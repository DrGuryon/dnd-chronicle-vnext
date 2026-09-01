import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeAiProvider } from '../src/main/ai/fake-provider';
import { AiTurnService } from '../src/main/ai/turn-service';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleIpcService } from '../src/main/ipc/chronicle-ipc-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('Milestone 7 first-run workspace', () => {
  it('creates a playable campaign, PC and active conversation without seed data', async () => {
    const { database } = await openDatabase();
    const ipc = new ChronicleIpcService(database);
    expect(ipc.listCampaigns()).toEqual([]);
    expect(() => ipc.createCampaign({ name: '  ', rulesetId: 'dnd5e', rulesetVersion: '2024' }))
      .toThrow('nesmí být prázdný');

    const campaign = ipc.createCampaign({
      name: 'Ravenford', rulesetId: 'dnd5e', rulesetVersion: '2024',
    });
    expect(campaign).toMatchObject({
      name: 'Ravenford', rulesetVersion: '2024',
      runtime: { activePlayerCharacterId: null, activeConversationId: null },
    });
    const character = ipc.createCharacter({
      campaignId: campaign.id,
      name: 'Arqos',
      species: 'Člověk',
      className: 'Bojovník',
      level: 1,
    });
    expect(character).toMatchObject({ name: 'Arqos', characterType: 'PC', campaignId: campaign.id });
    expect(database.engine.getCampaignRuntimeState(campaign.id).activePlayerCharacterId).toBe(character.id);
    expect(ipc.getCharacterCockpit(character.id)).toMatchObject({
      identity: { name: 'Arqos', totalLevel: 1, classSummary: 'Fighter 1' },
      combat: { hp: { current: 10, maximum: 10 } },
    });

    const conversation = ipc.createConversation({ campaignId: campaign.id, title: 'Začátek' });
    expect(database.engine.getCampaignRuntimeState(campaign.id).activeConversationId).toBe(conversation.id);
    expect(ipc.listCampaigns()[0]).toMatchObject({
      activePlayerCharacter: { label: 'Arqos' }, conversationCount: 1,
    });
    expect(ipc.getCampaignLibrary(campaign.id).categories.find((item) => item.id === 'characters')?.items)
      .toEqual([expect.objectContaining({ id: character.id, label: 'Arqos' })]);
    database.close();
  });

  it('persists the first fake AI turn and restores the workspace after reopen', async () => {
    const opened = await openDatabase();
    const ipc = new ChronicleIpcService(opened.database);
    const campaign = ipc.createCampaign({ name: 'Ravenford', rulesetId: 'dnd5e', rulesetVersion: '2014' });
    const character = ipc.createCharacter({ campaignId: campaign.id, name: 'Arqos' });
    const conversation = ipc.createConversation({ campaignId: campaign.id, title: 'Začátek' });
    const fake = new FakeAiProvider([[
      { type: 'text-delta', delta: 'Ulička je tichá...' },
      { type: 'completed', responseId: 'fake_m7', text: 'Ulička je tichá...' },
    ]]);
    const ai = new AiTurnService(opened.database, async () => fake);
    const events = [];
    for await (const event of ai.runTurn({
      campaignId: campaign.id,
      conversationId: conversation.id,
      content: 'Rozhlédnu se kolem sebe.',
    })) events.push(event);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text-delta', delta: 'Ulička je tichá...' }),
      expect.objectContaining({ type: 'completed' }),
    ]));
    opened.database.close();

    const reopened = await ChronicleDatabase.open(opened.directory);
    const restored = reopened.engine.getRuntimeWorkspace(campaign.id).campaigns[0];
    expect(restored.runtime).toMatchObject({
      activePlayerCharacterId: character.id,
      activeConversationId: conversation.id,
    });
    expect(reopened.engine.listConversationMessages(conversation.id, { maxResults: 10 }).items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Rozhlédnu se kolem sebe.' }),
        expect.objectContaining({ role: 'assistant', content: 'Ulička je tichá...' }),
      ]));
    reopened.close();
  });

  it('renames and safely archives a campaign without deleting its local rows', async () => {
    const { database } = await openDatabase();
    const ipc = new ChronicleIpcService(database);
    const campaign = ipc.createCampaign({ name: 'Ravenford', rulesetId: 'dnd5e', rulesetVersion: '2024' });
    expect(ipc.renameCampaign({ campaignId: campaign.id, name: 'Ravenford Chronicle' }).name)
      .toBe('Ravenford Chronicle');
    ipc.archiveCampaign(campaign.id);
    expect(ipc.listCampaigns()).toEqual([]);
    expect(database.domain.getCampaign(campaign.id)?.name).toBe('Ravenford Chronicle');
    database.close();
  });

  it('normalizes a previously saved minimal effort for GPT-5.6 without a schema change', async () => {
    const opened = await openDatabase();
    const campaign = new ChronicleIpcService(opened.database).createCampaign({
      name: 'Ravenford', rulesetId: 'dnd5e', rulesetVersion: '2024',
    });
    opened.database.aiSettings.get(campaign.id);
    opened.database.close();

    const raw = new DatabaseSync(path.join(opened.directory, 'data', 'chronicle.db'));
    raw.prepare('UPDATE campaign_ai_settings SET reasoning_effort = ? WHERE campaign_id = ?')
      .run('minimal', campaign.id);
    raw.close();

    const reopened = await ChronicleDatabase.open(opened.directory);
    expect(reopened.info.schemaVersion).toBe(7);
    expect(reopened.aiSettings.get(campaign.id).reasoningEffort).toBe('low');
    reopened.close();
  });
});

async function openDatabase(): Promise<{ directory: string; database: ChronicleDatabase }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-m7-workspace-'));
  temporaryDirectories.push(directory);
  return { directory, database: await ChronicleDatabase.open(directory) };
}
