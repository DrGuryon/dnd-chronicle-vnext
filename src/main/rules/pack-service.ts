import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { builtInRuleDefinitions, builtInRuleRelations } from '../../rules/builtin-catalog';
import { listBuiltInRulesets } from '../../rules/registry';
import type { RulesPack, RulesPackStatus, RulesPackUpdateResult } from '../../shared/rules-packs';
import type { AppLogService } from '../app-log/service';

interface PackRow {
  pack_id: string;
  version: string;
  display_name: string;
  ruleset_version: string;
  license: string;
  attribution: string;
  source_url: string;
  update_url: string;
  content_hash: string;
  installed_at: string;
  activated_at: string | null;
  active: number;
}

export class RulesPackService {
  readonly directory: string;

  constructor(
    private readonly database: DatabaseSync,
    userDataDirectory: string,
    private readonly log?: AppLogService,
  ) {
    this.directory = path.join(userDataDirectory, 'rules-packs');
  }

  async bootstrap(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    for (const pack of bundledRulesPacks()) {
      const active = this.database.prepare(`
        SELECT pack_id AS packId, version, content_hash AS contentHash FROM rules_pack_installations
        WHERE ruleset_id = ? AND ruleset_version = ? AND active = 1
      `).get(pack.manifest.rulesetId, pack.manifest.rulesetVersion) as { packId: string; version: string; contentHash: string } | undefined;
      if (!active) {
        await this.install(pack);
        continue;
      }
      try {
        const filePath = path.join(this.directory, safeSegment(active.packId), safeSegment(active.version), 'pack.json');
        const stored = JSON.parse(await readFile(filePath, 'utf8')) as RulesPack;
        validatePack(stored);
        if (stored.manifest.contentHash !== active.contentHash) throw new Error('Aktivní soubor neodpovídá databázovému záznamu.');
      } catch (error) {
        this.log?.write({ severity: 'warning', category: 'rules-pack', event: 'rules-pack.corruption-detected',
          message: 'Aktivní balíček pravidel byl poškozen. Obnovuji ověřenou vestavěnou kopii.',
          details: { packId: active.packId, version: active.version, error: error instanceof Error ? error.message : String(error) } });
        await this.install(pack, true);
      }
    }
  }

  list(): RulesPackStatus[] {
    const rows = this.database.prepare(`
      SELECT pack_id, version, display_name, ruleset_version, license, attribution,
             source_url, update_url, content_hash, installed_at, activated_at, active
      FROM rules_pack_installations ORDER BY ruleset_version, installed_at DESC
    `).all() as unknown as PackRow[];
    return rows.map(mapStatus);
  }

  async updateBundled(packId?: string): Promise<RulesPackUpdateResult[]> {
    const packs = bundledRulesPacks().filter((pack) => !packId || pack.manifest.packId === packId);
    if (packs.length === 0) throw new Error('Požadovaný balíček pravidel není součástí aplikace.');
    return Promise.all(packs.map((pack) => this.install(pack)));
  }

