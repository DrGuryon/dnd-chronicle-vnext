import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { RuntimeWorkspaceCampaign } from '../src/shared/chronicle-engine';
import { playPrerequisite, resolveStartupRoute } from '../src/renderer/router';
import { RendererUiStateStore, type StorageLike } from '../src/renderer/ui-state';

describe('Milestone 7 renderer state', () => {
  it('routes all first-run prerequisites and restores the last campaign', () => {
    const campaign = workspaceCampaign();
    expect(resolveStartupRoute([], 'campaign_ravenford')).toEqual({ view: 'overview', campaignId: null });
    expect(resolveStartupRoute([campaign], campaign.id)).toEqual({ view: 'play', campaignId: campaign.id });
    expect(playPrerequisite(null)).toBe('campaign');
    expect(playPrerequisite(campaign)).toBe('character');
    campaign.runtime.activePlayerCharacterId = 'char_arqos';
    expect(playPrerequisite(campaign)).toBe('conversation');
    campaign.runtime.activeConversationId = 'conversation_start';
    expect(playPrerequisite(campaign)).toBeNull();
  });

  it('persists last workspace and Cockpit visibility while rejecting corrupt state', () => {
    const storage = new MemoryStorage();
    const store = new RendererUiStateStore(storage);
    expect(store.load()).toMatchObject({ lastActiveCampaignId: null, cockpitVisible: true });
    store.save({ lastActiveCampaignId: 'campaign_ravenford', lastView: 'library', cockpitVisible: false });
    expect(store.load()).toEqual({ lastActiveCampaignId: 'campaign_ravenford', lastView: 'library', cockpitVisible: false });
    storage.setItem('dnd-chronicle.ui-state.v1', '{broken');
    expect(store.load()).toMatchObject({ lastActiveCampaignId: null, lastView: 'overview', cockpitVisible: true });
  });

  it('keeps ordinary creation and rest workflows free of native prompt/confirm dialogs', async () => {
    const sources = await Promise.all([
      readFile('src/renderer/main.ts', 'utf8'),
      readFile('src/renderer/runtime-controls.ts', 'utf8'),
      readFile('src/renderer/character-cockpit.ts', 'utf8'),
    ]);
    expect(sources.join('\n')).not.toMatch(/window\.(prompt|confirm)\s*\(/);
  });
});

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function workspaceCampaign(): RuntimeWorkspaceCampaign {
  return {
    id: 'campaign_ravenford',
    name: 'Ravenford',
    rulesetId: 'dnd5e',
    rulesetVersion: '2024',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    runtime: {
      campaignId: 'campaign_ravenford',
      activePlayerCharacterId: null,
      activeConversationId: null,
      activeSceneLocationId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    characters: [],
    conversations: [],
    activePlayerCharacter: null,
    conversationCount: 0,
  };
}
