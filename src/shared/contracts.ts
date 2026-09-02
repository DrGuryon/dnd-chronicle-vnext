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

export interface CreateCampaignCommand {
  name: string;
  rulesetId: string;
  rulesetVersion: string;
}

export interface RenameCampaignCommand {
  campaignId: string;
  name: string;
}

export interface CreateCharacterCommand {
  campaignId: string;
  name: string;
  fullName?: string | null;
  species?: string | null;
  background?: string | null;
  className?: string | null;
  level?: number;
}

export interface UpdateCharacterBasicsCommand {
  characterId: string;
  name: string;
  fullName?: string | null;
}

export interface RenameConversationCommand {
  conversationId: string;
  title: string | null;
}

export interface UpdateHomebrewDefinitionCommand {
  campaignId: string;
  definitionId: string;
  name: string;
  description: string;
  aliases?: string[];
}

export interface ChronicleApi {
  getBootstrap(): Promise<BootstrapInfo>;
  getLanguagePreferences(): Promise<LanguagePreferences>;
  saveLanguagePreferences(preferences: LanguagePreferencesInput): Promise<LanguagePreferences>;
  listCampaigns(): Promise<RuntimeWorkspaceCampaign[]>;
  createCampaign(command: CreateCampaignCommand): Promise<RuntimeWorkspaceCampaign>;
  renameCampaign(command: RenameCampaignCommand): Promise<RuntimeWorkspaceCampaign>;
  archiveCampaign(campaignId: string): Promise<void>;
  listCampaignCharacters(campaignId: string): Promise<Character[]>;
  createCharacter(command: CreateCharacterCommand): Promise<Character>;
  updateCharacterBasics(command: UpdateCharacterBasicsCommand): Promise<Character>;
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
  listConversations(campaignId: string): Promise<Conversation[]>;
  renameConversation(command: RenameConversationCommand): Promise<Conversation>;
  getConversationMessages(conversationId: string): Promise<ConversationMessage[]>;
  getCampaignLibrary(campaignId: string): Promise<CampaignLibraryView>;
  searchDndpedia(query?: DndpediaSearchRequest): Promise<DndpediaSearchResult>;
  getDndpediaEntry(request: DndpediaEntryRequest): Promise<DndpediaEntryDetail>;
  listRulesets(): Promise<RulesetDescriptor[]>;
  searchRuleDefinitions(query: RuleCatalogQuery): Promise<RuleCatalogResult>;
  getCharacterEditor(characterId: string): Promise<CharacterEditorView | null>;
  saveCharacterDraft(draft: CharacterDraft): Promise<{ view: CharacterEditorView; result: DataChangeTransactionResult }>;
  updateHomebrewDefinition(command: UpdateHomebrewDefinitionCommand): Promise<DataChangeTransactionResult>;
  getRuleReconciliationSuggestions(command: { campaignId: string; characterId?: string }): Promise<RuleReconciliationSuggestion[]>;
  applyRuleReconciliation(suggestion: RuleReconciliationSuggestion): Promise<DataChangeTransactionResult>;
  getDataChangeAudit(campaignId: string): Promise<DataChangeAuditTransaction[]>;
  queryAppLog(query?: AppLogQuery): Promise<AppLogPage>;
  clearAppLog(): Promise<number>;
  exportAppLog(request: { format: AppLogExportFormat; query?: AppLogQuery }): Promise<string | null>;
  listRulesPacks(): Promise<RulesPackStatus[]>;
  updateRulesPacks(packId?: string): Promise<RulesPackUpdateResult[]>;
  getAiSettings(campaignId: string): Promise<CampaignAiSettings>;
  saveAiSettings(command: { campaignId: string; settings: CampaignAiSettingsUpdate }): Promise<CampaignAiSettings>;
  getAiSecretStatus(): Promise<AiSecretStatus>;
  setAiApiKey(apiKey: string): Promise<AiSecretStatus>;
  removeAiApiKey(): Promise<AiSecretStatus>;
  testAiConnection(campaignId?: string): Promise<AiProviderConnectionResult>;
  testAiRuntime(campaignId: string): Promise<AiProviderConnectionResult>;
  startAiTurn(request: AiTurnRequest): Promise<{ runId: string }>;
  cancelAiTurn(runId: string): Promise<boolean>;
  getPendingAiProposals(campaignId: string): Promise<PendingAiProposal[]>;
  applyAiProposal(proposalId: string): Promise<AiProposalApplyResult>;
  rejectAiProposal(proposalId: string): Promise<PendingAiProposal>;
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
  CampaignLibraryView,
  RuntimeWorkspaceView,
  RuntimeWorkspaceCampaign,
  SceneContextView,
  SceneParticipant,
  ConversationMessage,
} from './chronicle-engine';
import type { Character } from '../domain/models';
import type {
  AiProposalApplyResult,
  AiProviderConnectionResult,
  AiSecretStatus,
  AiTurnClientEvent,
  AiTurnRequest,
  CampaignAiSettings,
  CampaignAiSettingsUpdate,
  PendingAiProposal,
} from './ai';
import type { RulesetDescriptor } from '../rules/registry';
import type {
  CharacterDraft,
  CharacterEditorView,
  DataChangeAuditTransaction,
  DataChangeTransactionResult,
  RuleCatalogQuery,
  RuleCatalogResult,
  RuleReconciliationSuggestion,
} from './editable-domain';
import type { AppLogExportFormat, AppLogPage, AppLogQuery } from './app-log';
import type { RulesPackStatus, RulesPackUpdateResult } from './rules-packs';
import type { LanguagePreferences, LanguagePreferencesInput } from './languages';
import type {
  DndpediaEntryDetail,
  DndpediaEntryRequest,
  DndpediaSearchRequest,
  DndpediaSearchResult,
} from './dndpedia';
