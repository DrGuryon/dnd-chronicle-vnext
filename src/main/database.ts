import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { latestSchemaVersion, migrations } from './migrations';
import type { StorageInfo } from '../shared/contracts';

interface VersionRow {
  user_version: number;
}

interface CountRow {
  count: number;
}

export class ChronicleDatabase {
  readonly path: string;
  readonly info: StorageInfo;
  private database: DatabaseSync | undefined;

  private constructor(database: DatabaseSync, databasePath: string, info: StorageInfo) {
    this.database = database;
    this.path = databasePath;
    this.info = info;
  }

  static async open(userDataDirectory: string): Promise<ChronicleDatabase> {
    const dataDirectory = path.join(userDataDirectory, 'data');
    const backupDirectory = path.join(userDataDirectory, 'backups');
    const databasePath = path.join(dataDirectory, 'chronicle.db');

    await mkdir(dataDirectory, { recursive: true });
    await mkdir(backupDirectory, { recursive: true });

    const existed = await fileHasContent(databasePath);
    const database = new DatabaseSync(databasePath);
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

      return new ChronicleDatabase(database, databasePath, {
        databasePath,
        schemaVersion: readSchemaVersion(database),
        campaignCount,
        backupCreated,
      });
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
