import { isAppView, type AppView } from './router';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PersistedUiState {
  lastActiveCampaignId: string | null;
  lastView: AppView;
  cockpitVisible: boolean;
}

const storageKey = 'dnd-chronicle.ui-state.v1';
const defaults: PersistedUiState = {
  lastActiveCampaignId: null,
  lastView: 'overview',
  cockpitVisible: true,
};

export class RendererUiStateStore {
  constructor(private readonly storage: StorageLike) {}

  load(): PersistedUiState {
    try {
      const raw = this.storage.getItem(storageKey);
      if (!raw) return { ...defaults };
      const value = JSON.parse(raw) as Record<string, unknown>;
      return {
        lastActiveCampaignId: typeof value.lastActiveCampaignId === 'string'
          ? value.lastActiveCampaignId
          : null,
        lastView: isAppView(value.lastView) ? value.lastView : defaults.lastView,
        cockpitVisible: typeof value.cockpitVisible === 'boolean'
          ? value.cockpitVisible
          : defaults.cockpitVisible,
      };
    } catch {
      return { ...defaults };
    }
  }

  save(state: PersistedUiState): void {
    this.storage.setItem(storageKey, JSON.stringify(state));
  }
}
