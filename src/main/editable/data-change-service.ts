import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AbilityIds, type AbilityId } from '../../domain/character-models';
import { createDomainId, requireDomainId } from '../../domain/ids';
import { LifeStateIds } from '../../domain/models';
import type {
  AppliedDataChange,
  DataChange,
  DataChangeAuditTransaction,
  DataChangeTransaction,
  DataChangeTransactionResult,
  DataChangeValidationResult,
} from '../../shared/editable-domain';
import { ChronicleEngineError, stableStringify } from '../engine/service';

interface EntityRow {
  id: string;
  campaignId: string;
  entityType: string;
  revision: number;
}

interface DefinitionRow {
  id: string;
  campaignId: string | null;
  rulesetId: string;
  rulesetVersion: string;
  definitionType: string;
  builtIn: number;
}

interface StoredTransactionRow {
  payloadHash: string;
  resultJson: string;
}

export class DataChangeService {
  constructor(private readonly database: DatabaseSync) {}

  validate(transaction: DataChangeTransaction): DataChangeValidationResult {
    const errors: DataChangeValidationResult['errors'][number][] = [];
    const warnings: DataChangeValidationResult['warnings'][number][] = [];
    let normalized: DataChangeTransaction;
    try {
      normalized = normalizeTransaction(transaction);
    } catch (error) {
      return {
        valid: false,
        errors: [{ code: 'INVALID_INPUT', message: message(error) }],
        warnings,
        normalizedTransaction: null,
      };
    }
    const campaign = this.database.prepare(`
      SELECT id, ruleset_id AS rulesetId, ruleset_version AS rulesetVersion
      FROM campaigns WHERE id = ? AND archived_at IS NULL
    `).get(normalized.campaignId) as unknown as {
      id: string;
      rulesetId: string;
      rulesetVersion: string;
    } | undefined;
    if (!campaign) {
      errors.push({ code: 'ENTITY_NOT_FOUND', message: `Kampaň ${normalized.campaignId} neexistuje.` });
      return { valid: false, errors, warnings, normalizedTransaction: normalized };
    }

    const expected = new Map<string, number>();
    for (const item of normalized.expectedRevisions) {
      if (expected.has(item.entityId)) {
        errors.push({ code: 'INVALID_INPUT', message: `Revize entity ${item.entityId} je uvedena vícekrát.` });
        continue;
      }
      expected.set(item.entityId, item.revision);
      const entity = this.entity(item.entityId);
      if (!entity || entity.campaignId !== campaign.id) {
        errors.push({ code: 'CROSS_CAMPAIGN_REFERENCE', message: `Entita ${item.entityId} nepatří do kampaně.` });
      } else if (entity.revision !== item.revision) {
        errors.push({
          code: 'TRANSACTION_CONFLICT',
          message: `Entita ${item.entityId} byla mezitím změněna (očekávána revize ${item.revision}, nalezena ${entity.revision}).`,
        });
      }
    }

    const newCharacters = new Set<string>();
    const newDefinitions = new Map<string, string>();
    const plannedDefinitions = new Map(normalized.changes
      .filter((change): change is Extract<DataChange, { type: 'ruleDefinition.homebrew.create' }> => change.type === 'ruleDefinition.homebrew.create')
      .map((change) => [change.definitionId, change.definitionType]));
    const plannedParents = new Map(normalized.changes
      .filter((change): change is Extract<DataChange, { type: 'ruleDefinition.homebrew.create' }> => change.type === 'ruleDefinition.homebrew.create')
      .filter((change) => Boolean(change.parentDefinitionId))
      .map((change) => [change.definitionId, change.parentDefinitionId!]));
    const newSpellSources = new Set(
      normalized.changes
        .filter((change): change is Extract<DataChange, { type: 'character.spellcastingSource.add' }> => change.type === 'character.spellcastingSource.add')
        .map((change) => change.sourceId),
    );
    normalized.changes.forEach((change, index) => {
      try {
        if (change.type === 'character.create') {
          requireDomainId(change.characterId, 'char');
          if (this.entity(change.characterId) || newCharacters.has(change.characterId)) {
            throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Postava ${change.characterId} už existuje.`);
          }
          requiredText(change.name, 'Jméno postavy', 120);
          newCharacters.add(change.characterId);
          return;
        }
        if (change.type === 'ruleDefinition.homebrew.create') {
          requireDomainId(change.definitionId, 'def');
          if (this.definition(change.definitionId) || newDefinitions.has(change.definitionId)) {
            throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Definice ${change.definitionId} už existuje.`);
          }
          requiredText(change.definitionType, 'Typ definice', 80);
          requiredText(change.name, 'Název definice', 160);
          const expectedParentTypes = parentTypesFor(change.definitionType);
          if (expectedParentTypes.length && !change.parentDefinitionId) {
            throw new ChronicleEngineError('INVALID_INPUT', `${change.definitionType} musí mít vybranou nadřazenou definici.`);
          }
          if (change.parentDefinitionId) {
            requireDomainId(change.parentDefinitionId, 'def');
            const parent = this.definition(change.parentDefinitionId);
            const pendingParentType = plannedDefinitions.get(change.parentDefinitionId);
            if (!parent && !pendingParentType) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Nadřazená definice ${change.parentDefinitionId} neexistuje.`);
            const parentType = parent?.definitionType ?? pendingParentType!;
            if (expectedParentTypes.length && !expectedParentTypes.includes(parentType)) {
              throw new ChronicleEngineError('INVALID_INPUT', `Nadřazená definice musí být typu ${expectedParentTypes.join(' nebo ')}.`);
            }
            if (parent && (parent.rulesetId !== campaign.rulesetId || parent.rulesetVersion !== campaign.rulesetVersion)) {
              throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Nadřazená definice patří jinému rulesetu.');
            }
            if (parent?.campaignId && parent.campaignId !== campaign.id) {
              throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Nadřazená Homebrew definice patří jiné kampani.');
            }
          }
          newDefinitions.set(change.definitionId, change.definitionType);
          return;
        }
        const characterId = characterIdFor(change);
        if (characterId) this.requireCharacter(characterId, campaign.id, newCharacters);
        this.validateChange(change, campaign, plannedDefinitions, plannedParents, newCharacters, newSpellSources);
      } catch (error) {
        const mapped = error instanceof ChronicleEngineError ? error : new ChronicleEngineError('INVALID_INPUT', message(error));
        errors.push({ code: mapped.code, message: mapped.message, changeIndex: index });
      }
    });
    if (normalized.changes.length > 80) {
      errors.push({ code: 'OUT_OF_BOUNDS', message: 'Jedna změnová transakce může obsahovat nejvýše 80 operací.' });
    }
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      normalizedTransaction: normalized,
    };
  }

  apply(input: DataChangeTransaction): DataChangeTransactionResult {
    const transaction = normalizeTransaction(input);
    const hash = sha256(stableStringify(transaction));
    const stored = this.database.prepare(`
      SELECT payload_hash AS payloadHash, result_json AS resultJson
      FROM data_change_transactions WHERE id = ?
    `).get(transaction.id) as unknown as StoredTransactionRow | undefined;
    if (stored) {
      if (stored.payloadHash !== hash) {
        throw new ChronicleEngineError('TRANSACTION_ID_REUSED', `ID změnové transakce ${transaction.id} už bylo použito s jiným obsahem.`);
      }
      const result = JSON.parse(stored.resultJson) as DataChangeTransactionResult;
      return { ...result, alreadyApplied: true };
    }
    const validation = this.validate(transaction);
    if (!validation.valid || !validation.normalizedTransaction) {
      throw new ChronicleEngineError(
        'INVALID_INPUT',
        validation.errors.map((issue) => issue.message).join(' ') || 'Změnová transakce není platná.',
      );
    }

    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const raced = this.database.prepare('SELECT payload_hash AS payloadHash, result_json AS resultJson FROM data_change_transactions WHERE id = ?')
        .get(transaction.id) as unknown as StoredTransactionRow | undefined;
      if (raced) {
        if (raced.payloadHash !== hash) throw new ChronicleEngineError('TRANSACTION_ID_REUSED', 'ID transakce už bylo použito.');
        this.database.exec('ROLLBACK;');
        return { ...JSON.parse(raced.resultJson) as DataChangeTransactionResult, alreadyApplied: true };
      }
      this.assertExpectedRevisions(transaction);
      const applied: AppliedDataChange[] = [];
      const changedEntityIds = new Set<string>();
      const createdCharacterIds = new Set<string>();
      for (const change of transaction.changes) {
        const result = this.applyChange(transaction, change);
        applied.push(result);
        if (result.entityId) changedEntityIds.add(result.entityId);
        if (change.type === 'character.create') createdCharacterIds.add(change.characterId);
      }
      const now = timestamp();
      for (const entityId of changedEntityIds) {
        if (createdCharacterIds.has(entityId)) continue;
        this.database.prepare('UPDATE entities SET revision = revision + 1, updated_at = ? WHERE id = ?')
          .run(now, entityId);
      }
      const result: DataChangeTransactionResult = {
        transactionId: transaction.id,
        campaignId: transaction.campaignId,
        alreadyApplied: false,
        changedEntityIds: [...changedEntityIds],
        changes: applied,
        createdAt: now,
      };
      this.database.prepare(`
        INSERT INTO data_change_transactions(
          id, campaign_id, origin, summary, payload_hash, result_json,
          source_run_id, source_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        transaction.id,
        transaction.campaignId,
        transaction.origin,
        transaction.summary,
        hash,
        JSON.stringify(result),
        transaction.sourceRunId,
        transaction.sourceMessageId,
        now,
      );
      const insertAudit = this.database.prepare(`
        INSERT INTO data_change_audit_items(
          transaction_id, sequence, change_type, entity_id, before_json, after_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      applied.forEach((change, index) => insertAudit.run(
        transaction.id,
        index + 1,
        change.type,
        change.entityId,
        json(change.before),
        json(change.after),
        now,
      ));
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  listAudit(campaignId: string, limit = 100): DataChangeAuditTransaction[] {
    const rows = this.database.prepare(`
      SELECT t.id, t.campaign_id AS campaignId, t.origin, t.summary, t.created_at AS createdAt,
             group_concat(DISTINCT i.entity_id) AS entityIds
      FROM data_change_transactions t
      LEFT JOIN data_change_audit_items i ON i.transaction_id = t.id
      WHERE t.campaign_id = ?
      GROUP BY t.id ORDER BY t.created_at DESC LIMIT ?
    `).all(campaignId, Math.min(500, Math.max(1, limit))) as unknown as Array<{
      id: string;
      campaignId: string;
      origin: DataChangeTransaction['origin'];
      summary: string;
      createdAt: string;
      entityIds: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      campaignId: row.campaignId,
      origin: row.origin,
      summary: row.summary,
      changedEntityIds: row.entityIds ? row.entityIds.split(',') : [],
      createdAt: row.createdAt,
    }));
  }

  private validateChange(
    change: Exclude<DataChange, { type: 'character.create' } | { type: 'ruleDefinition.homebrew.create' }>,
    campaign: { id: string; rulesetId: string; rulesetVersion: string },
    newDefinitions: ReadonlyMap<string, string>,
    newDefinitionParents: ReadonlyMap<string, string>,
    newCharacters: ReadonlySet<string>,
    newSpellSources: ReadonlySet<string>,
  ): void {
    const definition = (id: string | null, types: readonly string[]): void => {
      if (!id) return;
      const pendingType = newDefinitions.get(id);
      if (pendingType) {
        if (!types.includes(pendingType)) throw new ChronicleEngineError('INVALID_INPUT', `Definice ${id} nemá očekávaný typ.`);
        return;
      }
      const row = this.definition(id);
      if (!row) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Definice ${id} neexistuje.`);
      if (row.rulesetId !== campaign.rulesetId || row.rulesetVersion !== campaign.rulesetVersion) {
        throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', `Definice ${id} patří jinému rulesetu.`);
      }
      if (row.campaignId && row.campaignId !== campaign.id) {
        throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', `Homebrew definice ${id} patří jiné kampani.`);
      }
      if (!types.includes(row.definitionType)) {
        throw new ChronicleEngineError('INVALID_INPUT', `Definice ${id} musí být typu ${types.join(' nebo ')}.`);
      }
    };
    const requireParent = (childId: string | null, parentId: string | null, relationTypes: readonly string[]): void => {
      if (!childId || !parentId) return;
      if (newDefinitionParents.get(childId) === parentId) return;
      const found = this.database.prepare(`
        SELECT 1 FROM rule_definition_relations
        WHERE source_definition_id = ? AND target_definition_id = ?
          AND relation_type IN (${relationTypes.map(() => '?').join(', ')})
      `).get(childId, parentId, ...relationTypes);
      if (!found) throw new ChronicleEngineError('INVALID_INPUT', 'Vybraná podřazená definice nepatří k nadřazené volbě.');
    };
    switch (change.type) {
      case 'character.identity.set':
        requiredText(change.name, 'Jméno postavy', 120);
        boundedOptional(change.fullName, 160, 'Celé jméno');
        boundedText(change.description, 10_000, 'Popis');
        break;
      case 'character.biography.set':
        if (change.age !== null && (!Number.isSafeInteger(change.age) || change.age < 0 || change.age > 10_000)) {
          throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Věk musí být celé číslo 0–10000 nebo prázdný.');
        }
        definition(change.faithDefinitionId, ['Deity', 'Custom']);
        break;
      case 'character.origin.set':
        definition(change.speciesId, ['Species', 'Race']);
        definition(change.lineageId, ['Lineage', 'Subrace']);
        definition(change.backgroundId, ['Background']);
        requireParent(change.lineageId, change.speciesId, ['belongsToSpecies', 'belongsToRace']);
        break;
      case 'character.class.add':
        requireDomainId(change.classEntryId, 'class');
        if (this.row('character_classes', change.classEntryId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Class entry ${change.classEntryId} už existuje.`);
        definition(change.classId, ['Class']);
        definition(change.subclassId, ['Subclass']);
        requireParent(change.subclassId, change.classId, ['belongsToClass']);
        level(change.level);
        break;
      case 'character.class.update':
        this.requireOwnedRow('character_classes', change.classEntryId, change.characterId, 'class');
        definition(change.classId, ['Class']);
        definition(change.subclassId, ['Subclass']);
        requireParent(change.subclassId, change.classId, ['belongsToClass']);
        level(change.level);
        break;
      case 'character.class.remove':
        this.requireOwnedRow('character_classes', change.classEntryId, change.characterId, 'class');
        break;
      case 'character.ability.set':
        if (!AbilityIds.includes(change.abilityId)) throw new ChronicleEngineError('INVALID_INPUT', 'Neplatná vlastnost postavy.');
        score(change.baseScore, 'Základ vlastnosti');
        score(change.permanentModifier, 'Trvalý modifikátor');
        if (change.overrideScore !== null) score(change.overrideScore, 'Přepsaná vlastnost');
        break;
      case 'character.proficiency.add':
        requireDomainId(change.proficiencyId, 'proficiency');
        if (this.row('character_proficiencies', change.proficiencyId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Zdatnost ${change.proficiencyId} už existuje.`);
        if (change.targetDefinitionId) definition(change.targetDefinitionId, ['Proficiency', 'Skill', 'Language', 'Custom']);
        if (!change.targetDefinitionId) requiredText(change.customTarget, 'Vlastní zdatnost', 160);
        break;
      case 'character.proficiency.update':
        this.requireOwnedRow('character_proficiencies', change.proficiencyId, change.characterId, 'proficiency');
        if (change.targetDefinitionId) definition(change.targetDefinitionId, ['Proficiency', 'Skill', 'Language', 'Custom']);
        if (!change.targetDefinitionId) requiredText(change.customTarget, 'Vlastní zdatnost', 160);
        break;
      case 'character.proficiency.remove':
      case 'character.language.remove':
        this.requireOwnedRow('character_proficiencies', change.proficiencyId, change.characterId, 'proficiency');
        break;
      case 'character.language.add':
        requireDomainId(change.proficiencyId, 'proficiency');
        if (this.row('character_proficiencies', change.proficiencyId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Jazyk ${change.proficiencyId} už existuje.`);
        if (change.languageDefinitionId) definition(change.languageDefinitionId, ['Language']);
        if (!change.languageDefinitionId) requiredText(change.customLanguage, 'Vlastní jazyk', 160);
        break;
      case 'character.language.update':
        this.requireOwnedRow('character_proficiencies', change.proficiencyId, change.characterId, 'language');
        if (change.languageDefinitionId) definition(change.languageDefinitionId, ['Language']);
        if (!change.languageDefinitionId) requiredText(change.customLanguage, 'Vlastní jazyk', 160);
        break;
      case 'character.feature.add':
        requireDomainId(change.featureId, 'feature');
        if (this.row('character_features', change.featureId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Schopnost ${change.featureId} už existuje.`);
        if (change.definitionId) definition(change.definitionId, ['Feature', 'Feat']);
        if (!change.definitionId) requiredText(change.customName, 'Vlastní schopnost', 160);
        break;
      case 'character.feature.update':
        this.requireOwnedRow('character_features', change.featureId, change.characterId, 'feature');
        if (change.definitionId) definition(change.definitionId, ['Feature', 'Feat']);
        if (!change.definitionId) requiredText(change.customName, 'Vlastní schopnost', 160);
        break;
      case 'character.feature.remove':
        this.requireOwnedRow('character_features', change.featureId, change.characterId, 'feature');
        break;
      case 'character.spellcastingSource.add':
        requireDomainId(change.sourceId, 'spellsource');
        if (this.row('spellcasting_sources', change.sourceId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Zdroj sesílání ${change.sourceId} už existuje.`);
        definition(change.sourceDefinitionId, ['Class', 'Subclass', 'Feature', 'Custom']);
        if (!AbilityIds.includes(change.abilityId)) throw new ChronicleEngineError('INVALID_INPUT', 'Neplatná sesílací vlastnost.');
        break;
      case 'character.spellcastingSource.update':
        this.requireOwnedRow('spellcasting_sources', change.sourceId, change.characterId, 'spellcasting source');
        definition(change.sourceDefinitionId, ['Class', 'Subclass', 'Feature', 'Custom']);
        if (!AbilityIds.includes(change.abilityId)) throw new ChronicleEngineError('INVALID_INPUT', 'Neplatná sesílací vlastnost.');
        break;
      case 'character.spellcastingSource.remove':
        this.requireOwnedRow('spellcasting_sources', change.sourceId, change.characterId, 'spellcasting source');
        break;
      case 'character.spell.add':
        requireDomainId(change.characterSpellId, 'spell');
        if (this.row('character_spells', change.characterSpellId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Kouzlo postavy ${change.characterSpellId} už existuje.`);
        definition(change.spellId, ['Spell']);
        if (!newSpellSources.has(change.spellcastingSourceId)) {
          this.requireOwnedRow('spellcasting_sources', change.spellcastingSourceId, change.characterId, 'spellcasting source');
        }
        break;
      case 'character.spell.update':
        this.requireOwnedRow('character_spells', change.characterSpellId, change.characterId, 'spell');
        definition(change.spellId, ['Spell']);
        this.requireOwnedRow('spellcasting_sources', change.spellcastingSourceId, change.characterId, 'spellcasting source');
        break;
      case 'character.spell.remove':
        this.requireOwnedRow('character_spells', change.characterSpellId, change.characterId, 'spell');
        break;
      case 'character.notes.replace':
        boundedOptional(change.notes, 20_000, 'Poznámky');
        break;
      case 'character.notes.append':
        requiredText(change.notes, 'Poznámka', 10_000);
        break;
      case 'ruleDefinition.homebrew.update': {
        const row = this.definition(change.definitionId);
        if (!row) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Definice ${change.definitionId} neexistuje.`);
        if (row.builtIn) throw new ChronicleEngineError('INVALID_INPUT', 'Vestavěnou definici nelze upravit.');
        if (row.rulesetId !== campaign.rulesetId || row.rulesetVersion !== campaign.rulesetVersion) {
          throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', `Definice ${change.definitionId} patří jinému rulesetu.`);
        }
        if (row.campaignId && row.campaignId !== campaign.id) {
          throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', `Homebrew definice ${change.definitionId} patří jiné kampani.`);
        }
        requiredText(change.name, 'Název definice', 160);
        boundedText(change.description, 10_000, 'Popis definice');
        if (!Array.isArray(change.aliases) || change.aliases.length > 32) {
          throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Definice může mít nejvýše 32 aliasů.');
        }
        change.aliases.forEach((alias) => requiredText(alias, 'Alias definice', 160));
        break;
      }
      case 'ruleReference.reassign':
        definition(change.fromDefinitionId, ['Species', 'Race', 'Lineage', 'Subrace', 'Background', 'Class', 'Subclass', 'Proficiency', 'Skill', 'Language', 'Feature', 'Feat', 'Spell']);
        definition(change.toDefinitionId, ['Species', 'Race', 'Lineage', 'Subrace', 'Background', 'Class', 'Subclass', 'Proficiency', 'Skill', 'Language', 'Feature', 'Feat', 'Spell']);
        break;
    }
  }

  private applyChange(transaction: DataChangeTransaction, change: DataChange): AppliedDataChange {
    switch (change.type) {
      case 'character.create': return this.createCharacter(transaction, change);
      case 'character.identity.set': {
        const before = this.characterIdentity(change.characterId);
        this.database.prepare('UPDATE entities SET name = ?, description = ?, updated_at = ? WHERE id = ?')
          .run(change.name.trim(), change.description.trim(), timestamp(), change.characterId);
        this.database.prepare('UPDATE characters SET full_name = ? WHERE entity_id = ?')
          .run(emptyToNull(change.fullName), change.characterId);
        return applied(change, change.characterId, before, this.characterIdentity(change.characterId));
      }
      case 'character.biography.set': {
        const before = this.biography(change.characterId);
        this.database.prepare(`UPDATE characters SET
          age=?, birth_date=?, sex_id=?, gender_id=?, sexual_orientation_id=?, alignment=?,
          faith_definition_id=?, appearance=?, biography=?, height=?, weight=?, eyes=?, hair=?, skin=?,
          personality_traits=?, ideals=?, bonds=?, flaws=?, notes=? WHERE entity_id=?`).run(
          change.age, change.birthDate, change.sexId, change.genderId, change.sexualOrientationId,
          change.alignment, change.faithDefinitionId, change.appearance, change.biography,
          change.height, change.weight, change.eyes, change.hair, change.skin,
          change.personalityTraits, change.ideals, change.bonds, change.flaws, change.notes,
          change.characterId,
        );
        return applied(change, change.characterId, before, this.biography(change.characterId));
      }
      case 'character.origin.set': {
        const before = this.origin(change.characterId);
        this.database.prepare('UPDATE characters SET species_id=?, lineage_id=?, background_id=? WHERE entity_id=?')
          .run(change.speciesId, change.lineageId, change.backgroundId, change.characterId);
        return applied(change, change.characterId, before, this.origin(change.characterId));
      }
      case 'character.class.add': {
        this.database.prepare(`INSERT INTO character_classes(id, character_id, class_id, subclass_id, level, acquired_event_id)
          VALUES (?, ?, ?, ?, ?, NULL)`).run(change.classEntryId, change.characterId, change.classId, change.subclassId, change.level);
        return applied(change, change.characterId, null, this.row('character_classes', change.classEntryId));
      }
      case 'character.class.update': {
        const before = this.row('character_classes', change.classEntryId);
        this.database.prepare('UPDATE character_classes SET class_id=?, subclass_id=?, level=? WHERE id=? AND character_id=?')
          .run(change.classId, change.subclassId, change.level, change.classEntryId, change.characterId);
        return applied(change, change.characterId, before, this.row('character_classes', change.classEntryId));
      }
      case 'character.class.remove': return this.removeRow(change, 'character_classes', change.classEntryId, change.characterId);
      case 'character.ability.set': {
        const before = this.database.prepare('SELECT * FROM character_ability_scores WHERE character_id=? AND ability_id=?')
          .get(change.characterId, change.abilityId) ?? null;
        this.database.prepare(`INSERT INTO character_ability_scores(character_id, ability_id, base_score, permanent_modifier, override_score)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(character_id, ability_id) DO UPDATE SET
          base_score=excluded.base_score, permanent_modifier=excluded.permanent_modifier, override_score=excluded.override_score`)
          .run(change.characterId, change.abilityId, change.baseScore, change.permanentModifier, change.overrideScore);
        const after = this.database.prepare('SELECT * FROM character_ability_scores WHERE character_id=? AND ability_id=?')
          .get(change.characterId, change.abilityId) ?? null;
        return applied(change, change.characterId, before, after);
      }
      case 'character.proficiency.add':
        return this.addProficiency(transaction, change, change.category, change.targetDefinitionId, change.customTarget, change.level);
      case 'character.language.add':
        return this.addProficiency(transaction, change, 'language', change.languageDefinitionId, change.customLanguage, 'proficient');
      case 'character.proficiency.update': {
        const before = this.row('character_proficiencies', change.proficiencyId);
        this.database.prepare(`UPDATE character_proficiencies SET category=?, target_definition_id=?,
          custom_target=?, proficiency_level=? WHERE id=? AND character_id=?`).run(
          change.category, change.targetDefinitionId, emptyToNull(change.customTarget), change.level,
          change.proficiencyId, change.characterId,
        );
        return applied(change, change.characterId, before, this.row('character_proficiencies', change.proficiencyId));
      }
      case 'character.language.update': {
        const before = this.row('character_proficiencies', change.proficiencyId);
        this.database.prepare(`UPDATE character_proficiencies SET category='language', target_definition_id=?,
          custom_target=?, proficiency_level='proficient' WHERE id=? AND character_id=?`).run(
          change.languageDefinitionId, emptyToNull(change.customLanguage), change.proficiencyId, change.characterId,
        );
        return applied(change, change.characterId, before, this.row('character_proficiencies', change.proficiencyId));
      }
      case 'character.proficiency.remove':
      case 'character.language.remove':
        return this.removeRow(change, 'character_proficiencies', change.proficiencyId, change.characterId);
      case 'character.feature.add': {
        this.database.prepare(`INSERT INTO character_features(
          id, definition_id, character_id, source_type, source_id, acquired_event_id,
          enabled, custom_name, custom_description, choices, metadata
        ) VALUES (?, ?, ?, 'editable-domain', ?, NULL, 1, ?, ?, NULL, NULL)`).run(
          change.featureId, change.definitionId, change.characterId, transaction.id,
          emptyToNull(change.customName), emptyToNull(change.customDescription),
        );
        return applied(change, change.characterId, null, this.row('character_features', change.featureId));
      }
      case 'character.feature.update': {
        const before = this.row('character_features', change.featureId);
        this.database.prepare(`UPDATE character_features SET definition_id=?, custom_name=?,
          custom_description=? WHERE id=? AND character_id=?`).run(
          change.definitionId, emptyToNull(change.customName), emptyToNull(change.customDescription),
          change.featureId, change.characterId,
        );
        return applied(change, change.characterId, before, this.row('character_features', change.featureId));
      }
      case 'character.feature.remove': return this.removeRow(change, 'character_features', change.featureId, change.characterId);
      case 'character.spellcastingSource.add': {
        this.database.prepare(`INSERT INTO spellcasting_sources(
          id, character_id, source_type, source_id, spellcasting_ability_id,
          mechanism, attack_modifier, dc_modifier, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, NULL)`).run(
          change.sourceId, change.characterId, change.sourceType, change.sourceDefinitionId,
          change.abilityId, change.mechanism,
        );
        return applied(change, change.characterId, null, this.row('spellcasting_sources', change.sourceId));
      }
      case 'character.spellcastingSource.update': {
        const before = this.row('spellcasting_sources', change.sourceId);
        this.database.prepare(`UPDATE spellcasting_sources SET source_type=?, source_id=?,
          spellcasting_ability_id=?, mechanism=? WHERE id=? AND character_id=?`).run(
          change.sourceType, change.sourceDefinitionId, change.abilityId, change.mechanism,
          change.sourceId, change.characterId,
        );
        return applied(change, change.characterId, before, this.row('spellcasting_sources', change.sourceId));
      }
      case 'character.spellcastingSource.remove': return this.removeRow(change, 'spellcasting_sources', change.sourceId, change.characterId);
      case 'character.spell.add': {
        this.database.prepare(`INSERT INTO character_spells(
          id, character_id, spell_id, spellcasting_source_id, known, prepared,
          always_prepared, ritual_available, custom_notes, acquired_event_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
          change.characterSpellId, change.characterId, change.spellId, change.spellcastingSourceId,
          integer(change.known), integer(change.prepared), integer(change.alwaysPrepared),
          integer(change.ritualAvailable), emptyToNull(change.customNotes),
        );
        return applied(change, change.characterId, null, this.row('character_spells', change.characterSpellId));
      }
      case 'character.spell.update': {
        const before = this.row('character_spells', change.characterSpellId);
        this.database.prepare(`UPDATE character_spells SET spell_id=?, spellcasting_source_id=?,
          known=?, prepared=?, always_prepared=?, ritual_available=?, custom_notes=?
          WHERE id=? AND character_id=?`).run(
          change.spellId, change.spellcastingSourceId, integer(change.known), integer(change.prepared),
          integer(change.alwaysPrepared), integer(change.ritualAvailable), emptyToNull(change.customNotes),
          change.characterSpellId, change.characterId,
        );
        return applied(change, change.characterId, before, this.row('character_spells', change.characterSpellId));
      }
      case 'character.spell.remove': return this.removeRow(change, 'character_spells', change.characterSpellId, change.characterId);
      case 'character.notes.replace': {
        const before = this.database.prepare('SELECT notes FROM characters WHERE entity_id=?').get(change.characterId) ?? null;
        this.database.prepare('UPDATE characters SET notes=? WHERE entity_id=?').run(emptyToNull(change.notes), change.characterId);
        return applied(change, change.characterId, before, { notes: emptyToNull(change.notes) });
      }
      case 'character.notes.append': {
        const before = this.database.prepare('SELECT notes FROM characters WHERE entity_id=?').get(change.characterId) as unknown as { notes: string | null };
        const notes = [before.notes?.trim(), change.notes.trim()].filter(Boolean).join('\n\n');
        this.database.prepare('UPDATE characters SET notes=? WHERE entity_id=?').run(notes, change.characterId);
        return applied(change, change.characterId, before, { notes });
      }
      case 'ruleDefinition.homebrew.create': {
        const campaign = this.database.prepare('SELECT ruleset_id AS rulesetId, ruleset_version AS rulesetVersion FROM campaigns WHERE id=?')
          .get(transaction.campaignId) as unknown as { rulesetId: string; rulesetVersion: string };
        const now = timestamp();
        this.database.prepare(`INSERT INTO rule_definitions(
          id, definition_type, ruleset_id, ruleset_version, name, description, source, origin,
          metadata, is_homebrew, created_at, updated_at, campaign_id, canonical_id, aliases,
          pack_id, pack_version, locale, is_builtin
        ) VALUES (?, ?, ?, ?, ?, ?, 'Kampaň', 'homebrew', NULL, 1, ?, ?, ?, NULL, ?, NULL, 'homebrew', 'cs', 0)`)
          .run(change.definitionId, change.definitionType, campaign.rulesetId, campaign.rulesetVersion,
            change.name.trim(), change.description.trim(), now, now, transaction.campaignId,
            JSON.stringify(change.aliases));
        if (change.parentDefinitionId) {
          const relationType = relationTypeFor(change.definitionType);
          if (relationType) this.database.prepare(`
            INSERT INTO rule_definition_relations(source_definition_id, target_definition_id, relation_type)
            VALUES (?, ?, ?)
          `).run(change.definitionId, change.parentDefinitionId, relationType);
        }
        return applied(change, null, null, { definitionId: change.definitionId, name: change.name });
      }
      case 'ruleDefinition.homebrew.update': {
        const before = this.database.prepare(`SELECT id, name, description, aliases, updated_at AS updatedAt
          FROM rule_definitions WHERE id = ?`).get(change.definitionId) ?? null;
        this.database.prepare(`UPDATE rule_definitions SET name = ?, description = ?, aliases = ?, updated_at = ?
          WHERE id = ? AND is_builtin = 0`).run(
          change.name.trim(), change.description.trim(), JSON.stringify(change.aliases), timestamp(), change.definitionId,
        );
        const after = this.database.prepare(`SELECT id, name, description, aliases, updated_at AS updatedAt
          FROM rule_definitions WHERE id = ?`).get(change.definitionId) ?? null;
        return applied(change, change.definitionId, before, after);
      }
      case 'ruleReference.reassign': return this.reassignReference(transaction, change);
    }
  }

  private createCharacter(
    transaction: DataChangeTransaction,
    change: Extract<DataChange, { type: 'character.create' }>,
  ): AppliedDataChange {
    const now = timestamp();
    this.database.prepare(`INSERT INTO entities(
      id, campaign_id, entity_type, name, description, image_resource_id,
      created_event_id, created_at, updated_at, revision
    ) VALUES (?, ?, 'Character', ?, ?, NULL, NULL, ?, ?, 1)`).run(
      change.characterId, transaction.campaignId, change.name.trim(), change.description.trim(), now, now,
    );
    this.database.prepare(`INSERT INTO characters(
      entity_id, full_name, character_type, current_location_id, current_life_state_id
    ) VALUES (?, ?, ?, NULL, ?)`).run(
      change.characterId, emptyToNull(change.fullName), change.characterType, LifeStateIds.alive,
    );
    const ability = this.database.prepare(`INSERT INTO character_ability_scores(
      character_id, ability_id, base_score, permanent_modifier, override_score
    ) VALUES (?, ?, 10, 0, NULL)`);
    for (const abilityId of AbilityIds) ability.run(change.characterId, abilityId);
    this.database.prepare(`INSERT INTO character_combat_state(
      character_id, maximum_hp, current_hp, temporary_hp, armor_class_base,
      armor_class_modifier, armor_class_override, initiative_modifier,
      death_save_successes, death_save_failures, inspiration
    ) VALUES (?, 10, 10, 0, 10, 0, NULL, 0, 0, 0, 0)`).run(change.characterId);
    this.database.prepare(`INSERT INTO character_movements(
      id, character_id, movement_type, distance, unit, source_type, source_id, condition_text
    ) VALUES (?, ?, 'walk', 30, 'ft', 'bootstrap', ?, NULL)`).run(
      createDomainId('movement'), change.characterId, transaction.id,
    );
    return applied(change, change.characterId, null, this.characterIdentity(change.characterId));
  }

  private addProficiency(
    transaction: DataChangeTransaction,
    change: Extract<DataChange, { type: 'character.proficiency.add' | 'character.language.add' }>,
    category: string,
    targetDefinitionId: string | null,
    customTarget: string | null,
    proficiencyLevel: string,
  ): AppliedDataChange {
    this.database.prepare(`INSERT INTO character_proficiencies(
      id, character_id, category, target_definition_id, custom_target,
      proficiency_level, source_type, source_id, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, 'editable-domain', ?, NULL)`).run(
      change.proficiencyId, change.characterId, category, targetDefinitionId,
      emptyToNull(customTarget), proficiencyLevel, transaction.id,
    );
    return applied(change, change.characterId, null, this.row('character_proficiencies', change.proficiencyId));
  }

  private removeRow(
    change: DataChange,
    table: OwnedTable,
    id: string,
    characterId: string,
  ): AppliedDataChange {
    const before = this.row(table, id);
    this.database.prepare(`DELETE FROM ${table} WHERE id=? AND character_id=?`).run(id, characterId);
    return applied(change, characterId, before, null);
  }

  private reassignReference(
    transaction: DataChangeTransaction,
    change: Extract<DataChange, { type: 'ruleReference.reassign' }>,
  ): AppliedDataChange {
    const mapping: Record<typeof change.category, { table: string; column: string; key: string }> = {
      species: { table: 'characters', column: 'species_id', key: 'entity_id' },
      lineage: { table: 'characters', column: 'lineage_id', key: 'entity_id' },
      background: { table: 'characters', column: 'background_id', key: 'entity_id' },
      class: { table: 'character_classes', column: 'class_id', key: 'id' },
      subclass: { table: 'character_classes', column: 'subclass_id', key: 'id' },
      proficiency: { table: 'character_proficiencies', column: 'target_definition_id', key: 'id' },
      language: { table: 'character_proficiencies', column: 'target_definition_id', key: 'id' },
      feature: { table: 'character_features', column: 'definition_id', key: 'id' },
      spell: { table: 'character_spells', column: 'spell_id', key: 'id' },
    };
    const target = mapping[change.category];
    const current = this.database.prepare(`SELECT ${target.column} AS definitionId FROM ${target.table} WHERE ${target.key}=?`)
      .get(change.referenceId) as unknown as { definitionId: string | null } | undefined;
    if (!current || current.definitionId !== change.fromDefinitionId) {
      throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Původní odkaz se od vytvoření návrhu změnil.');
    }
    this.database.prepare(`UPDATE ${target.table} SET ${target.column}=? WHERE ${target.key}=?`)
      .run(change.toDefinitionId, change.referenceId);
    this.database.prepare(`INSERT OR IGNORE INTO rule_reference_reconciliations(
      campaign_id, character_id, old_definition_id, new_definition_id, category,
      transaction_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      transaction.campaignId, change.characterId, change.fromDefinitionId,
      change.toDefinitionId, change.category, transaction.id, timestamp(),
    );
    return applied(change, change.characterId, { definitionId: change.fromDefinitionId }, { definitionId: change.toDefinitionId });
  }

  private assertExpectedRevisions(transaction: DataChangeTransaction): void {
    for (const expected of transaction.expectedRevisions) {
      const entity = this.entity(expected.entityId);
      if (!entity || entity.campaignId !== transaction.campaignId || entity.revision !== expected.revision) {
        throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Entita ${expected.entityId} byla mezitím změněna. Načtěte editor znovu.`);
      }
    }
  }

  private entity(id: string): EntityRow | undefined {
    return this.database.prepare(`SELECT id, campaign_id AS campaignId, entity_type AS entityType, revision
      FROM entities WHERE id=?`).get(id) as unknown as EntityRow | undefined;
  }

  private definition(id: string): DefinitionRow | undefined {
    return this.database.prepare(`SELECT id, campaign_id AS campaignId, ruleset_id AS rulesetId,
      ruleset_version AS rulesetVersion, definition_type AS definitionType,
      is_builtin AS builtIn FROM rule_definitions WHERE id=?`).get(id) as unknown as DefinitionRow | undefined;
  }

  private requireCharacter(id: string, campaignId: string, newCharacters: ReadonlySet<string>): void {
    if (newCharacters.has(id)) return;
    const entity = this.entity(id);
    if (!entity) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Postava ${id} neexistuje.`);
    if (entity.campaignId !== campaignId) throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', `Postava ${id} patří jiné kampani.`);
    if (entity.entityType !== 'Character') throw new ChronicleEngineError('INVALID_INPUT', `Entita ${id} není postava.`);
  }

  private requireOwnedRow(table: OwnedTable, id: string, characterId: string, label: string): void {
    const row = this.database.prepare(`SELECT 1 AS found FROM ${table} WHERE id=? AND character_id=?`).get(id, characterId);
    if (!row) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `${label} ${id} nepatří postavě ${characterId}.`);
  }

  private row(table: OwnedTable, id: string): unknown {
    return this.database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) ?? null;
  }

  private characterIdentity(characterId: string): unknown {
    return this.database.prepare(`SELECT e.id, e.name, e.description, c.full_name AS fullName,
      c.character_type AS characterType, e.revision FROM entities e JOIN characters c ON c.entity_id=e.id
      WHERE e.id=?`).get(characterId) ?? null;
  }

  private biography(characterId: string): unknown {
    return this.database.prepare(`SELECT age, birth_date AS birthDate, sex_id AS sexId,
      gender_id AS genderId, sexual_orientation_id AS sexualOrientationId, alignment,
      faith_definition_id AS faithDefinitionId, appearance, biography, height, weight,
      eyes, hair, skin, personality_traits AS personalityTraits, ideals, bonds, flaws, notes
      FROM characters WHERE entity_id=?`).get(characterId) ?? null;
  }

  private origin(characterId: string): unknown {
    return this.database.prepare(`SELECT species_id AS speciesId, lineage_id AS lineageId,
      background_id AS backgroundId FROM characters WHERE entity_id=?`).get(characterId) ?? null;
  }
}

type OwnedTable = 'character_classes' | 'character_proficiencies' | 'character_features'
  | 'spellcasting_sources' | 'character_spells';

function normalizeTransaction(transaction: DataChangeTransaction): DataChangeTransaction {
  requireDomainId(transaction.id, 'change');
  requireDomainId(transaction.campaignId, 'campaign');
  if (!['manual', 'ai', 'system'].includes(transaction.origin)) throw new Error('Neplatný původ změny.');
  if (!Array.isArray(transaction.changes) || transaction.changes.length === 0) throw new Error('Transakce musí obsahovat alespoň jednu změnu.');
  return {
    ...structuredClone(transaction),
    summary: requiredText(transaction.summary, 'Souhrn změny', 500),
    changes: transaction.changes.map((change) => structuredClone(change)),
    expectedRevisions: (transaction.expectedRevisions ?? []).map((item) => ({
      entityId: item.entityId,
      revision: item.revision,
    })),
    sourceRunId: transaction.sourceRunId ?? null,
    sourceMessageId: transaction.sourceMessageId ?? null,
  };
}

function characterIdFor(change: DataChange): string | null {
  return 'characterId' in change && typeof change.characterId === 'string' ? change.characterId : null;
}

function applied(change: DataChange, entityId: string | null, before: unknown, after: unknown): AppliedDataChange {
  return { type: change.type, entityId, before, after };
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdný.`);
  if (value.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhý.`);
  return value.trim();
}

function boundedText(value: string, maximum: number, label: string): void {
  if (value.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhý.`);
}

function boundedOptional(value: string | null, maximum: number, label: string): void {
  if (value !== null) boundedText(value, maximum, label);
}

function level(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 20) throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Úroveň musí být 1–20.');
}

function score(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < -100 || value > 100) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} musí být celé číslo -100 až 100.`);
}

function emptyToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

function integer(value: boolean): number { return value ? 1 : 0; }
function json(value: unknown): string | null { return value === null || value === undefined ? null : JSON.stringify(value); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function timestamp(): string { return new Date().toISOString(); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function parentTypesFor(definitionType: string): readonly string[] {
  if (definitionType === 'Lineage' || definitionType === 'Subrace') return ['Species', 'Race'];
  if (definitionType === 'Subclass') return ['Class'];
  return [];
}

function relationTypeFor(definitionType: string): string | null {
  if (definitionType === 'Lineage') return 'belongsToSpecies';
  if (definitionType === 'Subrace') return 'belongsToRace';
  if (definitionType === 'Subclass') return 'belongsToClass';
  return null;
}
