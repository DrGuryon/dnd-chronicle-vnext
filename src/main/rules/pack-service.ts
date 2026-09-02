import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { builtInRuleContent, builtInRuleDefinitions, builtInRuleRelations } from '../../rules/builtin-catalog';
import { listBuiltInRulesets } from '../../rules/registry';
import {
  ruleDefinitionRelationTypes,
  type RulesPack,
  type RulesPackDefinition,
  type RulesPackStatus,
  type RulesPackTypedContent,
  type RulesPackUpdateResult,
} from '../../shared/rules-packs';
import type { AppLogService } from '../app-log/service';
import { rebuildDndpediaSearchIndex } from './dndpedia-index';

interface PackRow {
  pack_id: string;
  version: string;
  schema_version: 1 | 3;
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
      if (active.packId === pack.manifest.packId && compareVersions(active.version, pack.manifest.version) < 0) {
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
    // FTS je odvozený index. Jeho obnova při startu opraví i ruční poškození
    // bez zásahu do zdrojových definic nebo aktivních verzí balíčků.
    rebuildDndpediaSearchIndex(this.database);
  }

  list(): RulesPackStatus[] {
    const rows = this.database.prepare(`
      SELECT pack_id, version, schema_version, display_name, ruleset_version, license, attribution,
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
      this.assertStableDefinitionIdentities(pack);
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
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'builtin', ?, 0, ?, ?, NULL, ?, ?, ?, ?, ?, 1)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name, description = excluded.description,
            source = excluded.source, metadata = excluded.metadata,
            canonical_id = excluded.canonical_id, aliases = excluded.aliases,
            pack_id = excluded.pack_id, pack_version = excluded.pack_version,
            locale = excluded.locale, updated_at = excluded.updated_at, is_builtin = 1
        `);
        for (const definition of pack.payload.definitions) {
          upsert.run(
            definition.id, definition.definitionType, definition.rulesetId, definition.rulesetVersion,
            definition.name, definition.shortDescription ?? '', definition.source,
            JSON.stringify({ license: pack.manifest.license, attribution: pack.manifest.attribution }),
            now, now, definition.canonicalId, JSON.stringify(definition.aliases),
            pack.manifest.packId, pack.manifest.version, definition.locale,
          );
        }
        const upsertDocument = this.database.prepare(`
          INSERT INTO rule_definition_documents(
            definition_id, content_schema_version, locale, completeness,
            full_description, content_json, search_text, content_hash,
            source_reference, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(definition_id, locale) DO UPDATE SET
            content_schema_version = excluded.content_schema_version,
            completeness = excluded.completeness,
            full_description = excluded.full_description,
            content_json = excluded.content_json,
            search_text = excluded.search_text,
            content_hash = excluded.content_hash,
            source_reference = excluded.source_reference,
            updated_at = excluded.updated_at
        `);
        const deleteDocument = this.database.prepare(`
          DELETE FROM rule_definition_documents WHERE definition_id = ? AND locale = ?
        `);
        for (const definition of pack.payload.definitions) {
          if (pack.manifest.schemaVersion === 1) {
            deleteDocument.run(definition.id, definition.locale);
            continue;
          }
          const documentValue = {
            completeness: definition.completeness ?? 'partial',
            fullDescription: definition.fullDescription ?? '',
            typedContent: definition.typedContent ?? null,
            searchText: definition.searchText ?? '',
            sourceReference: definition.sourceReference ?? null,
          };
          upsertDocument.run(
            definition.id, definition.contentSchemaVersion ?? 1, definition.locale,
            definition.completeness ?? 'partial', definition.fullDescription ?? '',
            definition.typedContent ? JSON.stringify(definition.typedContent) : null,
            definition.searchText ?? '', hashValue(documentValue),
            definition.sourceReference ?? null, now, now,
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
        rebuildDndpediaSearchIndex(this.database);
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
      SELECT pack_id, version, schema_version, display_name, ruleset_version, license, attribution,
             source_url, update_url, content_hash, installed_at, activated_at, active
      FROM rules_pack_installations WHERE pack_id = ? AND version = ?
    `).get(packId, version) as unknown as PackRow | undefined;
    if (!row) throw new Error('Instalace balíčku pravidel nebyla nalezena.');
    return mapStatus(row);
  }

  private assertStableDefinitionIdentities(pack: RulesPack): void {
    const select = this.database.prepare(`
      SELECT canonical_id AS canonicalId, definition_type AS definitionType,
             ruleset_id AS rulesetId, ruleset_version AS rulesetVersion
      FROM rule_definitions WHERE id = ?
    `);
    for (const definition of pack.payload.definitions) {
      const existing = select.get(definition.id) as unknown as {
        canonicalId: string | null;
        definitionType: string;
        rulesetId: string;
        rulesetVersion: string;
      } | undefined;
      if (!existing) continue;
      if (existing.canonicalId !== definition.canonicalId
        || existing.definitionType !== definition.definitionType
        || existing.rulesetId !== definition.rulesetId
        || existing.rulesetVersion !== definition.rulesetVersion) {
        throw new Error(`Balíček mění stabilní identitu definice ${definition.id}.`);
      }
    }
  }
}

export function bundledRulesPacks(): RulesPack[] {
  const definitions: RulesPackDefinition[] = builtInRuleDefinitions().map((definition) => {
    const slug = definition.canonicalId.split(':').at(-1)!;
    const content = builtInRuleContent(definition.rulesetVersion, definition.definitionType, slug);
    return {
      ...definition,
      aliases: [...definition.aliases],
      shortDescription: content?.shortDescription ?? '',
      completeness: content ? 'full' : 'partial',
      contentSchemaVersion: 1,
      fullDescription: content?.fullDescription ?? '',
      ...(content ? {
        typedContent: content.typedContent,
        searchText: content.searchText,
        sourceReference: content.sourceReference,
      } : {}),
    };
  });
  const relations = builtInRuleRelations();
  return listBuiltInRulesets().flatMap((ruleset) => ruleset.versions.map((version) => {
    const payload = {
      definitions: definitions.filter((item) => item.rulesetId === ruleset.id && item.rulesetVersion === version.id),
      relations: relations.filter((item) => item.sourceDefinitionId.startsWith(`def_${ruleset.id}_${version.id}_`)),
    };
    return {
      manifest: {
        schemaVersion: 3,
        packId: version.catalogPackId,
        version: version.catalogPackVersion,
        rulesetId: ruleset.id,
        rulesetVersion: version.id,
        displayName: version.sourceLabel,
        license: 'CC BY 4.0',
        attribution: version.id === '2014'
          ? 'This work includes material from the System Reference Document 5.1 (SRD 5.1) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.1 is licensed under CC BY 4.0, available at https://creativecommons.org/licenses/by/4.0/legalcode.'
          : 'This work includes material from the System Reference Document 5.2.1 (SRD 5.2.1) by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under CC BY 4.0, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
        sourceUrl: version.id === '2014'
          ? 'https://www.dndbeyond.com/resources/1781-systems-reference-document-srd'
          : 'https://www.dndbeyond.com/srd',
        updateUrl: `https://raw.githubusercontent.com/DrGuryon/dnd-chronicle-vnext/main/rules-packs/${version.catalogPackId}/latest.json`,
        publishedAt: version.id === '2014' ? '2023-01-27T00:00:00.000Z' : '2025-05-01T00:00:00.000Z',
        contentHash: hashPayload(payload),
      },
      payload,
    };
  }));
}

