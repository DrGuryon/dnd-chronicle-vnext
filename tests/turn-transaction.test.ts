import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TurnTransaction } from '../src/shared/chronicle-engine';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleEngineError } from '../src/main/engine/service';
import { seedRavenfordM5 } from './fixtures/ravenford-m5';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 5 atomic TurnTransaction', () => {
  it('commits Hex as one Event and replays the same transaction idempotently', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    database.characters.endConcentration(fixture.characterId, {
      id: 'event_m5_fixture_concentration_end',
      eventType: 'fixture.concentration.ended',
      summary: 'Fixture concentration ended.',
    });
    database.characters.restoreSpellSlot(fixture.pactPoolId, {
      id: 'event_m5_fixture_slot_restore',
      eventType: 'fixture.slot.restored',
      summary: 'Fixture slot restored.',
    });
    const beforeEvents = database.domain.listEvents(fixture.campaignId).length;
    const transaction: TurnTransaction = {
      id: 'turn_m5_hex',
      campaignId: fixture.campaignId,
      sourceConversationId: fixture.conversationId,
      sourceMessageId: 'message_m5_30',
      event: {
        eventType: 'spell.cast',
        summary: 'Arqos seslal Hex.',
        locationId: fixture.alleyId,
      },
      changes: [
        {
          type: 'spellSlot.delta',
          characterId: fixture.characterId,
          poolId: fixture.pactPoolId,
          amount: -1,
        },
        {
          type: 'effect.add',
          effectId: 'effect_m5_transaction_hex',
          targetEntityId: fixture.characterId,
          sourceEntityId: fixture.characterId,
          sourceSpellId: fixture.spellDefinitionId,
          name: 'Hex',
          durationType: 'hour',
          durationValue: 1,
          remainingDuration: 1,
          concentration: true,
          modifiers: [],
        },
      ],
      metadata: { reasoningSummary: 'Hex spotřebuje Pact Slot a vyžaduje concentration.' },
    };

    const validation = database.turnTransactions.validateTurnTransaction(transaction);
    expect(validation).toMatchObject({ valid: true, errors: [] });
    const result = database.turnTransactions.applyTurnTransaction(transaction);
    expect(result.alreadyApplied).toBe(false);
    expect(database.domain.listEvents(fixture.campaignId)).toHaveLength(beforeEvents + 1);
    expect(database.characters.listSpellSlotPools(fixture.characterId)
      .find((pool) => pool.id === fixture.pactPoolId)?.current).toBe(1);
    expect(database.characters.getConcentration(fixture.characterId)?.id).toBe('effect_m5_transaction_hex');
    expect(database.characters.listActiveEffects(fixture.characterId).map((effect) => effect.id))
      .toContain('effect_m5_transaction_hex');
    expect(database.characters.listStateChanges(fixture.characterId)
      .filter((entry) => entry.eventId === result.eventId).map((entry) => entry.stateType))
      .toEqual(expect.arrayContaining(['spellSlot', 'effect']));
    expect(database.engine.listConversationMessages(fixture.conversationId, { maxResults: 1 })
      .items[0].relatedEventId).toBe(result.eventId);

    const replay = database.turnTransactions.applyTurnTransaction(transaction);
    expect(replay).toMatchObject({ eventId: result.eventId, alreadyApplied: true });
    expect(database.domain.listEvents(fixture.campaignId)).toHaveLength(beforeEvents + 1);

    const conflicting = structuredClone(transaction);
    conflicting.event.summary = 'Jiný payload se stejným ID.';
    expect(() => database.turnTransactions.applyTurnTransaction(conflicting)).toThrowError(
      expect.objectContaining<Partial<ChronicleEngineError>>({ code: 'TRANSACTION_ID_REUSED' }),
    );
    database.close();
  });

  it('rejects the whole transaction before the first invalid mutation', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    const before = {
      hp: database.characters.getCombatState(fixture.characterId)!.currentHp,
      resource: database.characters.getResource(fixture.resourceId)!.current,
      placement: database.domain.getItemPlacement(fixture.swordId),
      events: database.domain.listEvents(fixture.campaignId).length,
      history: database.characters.listStateChanges(fixture.characterId).length,
    };
    const invalid: TurnTransaction = {
      id: 'turn_m5_invalid_rollback',
      campaignId: fixture.campaignId,
      event: { eventType: 'test.invalid', summary: 'Tato změna se nesmí propsat.' },
      changes: [
        { type: 'hp.delta', characterId: fixture.characterId, amount: -5 },
        {
          type: 'resource.delta',
          characterId: fixture.characterId,
          resourceId: fixture.resourceId,
          amount: -999,
        },
        { type: 'item.transfer', itemId: fixture.swordId, placement: { kind: 'character', characterId: fixture.characterId } },
      ],
    };
    const validation = database.turnTransactions.validateTurnTransaction(invalid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.code)).toContain('INSUFFICIENT_RESOURCE');
    expect(() => database.turnTransactions.applyTurnTransaction(invalid)).toThrow();
    expect(database.characters.getCombatState(fixture.characterId)!.currentHp).toBe(before.hp);
    expect(database.characters.getResource(fixture.resourceId)!.current).toBe(before.resource);
    expect(database.domain.getItemPlacement(fixture.swordId)).toEqual(before.placement);
    expect(database.domain.listEvents(fixture.campaignId)).toHaveLength(before.events);
    expect(database.characters.listStateChanges(fixture.characterId)).toHaveLength(before.history);
    database.close();
  });

  it('applies item pickup, relation, and observer knowledge under one Event', async () => {
    const directory = await createTemporaryDirectory();
    let database = await ChronicleDatabase.open(directory);
    const fixture = seedRavenfordM5(database);
    const transaction: TurnTransaction = {
      id: 'turn_m5_pickup_sword',
      campaignId: fixture.campaignId,
      sourceConversationId: fixture.conversationId,
      sourceMessageId: 'message_m5_29',
      event: {
        eventType: 'item.picked_up',
        summary: 'Arqos zvedl starý stříbrný meč.',
        locationId: fixture.alleyId,
      },
      changes: [
        {
          type: 'item.transfer',
          itemId: fixture.swordId,
          placement: { kind: 'character', characterId: fixture.characterId },
        },
        {
          type: 'relation.add',
          relationId: 'relation_m5_arqos_owns_sword',
          sourceEntityId: fixture.characterId,
          targetEntityId: fixture.swordId,
          relationType: 'owns',
        },
        {
          type: 'knowledge.add',
          knowledgeId: 'knowledge_m5_arqos_identity',
          subjectEntityId: fixture.swordId,
          observerEntityId: fixture.characterId,
          visibilityScope: 'observer',
          knowledgeType: 'identity',
          value: 'Arqos ví, že jde o starý stříbrný meč.',
          confidence: 1,
          source: 'event',
        },
      ],
    };
    const result = database.turnTransactions.applyTurnTransaction(transaction);
    expect(database.domain.getItemPlacement(fixture.swordId)).toEqual({
      kind: 'character', characterId: fixture.characterId,
    });
    expect(database.domain.resolveEffectiveItemLocation(fixture.swordId).locationId).toBe(fixture.alleyId);
    expect(database.domain.listRelationsForEntity(fixture.swordId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'relation_m5_arqos_owns_sword', fromEventId: result.eventId }),
    ]));
    expect(database.engine.getKnowledge({
      campaignId: fixture.campaignId,
      subjectEntityId: fixture.swordId,
      observerEntityId: fixture.characterId,
    }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'knowledge_m5_arqos_identity', fromEventId: result.eventId }),
    ]));
    expect(database.engine.getRelevantEvents({
      campaignId: fixture.campaignId,
      entityIds: [fixture.swordId],
    }).items[0].id).toBe(result.eventId);
    database.close();

    database = await ChronicleDatabase.open(directory);
    expect(database.domain.getItemPlacement(fixture.swordId)).toEqual({
      kind: 'character', characterId: fixture.characterId,
    });
    expect(database.turnTransactions.applyTurnTransaction(transaction)).toMatchObject({
      eventId: result.eventId,
      alreadyApplied: true,
    });
    database.close();
  });

  it('allocates unique increasing Event sequences for consecutive transactions', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    const make = (id: string, value: boolean): TurnTransaction => ({
      id,
      campaignId: fixture.campaignId,
      event: { eventType: 'combat.inspiration.changed', summary: `Inspiration ${value}.` },
      changes: [{ type: 'inspiration.set', characterId: fixture.characterId, value }],
    });
    const first = database.turnTransactions.applyTurnTransaction(make('turn_m5_sequence_a', false));
    const second = database.turnTransactions.applyTurnTransaction(make('turn_m5_sequence_b', true));
    const events = database.domain.listEvents(fixture.campaignId)
      .filter((event) => [first.eventId, second.eventId].includes(event.id));
    expect(events).toHaveLength(2);
    expect(events[1].sequence).toBe(events[0].sequence + 1);
    database.close();
  });
});

async function openTemporaryDatabase(): Promise<ChronicleDatabase> {
  return ChronicleDatabase.open(await createTemporaryDirectory());
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-m5-turn-'));
  temporaryDirectories.push(directory);
  return directory;
}
