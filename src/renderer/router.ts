import type { RuntimeWorkspaceCampaign } from '../shared/chronicle-engine';

export const AppViews = ['overview', 'campaigns', 'play', 'library', 'settings'] as const;
export type AppView = typeof AppViews[number];

export interface StartupRoute {
  view: AppView;
  campaignId: string | null;
}

export type PlayPrerequisite = 'campaign' | 'character' | 'conversation' | null;

export function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (AppViews as readonly string[]).includes(value);
}

export function resolveStartupRoute(
  campaigns: readonly RuntimeWorkspaceCampaign[],
  lastCampaignId: string | null,
): StartupRoute {
  const campaign = campaigns.find((item) => item.id === lastCampaignId) ?? null;
  return campaign
    ? { view: 'play', campaignId: campaign.id }
    : { view: 'overview', campaignId: null };
}

export function playPrerequisite(campaign: RuntimeWorkspaceCampaign | null): PlayPrerequisite {
  if (!campaign) return 'campaign';
  if (!campaign.runtime.activePlayerCharacterId) return 'character';
  if (!campaign.runtime.activeConversationId) return 'conversation';
  return null;
}