export function validatePack(pack: RulesPack): void {
  if (pack.manifest.schemaVersion !== 1 && pack.manifest.schemaVersion !== 3) {
    throw new Error('Nepodporované schéma balíčku pravidel.');
  }
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
    if (!definition.id.trim() || !definition.canonicalId.trim() || !definition.name.trim()
      || !definition.definitionType.trim() || !definition.locale.trim()) {
      throw new Error('Definice nemá úplnou identitu.');
    }
    if (!Array.isArray(definition.aliases) || definition.aliases.some((alias) => typeof alias !== 'string')) {
      throw new Error('Definice obsahuje neplatné aliasy.');
    }
    if (pack.manifest.schemaVersion === 3) validateContentDocument(definition);
    ids.add(definition.id);
    canonicalIds.add(definition.canonicalId);
  }
  const relationKeys = new Set<string>();
  const allowedRelations = new Set<string>(ruleDefinitionRelationTypes);
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
  return hashValue(payload);
}

function hashValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
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
    packId: row.pack_id, version: row.version, schemaVersion: row.schema_version, displayName: row.display_name,
    rulesetVersion: row.ruleset_version, license: row.license, attribution: row.attribution,
    sourceUrl: row.source_url, updateUrl: row.update_url, contentHash: row.content_hash, installedAt: row.installed_at,
    activatedAt: row.activated_at, active: row.active === 1,
  };
}

