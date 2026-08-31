import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AiTurnService } from '../src/main/ai/turn-service';
import { FakeAiProvider } from '../src/main/ai/fake-provider';
import { ChronicleDatabase } from '../src/main/database';
import type { AiProviderEvent } from '../src/shared/ai';
import { seedRavenfordM5 } from './fixtures/ravenford-m5';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Milestone 6 AI turn runtime', () => {
  it('keeps review proposals non-mutating until Apply and makes repeated Apply idempotent', async () => {
    const database = await openDatabase();
    const fixture = seedRavenfordM5(database);
    const beforeHp = database.characters.getCombatState(fixture.characterId)!.currentHp;
    const beforeEvents = database.domain.listEvents(fixture.campaignId).length;
    const service = new AiTurnService(database, async () => proposalProvider(
      fixture.campaignId, fixture.characterId, fixture.conversationId,
    ));
    const events = [];
    for await (const event of service.runTurn({
      campaignId: fixture.campaignId,
      conversationId: fixture.conversationId,
      content: 'Sesílám Hex a utrácím zdroj.',
    })) events.push(event);

    const proposal = events.find((event) => event.type === 'proposal');
    expect(proposal).toMatchObject({ type: 'proposal', proposal: { status: 'pending' } });
    expect(database.characters.getCombatState(fixture.characterId)!.currentHp).toBe(beforeHp);
    expect(database.domain.listEvents(fixture.campaignId)).toHaveLength(beforeEvents);
    const first = service.applyProposal(proposal!.proposal.id);
    const second = service.applyProposal(proposal!.proposal.id);
    expect(first.result.alreadyApplied).toBe(false);
    expect(second.result.alreadyApplied).toBe(true);
    expect(database.characters.getCombatState(fixture.characterId)!.currentHp).toBe(beforeHp - 2);
    expect(database.engine.listConversationMessages(fixture.conversationId, { maxResults: 100 }).items.slice(0, 2))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: 'Arqos pocítil následky kouzla.' }),
        expect.objectContaining({ role: 'user', content: 'Sesílám Hex a utrácím zdroj.' }),
      ]));

    const databasePath = database.path;
    database.close();
    const inspected = new DatabaseSync(databasePath);
    expect(inspected.prepare(`
      SELECT status, input_tokens AS inputTokens, output_tokens AS outputTokens,
             reasoning_tokens AS reasoningTokens, provider_response_id AS responseId
      FROM ai_turn_runs
    `).get()).toMatchObject({ status: 'completed', inputTokens: 20, outputTokens: 8, reasoningTokens: 2, responseId: 'fake_resp' });
    inspected.close();
  });

  it('applies automatic proposals only after final narration and leaves manual proposals pending', async () => {
    const automatic = await openDatabase();
    const automaticFixture = seedRavenfordM5(automatic);
    automatic.aiSettings.update(automaticFixture.campaignId, { approvalPolicy: 'automatic' });
    const autoBefore = automatic.characters.getCombatState(automaticFixture.characterId)!.currentHp;
    const autoService = new AiTurnService(automatic, async () => proposalProvider(
      automaticFixture.campaignId, automaticFixture.characterId, automaticFixture.conversationId,
    ));
    const autoEvents = [];
    for await (const event of autoService.runTurn({
      campaignId: automaticFixture.campaignId,
      conversationId: automaticFixture.conversationId,
      content: 'Automaticky.',
    })) autoEvents.push(event);
    expect(autoEvents.find((event) => event.type === 'proposal')).toMatchObject({ proposal: { status: 'applied' } });
    expect(automatic.characters.getCombatState(automaticFixture.characterId)!.currentHp).toBe(autoBefore - 2);
    automatic.close();

    const manual = await openDatabase();
    const manualFixture = seedRavenfordM5(manual);
    manual.aiSettings.update(manualFixture.campaignId, { approvalPolicy: 'manual' });
    const manualBefore = manual.characters.getCombatState(manualFixture.characterId)!.currentHp;
    const manualService = new AiTurnService(manual, async () => proposalProvider(
      manualFixture.campaignId, manualFixture.characterId, manualFixture.conversationId,
    ));
    const manualEvents = [];
    for await (const event of manualService.runTurn({
      campaignId: manualFixture.campaignId,
      conversationId: manualFixture.conversationId,
      content: 'Ručně.',
    })) manualEvents.push(event);
    expect(manualEvents.find((event) => event.type === 'proposal')).toMatchObject({ proposal: { status: 'pending' } });
    expect(manual.characters.getCombatState(manualFixture.characterId)!.currentHp).toBe(manualBefore);
    manual.close();
  });

  it('keeps the latest valid repair after an invalid proposal and supports cancellation', async () => {
    const database = await openDatabase();
    const fixture = seedRavenfordM5(database);
    const repairProvider = new FakeAiProvider([async (input) => {
      const invalid = await input.executeTool({
        callId: 'invalid', name: 'chronicle.propose_turn_transaction',
        arguments: {
          event: { eventType: 'damage', summary: 'Invalid.' },
          changes: [{ type: 'hp.delta', characterId: 'char_missing', amount: -1 }],
        },
      });
      expect(invalid.output).toMatchObject({ valid: false });
      const valid = await input.executeTool({
        callId: 'valid', name: 'chronicle.propose_turn_transaction',
        arguments: {
          event: { eventType: 'damage', summary: 'Repaired.' },
          changes: [{ type: 'hp.delta', characterId: fixture.characterId, amount: -1 }],
        },
      });
      expect(valid.output).toMatchObject({ valid: true });
      return [
        { type: 'text-delta', delta: 'Opraveno.' },
        { type: 'completed', responseId: 'repair', text: 'Opraveno.' },
      ] satisfies AiProviderEvent[];
    }]);
    const service = new AiTurnService(database, async () => repairProvider);
    const repairedEvents = [];
    for await (const event of service.runTurn({
      campaignId: fixture.campaignId,
      conversationId: fixture.conversationId,
      content: 'Oprav návrh.',
    })) repairedEvents.push(event);
    expect(repairedEvents.find((event) => event.type === 'proposal')).toMatchObject({
      proposal: { transaction: { event: { summary: 'Repaired.' } } },
    });

    const cancelService = new AiTurnService(database, async () => new FakeAiProvider());
    const iterator = cancelService.runTurn({
      campaignId: fixture.campaignId,
      conversationId: fixture.conversationId,
      content: 'Zruš tento tah.',
    })[Symbol.asyncIterator]();
    const started = await iterator.next();
    expect(started.value).toMatchObject({ type: 'started' });
    expect(cancelService.cancel(started.value!.runId)).toBe(true);
    expect((await iterator.next()).value).toMatchObject({ type: 'cancelled', runId: started.value!.runId });
    database.close();
  });
});

function proposalProvider(campaignId: string, characterId: string, conversationId: string): FakeAiProvider {
  return new FakeAiProvider([async (input) => {
    const proposalTool = input.tools.find((tool) => tool.name === 'chronicle.propose_turn_transaction');
    expect(proposalTool?.mutatesState).toBe(false);
    const result = await input.executeTool({
      callId: 'fake_call',
      name: 'chronicle.propose_turn_transaction',
      arguments: {
        event: { eventType: 'spell.cast', summary: 'Hex byl seslán.' },
        changes: [{ type: 'hp.delta', characterId, amount: -2 }],
      },
    });
    expect(result.output).toMatchObject({ valid: true });
    return [
      { type: 'text-delta', delta: 'Arqos pocítil následky kouzla.' },
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 8, reasoningTokens: 2, cachedInputTokens: 3 } },
      { type: 'completed', responseId: 'fake_resp', text: 'Arqos pocítil následky kouzla.' },
    ] satisfies AiProviderEvent[];
  }]);
}

async function openDatabase(): Promise<ChronicleDatabase> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-m6-ai-'));
  temporaryDirectories.push(directory);
  return ChronicleDatabase.open(directory);
}
