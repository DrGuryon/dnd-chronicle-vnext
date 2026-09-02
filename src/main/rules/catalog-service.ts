import type { DatabaseSync } from 'node:sqlite';
import type { RuleDefinition } from '../../domain/character-models';
import type {
  RuleCatalogQuery,
  RuleCatalogResult,
  RuleReconciliationSuggestion,
} from '../../shared/editable-domain';
import { RulesetRegistry, type RulesetDescriptor } from '../../rules/registry';

interface DefinitionRow extends Record<string, unknown> {
  id: string;
  definitionType: string;
  rulesetId: string;
  rulesetVersion: string;
  name: string;
  description: string;
  source: string;
  origin: string;
  metadata: string | null;
  homebrew: number;
  createdAt: string;
  updatedAt: string;
  campaignId: string | null;
  canonicalId: string | null;
  aliases: string;
  packId: string | null;
  packVersion: string;
  locale: string;
  builtIn: number;
}

interface ReferenceRow {
  characterId: string;
  category: RuleReconciliationSuggestion['category'];
  referenceId: string;
  definitionId: string;
}

const definitionSelect = `
  SELECT id, definition_type AS definitionType, ruleset_id AS rulesetId,
         ruleset_version AS rulesetVersion, name, description, source, origin,
         metadata, is_homebrew AS homebrew, created_at AS createdAt,
         updated_at AS updatedAt, campaign_id AS campaignId, canonical_id AS canonicalId,
         aliases, pack_id AS packId, pack_version AS packVersion, locale,
         is_builtin AS builtIn
  FROM rule_definitions
`;

