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

export interface RuntimeSelectionCommand {
  campaignId: string;
  entityId: string | null;
}

export interface SceneParticipantsCommand {
  campaignId: string;
  participants: Array<{ entityId: string; participantRole: string }>;
}

export interface CreateConversationCommand {
  campaignId: string;
  title: string | null;
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
  getRuntimeWorkspace(campaignId?: string): Promise<RuntimeWorkspaceView>;
  setActivePlayerCharacter(command: RuntimeSelectionCommand): Promise<CampaignRuntimeState>;
  setActiveConversation(command: RuntimeSelectionCommand): Promise<CampaignRuntimeState>;
  setSceneLocation(command: RuntimeSelectionCommand): Promise<CampaignRuntimeState>;
  setSceneParticipants(command: SceneParticipantsCommand): Promise<SceneParticipant[]>;
  createConversation(command: CreateConversationCommand): Promise<Conversation>;
  getConversationMessages(conversationId: string): Promise<ConversationMessage[]>;
  getAiSettings(campaignId: string): Promise<CampaignAiSettings>;
  saveAiSettings(command: { campaignId: string; settings: CampaignAiSettingsUpdate }): Promise<CampaignAiSettings>;
  getAiSecretStatus(): Promise<AiSecretStatus>;
  setAiApiKey(apiKey: string): Promise<AiSecretStatus>;
  removeAiApiKey(): Promise<AiSecretStatus>;
  testAiConnection(campaignId: string): Promise<AiProviderConnectionResult>;
  startAiTurn(request: AiTurnRequest): Promise<{ runId: string }>;
  cancelAiTurn(runId: string): Promise<boolean>;
  getPendingAiProposals(campaignId: string): Promise<PendingTurnProposal[]>;
  applyAiProposal(proposalId: string): Promise<AiProposalApplyResult>;
  rejectAiProposal(proposalId: string): Promise<PendingTurnProposal>;
  onAiTurnEvent(listener: (event: AiTurnClientEvent) => void): () => void;
  getSceneContext(campaignId: string): Promise<SceneContextView>;
  getChronicleToolCatalog(): Promise<ChronicleToolDescriptor[]>;
  getChronicleTrace(): Promise<ChronicleToolTraceEntry[]>;
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
import type {
  CampaignRuntimeState,
  ChronicleToolDescriptor,
  ChronicleToolTraceEntry,
  Conversation,
  RuntimeWorkspaceView,
  SceneContextView,
  SceneParticipant,
  ConversationMessage,
} from './chronicle-engine';
import type {
  AiProposalApplyResult,
  AiProviderConnectionResult,
  AiSecretStatus,
  AiTurnClientEvent,
  AiTurnRequest,
  CampaignAiSettings,
  CampaignAiSettingsUpdate,
  PendingTurnProposal,
} from './ai';
