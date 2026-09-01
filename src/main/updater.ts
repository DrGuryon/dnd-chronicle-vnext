import { app, BrowserWindow } from 'electron';
import electronLog from 'electron-log/main';
import * as electronUpdater from 'electron-updater';
import type { AppUpdater } from 'electron-updater';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { UpdateState } from '../shared/contracts';
import type { AppLogWrite } from '../shared/app-log';

const { autoUpdater } = electronUpdater;

export class UpdateController {
  private readonly updater: AppUpdater;
  private state: UpdateState;

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly log: (entry: AppLogWrite) => void = () => undefined,
  ) {
    this.updater = autoUpdater;
    this.state = this.hasReleaseFeed()
      ? { status: 'idle', message: 'Aktualizace jsou připravené ke kontrole.' }
      : {
          status: 'not-configured',
          message: 'Lokální build nemá release kanál. Release build jej doplní automaticky.',
        };

    electronLog.initialize();
    electronLog.transports.file.level = 'info';
    this.updater.logger = electronLog;
    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = true;
    this.bindEvents();
  }

  getState(): UpdateState {
    return { ...this.state };
  }

  async check(): Promise<UpdateState> {
    if (!this.hasReleaseFeed()) {
      return this.setState({
        status: 'not-configured',
        message: 'Tento lokální build nemá nastavený release kanál.',
      });
    }

    this.setState({ status: 'checking', message: 'Kontroluji dostupnou aktualizaci…' });
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setState({ status: 'error', message: readableUpdateError(error) });
    }
    return this.getState();
  }

  install(): void {
    if (this.state.status !== 'downloaded') {
      throw new Error('Aktualizace ještě není připravená k instalaci.');
    }
    this.updater.quitAndInstall(false, true);
  }

  private bindEvents(): void {
    this.updater.on('checking-for-update', () => {
      this.setState({ status: 'checking', message: 'Kontroluji dostupnou aktualizaci…' });
    });
    this.updater.on('update-available', (info) => {
      this.setState({
        status: 'available',
        availableVersion: info.version,
        message: `Je dostupná verze ${info.version}. Zahajuji stahování…`,
      });
    });
    this.updater.on('update-not-available', () => {
      this.setState({ status: 'up-to-date', message: 'Používáte nejnovější verzi.' });
    });
    this.updater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        message: `Stahuji aktualizaci… ${progress.percent.toFixed(0)} %`,
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
      });
    });
    this.updater.on('update-downloaded', (info) => {
      this.setState({
        status: 'downloaded',
        availableVersion: info.version,
        percent: 100,
        message: `Verze ${info.version} je připravená. Aplikace se při instalaci bezpečně restartuje.`,
      });
    });
    this.updater.on('error', (error) => {
      this.setState({ status: 'error', message: readableUpdateError(error) });
    });
  }

  private hasReleaseFeed(): boolean {
    return app.isPackaged && existsSync(path.join(process.resourcesPath, 'app-update.yml'));
  }

  private setState(state: UpdateState): UpdateState {
    const previousStatus = this.state.status;
    this.state = state;
    if (state.status !== previousStatus) {
      this.log({
        severity: state.status === 'error' ? 'error'
          : state.status === 'downloaded' || state.status === 'up-to-date' ? 'success' : 'info',
        category: 'updater', event: `updater.${state.status}`, message: state.message,
        details: { availableVersion: state.availableVersion, percent: state.percent },
      });
    }
    const window = this.windowProvider();
    if (window && !window.isDestroyed()) {
      window.webContents.send('updater:state-changed', state);
    }
    return this.getState();
  }
}

function readableUpdateError(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error);
  electronLog.error('Update failed', error);

  if (/net::|ENOTFOUND|ECONN|ERR_INTERNET/i.test(rawMessage)) {
    return 'Aktualizaci se nepodařilo ověřit. Zkontrolujte připojení k internetu a zkuste to znovu.';
  }
  if (/404|latest\.yml/i.test(rawMessage)) {
    return 'Release kanál zatím neobsahuje platnou aktualizaci.';
  }
  return `Aktualizace selhala: ${rawMessage}`;
}
