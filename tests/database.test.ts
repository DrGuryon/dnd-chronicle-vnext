import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ChronicleDatabase } from '../src/main/database';
import { migrations } from '../src/main/migrations';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ChronicleDatabase', () => {
  it('creates an empty versioned database outside the application directory', async () => {
    const userData = await createTemporaryDirectory();
    const chronicle = await ChronicleDatabase.open(userData);

    expect(chronicle.path).toBe(path.join(userData, 'data', 'chronicle.db'));
    expect(chronicle.info.schemaVersion).toBe(3);
    expect(chronicle.info.campaignCount).toBe(0);
    chronicle.close();
  });

  it('is idempotent and preserves an existing campaign', async () => {
    const userData = await createTemporaryDirectory();
    const first = await ChronicleDatabase.open(userData);
    first.close();

    const database = new DatabaseSync(path.join(userData, 'data', 'chronicle.db'));
    database.prepare(
      'INSERT INTO campaigns(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run('campaign-1', 'Test campaign', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    database.close();

    const reopened = await ChronicleDatabase.open(userData);
    expect(reopened.info.schemaVersion).toBe(3);
    expect(reopened.info.campaignCount).toBe(1);
    expect(reopened.info.backupCreated).toBeUndefined();
    reopened.close();
  });

  it('migrates a version 1 database, preserves data, and creates a backup', async () => {
    const userData = await createTemporaryDirectory();
    const dataDirectory = path.join(userData, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const database = new DatabaseSync(path.join(dataDirectory, 'chronicle.db'));
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      ) STRICT;
      CREATE TABLE application_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations(version, name, applied_at)
        VALUES (1, 'create_campaign_storage', '2026-01-01T00:00:00.000Z');
      INSERT INTO campaigns(id, name, created_at, updated_at)
        VALUES ('legacy-campaign', 'Legacy', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      PRAGMA user_version = 1;
    `);
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    expect(migrated.info.schemaVersion).toBe(3);
    expect(migrated.info.campaignCount).toBe(1);
    expect(migrated.info.backupCreated).toBeDefined();
    expect((await stat(migrated.info.backupCreated!)).size).toBeGreaterThan(0);
    expect(migrated.domain.getCampaign('legacy-campaign')).toMatchObject({
      name: 'Legacy',
      rulesetId: 'dnd5e',
      rulesetVersion: '2024',
    });
    migrated.close();
  });

  it('migrates a version 2 domain database to the complete character schema', async () => {
    const userData = await createTemporaryDirectory();
    const dataDirectory = path.join(userData, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'chronicle.db');
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of migrations.filter((candidate) => candidate.version <= 2)) {
      migration.up(database);
      database.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }
    database.prepare(`
      INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'campaign-v2', 'Version two', '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z', 'dnd5e', '2024',
    );
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    expect(migrated.info.schemaVersion).toBe(3);
    expect(migrated.info.backupCreated).toBeDefined();
    expect(migrated.domain.getCampaign('campaign-v2')?.name).toBe('Version two');
    expect(migrated.characters.listDefinitions()).toEqual([]);
    migrated.close();

    const inspected = new DatabaseSync(databasePath);
    const characterColumns = inspected.prepare('PRAGMA table_info(characters)').all() as unknown as Array<{
      name: string;
    }>;
    expect(characterColumns.map((column) => column.name)).toContain('species_id');
    expect(inspected.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'active_effects'
    `).get()).toBeDefined();
    inspected.close();
  });

  it('rejects a database created by a newer application', async () => {
    const userData = await createTemporaryDirectory();
    const dataDirectory = path.join(userData, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const database = new DatabaseSync(path.join(dataDirectory, 'chronicle.db'));
    database.exec('PRAGMA user_version = 999;');
    database.close();

    await expect(ChronicleDatabase.open(userData)).rejects.toThrow('novější schéma');
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-'));
  temporaryDirectories.push(directory);
  return directory;
}
