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

export interface ChronicleApi {
  getBootstrap(): Promise<BootstrapInfo>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
}