function validateContentDocument(definition: RulesPackDefinition): void {
  if (definition.contentSchemaVersion !== 1) throw new Error('Definice má nepodporované schéma obsahu.');
  if (definition.completeness !== 'full' && definition.completeness !== 'partial') {
    throw new Error('Definice nemá platný stav úplnosti.');
  }
  if (typeof definition.shortDescription !== 'string' || definition.shortDescription.length > 2_000) {
    throw new Error('Definice má neplatný krátký popis.');
  }
  if (typeof definition.fullDescription !== 'string' || definition.fullDescription.length > 100_000) {
    throw new Error('Definice má neplatný úplný popis.');
  }
  if (definition.completeness === 'full') {
    if (!definition.fullDescription.trim() || !definition.typedContent) {
      throw new Error('Úplné definici chybí validovaný strukturovaný obsah.');
    }
    validateTypedContent(definition.definitionType, definition.typedContent);
  } else if (definition.typedContent) {
    validateTypedContent(definition.definitionType, definition.typedContent);
  }
  if (definition.searchText !== undefined && (typeof definition.searchText !== 'string' || definition.searchText.length > 50_000)) {
    throw new Error('Definice má neplatný vyhledávací text.');
  }
  if (definition.sourceReference !== undefined && (typeof definition.sourceReference !== 'string' || definition.sourceReference.length > 1_000)) {
    throw new Error('Definice má neplatný odkaz na zdroj.');
  }
}

function validateTypedContent(definitionType: string, content: RulesPackTypedContent): void {
  if (!content || typeof content !== 'object') throw new Error('Strukturovaný obsah není objekt.');
  const value = content as unknown as Record<string, unknown>;
  const kind = value.kind;
  const compatible = kind === definitionType
    || (['Species', 'Race'].includes(definitionType) && (kind === 'Species' || kind === 'Race'))
    || (kind === 'Generic' && value.definitionType === definitionType);
  if (!compatible) throw new Error(`Strukturovaný obsah neodpovídá typu ${definitionType}.`);
  if (value.sections !== undefined) {
    if (!Array.isArray(value.sections) || value.sections.some((candidate) => {
      if (!candidate || typeof candidate !== 'object') return true;
      const section = candidate as Record<string, unknown>;
      return !nonEmptyText(section.id) || !nonEmptyText(section.title) || !Array.isArray(section.paragraphs)
        || section.paragraphs.length === 0 || section.paragraphs.some((paragraph) => !nonEmptyText(paragraph));
    })) throw new Error('Strukturovaný obsah má neplatné sekce.');
  }
  switch (kind) {
    case 'Spell':
      if (!Number.isInteger(value.level) || (value.level as number) < 0 || (value.level as number) > 9
        || !requiredTexts(value, ['school', 'castingTime', 'range', 'duration'])
        || !stringArray(value.components, false) || typeof value.concentration !== 'boolean'
        || (value.ritual !== undefined && typeof value.ritual !== 'boolean')
        || !optionalTexts(value, ['savingThrow', 'attackType', 'damageOrHealing'])) {
        throw new Error('Kouzlo má neplatný strukturovaný obsah.');
      }
      break;
    case 'Weapon':
      if (!requiredTexts(value, ['category', 'damage', 'damageType']) || !stringArray(value.properties, true)
        || !optionalTexts(value, ['mastery', 'cost', 'weight'])) {
        throw new Error('Zbraň má neplatný strukturovaný obsah.');
      }
      break;
    case 'Armor':
      if (!requiredTexts(value, ['category', 'armorClass', 'stealth'])
        || !optionalTexts(value, ['strength', 'cost', 'weight', 'don', 'doff'])) {
        throw new Error('Zbroj má neplatný strukturovaný obsah.');
      }
      break;
    case 'Species':
    case 'Race':
      if (!requiredTexts(value, ['size', 'speed']) || !optionalTexts(value, ['creatureType'])
        || !optionalStringArrays(value, ['senses', 'defenses', 'languages'])) {
        throw new Error('Druh nebo rasa má neplatný strukturovaný obsah.');
      }
      break;
    case 'Class':
      if (!requiredTexts(value, ['hitDie']) || !stringArray(value.primaryAbilities, false)
        || !stringArray(value.savingThrows, false) || !stringArray(value.armorTraining, true)
        || !stringArray(value.weaponProficiencies, false) || !optionalTexts(value, ['spellcasting'])) {
        throw new Error('Povolání má neplatný strukturovaný obsah.');
      }
      break;
    case 'Generic':
      if (!Array.isArray(value.facts) || value.facts.some((candidate) => {
        if (!candidate || typeof candidate !== 'object') return true;
        const item = candidate as Record<string, unknown>;
        return !nonEmptyText(item.key) || !nonEmptyText(item.value);
      })) throw new Error('Obecný strukturovaný obsah má neplatná fakta.');
      break;
    default:
      throw new Error('Strukturovaný obsah má nepodporovaný typ.');
  }
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim());
}

function requiredTexts(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => nonEmptyText(value[key]));
}

function optionalTexts(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined || value[key] === null || nonEmptyText(value[key]));
}

function stringArray(value: unknown, allowEmpty: boolean): value is string[] {
  return Array.isArray(value) && (allowEmpty || value.length > 0) && value.every(nonEmptyText);
}

function optionalStringArrays(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => value[key] === undefined || stringArray(value[key], true));
}

function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}
