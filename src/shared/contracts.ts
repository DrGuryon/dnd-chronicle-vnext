export type UpdateStatus =
  | 'not-configured'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error';

export interface UpdateState {
  status: UpdateStatus;
  message: string;
  availableVersion?: string;
  percent?: number;
  bytesPerSecond?: number;
}

export interface StorageInfo {
  databasePath: string;
  schemaVersion: number;
  campaignCount: number;
  backupCreated?: string;
}

export interface BootstrapInfo {
  appVersion: string;
  storage: StorageInfo;
  update: UpdateState;
}

export interface CharacterAmountCommand {
  characterId: string;
  amount: number;
}

export interface CharacterValueCommand {
  characterId: string;
  value: number;
}

export interface CharacterToggleCommand {
  characterId: string;
  value: boolean;
}

export interface CharacterResourceCommand extends CharacterAmountCommand {
  resourceId: string;
}

export interface CharacterPoolCommand {
  characterId: string;
  poolId: string;
}

export interface CharacterEffectCommand {
  characterId: string;
  effectId: string;
}

export interface DeathSaveCommand {
  characterId: string;
  success: boolean;
}

export interface ChronicleApi {
  getBootstrap(): Promise<BootstrapInfo>;
  getCharacterCockpit(characterId?: string): Promise<CharacterCockpitView | null>;
  getEntitySummary(request: EntityCardRequest): Promise<EntitySummary>;
  getEntityCard(request: EntityCardRequest): Promise<EntityCardView>;
  changeHitPoints(command: CharacterAmountCommand): Promise<CharacterCockpitView>;
  setTemporaryHitPoints(command: CharacterValueCommand): Promise<CharacterCockpitView>;
  spendResource(command: CharacterResourceCommand): Promise<CharacterCockpitView>;
  restoreResource(command: CharacterResourceCommand): Promise<CharacterCockpitView>;
  spendSpellSlot(command: CharacterPoolCommand): Promise<CharacterCockpitView>;
  restoreSpellSlot(command: CharacterPoolCommand): Promise<CharacterCockpitView>;
  setInspiration(command: CharacterToggleCommand): Promise<CharacterCockpitView>;
  recordDeathSave(command: DeathSaveCommand): Promise<CharacterCockpitView>;
  endConcentration(command: { characterId: string }): Promise<CharacterCockpitView>;
  removeCondition(command: CharacterEffectCommand): Promise<CharacterCockpitView>;
  endEffect(command: CharacterEffectCommand): Promise<CharacterCockpitView>;
  takeShortRest(command: { characterId: string }): Promise<CharacterCockpitView>;
  takeLongRest(command: { characterId: string }): Promise<CharacterCockpitView>;
  saveCharacterPanelPreferences(
    preferences: CharacterPanelPreferencesInput,
  ): Promise<CharacterCockpitView>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}
import type {
  CharacterCockpitView,
  CharacterPanelPreferencesInput,
  EntityCardRequest,
  EntityCardView,
  EntitySummary,
} from './read-models';
