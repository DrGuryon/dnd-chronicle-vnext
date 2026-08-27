import { contextBridge, ipcRenderer } from 'electron';
import type { BootstrapInfo, ChronicleApi, UpdateState } from '../shared/contracts';

const api: ChronicleApi = {
  getBootstrap: () => ipcRenderer.invoke('app:get-bootstrap') as Promise<BootstrapInfo>,
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
