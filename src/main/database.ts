import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { latestSchemaVersion, migrations } from './migrations';
import { SqliteChronicleRepository } from './domain/repository';
import { ChronicleDomainService } from './domain/service';
import { SqliteCharacterRepository } from './character/repository';
import { CharacterDomainService } from './character/service';
import { SqliteUiPreferencesRepository } from './preferences/repository';
import { UiPreferencesService } from './preferences/service';
import { ChronicleReadModelService } from './read-model/service';
import { RulesEngineRegistry } from '../rules/rules-engine';
import type { StorageInfo } from '../shared/contracts';
import { ChronicleEngineService } from './engine/service';
import { TurnTransactionService } from './engine/turn-transaction-service';
import { ChronicleOrchestrator } from './engine/orchestrator';
import { ActorRelationshipService } from './relationships/service';
import { CampaignAiSettingsService } from './ai/settings-service';
import { AiProposalService } from './ai/proposal-service';
import { AiTurnRunStore } from './ai/run-store';
import { RulesetRegistry } from '../rules/registry';
import { RulesCatalogService } from './rules/catalog-service';
import { DataChangeService } from './editable/data-change-service';
import { CharacterEditorService } from './editable/character-editor-service';
import { AiDataChangeProposalService } from './ai/data-change-proposal-service';
import { AppLogService } from './app-log/service';
import { RulesPackService } from './rules/pack-service';

interface VersionRow {
  user_version: number;
}

interface CountRow {
  count: number;
}

export class ChronicleDatabase {
  readonly path: string;
  readonly info: StorageInfo;
  readonly domain: ChronicleDomainService;
  readonly characters: CharacterDomainService;
  readonly preferences: UiPreferencesService;
  readonly readModels: ChronicleReadModelService;
  readonly engine: ChronicleEngineService;
  readonly turnTransactions: TurnTransactionService;
  readonly orchestrator: ChronicleOrchestrator;
  readonly relationships: ActorRelationshipService;
  readonly aiSettings: CampaignAiSettingsService;
  readonly aiProposals: AiProposalService;
  readonly aiRuns: AiTurnRunStore;
  readonly rulesets: RulesetRegistry;
  readonly rulesCatalog: RulesCatalogService;
  readonly dataChanges: DataChangeService;
  readonly characterEditor: CharacterEditorService;
  readonly aiDataChangeProposals: AiDataChangeProposalService;
  readonly appLog: AppLogService;
  readonly rulesPacks: RulesPackService;
  private database: DatabaseSync | undefined;

  private constructor(database: DatabaseSync, databasePath: string, info: StorageInfo, userDataDirectory: string) {
    this.database = database;
    this.path = databasePath;
    this.info = info;
    const repository = new SqliteChronicleRepository(database);
    this.rulesets = new RulesetRegistry();
    this.rulesCatalog = new RulesCatalogService(database, this.rulesets);
    this.appLog = new AppLogService(database);
    this.rulesPacks = new RulesPackService(database, userDataDirectory, this.appLog);
    this.dataChanges = new DataChangeService(database);
    this.characterEditor = new CharacterEditorService(database, this.dataChanges);
    this.aiDataChangeProposals = new AiDataChangeProposalService(database, this.dataChanges);
    this.domain = new ChronicleDomainService(repository);
    this.characters = new CharacterDomainService(
      new SqliteCharacterRepository(database),
      repository,
      new RulesEngineRegistry(),
    );
    this.preferences = new UiPreferencesService(
      new SqliteUiPreferencesRepository(database),
      this.domain,
      repository,
    );
    this.relationships = new ActorRelationshipService(database);
    this.aiSettings = new CampaignAiSettingsService(database);
    this.engine = new ChronicleEngineService(database, this.domain, this.characters, this.relationships);
    this.turnTransactions = new TurnTransactionService(database, this.domain, this.characters);
    this.aiProposals = new AiProposalService(database, this.turnTransactions);
    this.aiRuns = new AiTurnRunStore(database);
    this.orchestrator = new ChronicleOrchestrator(this.engine, this.turnTransactions);
    this.readModels = new ChronicleReadModelService(
      this.domain,
      this.characters,
      this.preferences,
      this.relationships,
      () => this.engine.getActivePlayerCharacterId(),
    );
  }

  static async open(userDataDirectory: string): Promise<ChronicleDatabase> {
    const dataDirectory = path.join(userDataDirectory, 'data');
    const backupDirectory = path.join(userDataDirectory, 'backups');
    const databasePath = path.join(dataDirectory, 'chronicle.db');

    await mkdir(dataDirectory, { recursive: true });
    await mkdir(backupDirectory, { recursive: true });

    const existed = await fileHasContent(databasePath);
    const database = new DatabaseSync(databasePath);
    database.function('chronicle_normalize', (value: unknown) => normalizeForLookup(String(value ?? '')));
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

    try {
      const currentVersion = readSchemaVersion(database);
      assertMigrationPath(currentVersion);
      const pending = migrations.filter((migration) => migration.version > currentVersion);
      let backupCreated: string | undefined;

      if (existed && pending.length > 0) {
        const timestamp = new Date().toISOString().replaceAll(':', '-');
        backupCreated = path.join(backupDirectory, `pre-migration-v${currentVersion}-${timestamp}.db`);
        await backup(database, backupCreated);
      }

      applyMigrations(database, pending);
      const campaignCount = readCampaignCount(database);

      const chronicle = new ChronicleDatabase(database, databasePath, {
        databasePath,
        schemaVersion: readSchemaVersion(database),
        campaignCount,
        backupCreated,
      }, userDataDirectory);
      await chronicle.rulesPacks.bootstrap();
      return chronicle;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  close(): void {
    if (!this.database) {
      return;
    }

    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    this.database.close();
    this.database = undefined;
  }
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare('PRAGMA user_version').get() as unknown as VersionRow;
  return row.user_version;
}

function readCampaignCount(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM campaigns').get() as unknown as CountRow;
  return row.count;
}

function assertMigrationPath(currentVersion: number): void {
  if (currentVersion > latestSchemaVersion) {
    throw new Error(
      `Databáze používá novější schéma (${currentVersion}) než tato aplikace (${latestSchemaVersion}).`,
    );
  }
}

function applyMigrations(database: DatabaseSync, pending: typeof migrations): void {
  if (pending.length === 0) {
    return;
  }

  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);

    const record = database.prepare(
      'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
    );

    for (const migration of pending) {
      migration.up(database);
      record.run(migration.version, migration.name, new Date().toISOString());
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }

    database.exec('COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  }
}

async function fileHasContent(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function normalizeForLookup(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('cs-CZ');
}
