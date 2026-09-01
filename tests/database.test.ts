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
    expect(chronicle.info.schemaVersion).toBe(8);
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
    expect(reopened.info.schemaVersion).toBe(8);
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
    expect(migrated.info.schemaVersion).toBe(8);
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
    expect(migrated.info.schemaVersion).toBe(8);
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

  it('migrates a version 3 character database to isolated UI preferences', async () => {
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
    for (const migration of migrations.filter((candidate) => candidate.version <= 3)) {
      migration.up(database);
      database.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    expect(migrated.info.schemaVersion).toBe(8);
    expect(migrated.info.backupCreated).toBeDefined();
    migrated.close();

    const inspected = new DatabaseSync(databasePath);
    expect(inspected.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name = 'character_panel_preferences'
    `).get()).toBeDefined();
    const columns = inspected.prepare('PRAGMA table_info(character_panel_preferences)').all() as unknown as Array<{
      name: string;
    }>;
    expect(columns.map((column) => column.name)).toEqual([
      'campaign_id', 'character_id', 'section_order', 'collapsed_sections',
      'panel_width', 'updated_at',
    ]);
    inspected.close();
  });

  it('migrates a version 4 database to the persistent Chronicle Engine schema', async () => {
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
    for (const migration of migrations.filter((candidate) => candidate.version <= 4)) {
      migration.up(database);
      database.prepare(
        'INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }
    database.prepare(`
      INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES ('campaign-v4', 'Version four', ?, ?, 'dnd5e', '2024')
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    expect(migrated.info.schemaVersion).toBe(8);
    expect(migrated.info.backupCreated).toBeDefined();
    expect(migrated.engine.getCampaignRuntimeState('campaign-v4')).toMatchObject({
      campaignId: 'campaign-v4',
      activePlayerCharacterId: null,
    });
    migrated.close();

    const inspected = new DatabaseSync(databasePath);
    const tables = inspected.prepare(`
      SELECT name FROM sqlite_master WHERE type IN ('table', 'view')
    `).all() as unknown as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'campaign_runtime_state',
      'conversations',
      'conversation_messages',
      'scene_participants',
      'event_entity_references',
      'turn_transactions',
      'campaign_search_fts',
    ]));
    inspected.close();
  });

  it('migrates a version 5 Chronicle database to AI settings and relationships without losing campaigns', async () => {
    const userData = await createTemporaryDirectory();
    const dataDirectory = path.join(userData, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'chronicle.db');
    const database = new DatabaseSync(databasePath);
    database.function('chronicle_normalize', (value: unknown) => String(value ?? '').toLowerCase());
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of migrations.filter((candidate) => candidate.version <= 5)) {
      migration.up(database);
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }
    database.prepare(`
      INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES ('campaign-v5', 'Version five', ?, ?, 'dnd5e', '2024')
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    expect(migrated.info.schemaVersion).toBe(8);
    expect(migrated.info.backupCreated).toBeDefined();
    expect(migrated.domain.getCampaign('campaign-v5')?.name).toBe('Version five');
    expect(migrated.aiSettings.get('campaign-v5')).toMatchObject({
      modelId: 'gpt-5.6-sol', approvalPolicy: 'review',
    });
    migrated.close();

    const inspected = new DatabaseSync(databasePath);
    const tables = inspected.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all() as unknown as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining([
      'campaign_ai_settings', 'ai_turn_runs', 'pending_turn_proposals',
      'relationship_profiles', 'relationship_event_references',
    ]));
    inspected.close();
  });

  it('migrates a version 6 database to the editable catalog schema without losing AI settings', async () => {
    const userData = await createTemporaryDirectory();
    const dataDirectory = path.join(userData, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'chronicle.db');
    const database = new DatabaseSync(databasePath);
    database.function('chronicle_normalize', (value: unknown) => String(value ?? '').toLowerCase());
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of migrations.filter((candidate) => candidate.version <= 5)) {
      migration.up(database);
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }
    database.prepare(`
      INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES ('campaign-v6', 'Version six', ?, ?, 'dnd5e', '2024')
    `).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    const versionSix = migrations.find((candidate) => candidate.version === 6)!;
    versionSix.up(database);
    database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
      .run(versionSix.version, versionSix.name, '2026-01-01T00:00:00.000Z');
    database.exec('PRAGMA user_version = 6;');
    database.prepare(`
      UPDATE campaign_ai_settings
      SET reasoning_effort = 'high', approval_policy = 'automatic'
      WHERE campaign_id = 'campaign-v6'
    `).run();
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    try {
      expect(migrated.info.schemaVersion).toBe(8);
      expect(migrated.info.backupCreated).toBeDefined();
      expect(migrated.domain.getCampaign('campaign-v6')?.name).toBe('Version six');
      expect(migrated.aiSettings.get('campaign-v6')).toMatchObject({
        reasoningEffort: 'high', approvalPolicy: 'automatic',
      });
      expect(migrated.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', includeBuiltIn: true,
        includeHomebrew: false, limit: 500,
      }).items.length).toBeGreaterThan(100);
    } finally {
      migrated.close();
    }
  });

  it('migrates a historical version 7 catalog that does not contain newly related definitions', async () => {
    const userData = await createTemporaryDirectory();
    const dataDirectory = path.join(userData, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'chronicle.db');
    const database = new DatabaseSync(databasePath);
    database.function('chronicle_normalize', (value: unknown) => String(value ?? '').toLowerCase());
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    for (const migration of migrations.filter((candidate) => candidate.version <= 7)) {
      migration.up(database);
      database.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, '2026-01-01T00:00:00.000Z');
      database.exec(`PRAGMA user_version = ${migration.version};`);
    }
    database.exec(`
      DROP TRIGGER rule_definitions_builtin_delete;
      DELETE FROM rule_definitions WHERE canonical_id LIKE '%:Subclass:oath-of-devotion';
      CREATE TRIGGER rule_definitions_builtin_delete
      BEFORE DELETE ON rule_definitions WHEN old.is_builtin = 1 BEGIN
        SELECT RAISE(ABORT, 'Vestavěnou definici nelze odstranit.');
      END;
      INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES (
        'campaign-v7', 'Version seven',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        'dnd5e', '2024'
      );
    `);
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM rule_definitions
      WHERE canonical_id LIKE '%:Subclass:oath-of-devotion'
    `).get()).toMatchObject({ count: 0 });
    database.close();

    const migrated = await ChronicleDatabase.open(userData);
    try {
      expect(migrated.info).toMatchObject({ schemaVersion: 8, campaignCount: 1 });
      expect(migrated.info.backupCreated).toBeDefined();
      expect(migrated.domain.getCampaign('campaign-v7')?.name).toBe('Version seven');
    } finally {
      migrated.close();
    }

    const inspected = new DatabaseSync(databasePath);
    expect(inspected.prepare(`
      SELECT COUNT(*) AS count FROM rule_definitions
      WHERE canonical_id LIKE '%:Subclass:oath-of-devotion'
    `).get()).toMatchObject({ count: 2 });
    expect(inspected.prepare(`
      SELECT COUNT(*) AS count FROM rule_definition_relations
      WHERE relation_type = 'belongsToClass'
        AND source_definition_id LIKE '%subclass_oath_of_devotion'
    `).get()).toMatchObject({ count: 2 });
    expect(inspected.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
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
