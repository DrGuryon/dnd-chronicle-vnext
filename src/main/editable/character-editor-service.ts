import type { DatabaseSync } from 'node:sqlite';
import { AbilityIds } from '../../domain/character-models';
import { createDomainId } from '../../domain/ids';
import type { Character } from '../../domain/models';
import type {
  CharacterDraft,
  CharacterEditorView,
  DataChange,
  DataChangeTransactionResult,
} from '../../shared/editable-domain';
import { ChronicleEngineError } from '../engine/service';
import { DataChangeService } from './data-change-service';

export class CharacterEditorService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly dataChanges: DataChangeService,
  ) {}

  get(characterId: string): CharacterEditorView | undefined {
    const character = this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, e.revision, c.full_name AS fullName,
             c.character_type AS characterType, c.current_location_id AS currentLocationId,
             c.current_life_state_id AS currentLifeStateId
      FROM entities e JOIN characters c ON c.entity_id=e.id WHERE e.id=?
    `).get(characterId) as unknown as (Character & { revision: number }) | undefined;
    if (!character) return undefined;
    const biography = this.database.prepare(`
      SELECT entity_id AS characterId, age, birth_date AS birthDate, sex_id AS sexId,
             gender_id AS genderId, sexual_orientation_id AS sexualOrientationId,
             alignment, faith_definition_id AS faithDefinitionId, appearance, biography,
             height, weight, eyes, hair, skin, personality_traits AS personalityTraits,
             ideals, bonds, flaws, notes FROM characters WHERE entity_id=?
    `).get(characterId) as unknown as CharacterEditorView['biography'];
    const origin = this.database.prepare(`SELECT entity_id AS characterId,
      species_id AS speciesId, lineage_id AS lineageId, background_id AS backgroundId
      FROM characters WHERE entity_id=?`).get(characterId) as unknown as CharacterEditorView['origin'];
    const classes = this.database.prepare(`SELECT id, character_id AS characterId, class_id AS classId,
      subclass_id AS subclassId, level, acquired_event_id AS acquiredEventId
      FROM character_classes WHERE character_id=? ORDER BY rowid`).all(characterId) as unknown as CharacterEditorView['classes'];
    const abilities = AbilityIds.map((abilityId) => (
      this.database.prepare(`SELECT character_id AS characterId, ability_id AS abilityId,
        base_score AS baseScore, permanent_modifier AS permanentModifier,
        override_score AS overrideScore FROM character_ability_scores
        WHERE character_id=? AND ability_id=?`).get(characterId, abilityId) as unknown as CharacterEditorView['abilities'][number] | undefined
    )).filter((value): value is CharacterEditorView['abilities'][number] => Boolean(value));
    const proficiencies = (this.database.prepare(`SELECT id, character_id AS characterId, category,
      target_definition_id AS targetDefinitionId, custom_target AS customTarget,
      proficiency_level AS level, source_type AS sourceType, source_id AS sourceId, metadata
      FROM character_proficiencies WHERE character_id=? ORDER BY rowid`).all(characterId) as unknown as Array<Record<string, unknown>>)
      .map((row) => ({ ...row, metadata: parseRecord(row.metadata) })) as unknown as CharacterEditorView['proficiencies'];
    const features = (this.database.prepare(`SELECT id, definition_id AS definitionId,
      character_id AS characterId, source_type AS sourceType, source_id AS sourceId,
      acquired_event_id AS acquiredEventId, enabled, custom_name AS customName,
      custom_description AS customDescription, choices, metadata
      FROM character_features WHERE character_id=? ORDER BY rowid`).all(characterId) as unknown as Array<Record<string, unknown>>)
      .map((row) => ({
        ...row,
        enabled: Boolean(row.enabled),
        choices: parseRecord(row.choices),
        metadata: parseRecord(row.metadata),
      })) as unknown as CharacterEditorView['features'];
    const spellcastingSources = (this.database.prepare(`SELECT id, character_id AS characterId,
      source_type AS sourceType, source_id AS sourceId,
      spellcasting_ability_id AS spellcastingAbilityId, mechanism,
      attack_modifier AS attackModifier, dc_modifier AS dcModifier, metadata
      FROM spellcasting_sources WHERE character_id=? ORDER BY rowid`).all(characterId) as unknown as Array<Record<string, unknown>>)
      .map((row) => ({ ...row, metadata: parseRecord(row.metadata) })) as unknown as CharacterEditorView['spellcastingSources'];
    const spells = (this.database.prepare(`SELECT id, character_id AS characterId, spell_id AS spellId,
      spellcasting_source_id AS spellcastingSourceId, known, prepared,
      always_prepared AS alwaysPrepared, ritual_available AS ritualAvailable,
      custom_notes AS customNotes, acquired_event_id AS acquiredEventId
      FROM character_spells WHERE character_id=? ORDER BY rowid`).all(characterId) as unknown as Array<Record<string, unknown>>)
      .map((row) => ({
        ...row,
        known: Boolean(row.known),
        prepared: Boolean(row.prepared),
        alwaysPrepared: Boolean(row.alwaysPrepared),
        ritualAvailable: Boolean(row.ritualAvailable),
      })) as unknown as CharacterEditorView['spells'];
    return {
      character,
      revision: character.revision,
      biography,
      origin,
      classes,
      abilities,
      proficiencies,
      features,
      spellcastingSources,
      spells,
    };
  }

  save(draft: CharacterDraft): { view: CharacterEditorView; result: DataChangeTransactionResult } {
    const campaign = this.database.prepare(`SELECT id FROM campaigns WHERE id=? AND archived_at IS NULL`)
      .get(draft.campaignId);
    if (!campaign) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Kampaň ${draft.campaignId} neexistuje.`);
    const existing = draft.characterId ? this.get(draft.characterId) : undefined;
    if (draft.characterId && !existing) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Postava ${draft.characterId} neexistuje.`);
    if (existing && existing.character.campaignId !== draft.campaignId) {
      throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Postava patří jiné kampani.');
    }
    if (existing && draft.baseRevision === undefined) {
      throw new ChronicleEngineError('INVALID_INPUT', 'Editor musí při uložení uvést načtenou revizi postavy.');
    }
    const characterId = draft.characterId ?? createDomainId('char');
    const changes: DataChange[] = [];
    for (const definition of draft.homebrewDefinitions ?? []) {
      changes.push({
        type: 'ruleDefinition.homebrew.create',
        definitionId: definition.id || createDomainId('def'),
        definitionType: definition.definitionType,
        name: definition.name,
        description: definition.description ?? '',
        aliases: definition.aliases ?? [],
      });
    }
    if (!existing) {
      changes.push({
        type: 'character.create', characterId, name: draft.name, fullName: draft.fullName,
        characterType: draft.characterType, description: draft.description,
      });
    } else {
      changes.push({
        type: 'character.identity.set', characterId, name: draft.name,
        fullName: draft.fullName, description: draft.description,
      });
    }
    changes.push({ type: 'character.biography.set', characterId, ...draft.biography });
    changes.push({ type: 'character.origin.set', characterId, ...draft.origin });
    this.syncClasses(changes, characterId, existing?.classes ?? [], draft.classes);
    for (const ability of draft.abilities) changes.push({ type: 'character.ability.set', characterId, ...ability });
    this.syncProficiencies(changes, characterId, existing?.proficiencies ?? [], draft.proficiencies);
    this.syncFeatures(changes, characterId, existing?.features ?? [], draft.features);
    this.syncSpellcasting(changes, characterId, existing, draft);

    const result = this.dataChanges.apply({
      id: createDomainId('change'),
      campaignId: draft.campaignId,
      origin: 'manual',
      summary: existing ? `Upravení postavy ${draft.name.trim()}` : `Vytvoření postavy ${draft.name.trim()}`,
      changes,
      expectedRevisions: existing ? [{ entityId: characterId, revision: draft.baseRevision! }] : [],
      sourceRunId: null,
      sourceMessageId: null,
    });
    return { view: this.get(characterId)!, result };
  }

  private syncClasses(
    changes: DataChange[],
    characterId: string,
    current: CharacterEditorView['classes'],
    draft: CharacterDraft['classes'],
  ): void {
    const wanted = new Set(draft.map((item) => item.id).filter(Boolean));
    for (const item of current) {
      if (!wanted.has(item.id)) changes.push({ type: 'character.class.remove', classEntryId: item.id, characterId });
    }
    const existing = new Set(current.map((item) => item.id));
    for (const item of draft) {
      const classEntryId = item.id || createDomainId('class');
      changes.push({
        type: existing.has(classEntryId) ? 'character.class.update' : 'character.class.add',
        classEntryId, characterId, classId: item.classId, subclassId: item.subclassId, level: item.level,
      });
    }
  }

  private syncProficiencies(
    changes: DataChange[],
    characterId: string,
    current: CharacterEditorView['proficiencies'],
    draft: CharacterDraft['proficiencies'],
  ): void {
    const wanted = new Set(draft.map((item) => item.id).filter(Boolean));
    for (const item of current) {
      if (!wanted.has(item.id)) changes.push({
        type: item.category === 'language' ? 'character.language.remove' : 'character.proficiency.remove',
        proficiencyId: item.id,
        characterId,
      });
    }
    const existing = new Set(current.map((item) => item.id));
    for (const item of draft) {
      const proficiencyId = item.id || createDomainId('proficiency');
      if (item.category === 'language') {
        changes.push({
          type: existing.has(proficiencyId) ? 'character.language.update' : 'character.language.add',
          proficiencyId,
          characterId,
          languageDefinitionId: item.targetDefinitionId,
          customLanguage: item.customTarget,
        });
      } else {
        const proficiency = {
          proficiencyId, characterId, category: item.category,
          targetDefinitionId: item.targetDefinitionId, customTarget: item.customTarget, level: item.level,
        };
        changes.push(existing.has(proficiencyId)
          ? { type: 'character.proficiency.update', ...proficiency }
          : { type: 'character.proficiency.add', ...proficiency });
      }
    }
  }

  private syncFeatures(
    changes: DataChange[],
    characterId: string,
    current: CharacterEditorView['features'],
    draft: CharacterDraft['features'],
  ): void {
    const wanted = new Set(draft.map((item) => item.id).filter(Boolean));
    for (const item of current) {
      if (!wanted.has(item.id)) changes.push({ type: 'character.feature.remove', featureId: item.id, characterId });
    }
    const existing = new Set(current.map((item) => item.id));
    for (const item of draft) {
      const featureId = item.id || createDomainId('feature');
      changes.push({
        type: existing.has(featureId) ? 'character.feature.update' : 'character.feature.add',
        featureId,
        characterId,
        definitionId: item.definitionId,
        customName: item.customName,
        customDescription: item.customDescription,
      });
    }
  }

  private syncSpellcasting(
    changes: DataChange[],
    characterId: string,
    current: CharacterEditorView | undefined,
    draft: CharacterDraft,
  ): void {
    const currentSpells = current?.spells ?? [];
    const wantedSpells = new Set(draft.spells.map((item) => item.id).filter(Boolean));
    for (const item of currentSpells) {
      if (!wantedSpells.has(item.id)) changes.push({ type: 'character.spell.remove', characterSpellId: item.id, characterId });
    }
    const currentSources = current?.spellcastingSources ?? [];
    const wantedSources = new Set(draft.spellcastingSources.map((item) => item.id).filter(Boolean));
    for (const item of currentSources) {
      if (!wantedSources.has(item.id)) changes.push({ type: 'character.spellcastingSource.remove', sourceId: item.id, characterId });
    }
    const existingSources = new Set(currentSources.map((item) => item.id));
    for (const item of draft.spellcastingSources) {
      const sourceId = item.id || createDomainId('spellsource');
      changes.push({
        type: existingSources.has(sourceId) ? 'character.spellcastingSource.update' : 'character.spellcastingSource.add',
        sourceId,
        characterId,
        sourceType: item.sourceType,
        sourceDefinitionId: item.sourceId,
        abilityId: item.spellcastingAbilityId,
        mechanism: item.mechanism,
      });
    }
    const existingSpells = new Set(currentSpells.map((item) => item.id));
    for (const item of draft.spells) {
      const characterSpellId = item.id || createDomainId('spell');
      changes.push({
        type: existingSpells.has(characterSpellId) ? 'character.spell.update' : 'character.spell.add',
        characterSpellId,
        characterId,
        spellId: item.spellId,
        spellcastingSourceId: item.spellcastingSourceId,
        known: item.known,
        prepared: item.prepared,
        alwaysPrepared: item.alwaysPrepared,
        ritualAvailable: item.ritualAvailable,
        customNotes: item.customNotes,
      });
    }
  }
}

function parseRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Readonly<Record<string, unknown>> : null;
}
