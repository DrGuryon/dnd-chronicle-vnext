import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  BoundedResult,
  EntityResolutionResult,
  ItemContextView,
  ProposedTurnTransaction,
} from '../src/shared/chronicle-engine';
import type { KnowledgeRecord } from '../src/domain/models';
import { ChronicleDatabase } from '../src/main/database';
import { seedRavenfordM5 } from './fixtures/ravenford-m5';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 5 deterministic no-model harness', () => {
  it('simulates retrieval, a structured proposal, validation, and atomic commit', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-m5-harness-'));
    temporaryDirectories.push(directory);
    const database = await ChronicleDatabase.open(directory);
    const fixture = seedRavenfordM5(database);

    const hot = database.orchestrator.buildTurnContext(fixture.campaignId);
    expect(hot).toMatchObject({
      activePlayerCharacter: { id: fixture.characterId },
      sceneLocation: { id: fixture.alleyId },
    });
    const resolved = database.orchestrator.executeTool('chronicle.resolve_entity', {
      campaignId: fixture.campaignId,
      query: 'stříbrný meč',
      observerEntityId: fixture.characterId,
      entityTypes: ['Item'],
    }) as EntityResolutionResult;
    expect(resolved.matches[0].entity.id).toBe(fixture.swordId);
    const item = database.orchestrator.executeTool('chronicle.get_item_context', {
      campaignId: fixture.campaignId,
      itemId: fixture.swordId,
      observerEntityId: fixture.miraId,
      budget: { maxResults: 5 },
    }) as ItemContextView;
    expect(item.item.id).toBe(fixture.swordId);
    const miraKnowledge = database.orchestrator.executeTool('chronicle.get_knowledge', {
      campaignId: fixture.campaignId,
      subjectEntityId: fixture.swordId,
      observerEntityId: fixture.miraId,
    }) as BoundedResult<KnowledgeRecord>;
    expect(miraKnowledge.items.map((entry) => entry.id)).toContain(fixture.miraKnowledgeId);
    expect(miraKnowledge.items.map((entry) => entry.id)).not.toContain(fixture.worldKnowledgeId);

    database.characters.endConcentration(fixture.characterId, {
      id: 'event_m5_harness_old_concentration_end',
      eventType: 'fixture.concentration.ended',
      summary: 'Fixture concentration ended.',
    });
    database.characters.restoreSpellSlot(fixture.pactPoolId, {
      id: 'event_m5_harness_slot_restore',
      eventType: 'fixture.slot.restored',
      summary: 'Fixture slot restored.',
    });
    const proposal: ProposedTurnTransaction = {
      event: { eventType: 'spell.cast', summary: 'Arqos sesílá Hex.' },
      changes: [
        {
          type: 'spellSlot.delta',
          characterId: fixture.characterId,
          poolId: fixture.pactPoolId,
          amount: -1,
        },
        {
          type: 'effect.add',
          effectId: 'effect_m5_harness_hex',
          targetEntityId: fixture.characterId,
          sourceEntityId: fixture.characterId,
          sourceSpellId: fixture.spellDefinitionId,
          name: 'Hex',
          durationType: 'hour',
          durationValue: 1,
          concentration: true,
        },
      ],
      reasoningSummary: 'Hex spotřebuje Pact Slot a vyžaduje concentration.',
    };
    const validation = database.orchestrator.validateProposedTransaction({
      transactionId: 'turn_m5_harness_hex',
      campaignId: fixture.campaignId,
      proposal,
      sourceConversationId: fixture.conversationId,
      sourceMessageId: 'message_m5_30',
    });
    expect(validation.valid).toBe(true);
    const transaction = database.orchestrator.toTransaction({
      transactionId: 'turn_m5_harness_hex',
      campaignId: fixture.campaignId,
      proposal,
      sourceConversationId: fixture.conversationId,
      sourceMessageId: 'message_m5_30',
    });
    const committed = database.orchestrator.commitTransaction(transaction);
    expect(database.readModels.getCharacterCockpit(fixture.characterId)).toMatchObject({
      concentration: { id: 'effect_m5_harness_hex' },
      spellcasting: {
        slotPools: expect.arrayContaining([
          expect.objectContaining({ id: fixture.pactPoolId, current: 1 }),
        ]),
      },
    });
    expect(database.domain.listEvents(fixture.campaignId).find((event) => event.id === committed.eventId))
      .toMatchObject({ sourceMessageId: 'message_m5_30' });
    expect(database.orchestrator.getTrace().map((entry) => entry.stage)).toEqual(expect.arrayContaining([
      'scene_context_built', 'tool_called', 'transaction_validated', 'transaction_committed',
    ]));
    database.close();
  });
});
