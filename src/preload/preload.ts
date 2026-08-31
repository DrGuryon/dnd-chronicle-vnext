import { contextBridge, ipcRenderer } from 'electron';
import type { BootstrapInfo, ChronicleApi, UpdateState } from '../shared/contracts';

const api: ChronicleApi = {
  getBootstrap: () => ipcRenderer.invoke('app:get-bootstrap') as Promise<BootstrapInfo>,
  listCampaigns: () => ipcRenderer.invoke('campaign:list') as ReturnType<ChronicleApi['listCampaigns']>,
  createCampaign: (command) => ipcRenderer.invoke(
    'campaign:create', command,
  ) as ReturnType<ChronicleApi['createCampaign']>,
  renameCampaign: (command) => ipcRenderer.invoke(
    'campaign:rename', command,
  ) as ReturnType<ChronicleApi['renameCampaign']>,
  archiveCampaign: (campaignId) => ipcRenderer.invoke(
    'campaign:archive', campaignId,
  ) as ReturnType<ChronicleApi['archiveCampaign']>,
  listCampaignCharacters: (campaignId) => ipcRenderer.invoke(
    'character:list', campaignId,
  ) as ReturnType<ChronicleApi['listCampaignCharacters']>,
  createCharacter: (command) => ipcRenderer.invoke(
    'character:create', command,
  ) as ReturnType<ChronicleApi['createCharacter']>,
  updateCharacterBasics: (command) => ipcRenderer.invoke(
    'character:update-basics', command,
  ) as ReturnType<ChronicleApi['updateCharacterBasics']>,
  getCharacterCockpit: (characterId) => ipcRenderer.invoke(
    'character:get-cockpit',
    characterId,
  ) as ReturnType<ChronicleApi['getCharacterCockpit']>,
  getEntitySummary: (request) => ipcRenderer.invoke(
    'entity:get-summary',
    request,
  ) as ReturnType<ChronicleApi['getEntitySummary']>,
  getEntityCard: (request) => ipcRenderer.invoke(
    'entity:get-card',
    request,
  ) as ReturnType<ChronicleApi['getEntityCard']>,
  changeHitPoints: (command) => ipcRenderer.invoke(
    'character:change-hp',
    command,
  ) as ReturnType<ChronicleApi['changeHitPoints']>,
  setTemporaryHitPoints: (command) => ipcRenderer.invoke(
    'character:set-temporary-hp',
    command,
  ) as ReturnType<ChronicleApi['setTemporaryHitPoints']>,
  spendResource: (command) => ipcRenderer.invoke(
    'character:spend-resource',
    command,
  ) as ReturnType<ChronicleApi['spendResource']>,
  restoreResource: (command) => ipcRenderer.invoke(
    'character:restore-resource',
    command,
  ) as ReturnType<ChronicleApi['restoreResource']>,
  spendSpellSlot: (command) => ipcRenderer.invoke(
    'character:spend-spell-slot',
    command,
  ) as ReturnType<ChronicleApi['spendSpellSlot']>,
  restoreSpellSlot: (command) => ipcRenderer.invoke(
    'character:restore-spell-slot',
    command,
  ) as ReturnType<ChronicleApi['restoreSpellSlot']>,
  setInspiration: (command) => ipcRenderer.invoke(
    'character:set-inspiration',
    command,
  ) as ReturnType<ChronicleApi['setInspiration']>,
  recordDeathSave: (command) => ipcRenderer.invoke(
    'character:record-death-save',
    command,
  ) as ReturnType<ChronicleApi['recordDeathSave']>,
  endConcentration: (command) => ipcRenderer.invoke(
    'character:end-concentration',
    command,
  ) as ReturnType<ChronicleApi['endConcentration']>,
  removeCondition: (command) => ipcRenderer.invoke(
    'character:remove-condition',
    command,
  ) as ReturnType<ChronicleApi['removeCondition']>,
  endEffect: (command) => ipcRenderer.invoke(
    'character:end-effect',
    command,
  ) as ReturnType<ChronicleApi['endEffect']>,
  takeShortRest: (command) => ipcRenderer.invoke(
    'character:short-rest',
    command,
  ) as ReturnType<ChronicleApi['takeShortRest']>,
  takeLongRest: (command) => ipcRenderer.invoke(
    'character:long-rest',
    command,
  ) as ReturnType<ChronicleApi['takeLongRest']>,
  saveCharacterPanelPreferences: (preferences) => ipcRenderer.invoke(
    'ui:save-character-panel-preferences',
    preferences,
  ) as ReturnType<ChronicleApi['saveCharacterPanelPreferences']>,
  getRuntimeWorkspace: (campaignId) => ipcRenderer.invoke(
    'runtime:get-workspace',
    campaignId,
  ) as ReturnType<ChronicleApi['getRuntimeWorkspace']>,
  setActivePlayerCharacter: (command) => ipcRenderer.invoke(
    'runtime:set-active-character',
    command,
  ) as ReturnType<ChronicleApi['setActivePlayerCharacter']>,
  setActiveConversation: (command) => ipcRenderer.invoke(
    'runtime:set-active-conversation',
    command,
  ) as ReturnType<ChronicleApi['setActiveConversation']>,
  setSceneLocation: (command) => ipcRenderer.invoke(
    'runtime:set-scene-location',
    command,
  ) as ReturnType<ChronicleApi['setSceneLocation']>,
  setSceneParticipants: (command) => ipcRenderer.invoke(
    'runtime:set-scene-participants',
    command,
  ) as ReturnType<ChronicleApi['setSceneParticipants']>,
  createConversation: (command) => ipcRenderer.invoke(
    'conversation:create',
    command,
  ) as ReturnType<ChronicleApi['createConversation']>,
  listConversations: (campaignId) => ipcRenderer.invoke(
    'conversation:list', campaignId,
  ) as ReturnType<ChronicleApi['listConversations']>,
  renameConversation: (command) => ipcRenderer.invoke(
    'conversation:rename', command,
  ) as ReturnType<ChronicleApi['renameConversation']>,
  getConversationMessages: (conversationId) => ipcRenderer.invoke(
    'conversation:list-messages', conversationId,
  ) as ReturnType<ChronicleApi['getConversationMessages']>,
  getCampaignLibrary: (campaignId) => ipcRenderer.invoke(
    'library:get-campaign', campaignId,
  ) as ReturnType<ChronicleApi['getCampaignLibrary']>,
  getAiSettings: (campaignId) => ipcRenderer.invoke('ai:get-settings', campaignId) as ReturnType<ChronicleApi['getAiSettings']>,
  saveAiSettings: (command) => ipcRenderer.invoke('ai:save-settings', command) as ReturnType<ChronicleApi['saveAiSettings']>,
  getAiSecretStatus: () => ipcRenderer.invoke('ai:get-secret-status') as ReturnType<ChronicleApi['getAiSecretStatus']>,
  setAiApiKey: (apiKey) => ipcRenderer.invoke('ai:set-api-key', apiKey) as ReturnType<ChronicleApi['setAiApiKey']>,
  removeAiApiKey: () => ipcRenderer.invoke('ai:remove-api-key') as ReturnType<ChronicleApi['removeAiApiKey']>,
  testAiConnection: (campaignId) => ipcRenderer.invoke('ai:test-connection', campaignId) as ReturnType<ChronicleApi['testAiConnection']>,
  testAiRuntime: (campaignId) => ipcRenderer.invoke('ai:test-runtime', campaignId) as ReturnType<ChronicleApi['testAiRuntime']>,
  startAiTurn: (request) => ipcRenderer.invoke('ai:start-turn', request) as ReturnType<ChronicleApi['startAiTurn']>,
  cancelAiTurn: (runId) => ipcRenderer.invoke('ai:cancel-turn', runId) as ReturnType<ChronicleApi['cancelAiTurn']>,
  getPendingAiProposals: (campaignId) => ipcRenderer.invoke('ai:list-pending-proposals', campaignId) as ReturnType<ChronicleApi['getPendingAiProposals']>,
  applyAiProposal: (proposalId) => ipcRenderer.invoke('ai:apply-proposal', proposalId) as ReturnType<ChronicleApi['applyAiProposal']>,
  rejectAiProposal: (proposalId) => ipcRenderer.invoke('ai:reject-proposal', proposalId) as ReturnType<ChronicleApi['rejectAiProposal']>,
  onAiTurnEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, update: Parameters<typeof listener>[0]): void => listener(update);
    ipcRenderer.on('ai:turn-event', handler);
    return () => ipcRenderer.removeListener('ai:turn-event', handler);
  },
  getSceneContext: (campaignId) => ipcRenderer.invoke(
    'engine:get-scene-context',
    campaignId,
  ) as ReturnType<ChronicleApi['getSceneContext']>,
  getChronicleToolCatalog: () => ipcRenderer.invoke(
    'engine:get-tool-catalog',
  ) as ReturnType<ChronicleApi['getChronicleToolCatalog']>,
  getChronicleTrace: () => ipcRenderer.invoke(
    'engine:get-trace',
  ) as ReturnType<ChronicleApi['getChronicleTrace']>,
  getUpdateState: () => ipcRenderer.invoke('updater:get-state') as Promise<UpdateState>,
  checkForUpdates: () => ipcRenderer.invoke('updater:check') as Promise<UpdateState>,
  installUpdate: () => ipcRenderer.invoke('updater:install') as Promise<void>,
  onUpdateState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => listener(state);
    ipcRenderer.on('updater:state-changed', handler);
    return () => ipcRenderer.removeListener('updater:state-changed', handler);
  },
};

contextBridge.exposeInMainWorld('chronicle', api);