  async update(packId?: string): Promise<RulesPackUpdateResult[]> {
    const rows = this.database.prepare(`
      SELECT pack_id AS packId, update_url AS updateUrl FROM rules_pack_installations
      WHERE active = 1 ${packId ? 'AND pack_id = ?' : ''}
    `).all(...(packId ? [packId] : [])) as unknown as Array<{ packId: string; updateUrl: string }>;
    if (!rows.length) throw new Error('Požadovaný aktivní balíček pravidel nebyl nalezen.');
    const results: RulesPackUpdateResult[] = [];
    for (const row of rows) {
      const url = new URL(row.updateUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com') {
        throw new Error('Zdroj aktualizace balíčku není důvěryhodný.');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Server aktualizací vrátil HTTP ${response.status}.`);
        const source = await response.text();
        if (source.length > 5_000_000) throw new Error('Balíček pravidel překročil bezpečný limit velikosti.');
        const candidate = JSON.parse(source) as RulesPack;
        if (candidate.manifest.packId !== row.packId) throw new Error('Stažený balíček má jiné ID.');
        results.push(await this.install(candidate));
      } catch (error) {
        this.log?.write({ severity: 'error', category: 'rules-pack', event: 'rules-pack.remote-update-failed',
          message: 'Aktualizaci pravidel se nepodařilo stáhnout. Aktivní data zůstala beze změny.',
          details: { packId: row.packId, error: error instanceof Error ? error.message : String(error) } });
        throw new Error('Aktualizaci pravidel se nepodařilo ověřit. Zkontrolujte připojení a zkuste to znovu.');
      } finally { clearTimeout(timeout); }
    }
    return results;
  }

  async install(pack: RulesPack, force = false): Promise<RulesPackUpdateResult> {
    let tempPath: string | undefined;
    try {
      validatePack(pack);
      const existing = this.database.prepare(`
        SELECT content_hash, active FROM rules_pack_installations WHERE pack_id = ? AND version = ?
      `).get(pack.manifest.packId, pack.manifest.version) as { content_hash: string; active: number } | undefined;
      if (existing && existing.content_hash !== pack.manifest.contentHash) {
        throw new Error('Publikovaná verze rules packu je neměnná; změněný obsah musí mít nové číslo verze.');
      }
      if (!force && existing?.content_hash === pack.manifest.contentHash && existing.active === 1) {
        return { status: this.requireStatus(pack.manifest.packId, pack.manifest.version), changed: false, rolledBack: false };
      }

      const packDirectory = path.join(this.directory, safeSegment(pack.manifest.packId), safeSegment(pack.manifest.version));
      await mkdir(packDirectory, { recursive: true });
      const targetPath = path.join(packDirectory, 'pack.json');
      tempPath = path.join(packDirectory, `pack.${process.pid}.${Date.now()}.tmp`);
      await writeFile(tempPath, `${JSON.stringify(pack, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      const persisted = JSON.parse(await readFile(tempPath, 'utf8')) as RulesPack;
      validatePack(persisted);
      await rename(tempPath, targetPath);
      tempPath = undefined;

      const now = new Date().toISOString();
      const previous = this.database.prepare(`
        SELECT version FROM rules_pack_installations
        WHERE ruleset_id = ? AND ruleset_version = ? AND active = 1
      `).get(pack.manifest.rulesetId, pack.manifest.rulesetVersion) as { version: string } | undefined;
      this.database.exec('BEGIN IMMEDIATE;');
      try {
        this.database.prepare('UPDATE rules_pack_update_guard SET enabled = 1 WHERE id = 1').run();
        this.database.prepare(`
          UPDATE rules_pack_installations SET active = 0
          WHERE ruleset_id = ? AND ruleset_version = ?
        `).run(pack.manifest.rulesetId, pack.manifest.rulesetVersion);
        this.database.prepare(`
          INSERT INTO rules_pack_installations(
            pack_id, version, schema_version, ruleset_id, ruleset_version, display_name,
            license, attribution, content_hash, source_url, update_url, published_at, installed_at,
            activated_at, active, previous_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(pack_id, version) DO UPDATE SET
            display_name = excluded.display_name, license = excluded.license,
            attribution = excluded.attribution, content_hash = excluded.content_hash,
            source_url = excluded.source_url, update_url = excluded.update_url, published_at = excluded.published_at,
            installed_at = excluded.installed_at, activated_at = excluded.activated_at,
            active = 1, previous_version = excluded.previous_version
        `).run(
          pack.manifest.packId, pack.manifest.version, pack.manifest.schemaVersion,
          pack.manifest.rulesetId, pack.manifest.rulesetVersion, pack.manifest.displayName,
          pack.manifest.license, pack.manifest.attribution, pack.manifest.contentHash,
          pack.manifest.sourceUrl, pack.manifest.updateUrl, pack.manifest.publishedAt, now, now, previous?.version ?? null,
        );

        const upsert = this.database.prepare(`
          INSERT INTO rule_definitions(
            id, definition_type, ruleset_id, ruleset_version, name, description,
            source, origin, metadata, is_homebrew, created_at, updated_at,
            campaign_id, canonical_id, aliases, pack_id, pack_version, locale, is_builtin
          ) VALUES (?, ?, ?, ?, ?, '', ?, 'builtin', ?, 0, ?, ?, NULL, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, source = excluded.source, metadata = excluded.metadata,
            canonical_id = excluded.canonical_id, aliases = excluded.aliases,
            pack_id = excluded.pack_id, pack_version = excluded.pack_version,
            locale = excluded.locale, updated_at = excluded.updated_at, is_builtin = 1
        `);
        for (const definition of pack.payload.definitions) {
          upsert.run(
            definition.id, definition.definitionType, definition.rulesetId, definition.rulesetVersion,
            definition.name, definition.source,
            JSON.stringify({ license: pack.manifest.license, attribution: pack.manifest.attribution }),
            now, now, definition.canonicalId, JSON.stringify(definition.aliases),
            pack.manifest.packId, pack.manifest.version, definition.locale,
          );
        }
        const deleteRelations = this.database.prepare(`
          DELETE FROM rule_definition_relations WHERE source_definition_id = ?
        `);
        const insertRelation = this.database.prepare(`
          INSERT INTO rule_definition_relations(source_definition_id, target_definition_id, relation_type, metadata)
          VALUES (?, ?, ?, ?)
        `);
        for (const definition of pack.payload.definitions) deleteRelations.run(definition.id);
        for (const relation of pack.payload.relations) {
          insertRelation.run(
            relation.sourceDefinitionId, relation.targetDefinitionId, relation.relationType,
            relation.metadata ? JSON.stringify(relation.metadata) : null,
          );
        }
        this.database.prepare('UPDATE rules_pack_update_guard SET enabled = 0 WHERE id = 1').run();
        this.database.exec('COMMIT;');
      } catch (error) {
        this.database.exec('ROLLBACK;');
        throw error;
      }

      const status = this.requireStatus(pack.manifest.packId, pack.manifest.version);
      this.log?.write({
        severity: 'success', category: 'rules-pack', event: 'rules-pack.activated',
        message: `Balíček ${pack.manifest.displayName} byl ověřen a aktivován.`,
        details: { packId: pack.manifest.packId, version: pack.manifest.version, contentHash: pack.manifest.contentHash },
      });
      return { status, changed: true, rolledBack: false };
    } catch (error) {
      if (tempPath) await unlink(tempPath).catch(() => undefined);
      this.log?.write({
        severity: 'error', category: 'rules-pack', event: 'rules-pack.update-failed',
        message: 'Aktualizaci balíčku pravidel se nepodařilo bezpečně dokončit. Původní verze zůstala aktivní.',
        details: { error: error instanceof Error ? error.message : String(error), packId: pack.manifest?.packId },
      });
      throw error;
    }
  }

  private requireStatus(packId: string, version: string): RulesPackStatus {
    const row = this.database.prepare(`
      SELECT pack_id, version, display_name, ruleset_version, license, attribution,
             source_url, update_url, content_hash, installed_at, activated_at, active
      FROM rules_pack_installations WHERE pack_id = ? AND version = ?
    `).get(packId, version) as unknown as PackRow | undefined;
    if (!row) throw new Error('Instalace balíčku pravidel nebyla nalezena.');
    return mapStatus(row);
  }
}

export function bundledRulesPacks(): RulesPack[] {
  const definitions = builtInRuleDefinitions();
  const relations = builtInRuleRelations();
  return listBuiltInRulesets().flatMap((ruleset) => ruleset.versions.map((version) => {
    const payload = {
      definitions: definitions.filter((item) => item.rulesetId === ruleset.id && item.rulesetVersion === version.id),
      relations: relations.filter((item) => item.sourceDefinitionId.startsWith(`def_${ruleset.id}_${version.id}_`)),
    };
    return {
      manifest: {
        schemaVersion: 1,
        packId: version.catalogPackId,
        version: version.catalogPackVersion,
        rulesetId: ruleset.id,
        rulesetVersion: version.id,
        displayName: version.sourceLabel,
        license: 'CC BY 4.0',
        attribution: 'Dungeons & Dragons System Reference Document, Wizards of the Coast LLC.',
        sourceUrl: version.id === '2014'
          ? 'https://www.dndbeyond.com/resources/1781-systems-reference-document-srd'
          : 'https://www.dndbeyond.com/srd',
        updateUrl: `https://raw.githubusercontent.com/DrGuryon/dnd-chronicle-vnext/main/rules-packs/${version.catalogPackId}/latest.json`,
        publishedAt: version.id === '2014' ? '2023-01-27T00:00:00.000Z' : '2025-04-22T00:00:00.000Z',
        contentHash: hashPayload(payload),
      },
      payload,
    };
  }));
}

export function validatePack(pack: RulesPack): void {
  if (pack.manifest.schemaVersion !== 1) throw new Error('Nepodporované schéma balíčku pravidel.');
  if (!pack.manifest.packId.trim() || !pack.manifest.version.trim()) throw new Error('Balíčku chybí identita nebo verze.');
  if (hashPayload(pack.payload) !== pack.manifest.contentHash) throw new Error('Kontrolní součet balíčku pravidel nesouhlasí.');
  const ids = new Set<string>();
  const canonicalIds = new Set<string>();
  if (!pack.payload.definitions.length) throw new Error('Balíček neobsahuje žádné definice.');
  for (const definition of pack.payload.definitions) {
    if (ids.has(definition.id) || canonicalIds.has(definition.canonicalId)) throw new Error('Balíček obsahuje duplicitní definici.');
    if (definition.rulesetId !== pack.manifest.rulesetId || definition.rulesetVersion !== pack.manifest.rulesetVersion) {
      throw new Error('Definice neodpovídá rulesetu balíčku.');
    }
    if (definition.packId !== pack.manifest.packId || definition.packVersion !== pack.manifest.version) {
      throw new Error('Definice neodpovídá identitě nebo verzi balíčku.');
    }
    ids.add(definition.id);
    canonicalIds.add(definition.canonicalId);
  }
  const relationKeys = new Set<string>();
  const allowedRelations = new Set(['belongsToSpecies', 'belongsToRace', 'belongsToClass', 'requiresDefinition', 'compatibleWith', 'incompatibleWith']);
  for (const relation of pack.payload.relations) {
    if (!ids.has(relation.sourceDefinitionId) || !ids.has(relation.targetDefinitionId)) {
      throw new Error('Balíček obsahuje vztah na neexistující definici.');
    }
    if (!allowedRelations.has(relation.relationType)) throw new Error('Balíček obsahuje nepodporovaný typ vztahu.');
    const key = `${relation.sourceDefinitionId}|${relation.targetDefinitionId}|${relation.relationType}`;
    if (relationKeys.has(key)) throw new Error('Balíček obsahuje duplicitní vztah.');
    relationKeys.add(key);
  }
}

function hashPayload(payload: RulesPack['payload']): string {
  return `sha256:${createHash('sha256').update(stableStringify(payload)).digest('hex')}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeSegment(value: string): string {
  if (!/^[a-z0-9._-]+$/i.test(value)) throw new Error('Neplatný identifikátor balíčku pravidel.');
  return value;
}

function mapStatus(row: PackRow): RulesPackStatus {
  return {
    packId: row.pack_id, version: row.version, displayName: row.display_name,
    rulesetVersion: row.ruleset_version, license: row.license, attribution: row.attribution,
    sourceUrl: row.source_url, updateUrl: row.update_url, contentHash: row.content_hash, installedAt: row.installed_at,
    activatedAt: row.activated_at, active: row.active === 1,
  };
}