export class RulesCatalogService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly registry: RulesetRegistry,
  ) {}

  listRulesets(): RulesetDescriptor[] {
    return this.registry.list();
  }

  get(id: string): RuleDefinition | undefined {
    const row = this.database.prepare(`${definitionSelect} WHERE id = ?`).get(id) as unknown as DefinitionRow | undefined;
    return row ? this.attachParents([mapDefinition(row)])[0] : undefined;
  }

  search(input: RuleCatalogQuery): RuleCatalogResult {
    this.registry.require(input.rulesetId, input.rulesetVersion);
    const limit = clampInteger(input.limit ?? 60, 1, 200);
    const clauses = ['ruleset_id = ?', 'ruleset_version = ?'];
    const values: Array<string | number> = [input.rulesetId, input.rulesetVersion];
    const sourceClauses: string[] = [];
    if (input.includeBuiltIn !== false) sourceClauses.push('is_builtin = 1');
    if (input.includeHomebrew !== false && input.campaignId) {
      sourceClauses.push('(is_homebrew = 1 AND is_builtin = 0 AND campaign_id = ?)');
      values.push(input.campaignId);
    }
    if (sourceClauses.length === 0) return { items: [], total: 0, truncated: false };
    clauses.push(`(${sourceClauses.join(' OR ')})`);
    const types = (input.definitionTypes ?? []).filter(Boolean);
    if (types.length) {
      clauses.push(`definition_type IN (${types.map(() => '?').join(', ')})`);
      values.push(...types);
    }
    if (input.parentDefinitionId) {
      clauses.push(`EXISTS (
        SELECT 1 FROM rule_definition_relations relation
        WHERE relation.source_definition_id = rule_definitions.id
          AND relation.target_definition_id = ?
          AND relation.relation_type IN ('belongsToSpecies', 'belongsToRace', 'belongsToClass')
      )`);
      values.push(input.parentDefinitionId);
    }
    const query = input.query?.trim();
    if (query) {
      clauses.push('(name LIKE ? COLLATE NOCASE OR aliases LIKE ? COLLATE NOCASE)');
      values.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`);
    }
    const where = clauses.join(' AND ');
    const count = this.database.prepare(`SELECT COUNT(*) AS count FROM rule_definitions WHERE ${where}`)
      .get(...values) as unknown as { count: number };
    const rows = this.database.prepare(`${definitionSelect} WHERE ${where}
      ORDER BY is_builtin DESC, definition_type, name COLLATE NOCASE, id LIMIT ?`)
      .all(...values, limit) as unknown as DefinitionRow[];
    return { items: this.attachParents(rows.map(mapDefinition)), total: count.count, truncated: count.count > rows.length };
  }

  reconciliationSuggestions(campaignId: string, characterId?: string): RuleReconciliationSuggestion[] {
    const campaign = this.database.prepare(`
      SELECT id, ruleset_id AS rulesetId, ruleset_version AS rulesetVersion
      FROM campaigns WHERE id = ? AND archived_at IS NULL
    `).get(campaignId) as unknown as { id: string; rulesetId: string; rulesetVersion: string } | undefined;
    if (!campaign) throw new Error(`Kampaň ${campaignId} neexistuje.`);
    const refs = this.referenceRows(campaignId, characterId);
    const builtIns = this.search({
      rulesetId: campaign.rulesetId,
      rulesetVersion: campaign.rulesetVersion,
      campaignId,
      includeBuiltIn: true,
      includeHomebrew: false,
      limit: 200,
    }).items;
    const completed = new Set((this.database.prepare(`
      SELECT character_id || '|' || old_definition_id || '|' || category AS key
      FROM rule_reference_reconciliations WHERE campaign_id = ?
    `).all(campaignId) as unknown as Array<{ key: string }>).map((row) => row.key));
    const suggestions: RuleReconciliationSuggestion[] = [];
    for (const reference of refs) {
      if (completed.has(`${reference.characterId}|${reference.definitionId}|${reference.category}`)) continue;
      const oldDefinition = this.get(reference.definitionId);
      if (!oldDefinition?.homebrew || oldDefinition.builtIn) continue;
      const oldNames = new Set([oldDefinition.name, ...oldDefinition.aliases].map(normalize));
      const candidate = builtIns.find((definition) => (
        compatibleType(reference.category, definition.definitionType)
        && [definition.name, ...definition.aliases].some((name) => oldNames.has(normalize(name)))
      ));
      if (candidate) suggestions.push({
        characterId: reference.characterId,
        category: reference.category,
        referenceId: reference.referenceId,
        oldDefinition,
        suggestedDefinition: candidate,
      });
    }
    return suggestions;
  }

  private referenceRows(campaignId: string, characterId?: string): ReferenceRow[] {
    const characterClause = characterId ? 'AND e.id = ?' : '';
    const values = characterId ? [campaignId, characterId] : [campaignId];
    return this.database.prepare(`
      SELECT e.id AS characterId, 'species' AS category, e.id AS referenceId,
             c.species_id AS definitionId
      FROM entities e JOIN characters c ON c.entity_id = e.id
      WHERE e.campaign_id = ? AND c.species_id IS NOT NULL ${characterClause}
      UNION ALL
      SELECT e.id, 'lineage', e.id, c.lineage_id
      FROM entities e JOIN characters c ON c.entity_id = e.id
      WHERE e.campaign_id = ? AND c.lineage_id IS NOT NULL ${characterClause}
      UNION ALL
      SELECT e.id, 'background', e.id, c.background_id
      FROM entities e JOIN characters c ON c.entity_id = e.id
      WHERE e.campaign_id = ? AND c.background_id IS NOT NULL ${characterClause}
      UNION ALL
      SELECT e.id, 'class', cc.id, cc.class_id
      FROM entities e JOIN character_classes cc ON cc.character_id = e.id
      WHERE e.campaign_id = ? ${characterClause}
      UNION ALL
      SELECT e.id, 'subclass', cc.id, cc.subclass_id
      FROM entities e JOIN character_classes cc ON cc.character_id = e.id
      WHERE e.campaign_id = ? AND cc.subclass_id IS NOT NULL ${characterClause}
      UNION ALL
      SELECT e.id, CASE WHEN cp.category = 'language' THEN 'language' ELSE 'proficiency' END,
             cp.id, cp.target_definition_id
      FROM entities e JOIN character_proficiencies cp ON cp.character_id = e.id
      WHERE e.campaign_id = ? AND cp.target_definition_id IS NOT NULL ${characterClause}
      UNION ALL
      SELECT e.id, 'feature', cf.id, cf.definition_id
      FROM entities e JOIN character_features cf ON cf.character_id = e.id
      WHERE e.campaign_id = ? AND cf.definition_id IS NOT NULL ${characterClause}
      UNION ALL
      SELECT e.id, 'spell', cs.id, cs.spell_id
      FROM entities e JOIN character_spells cs ON cs.character_id = e.id
      WHERE e.campaign_id = ? ${characterClause}
    `).all(...repeatValues(values, 8)) as unknown as ReferenceRow[];
  }

  private attachParents(items: RuleDefinition[]): RuleDefinition[] {
    if (!items.length) return items;
    const placeholders = items.map(() => '?').join(', ');
    const relations = this.database.prepare(`
      SELECT source_definition_id AS sourceId, target_definition_id AS targetId
      FROM rule_definition_relations
      WHERE source_definition_id IN (${placeholders})
        AND relation_type IN ('belongsToSpecies', 'belongsToRace', 'belongsToClass')
    `).all(...items.map((item) => item.id)) as unknown as Array<{ sourceId: string; targetId: string }>;
    const parents = new Map<string, string[]>();
    for (const relation of relations) {
      const current = parents.get(relation.sourceId) ?? [];
      current.push(relation.targetId);
      parents.set(relation.sourceId, current);
    }
    return items.map((item) => ({ ...item, parentDefinitionIds: parents.get(item.id) ?? [] }));
  }
}

function repeatValues(values: readonly string[], count: number): string[] {
  return Array.from({ length: count }, () => values).flat();
}

function compatibleType(category: RuleReconciliationSuggestion['category'], definitionType: string): boolean {
  const types: Record<RuleReconciliationSuggestion['category'], readonly string[]> = {
    species: ['Species', 'Race'],
    lineage: ['Lineage', 'Subrace'],
    background: ['Background'],
    class: ['Class'],
    subclass: ['Subclass'],
    proficiency: ['Proficiency', 'Skill'],
    language: ['Language'],
    feature: ['Feature', 'Feat'],
    spell: ['Spell'],
  };
  return types[category].includes(definitionType);
}

function mapDefinition(row: DefinitionRow): RuleDefinition {
  return {
    id: row.id,
    campaignId: row.campaignId,
    definitionType: row.definitionType,
    rulesetId: row.rulesetId,
    rulesetVersion: row.rulesetVersion,
    name: row.name,
    description: row.description,
    source: row.source,
    origin: row.origin,
    metadata: parseRecord(row.metadata),
    homebrew: Boolean(row.homebrew),
    canonicalId: row.canonicalId,
    aliases: parseAliases(row.aliases),
    packId: row.packId,
    packVersion: row.packVersion,
    locale: row.locale,
    builtIn: Boolean(row.builtIn),
    parentDefinitionIds: [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseRecord(value: string | null): Readonly<Record<string, unknown>> | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Readonly<Record<string, unknown>> : null;
}

function parseAliases(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeLike(value: string): string {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('cs-CZ');
}
