import { contextBridge, ipcRenderer } from 'electron';
import type { BootstrapInfo, ChronicleApi, UpdateState } from '../shared/contracts';

const api: ChronicleApi = {
  getBootstrap: () => ipcRenderer.invoke('app:get-bootstrap') as Promise<BootstrapInfo>,
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
