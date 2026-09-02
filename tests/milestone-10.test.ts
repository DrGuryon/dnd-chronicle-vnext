import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createDomainId } from '../src/domain/ids';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleIpcService } from '../src/main/ipc/chronicle-ipc-service';
import { migrations } from '../src/main/migrations';
import { bundledRulesPacks } from '../src/main/rules/pack-service';
import type { RulesPack, RulesPackTypedContent } from '../src/shared/rules-packs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Milestone 10 D&Dpedie catalog boundary', () => {
  it('searches both active rulesets without a campaign through bounded database pagination', async () => {
    const { database } = await openDatabase();
    try {
      const first = database.dndpedia.search({ page: 1, pageSize: 5 });
      expect(first).toMatchObject({ page: 1, pageSize: 5, totalPages: expect.any(Number) });
      expect(first.items).toHaveLength(5);
      expect(first.totalItems).toBeGreaterThan(200);
      expect(first.facets.rulesets.map((item) => item.value)).toEqual(['dnd5e@2014', 'dnd5e@2024']);
      expect(first.activeSourceSummary).toMatchObject({ activePackCount: 2 });
      expect(new Set(first.items.map((item) => item.definitionId)).size).toBe(first.items.length);

      const alias = database.dndpedia.search({ query: 'ohniva koule', pageSize: 20 });
      expect(alias.items.map((item) => item.name)).toEqual(['Ohnivá koule', 'Ohnivá koule']);
      const canonical = database.dndpedia.search({ query: 'dnd5e:2024:Spell:fireball', pageSize: 20 });
      expect(canonical.items).toEqual([expect.objectContaining({
        definitionId: 'def_dnd5e_2024_spell_fireball', canonicalId: 'dnd5e:2024:Spell:fireball',
      })]);
      expect(database.dndpedia.search({ definitionType: 'Weapon', rulesetVersion: '2024' }).items)
        .toEqual([expect.objectContaining({ name: 'Dlouhý meč', locale: 'cs' })]);
    } finally { database.close(); }
  });

  it('resolves ID and canonical ID to the same localized, typed, sourced detail', async () => {
    const { database } = await openDatabase();
    try {
      const byId = database.dndpedia.get('def_dnd5e_2024_spell_fireball');
      const byCanonical = database.dndpedia.get('dnd5e:2024:Spell:fireball');
      expect(byCanonical).toEqual(byId);
      expect(byId).toMatchObject({
        completeness: 'full',
        content: { kind: 'spell', level: 3, school: 'Zaklínání' },
        source: {
          packId: 'dnd5e-srd-5.2.1', packVersion: '3.0.0', locale: 'cs', license: 'CC BY 4.0',
        },
      });
      expect(byId.content.facts.map((fact) => fact.label)).toContain('Poškození / léčení');

      const weapon = database.dndpedia.get('dnd5e:2024:Weapon:longsword');
      expect(weapon.content).toMatchObject({ kind: 'weapon', damage: expect.stringMatching(/^1k8/) });
      expect(weapon.relatedDefinitions.map((item) => item.name)).toEqual(expect.arrayContaining([
        'Válečné zbraně na blízko', 'Obouruční použití', 'Oslabení',
      ]));
      const magicMissile = database.dndpedia.get('dnd5e:2024:Spell:magic-missile');
      expect(magicMissile).toMatchObject({ completeness: 'full', locale: 'cs', content: { kind: 'spell' } });

      const ipc = new ChronicleIpcService(database);
      expect(ipc.getEntityCard({ id: byId.definitionId })).toMatchObject({
        cardType: 'definition', dndpedia: { canonicalId: byId.canonicalId, content: { kind: 'spell' } },
      });
      expect(database.engine.getDefinition(byId.definitionId)).toMatchObject({
        id: byId.definitionId, dndpedia: { canonicalId: byId.canonicalId },
      });
    } finally { database.close(); }
  });

  it('keeps campaign Homebrew isolated from other campaigns, the Library, and global D&Dpedie', async () => {
    const { database } = await openDatabase();
    try {
      const first = database.domain.createCampaign({ name: 'První', rulesetId: 'dnd5e', rulesetVersion: '2024' });
      const second = database.domain.createCampaign({ name: 'Druhá', rulesetId: 'dnd5e', rulesetVersion: '2024' });
      const firstDefinitionId = await createHomebrew(database, first.id, 'Runová cesta');
      const secondDefinitionId = await createHomebrew(database, second.id, 'Runová cesta');

      expect(database.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', campaignId: first.id,
        includeBuiltIn: false, includeHomebrew: true, limit: 20,
      }).items.map((item) => item.id)).toEqual([firstDefinitionId]);
      expect(database.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', campaignId: second.id,
        includeBuiltIn: false, includeHomebrew: true, limit: 20,
      }).items.map((item) => item.id)).toEqual([secondDefinitionId]);
      expect(database.engine.getCampaignLibrary(first.id).categories.find((item) => item.id === 'homebrew'))
        .toMatchObject({ label: 'Kampaňové Homebrew', items: [{ id: firstDefinitionId }] });
      expect(database.dndpedia.search({ query: 'Runová cesta' }).totalItems).toBe(0);
      expect(database.engine.getCampaignLibrary(first.id).categories.map((item) => item.id)).not.toContain('definitions');
    } finally { database.close(); }
  });
});

