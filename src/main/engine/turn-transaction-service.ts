import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { createDomainId } from '../../domain/ids';
import type { EntityType, ItemPlacement } from '../../domain/models';
import type {
  AppliedTurnChange,
  ChronicleErrorCode,
  TurnChange,
  TurnTransaction,
  TurnTransactionResult,
  TurnValidationIssue,
  TurnValidationResult,
} from '../../shared/chronicle-engine';
import { CharacterDomainService } from '../character/service';
import { ChronicleDomainService } from '../domain/service';
import { ChronicleEngineError, stableStringify } from './service';

interface EntityIdentity {
  campaignId: string;
  entityType: EntityType;
}

export class TurnTransactionService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly domain: ChronicleDomainService,
    private readonly characters: CharacterDomainService,
  ) {}

  validateTurnTransaction(transaction: TurnTransaction): TurnValidationResult {
    const errors: TurnValidationIssue[] = [];
    const warnings: TurnValidationIssue[] = [];
    const add = (code: ChronicleErrorCode, message: string, changeIndex?: number, field?: string) => {
      errors.push({ code, message, ...(changeIndex === undefined ? {} : { changeIndex }), ...(field ? { field } : {}) });
    };
    if (!transaction || typeof transaction !== 'object') {
      return { valid: false, errors: [{ code: 'INVALID_INPUT', message: 'TurnTransaction musí být object.' }], warnings };
    }
    if (!validText(transaction.id)) add('INVALID_INPUT', 'Transaction ID nesmí být prázdné.', undefined, 'id');
    if (!validText(transaction.campaignId) || !this.domain.getCampaign(transaction.campaignId)) {
      add('ENTITY_NOT_FOUND', `Campaign ${transaction.campaignId} neexistuje.`, undefined, 'campaignId');
      return { valid: false, errors, warnings };
    }
    if (!validText(transaction.event?.eventType)) add('INVALID_INPUT', 'Event type nesmí být prázdný.', undefined, 'event.eventType');
    if (!validText(transaction.event?.summary)) add('INVALID_INPUT', 'Event summary nesmí být prázdný.', undefined, 'event.summary');
    if (!Array.isArray(transaction.changes) || transaction.changes.length === 0) {
      add('INVALID_INPUT', 'TurnTransaction musí obsahovat alespoň jednu změnu.', undefined, 'changes');
    }
    if (transaction.event?.locationId) this.validateEntity(transaction.event.locationId, transaction.campaignId, add, undefined, 'Location');
    for (const reference of transaction.event?.entityReferences ?? []) {
      this.validateEntity(reference.entityId, transaction.campaignId, add);
      if (!validText(reference.role)) add('INVALID_INPUT', 'Event reference role nesmí být prázdná.');
    }
    if (transaction.sourceConversationId) {
      const row = this.database.prepare('SELECT campaign_id AS campaignId FROM conversations WHERE id = ?')
        .get(transaction.sourceConversationId) as unknown as { campaignId: string } | undefined;
      if (!row) add('ENTITY_NOT_FOUND', `Conversation ${transaction.sourceConversationId} neexistuje.`);
      else if (row.campaignId !== transaction.campaignId) add('CROSS_CAMPAIGN_REFERENCE', 'Conversation patří do jiné Campaign.');
    }
    if (transaction.sourceMessageId) {
      const row = this.database.prepare(`
        SELECT campaign_id AS campaignId, conversation_id AS conversationId
        FROM conversation_messages WHERE id = ?
      `).get(transaction.sourceMessageId) as unknown as { campaignId: string; conversationId: string } | undefined;
      if (!row) add('ENTITY_NOT_FOUND', `Message ${transaction.sourceMessageId} neexistuje.`);
      else {
        if (row.campaignId !== transaction.campaignId) add('CROSS_CAMPAIGN_REFERENCE', 'Message patří do jiné Campaign.');
        if (transaction.sourceConversationId && row.conversationId !== transaction.sourceConversationId) {
          add('TRANSACTION_CONFLICT', 'Message nepatří do source Conversation.');
        }
      }
    }

    const normalizedTransaction: TurnTransaction = {
      ...transaction,
      id: transaction.id.trim(),
      campaignId: transaction.campaignId.trim(),
      sourceConversationId: transaction.sourceConversationId ?? null,
      sourceMessageId: transaction.sourceMessageId ?? null,
      event: {
        ...transaction.event,
        eventType: transaction.event.eventType.trim(),
        summary: transaction.event.summary.trim(),
        locationId: transaction.event.locationId ?? null,
      },
      metadata: transaction.metadata ?? null,
      changes: transaction.changes.map((change) => structuredClone(change)),
    };
    const existing = this.database.prepare(`
      SELECT payload_hash AS payloadHash FROM turn_transactions WHERE id = ?
    `).get(normalizedTransaction.id) as unknown as { payloadHash: string } | undefined;
    if (existing && existing.payloadHash !== payloadHash(normalizedTransaction)) {
      add('TRANSACTION_ID_REUSED', `Transaction ID ${transaction.id} už bylo použito s jiným payloadem.`);
    } else if (existing) {
      warnings.push({ code: 'TRANSACTION_CONFLICT', message: 'Transaction už byla úspěšně aplikována; jde o idempotentní retry.' });
    }
    if (!existing) {
      for (const [index, change] of (transaction.changes ?? []).entries()) {
        try {
          this.validateChange(change, transaction.campaignId);
        } catch (error) {
          if (error instanceof ChronicleEngineError) add(error.code as ChronicleErrorCode, error.message, index);
          else add('INVALID_INPUT', error instanceof Error ? error.message : String(error), index);
        }
      }
      errors.push(...this.validateCombinedChanges(transaction.changes ?? []));
    }
    if (errors.length > 0) {
      console.warn('[Chronicle Engine] TurnTransaction validation failed.', { id: transaction.id, errors });
    }
    return { valid: errors.length === 0, ...(errors.length === 0 ? { normalizedTransaction } : {}), errors, warnings };
  }

  applyTurnTransaction(transaction: TurnTransaction): TurnTransactionResult {
    const initialValidation = this.validateTurnTransaction(transaction);
    if (!initialValidation.valid || !initialValidation.normalizedTransaction) {
      throw new ChronicleEngineError(
        initialValidation.errors[0]?.code ?? 'INVALID_INPUT',
        initialValidation.errors.map((error) => error.message).join(' '),
        { errors: initialValidation.errors },
      );
    }
    const normalized = initialValidation.normalizedTransaction;
    const hash = payloadHash(normalized);
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const existing = this.database.prepare(`
        SELECT payload_hash AS payloadHash, result_json AS resultJson
        FROM turn_transactions WHERE id = ?
      `).get(normalized.id) as unknown as { payloadHash: string; resultJson: string } | undefined;
      if (existing) {
        if (existing.payloadHash !== hash) {
          throw new ChronicleEngineError(
            'TRANSACTION_ID_REUSED',
            `Transaction ID ${normalized.id} už bylo použito s jiným payloadem.`,
          );
        }
        const replay = JSON.parse(existing.resultJson) as TurnTransactionResult;
        this.database.exec('COMMIT;');
        console.info(`[Chronicle Engine] Idempotent replay ${normalized.id}.`);
        return { ...replay, alreadyApplied: true };
      }
      const inTransactionValidation = this.validateTurnTransaction(normalized);
      if (!inTransactionValidation.valid) {
        throw new ChronicleEngineError(
          inTransactionValidation.errors[0]?.code ?? 'TRANSACTION_CONFLICT',
          inTransactionValidation.errors.map((error) => error.message).join(' '),
          { errors: inTransactionValidation.errors },
        );
      }
      const now = timestamp();
      const eventId = normalized.event.id ?? createDomainId('event');
      const sequenceRow = this.database.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
        FROM events WHERE campaign_id = ?
      `).get(normalized.campaignId) as unknown as { nextSequence: number };
      this.database.prepare(`
        INSERT INTO events(
          id, campaign_id, event_type, sequence, occurred_at, location_id,
          summary, source_message_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        normalized.campaignId,
        normalized.event.eventType,
        sequenceRow.nextSequence,
        null,
        normalized.event.locationId ?? null,
        normalized.event.summary,
        normalized.sourceMessageId ?? null,
        now,
      );

      const affected = new Set<string>();
      const references = new Map<string, Set<string>>();
      const appliedChanges = normalized.changes.map((change) => {
        const entityIds = this.applyChange(change, eventId, now);
        for (const entityId of entityIds) {
          affected.add(entityId);
          addReference(references, entityId, 'subject');
        }
        addDerivedReferences(references, change);
        return { type: change.type, entityIds } satisfies AppliedTurnChange;
      });
      if (normalized.event.locationId) addReference(references, normalized.event.locationId, 'location');
      for (const reference of normalized.event.entityReferences ?? []) {
        addReference(references, reference.entityId, reference.role);
      }
      const insertReference = this.database.prepare(`
        INSERT OR IGNORE INTO event_entity_references(event_id, entity_id, role)
        VALUES (?, ?, ?)
      `);
      for (const [entityId, roles] of references) {
        for (const role of roles) insertReference.run(eventId, entityId, role);
      }
      if (normalized.sourceMessageId) {
        this.database.prepare(`
          UPDATE conversation_messages SET related_event_id = ?
          WHERE id = ? AND campaign_id = ?
        `).run(eventId, normalized.sourceMessageId, normalized.campaignId);
      }
      const result: TurnTransactionResult = {
        transactionId: normalized.id,
        eventId,
        appliedChanges,
        affectedEntityIds: [...affected].sort(),
        alreadyApplied: false,
      };
      this.database.prepare(`
        INSERT INTO turn_transactions(
          id, campaign_id, event_id, source_conversation_id, source_message_id,
          payload_hash, result_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        normalized.id,
        normalized.campaignId,
        eventId,
        normalized.sourceConversationId ?? null,
        normalized.sourceMessageId ?? null,
        hash,
        JSON.stringify(result),
        now,
      );
      this.database.exec('COMMIT;');
      console.info(`[Chronicle Engine] TurnTransaction ${normalized.id} committed as ${eventId}.`);
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      console.error(`[Chronicle Engine] TurnTransaction ${transaction.id} failed.`, safeError(error));
      throw error;
    }
  }

  private validateChange(change: TurnChange, campaignId: string): void {
    if (!change || typeof change !== 'object' || !validText(change.type)) {
      throw invalid('TurnChange nemá platný type.');
    }
    switch (change.type) {
      case 'hp.delta': {
        this.requireEntity(change.characterId, campaignId, 'Character');
        finite(change.amount, 'HP delta');
        if (!this.characters.getCombatState(change.characterId)) throw invalid('Character nemá combat state.');
        return;
      }
      case 'temporaryHp.set': {
        this.requireEntity(change.characterId, campaignId, 'Character');
        nonNegativeInteger(change.value, 'Temporary HP');
        return;
      }
      case 'resource.delta': {
        this.requireEntity(change.characterId, campaignId, 'Character');
        finite(change.amount, 'Resource delta');
        const resource = this.characters.getResource(change.resourceId);
        if (!resource) throw notFound(`Resource ${change.resourceId} neexistuje.`);
        if (resource.ownerEntityId !== change.characterId) throw crossCampaign('Resource nepatří zadanému Characteru.');
        const next = resource.current + change.amount;
        if (next < 0) throw new ChronicleEngineError('INSUFFICIENT_RESOURCE', `${resource.name} nemá dostatek hodnoty.`);
        if (next > resource.maximum) throw outOfBounds(`${resource.name} by překročil maximum.`);
        return;
      }
      case 'spellSlot.delta': {
        this.requireEntity(change.characterId, campaignId, 'Character');
        finite(change.amount, 'Spell slot delta');
        const pool = this.characters.listSpellSlotPools(change.characterId).find((item) => item.id === change.poolId);
        if (!pool) throw notFound(`Spell slot pool ${change.poolId} nepatří zadanému Characteru.`);
        const next = pool.current + change.amount;
        if (next < 0) throw new ChronicleEngineError('INSUFFICIENT_RESOURCE', 'Spell slot pool nemá dostatek pozic.');
        if (next > pool.maximum) throw outOfBounds('Spell slot pool by překročil maximum.');
        return;
      }
      case 'character.move':
        this.requireEntity(change.characterId, campaignId, 'Character');
        if (change.locationId) this.requireEntity(change.locationId, campaignId, 'Location');
        return;
      case 'item.transfer':
        this.requireEntity(change.itemId, campaignId, 'Item');
        this.validatePlacement(change.itemId, change.placement, campaignId);
        return;
      case 'effect.add':
        this.requireEntity(change.targetEntityId, campaignId);
        if (!validText(change.name) || !validText(change.durationType)) throw invalid('Effect name a durationType jsou povinné.');
        if (change.sourceEntityId) this.requireEntity(change.sourceEntityId, campaignId);
        if (change.definitionId && !this.characters.getDefinition(change.definitionId)) throw notFound('Effect definition neexistuje.');
        if (change.sourceSpellId && !this.characters.getDefinition(change.sourceSpellId)) throw notFound('Source spell neexistuje.');
        if (change.concentration) this.requireEntity(change.targetEntityId, campaignId, 'Character');
        if (change.effectId && this.characters.getEffect(change.effectId)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Effect ${change.effectId} už existuje.`);
        return;
      case 'effect.end': {
        const effect = this.characters.getEffect(change.effectId);
        if (!effect || effect.endEventId) throw notFound(`Aktivní effect ${change.effectId} neexistuje.`);
        this.requireEntity(effect.targetEntityId, campaignId);
        return;
      }
      case 'concentration.end':
        this.requireEntity(change.characterId, campaignId, 'Character');
        return;
      case 'inspiration.set':
        this.requireEntity(change.characterId, campaignId, 'Character');
        if (typeof change.value !== 'boolean') throw invalid('Inspiration value musí být boolean.');
        return;
      case 'deathSave.record': {
        this.requireEntity(change.characterId, campaignId, 'Character');
        const state = this.characters.getCombatState(change.characterId);
        if (!state) throw invalid('Character nemá combat state.');
        const current = change.success ? state.deathSaveSuccesses : state.deathSaveFailures;
        if (current >= 3) throw outOfBounds('Death save counter už je na maximu.');
        return;
      }
      case 'relation.add':
        this.requireEntity(change.sourceEntityId, campaignId);
        this.requireEntity(change.targetEntityId, campaignId);
        if (!validText(change.relationType)) throw invalid('Relation type nesmí být prázdný.');
        if (change.relationId && this.database.prepare('SELECT 1 FROM entity_relations WHERE id = ?').get(change.relationId)) {
          throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Relation ${change.relationId} už existuje.`);
        }
        return;
      case 'relation.end': {
        const row = this.database.prepare(`
          SELECT campaign_id AS campaignId, to_event_id AS toEventId
          FROM entity_relations WHERE id = ?
        `).get(change.relationId) as unknown as { campaignId: string; toEventId: string | null } | undefined;
        if (!row || row.toEventId) throw notFound(`Aktivní relation ${change.relationId} neexistuje.`);
        if (row.campaignId !== campaignId) throw crossCampaign('Relation patří do jiné Campaign.');
        return;
      }
      case 'knowledge.add':
        this.requireEntity(change.subjectEntityId, campaignId);
        if (change.observerEntityId) this.requireEntity(change.observerEntityId, campaignId);
        if (change.referenceEntityId) this.requireEntity(change.referenceEntityId, campaignId);
        if (change.visibilityScope === 'observer' && !change.observerEntityId) throw new ChronicleEngineError('KNOWLEDGE_SCOPE_DENIED', 'Observer knowledge vyžaduje observerEntityId.');
        if (change.visibilityScope !== 'observer' && change.observerEntityId) throw new ChronicleEngineError('KNOWLEDGE_SCOPE_DENIED', 'World/public knowledge nesmí mít observerEntityId.');
        if (change.value == null && change.referenceEntityId == null) throw invalid('Knowledge vyžaduje value nebo referenceEntityId.');
        if (!validText(change.knowledgeType)) throw invalid('Knowledge type nesmí být prázdný.');
        if (change.knowledgeId && this.database.prepare('SELECT 1 FROM knowledge_records WHERE id = ?').get(change.knowledgeId)) {
          throw new ChronicleEngineError('TRANSACTION_CONFLICT', `Knowledge ${change.knowledgeId} už existuje.`);
        }
        return;
      case 'knowledge.end': {
        const row = this.database.prepare(`
          SELECT campaign_id AS campaignId, to_event_id AS toEventId
          FROM knowledge_records WHERE id = ?
        `).get(change.knowledgeId) as unknown as { campaignId: string; toEventId: string | null } | undefined;
        if (!row || row.toEventId) throw notFound(`Aktivní knowledge ${change.knowledgeId} neexistuje.`);
        if (row.campaignId !== campaignId) throw crossCampaign('Knowledge patří do jiné Campaign.');
        return;
      }
      default:
        throw invalid(`Nepodporovaný TurnChange ${(change as { type?: unknown }).type}.`);
    }
  }

  private validateCombinedChanges(changes: readonly TurnChange[]): TurnValidationIssue[] {
    const issues: TurnValidationIssue[] = [];
    const resourceValues = new Map<string, number>();
    const slotValues = new Map<string, number>();
    const placements = new Map<string, ItemPlacement>();
    const deathSaveValues = new Map<string, number>();
    const effectIds = new Set<string>();
    const relationIds = new Set<string>();
    const knowledgeIds = new Set<string>();
    const issue = (code: ChronicleErrorCode, message: string, changeIndex: number) => {
      issues.push({ code, message, changeIndex });
    };
    for (const [index, change] of changes.entries()) {
      switch (change.type) {
        case 'resource.delta': {
          const resource = this.characters.getResource(change.resourceId);
          if (!resource) break;
          const current = resourceValues.get(change.resourceId) ?? resource.current;
          const next = current + change.amount;
          resourceValues.set(change.resourceId, next);
          if (next < 0) issue('INSUFFICIENT_RESOURCE', `${resource.name} nemá dostatek hodnoty po předchozích změnách.`, index);
          if (next > resource.maximum) issue('OUT_OF_BOUNDS', `${resource.name} překračuje maximum po předchozích změnách.`, index);
          break;
        }
        case 'spellSlot.delta': {
          const pool = this.characters.listSpellSlotPools(change.characterId).find((item) => item.id === change.poolId);
          if (!pool) break;
          const current = slotValues.get(change.poolId) ?? pool.current;
          const next = current + change.amount;
          slotValues.set(change.poolId, next);
          if (next < 0) issue('INSUFFICIENT_RESOURCE', 'Spell slot pool nemá dostatek pozic po předchozích změnách.', index);
          if (next > pool.maximum) issue('OUT_OF_BOUNDS', 'Spell slot pool překračuje maximum po předchozích změnách.', index);
          break;
        }
        case 'item.transfer': {
          placements.set(change.itemId, change.placement);
          let current = change.itemId;
          const visited = new Set<string>();
          while (true) {
            if (visited.has(current)) {
              issue('TRANSACTION_CONFLICT', 'Kombinace item transfers by vytvořila cycle.', index);
              break;
            }
            visited.add(current);
            const placement = placements.get(current) ?? this.domain.getItemPlacement(current);
            if (!placement || placement.kind !== 'container') break;
            current = placement.containerItemId;
          }
          break;
        }
        case 'deathSave.record': {
          const state = this.characters.getCombatState(change.characterId);
          if (!state) break;
          const key = `${change.characterId}:${change.success ? 'success' : 'failure'}`;
          const current = deathSaveValues.get(key)
            ?? (change.success ? state.deathSaveSuccesses : state.deathSaveFailures);
          deathSaveValues.set(key, current + 1);
          if (current + 1 > 3) issue('OUT_OF_BOUNDS', 'Součet death save změn překračuje maximum.', index);
          break;
        }
        case 'effect.add':
          if (change.effectId && effectIds.has(change.effectId)) issue('TRANSACTION_CONFLICT', `Effect ${change.effectId} je v transaction vícekrát.`, index);
          if (change.effectId) effectIds.add(change.effectId);
          break;
        case 'relation.add':
          if (change.relationId && relationIds.has(change.relationId)) issue('TRANSACTION_CONFLICT', `Relation ${change.relationId} je v transaction vícekrát.`, index);
          if (change.relationId) relationIds.add(change.relationId);
          break;
        case 'knowledge.add':
          if (change.knowledgeId && knowledgeIds.has(change.knowledgeId)) issue('TRANSACTION_CONFLICT', `Knowledge ${change.knowledgeId} je v transaction vícekrát.`, index);
          if (change.knowledgeId) knowledgeIds.add(change.knowledgeId);
          break;
        default:
          break;
      }
    }
    return issues;
  }

  private applyChange(change: TurnChange, eventId: string, now: string): string[] {
    switch (change.type) {
      case 'hp.delta': {
        const before = this.requireCombat(change.characterId);
        const current = Math.min(before.maximumHp, Math.max(0, before.currentHp + change.amount));
        this.database.prepare('UPDATE character_combat_state SET current_hp = ? WHERE character_id = ?')
          .run(current, change.characterId);
        this.recordState(change.characterId, eventId, 'combat', 'currentHp', before.currentHp, current, now);
        return [change.characterId];
      }
      case 'temporaryHp.set': {
        const before = this.requireCombat(change.characterId);
        this.database.prepare('UPDATE character_combat_state SET temporary_hp = ? WHERE character_id = ?')
          .run(change.value, change.characterId);
        this.recordState(change.characterId, eventId, 'combat', 'temporaryHp', before.temporaryHp, change.value, now);
        return [change.characterId];
      }
      case 'resource.delta': {
        const resource = this.characters.getResource(change.resourceId)!;
        const next = resource.current + change.amount;
        this.database.prepare('UPDATE entity_resources SET current_value = ? WHERE id = ?').run(next, change.resourceId);
        this.recordState(change.characterId, eventId, 'resource', change.resourceId, resource.current, next, now);
        return [change.characterId];
      }
      case 'spellSlot.delta': {
        const pool = this.characters.listSpellSlotPools(change.characterId).find((item) => item.id === change.poolId)!;
        const next = pool.current + change.amount;
        this.database.prepare('UPDATE spell_slot_pools SET current_value = ? WHERE id = ?').run(next, change.poolId);
        this.recordState(change.characterId, eventId, 'spellSlot', change.poolId, pool.current, next, now);
        return [change.characterId];
      }
      case 'character.move': {
        const before = this.domain.getCharacter(change.characterId)!.currentLocationId;
        this.database.prepare('UPDATE characters SET current_location_id = ? WHERE entity_id = ?')
          .run(change.locationId, change.characterId);
        this.database.prepare(`
          UPDATE entity_location_history SET to_event_id = ?
          WHERE entity_id = ? AND to_event_id IS NULL
        `).run(eventId, change.characterId);
        this.database.prepare(`
          INSERT INTO entity_location_history(
            id, entity_id, location_id, from_event_id, to_event_id, recorded_at
          ) VALUES (?, ?, ?, ?, NULL, ?)
        `).run(createDomainId('state'), change.characterId, change.locationId, eventId, now);
        this.recordState(change.characterId, eventId, 'location', 'currentLocationId', before, change.locationId, now);
        return [change.characterId, ...(change.locationId ? [change.locationId] : [])];
      }
      case 'item.transfer': {
        const before = this.domain.getItemPlacement(change.itemId) ?? { kind: 'unknown' };
        this.database.prepare('DELETE FROM item_current_placements WHERE item_id = ?').run(change.itemId);
        this.insertCurrentPlacement(change.itemId, change.placement);
        this.database.prepare(`
          UPDATE item_placement_history SET to_event_id = ?
          WHERE item_id = ? AND to_event_id IS NULL
        `).run(eventId, change.itemId);
        this.insertPlacementHistory(change.itemId, change.placement, eventId, now);
        this.recordState(change.itemId, eventId, 'placement', 'current', before, change.placement, now);
        return [change.itemId, ...placementEntityIds(change.placement)];
      }
      case 'effect.add': {
        const effectId = change.effectId ?? createDomainId('effect');
        if (change.concentration) {
          const existing = this.characters.getConcentration(change.targetEntityId);
          if (existing) {
            this.database.prepare('UPDATE active_effects SET end_event_id = ? WHERE id = ?').run(eventId, existing.id);
            this.database.prepare('DELETE FROM character_concentration WHERE character_id = ?').run(change.targetEntityId);
            this.recordState(change.targetEntityId, eventId, 'effect', existing.id, { active: true }, { active: false }, now);
          }
        }
        this.database.prepare(`
          INSERT INTO active_effects(
            id, target_entity_id, definition_id, source_entity_id, source_feature_id,
            source_spell_id, name, start_event_id, end_event_id, duration_type,
            duration_value, remaining_duration, concentration, modifiers, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
        `).run(
          effectId,
          change.targetEntityId,
          change.definitionId ?? null,
          change.sourceEntityId ?? null,
          change.sourceFeatureId ?? null,
          change.sourceSpellId ?? null,
          change.name.trim(),
          eventId,
          change.durationType.trim(),
          change.durationValue ?? null,
          change.remainingDuration ?? change.durationValue ?? null,
          change.concentration ? 1 : 0,
          JSON.stringify(change.modifiers ?? []),
          serialize(change.metadata ?? null),
        );
        if (change.concentration) {
          this.database.prepare(`
            INSERT INTO character_concentration(character_id, effect_id) VALUES (?, ?)
          `).run(change.targetEntityId, effectId);
        }
        this.recordState(change.targetEntityId, eventId, 'effect', effectId, null, { active: true, name: change.name }, now);
        return [change.targetEntityId, ...(change.sourceEntityId ? [change.sourceEntityId] : [])];
      }
      case 'effect.end': {
        const effect = this.characters.getEffect(change.effectId)!;
        this.database.prepare('UPDATE active_effects SET end_event_id = ? WHERE id = ?').run(eventId, change.effectId);
        this.database.prepare('DELETE FROM character_concentration WHERE effect_id = ?').run(change.effectId);
        this.recordState(effect.targetEntityId, eventId, 'effect', change.effectId, { active: true }, { active: false }, now);
        return [effect.targetEntityId];
      }
      case 'concentration.end': {
        const effect = this.characters.getConcentration(change.characterId);
        if (!effect) {
          this.recordState(change.characterId, eventId, 'concentration', 'active', null, null, now);
          return [change.characterId];
        }
        this.database.prepare('UPDATE active_effects SET end_event_id = ? WHERE id = ?').run(eventId, effect.id);
        this.database.prepare('DELETE FROM character_concentration WHERE character_id = ?').run(change.characterId);
        this.recordState(change.characterId, eventId, 'concentration', 'effectId', effect.id, null, now);
        return [change.characterId];
      }
      case 'inspiration.set': {
        const before = this.requireCombat(change.characterId);
        this.database.prepare('UPDATE character_combat_state SET inspiration = ? WHERE character_id = ?')
          .run(change.value ? 1 : 0, change.characterId);
        this.recordState(change.characterId, eventId, 'combat', 'inspiration', before.inspiration, change.value, now);
        return [change.characterId];
      }
      case 'deathSave.record': {
        const before = this.requireCombat(change.characterId);
        const key = change.success ? 'deathSaveSuccesses' : 'deathSaveFailures';
        const column = change.success ? 'death_save_successes' : 'death_save_failures';
        const current = change.success ? before.deathSaveSuccesses : before.deathSaveFailures;
        this.database.prepare(`UPDATE character_combat_state SET ${column} = ? WHERE character_id = ?`)
          .run(current + 1, change.characterId);
        this.recordState(change.characterId, eventId, 'combat', key, current, current + 1, now);
        return [change.characterId];
      }
      case 'relation.add': {
        const id = change.relationId ?? createDomainId('relation');
        this.database.prepare(`
          INSERT INTO entity_relations(
            id, campaign_id, source_entity_id, target_entity_id, relation_type,
            from_event_id, to_event_id, metadata
          ) VALUES (?, (SELECT campaign_id FROM entities WHERE id = ?), ?, ?, ?, ?, NULL, ?)
        `).run(id, change.sourceEntityId, change.sourceEntityId, change.targetEntityId, change.relationType.trim(), eventId, serialize(change.metadata ?? null));
        return [change.sourceEntityId, change.targetEntityId];
      }
      case 'relation.end': {
        const relation = this.database.prepare(`
          SELECT source_entity_id AS sourceEntityId, target_entity_id AS targetEntityId
          FROM entity_relations WHERE id = ?
        `).get(change.relationId) as unknown as { sourceEntityId: string; targetEntityId: string };
        this.database.prepare('UPDATE entity_relations SET to_event_id = ? WHERE id = ?').run(eventId, change.relationId);
        return [relation.sourceEntityId, relation.targetEntityId];
      }
      case 'knowledge.add': {
        const id = change.knowledgeId ?? createDomainId('knowledge');
        this.database.prepare(`
          INSERT INTO knowledge_records(
            id, campaign_id, subject_entity_id, observer_entity_id, knowledge_type,
            value_text, reference_entity_id, from_event_id, to_event_id, confidence,
            source, visibility_scope
          ) VALUES (?, (SELECT campaign_id FROM entities WHERE id = ?), ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
        `).run(
          id,
          change.subjectEntityId,
          change.subjectEntityId,
          change.observerEntityId ?? null,
          change.knowledgeType.trim(),
          change.value ?? null,
          change.referenceEntityId ?? null,
          eventId,
          change.confidence ?? null,
          change.source ?? null,
          change.visibilityScope,
        );
        return [change.subjectEntityId, ...(change.observerEntityId ? [change.observerEntityId] : [])];
      }
      case 'knowledge.end': {
        const knowledge = this.database.prepare(`
          SELECT subject_entity_id AS subjectEntityId, observer_entity_id AS observerEntityId
          FROM knowledge_records WHERE id = ?
        `).get(change.knowledgeId) as unknown as { subjectEntityId: string; observerEntityId: string | null };
        this.database.prepare('UPDATE knowledge_records SET to_event_id = ? WHERE id = ?').run(eventId, change.knowledgeId);
        return [knowledge.subjectEntityId, ...(knowledge.observerEntityId ? [knowledge.observerEntityId] : [])];
      }
    }
  }

  private requireEntity(id: string, campaignId: string, type?: EntityType): EntityIdentity {
    const row = this.database.prepare(`
      SELECT campaign_id AS campaignId, entity_type AS entityType FROM entities WHERE id = ?
    `).get(id) as unknown as EntityIdentity | undefined;
    if (!row) throw notFound(`Entity ${id} neexistuje.`);
    if (row.campaignId !== campaignId) throw crossCampaign(`Entity ${id} patří do jiné Campaign.`);
    if (type && row.entityType !== type) throw invalid(`Entity ${id} není typu ${type}.`);
    return row;
  }

  private validateEntity(
    id: string,
    campaignId: string,
    add: (code: ChronicleErrorCode, message: string, index?: number, field?: string) => void,
    index?: number,
    type?: EntityType,
  ): void {
    try { this.requireEntity(id, campaignId, type); }
    catch (error) {
      if (error instanceof ChronicleEngineError) add(error.code as ChronicleErrorCode, error.message, index);
      else add('INVALID_INPUT', String(error), index);
    }
  }

  private validatePlacement(itemId: string, placement: ItemPlacement, campaignId: string): void {
    switch (placement.kind) {
      case 'location': this.requireEntity(placement.locationId, campaignId, 'Location'); return;
      case 'character': this.requireEntity(placement.characterId, campaignId, 'Character'); return;
      case 'creature': this.requireEntity(placement.creatureId, campaignId, 'Creature'); return;
      case 'unknown': return;
      case 'container': {
        this.requireEntity(placement.containerItemId, campaignId, 'Item');
        let current: string | null = placement.containerItemId;
        const visited = new Set<string>();
        while (current) {
          if (current === itemId) throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Item placement by vytvořil cycle.');
          if (visited.has(current)) throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Existující item placement obsahuje cycle.');
          visited.add(current);
          const row = this.database.prepare(`
            SELECT container_item_id AS containerItemId
            FROM item_current_placements
            WHERE item_id = ? AND placement_type = 'container'
          `).get(current) as unknown as { containerItemId: string } | undefined;
          current = row?.containerItemId ?? null;
        }
      }
    }
  }

  private requireCombat(characterId: string) {
    const state = this.characters.getCombatState(characterId);
    if (!state) throw invalid(`Character ${characterId} nemá combat state.`);
    return state;
  }

  private recordState(
    entityId: string,
    eventId: string,
    stateType: string,
    stateKey: string,
    before: unknown,
    after: unknown,
    now: string,
  ): void {
    this.database.prepare(`
      INSERT INTO state_change_history(
        id, entity_id, event_id, state_type, state_key,
        before_value, after_value, metadata, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      createDomainId('state'),
      entityId,
      eventId,
      stateType,
      stateKey,
      serialize(before),
      serialize(after),
      now,
    );
  }

  private insertCurrentPlacement(itemId: string, placement: ItemPlacement): void {
    const values = placementValues(placement);
    this.database.prepare(`
      INSERT INTO item_current_placements(
        item_id, placement_type, location_id, character_id,
        creature_id, container_item_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(itemId, placement.kind, ...values);
  }

  private insertPlacementHistory(itemId: string, placement: ItemPlacement, eventId: string, now: string): void {
    const values = placementValues(placement);
    this.database.prepare(`
      INSERT INTO item_placement_history(
        id, item_id, placement_type, location_id, character_id, creature_id,
        container_item_id, from_event_id, to_event_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(createDomainId('state'), itemId, placement.kind, ...values, eventId, now);
  }
}

function addDerivedReferences(target: Map<string, Set<string>>, change: TurnChange): void {
  switch (change.type) {
    case 'hp.delta':
    case 'temporaryHp.set':
    case 'resource.delta':
    case 'spellSlot.delta':
    case 'character.move':
    case 'inspiration.set':
    case 'deathSave.record':
    case 'concentration.end':
      addReference(target, change.characterId, 'actor'); break;
    case 'item.transfer':
      addReference(target, change.itemId, 'item');
      for (const id of placementEntityIds(change.placement)) addReference(target, id, 'target');
      break;
    case 'effect.add':
      addReference(target, change.targetEntityId, 'target');
      if (change.sourceEntityId) addReference(target, change.sourceEntityId, 'actor');
      break;
    case 'effect.end': break;
    case 'relation.add':
      addReference(target, change.sourceEntityId, 'actor');
      addReference(target, change.targetEntityId, 'target');
      break;
    case 'relation.end': break;
    case 'knowledge.add':
      addReference(target, change.subjectEntityId, 'subject');
      if (change.observerEntityId) addReference(target, change.observerEntityId, 'observer');
      break;
    case 'knowledge.end': break;
  }
}

function addReference(target: Map<string, Set<string>>, entityId: string, role: string): void {
  const roles = target.get(entityId) ?? new Set<string>();
  roles.add(role);
  target.set(entityId, roles);
}

function placementValues(placement: ItemPlacement): [string | null, string | null, string | null, string | null] {
  return [
    placement.kind === 'location' ? placement.locationId : null,
    placement.kind === 'character' ? placement.characterId : null,
    placement.kind === 'creature' ? placement.creatureId : null,
    placement.kind === 'container' ? placement.containerItemId : null,
  ];
}

function placementEntityIds(placement: ItemPlacement): string[] {
  switch (placement.kind) {
    case 'location': return [placement.locationId];
    case 'character': return [placement.characterId];
    case 'creature': return [placement.creatureId];
    case 'container': return [placement.containerItemId];
    case 'unknown': return [];
  }
}

function payloadHash(transaction: TurnTransaction): string {
  return createHash('sha256').update(stableStringify(transaction)).digest('hex');
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw invalid(`${label} musí být konečné číslo.`);
}

function nonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw outOfBounds(`${label} musí být nezáporné celé číslo.`);
}

function invalid(message: string): ChronicleEngineError {
  return new ChronicleEngineError('INVALID_INPUT', message);
}

function notFound(message: string): ChronicleEngineError {
  return new ChronicleEngineError('ENTITY_NOT_FOUND', message);
}

function outOfBounds(message: string): ChronicleEngineError {
  return new ChronicleEngineError('OUT_OF_BOUNDS', message);
}

function crossCampaign(message: string): ChronicleEngineError {
  return new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', message);
}

function serialize(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function timestamp(): string { return new Date().toISOString(); }

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
