import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import electronLog from 'electron-log/main';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { ChronicleDatabase } from './database';
import { ChronicleIpcService } from './ipc/chronicle-ipc-service';
import { UpdateController } from './updater';
import type { BootstrapInfo } from '../shared/contracts';
import type { AiTurnRequest } from '../shared/ai';
import { AiSecretStore } from './ai/secret-store';
import { AiTurnService } from './ai/turn-service';
import { OpenAiProvider } from './ai/openai-provider';
import { ChronicleEngineError } from './engine/service';
import type { AppLogEntry, AppLogExportFormat, AppLogQuery } from '../shared/app-log';

let mainWindow: BrowserWindow | null = null;
let chronicleDatabase: ChronicleDatabase | undefined;
let updateController: UpdateController | undefined;
let databaseClosed = false;
let aiSecretStore: AiSecretStore | undefined;
let aiTurnService: AiTurnService | undefined;

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
    aiSecretStore = new AiSecretStore(app.getPath('userData'), safeStorage);
    aiTurnService = new AiTurnService(
      chronicleDatabase,
      async () => {
        const apiKey = await aiSecretStore!.getKey();
        if (!apiKey) {
          throw new ChronicleEngineError(
            'OPENAI_KEY_MISSING',
            'Nejdřív zadejte OpenAI API klíč v nastavení AI.',
          );
        }
        return new OpenAiProvider(apiKey);
      },
      (entry) => electronLog.error('[AI runtime]', entry),
    );

    if (process.argv.includes('--smoke-test')) {
      process.stdout.write(`${JSON.stringify(chronicleDatabase.info)}\n`);
      closeDatabase();
      app.quit();
      return;
    }

    createWindow();
    updateController = new UpdateController(
      () => mainWindow,
      (entry) => { chronicleDatabase?.appLog.write(entry); },
    );
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
    width: 1440,
    height: 860,
    minWidth: 760,
    minHeight: 560,
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
  if (!chronicleDatabase) throw new Error('Databáze ještě není připravená.');
  const chronicle = new ChronicleIpcService(chronicleDatabase);
  handle('campaign:list', () => chronicle.listCampaigns());
  handle('campaign:create', (command) => chronicle.createCampaign(command));
  handle('campaign:rename', (command) => chronicle.renameCampaign(command));
  handle('campaign:archive', (campaignId) => chronicle.archiveCampaign(campaignId));
  handle('character:list', (campaignId) => chronicle.listCampaignCharacters(campaignId));
  handle('character:create', (command) => chronicle.createCharacter(command));
  handle('character:update-basics', (command) => chronicle.updateCharacterBasics(command));
  handle('character:get-cockpit', (characterId) => chronicle.getCharacterCockpit(characterId));
  handle('entity:get-summary', (request) => chronicle.getEntitySummary(request));
  handle('entity:get-card', (request) => chronicle.getEntityCard(request));
  handle('character:change-hp', (command) => chronicle.changeHitPoints(command));
  handle('character:set-temporary-hp', (command) => chronicle.setTemporaryHitPoints(command));
  handle('character:spend-resource', (command) => chronicle.spendResource(command));
  handle('character:restore-resource', (command) => chronicle.restoreResource(command));
  handle('character:spend-spell-slot', (command) => chronicle.spendSpellSlot(command));
  handle('character:restore-spell-slot', (command) => chronicle.restoreSpellSlot(command));
  handle('character:set-inspiration', (command) => chronicle.setInspiration(command));
  handle('character:record-death-save', (command) => chronicle.recordDeathSave(command));
  handle('character:end-concentration', (command) => chronicle.endConcentration(command));
  handle('character:remove-condition', (command) => chronicle.removeCondition(command));
  handle('character:end-effect', (command) => chronicle.endEffect(command));
  handle('character:short-rest', (command) => chronicle.takeShortRest(command));
  handle('character:long-rest', (command) => chronicle.takeLongRest(command));
  handle('ui:save-character-panel-preferences', (preferences) => (
    chronicle.saveCharacterPanelPreferences(preferences)
  ));
  handle('runtime:get-workspace', (campaignId) => chronicle.getRuntimeWorkspace(campaignId));
  handle('runtime:set-active-character', (command) => chronicle.setActivePlayerCharacter(command));
  handle('runtime:set-active-conversation', (command) => chronicle.setActiveConversation(command));
  handle('runtime:set-scene-location', (command) => chronicle.setSceneLocation(command));
  handle('runtime:set-scene-participants', (command) => chronicle.setSceneParticipants(command));
  handle('conversation:create', (command) => chronicle.createConversation(command));
  handle('conversation:list', (campaignId) => chronicle.listConversations(campaignId));
  handle('conversation:rename', (command) => chronicle.renameConversation(command));
  handle('conversation:list-messages', (conversationId) => chronicle.listConversationMessages(conversationId));
  handle('library:get-campaign', (campaignId) => chronicle.getCampaignLibrary(campaignId));
  handle('dndpedia:search', (query) => chronicle.searchDndpedia(query));
  handle('dndpedia:get-entry', (request) => chronicle.getDndpediaEntry(request));
  handle('rules:list-rulesets', () => chronicle.listRulesets());
  handle('rules:search-definitions', (query) => chronicle.searchRuleDefinitions(query));
  handle('character:get-editor', (characterId) => chronicle.getCharacterEditor(characterId));
  handle('character:save-draft', (draft) => chronicle.saveCharacterDraft(draft));
  handle('rules:update-homebrew-definition', (command) => chronicle.updateHomebrewDefinition(command));
  handle('rules:get-reconciliation-suggestions', (query) => chronicle.getRuleReconciliationSuggestions(query));
  handle('rules:apply-reconciliation', (suggestion) => chronicle.applyRuleReconciliation(suggestion));
  handle('data-change:list-audit', (campaignId) => chronicle.getDataChangeAudit(campaignId));
  handle('app-log:query', (query) => chronicle.queryAppLog(query));
  handle('app-log:clear', () => chronicle.clearAppLog());
  ipcMain.handle('app-log:export', async (_event, value: unknown) => {
    const request = value && typeof value === 'object' ? value as { format?: unknown; query?: unknown } : {};
    const format: AppLogExportFormat = request.format === 'txt' ? 'txt' : 'json';
    const query = request.query && typeof request.query === 'object' ? request.query as AppLogQuery : {};
    const entries = chronicleDatabase!.appLog.export(query);
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: 'Exportovat aplikační log', defaultPath: `dnd-chronicle-log-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format === 'json' ? 'JSON' : 'Text', extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, formatLog(entries, format), 'utf8');
    return result.filePath;
  });
  handle('rules-packs:list', () => chronicle.listRulesPacks());
  ipcMain.handle('rules-packs:update', (_event, packId: unknown) => chronicle.updateRulesPacks(packId));
  handle('ai:get-settings', (campaignId) => chronicle.getAiSettings(campaignId));
  handle('ai:save-settings', (command) => chronicle.saveAiSettings(command));
  handle('ai:list-pending-proposals', (campaignId) => chronicle.listPendingAiProposals(campaignId));
  ipcMain.handle('ai:get-secret-status', () => aiSecretStore?.getStatus());
  ipcMain.handle('ai:set-api-key', (_event, apiKey: unknown) => {
    if (typeof apiKey !== 'string') throw new Error('API klíč musí být text.');
    return aiSecretStore?.setKey(apiKey);
  });
  ipcMain.handle('ai:remove-api-key', () => aiSecretStore?.removeKey());
  ipcMain.handle('ai:test-connection', (_event, campaignId: unknown) => {
    if (campaignId !== undefined && campaignId !== null && typeof campaignId !== 'string') {
      throw new Error('Campaign ID musí být text.');
    }
    return aiTurnService?.testConnection(typeof campaignId === 'string' ? campaignId : undefined);
  });
  ipcMain.handle('ai:test-runtime', (_event, campaignId: unknown) => {
    if (typeof campaignId !== 'string') throw new Error('Campaign ID musí být text.');
    return aiTurnService?.testRuntime(campaignId);
  });
  ipcMain.handle('ai:start-turn', async (event, request: AiTurnRequest) => {
    if (!aiTurnService) throw new Error('AI služba ještě není připravená.');
    const iterator = aiTurnService.runTurn(request)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new Error('AI tah se nepodařilo spustit.');
    if (!event.sender.isDestroyed()) event.sender.send('ai:turn-event', first.value);
    void (async () => {
      for await (const update of { [Symbol.asyncIterator]: () => iterator }) {
        if (!event.sender.isDestroyed()) event.sender.send('ai:turn-event', update);
      }
    })().catch((error: unknown) => electronLog.error('[AI turn stream]', error));
    return { runId: first.value.runId };
  });
  ipcMain.handle('ai:cancel-turn', (_event, runId: unknown) => (
    typeof runId === 'string' ? aiTurnService?.cancel(runId) ?? false : false
  ));
  ipcMain.handle('ai:apply-proposal', (_event, proposalId: unknown) => {
    if (typeof proposalId !== 'string' || !aiTurnService) throw new Error('Neplatný proposal ID.');
    return aiTurnService.applyProposal(proposalId);
  });
  ipcMain.handle('ai:reject-proposal', (_event, proposalId: unknown) => {
    if (typeof proposalId !== 'string' || !aiTurnService) throw new Error('Neplatný proposal ID.');
    return aiTurnService.rejectProposal(proposalId);
  });
  handle('engine:get-scene-context', (campaignId) => chronicle.getSceneContext(campaignId));
  handle('engine:get-tool-catalog', () => chronicle.getChronicleToolCatalog());
  handle('engine:get-trace', () => chronicle.getChronicleTrace());
  ipcMain.handle('updater:get-state', () => updateController?.getState());
  ipcMain.handle('updater:check', () => updateController?.check());
  ipcMain.handle('updater:install', () => updateController?.install());
}

function handle(channel: string, operation: (input: unknown) => unknown): void {
  ipcMain.handle(channel, (_event, input) => {
    try {
      return operation(input);
    } catch (error) {
      electronLog.error(`[IPC ${channel}]`, error);
      const message = error instanceof Error ? error.message : 'Požadavek se nepodařilo dokončit.';
      throw new Error(message);
    }
  });
}

function closeDatabase(): void {
  if (databaseClosed) {
    return;
  }
  databaseClosed = true;
  chronicleDatabase?.close();
}

function formatLog(entries: readonly AppLogEntry[], format: AppLogExportFormat): string {
  if (format === 'json') return `${JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)}\n`;
  return `${entries.map((entry) => [
    entry.createdAt, entry.severity.toUpperCase(), entry.category, entry.campaignId ?? '-', entry.event,
    entry.message, entry.details ? JSON.stringify(entry.details) : '',
  ].join('\t')).join('\n')}\n`;
}