describe('Milestone 10 pack and migration safety', () => {
  it('rejects an invalid typed Rules Pack 3.0 atomically and rebuilds a damaged derived index', async () => {
    const opened = await openDatabase();
    let database = opened.database;
    try {
      const active = database.rulesPacks.list().find((item) => item.packId === 'dnd5e-srd-5.2.1')!;
      expect(active).toMatchObject({ version: '3.0.0', schemaVersion: 3, active: true });
      const invalid = structuredClone(bundledRulesPacks().find((pack) => pack.manifest.packId === active.packId)!) as RulesPack;
      invalid.manifest.version = '3.1.0';
      invalid.payload.definitions.forEach((definition) => { definition.packVersion = '3.1.0'; });
      const fireball = invalid.payload.definitions.find((definition) => definition.name === 'Fireball')!;
      fireball.typedContent = {
        kind: 'Generic', definitionType: 'Background', facts: [{ key: 'broken', value: 'yes' }],
      } satisfies RulesPackTypedContent;
      invalid.manifest.contentHash = testHash(invalid.payload);
      await expect(database.rulesPacks.install(invalid)).rejects.toThrow(/neodpovídá typu Spell/);
      expect(database.rulesPacks.list().find((item) => item.packId === active.packId && item.active))
        .toMatchObject({ version: '3.0.0', contentHash: active.contentHash });

      const raw = rawDatabase(database.path);
      raw.exec('DELETE FROM dndpedia_fts;');
      raw.close();
      expect(database.dndpedia.search({ query: 'Fireball' }).totalItems).toBe(0);
      database.close();
      database = await ChronicleDatabase.open(opened.directory);
      expect(database.dndpedia.search({ query: 'Fireball', rulesetVersion: '2024' }).totalItems).toBe(1);
    } finally { database.close(); }
  });

  it('upgrades a schema 8 database with backup, preserved data, documents, and valid foreign keys', async () => {
    const directory = await createTemporaryDirectory('chronicle-m10-schema8-');
    const dataDirectory = path.join(directory, 'data');
    await mkdir(dataDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'chronicle.db');
    const legacy = new DatabaseSync(databasePath);
    legacy.function('chronicle_normalize', (value: unknown) => String(value ?? '').toLowerCase());
    legacy.exec(`CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT;`);
    for (const migration of migrations.filter((candidate) => candidate.version <= 8)) {
      migration.up(legacy);
      legacy.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.version, migration.name, '2026-09-01T00:00:00.000Z');
      legacy.exec(`PRAGMA user_version = ${migration.version};`);
    }
    legacy.prepare(`INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES (?, ?, ?, ?, 'dnd5e', '2024')`).run(
      'campaign-schema8', 'Zachovaná kampaň', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z',
    );
    legacy.close();

    const migrated = await ChronicleDatabase.open(directory);
    try {
      expect(migrated.info).toMatchObject({ schemaVersion: 10, campaignCount: 1, backupCreated: expect.any(String) });
      expect(migrated.domain.getCampaign('campaign-schema8')?.name).toBe('Zachovaná kampaň');
      expect(migrated.dndpedia.get('dnd5e:2024:Spell:fireball')).toMatchObject({ completeness: 'full' });
    } finally { migrated.close(); }
    const inspected = rawDatabase(databasePath);
    expect(inspected.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(inspected.prepare(`SELECT COUNT(*) AS count FROM rule_definition_documents`).get())
      .toMatchObject({ count: expect.any(Number) });
    expect(inspected.prepare(`SELECT COUNT(*) AS count FROM dndpedia_fts`).get())
      .toMatchObject({ count: expect.any(Number) });
    inspected.close();
  });
});

describe('Milestone 10 renderer contract', () => {
  it('provides semantic paging, debounce, keyboard-safe modal navigation, and responsive detail styles', async () => {
    const [controller, main, router, styles] = await Promise.all([
      readFile('src/renderer/dndpedia-controller.ts', 'utf8'),
      readFile('src/renderer/main.ts', 'utf8'),
      readFile('src/renderer/router.ts', 'utf8'),
      readFile('src/renderer/styles.css', 'utf8'),
    ]);
    expect(router).toContain("'dndpedia'");
    expect(main).toContain("navButton('dndpedia'");
    expect(controller).toContain('<table class="dndpedia-table">');
    expect(controller).toContain('scope="col"');
    expect(controller).toContain('aria-live="polite"');
    expect(controller).toContain('}, 250)');
    expect(controller).toContain("this.dialog.addEventListener('cancel'");
    expect(controller).toContain('this.returnFocus?.focus()');
    expect(styles).toContain('.dndpedia-table-wrap { overflow-x: auto; }');
    expect(styles).toContain('grid-template-columns: repeat(4');
    expect(styles).toContain('@media (max-width: 680px)');
  });
});

async function openDatabase(): Promise<{ directory: string; database: ChronicleDatabase }> {
  const directory = await createTemporaryDirectory('chronicle-m10-');
  return { directory, database: await ChronicleDatabase.open(directory) };
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createHomebrew(database: ChronicleDatabase, campaignId: string, name: string): Promise<string> {
  const definitionId = createDomainId('def');
  database.dataChanges.apply({
    id: createDomainId('change'), campaignId, origin: 'manual', summary: `Vytvořit ${name}`,
    changes: [{
      type: 'ruleDefinition.homebrew.create', definitionId, definitionType: 'Feat',
      name, description: 'Kampaňový obsah', aliases: [],
    }],
    expectedRevisions: [], sourceRunId: null, sourceMessageId: null,
  });
  return definitionId;
}

function rawDatabase(databasePath: string): DatabaseSync {
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return database;
}

function testHash(value: unknown): string {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.keys(item as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((item as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(item);
  };
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}
