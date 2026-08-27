import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { ChronicleDatabase } from './database';
import { UpdateController } from './updater';
import type { BootstrapInfo } from '../shared/contracts';

let mainWindow: BrowserWindow | null = null;
let chronicleDatabase: ChronicleDatabase | undefined;
let updateController: UpdateController | undefined;
let databaseClosed = false;

const userDataOverride = process.env.DND_CHRONICLE_USER_DATA_DIR;
if (userDataOverride) {
  app.setPath('userData', path.resolve(userDataOverride));
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

app.whenReady().then(async () => {
  try {
    chronicleDatabase = await ChronicleDatabase.open(app.getPath('userData'));

    if (process.argv.includes('--smoke-test')) {
      process.stdout.write(`${JSON.stringify(chronicleDatabase.info)}\n`);
      closeDatabase();
      app.quit();
      return;
    }

    createWindow();
    updateController = new UpdateController(() => mainWindow);
    registerIpc();

    if (updateController.getState().status === 'idle') {
      setTimeout(() => void updateController?.check(), 3_000);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'D&D Chronicle vNext se nepodařilo spustit',
      `Databázi se nepodařilo bezpečně otevřít. Vaše data nebyla smazána.\n\n${message}`,
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', closeDatabase);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: '#11100f',
    show: false,
    title: 'D&D Chronicle vNext',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  void mainWindow
    .loadFile(path.join(__dirname, '../renderer/index.html'))
    .catch((error: unknown) => {
      dialog.showErrorBox('Renderer se nepodařilo načíst', String(error));
      app.quit();
    });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle('app:get-bootstrap', (): BootstrapInfo => {
    if (!chronicleDatabase || !updateController) {
      throw new Error('Aplikace ještě není připravená.');
    }
    return {
      appVersion: app.getVersion(),
      storage: chronicleDatabase.info,
      update: updateController.getState(),
    };
  });
  ipcMain.handle('updater:get-state', () => updateController?.getState());
  ipcMain.handle('updater:check', () => updateController?.check());
  ipcMain.handle('updater:install', () => updateController?.install());
}

function closeDatabase(): void {
  if (databaseClosed) {
    return;
  }
  databaseClosed = true;
  chronicleDatabase?.close();
}
