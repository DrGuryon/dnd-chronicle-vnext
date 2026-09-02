import type { DatabaseSync } from 'node:sqlite';
import type { RulesetRegistry } from '../../rules/registry';
import type {
  DndpediaContentSection,
  DndpediaEntryDetail,
  DndpediaFacets,
  DndpediaFact,
  DndpediaSearchRequest,
  DndpediaSearchResult,
  DndpediaSort,
  DndpediaStructuredContent,
} from '../../shared/dndpedia';
import type { RulesPackTypedContent } from '../../shared/rules-packs';

interface CatalogRow extends Record<string, unknown> {
  definitionId: string;
  canonicalId: string;
  name: string;
  definitionType: string;
  shortDescription: string;
  rulesetId: string;
  rulesetVersion: string;
  sourcePackId: string;
  sourceDisplayName: string;
  packVersion: string;
  locale: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  completeness: 'full' | 'partial' | null;
  fullDescription: string | null;
  contentJson: string | null;
  sourceReference: string | null;
}

const catalogSelect = `
  SELECT definition.id AS definitionId, definition.canonical_id AS canonicalId,
         definition.name, definition.definition_type AS definitionType,
         definition.description AS shortDescription,
         definition.ruleset_id AS rulesetId,
         definition.ruleset_version AS rulesetVersion,
         installation.pack_id AS sourcePackId,
         installation.display_name AS sourceDisplayName,
         installation.version AS packVersion,
         definition.locale, installation.license, installation.attribution,
         installation.source_url AS sourceUrl,
         document.completeness, document.full_description AS fullDescription,
         document.content_json AS contentJson,
         document.source_reference AS sourceReference
  FROM rule_definitions definition
  JOIN rules_pack_installations installation
    ON installation.pack_id = definition.pack_id
   AND installation.version = definition.pack_version
   AND installation.active = 1
  LEFT JOIN rule_definition_documents document
    ON document.definition_id = definition.id
   AND document.locale = definition.locale
`;

const globalCatalogBoundary = `
  definition.is_builtin = 1
  AND definition.is_homebrew = 0
  AND definition.campaign_id IS NULL
  AND definition.canonical_id IS NOT NULL
`;

export class DndpediaService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly registry: RulesetRegistry,
  ) {}

  search(input: DndpediaSearchRequest = {}): DndpediaSearchResult {
    const pageSize = clampInteger(input.pageSize ?? 25, 1, 100);
    const requestedPage = clampInteger(input.page ?? 1, 1, 1_000_000);
    const sort = dndpediaSort(input.sort);
    const clauses = [globalCatalogBoundary];
    const values: Array<string | number> = [];

    if (input.definitionType?.trim()) {
      clauses.push('definition.definition_type = ?');
      values.push(input.definitionType.trim());
    } else if (input.definitionTypes?.length) {
      const types = [...new Set(input.definitionTypes.map((item) => item.trim()).filter(Boolean))].slice(0, 30);
      if (types.length) {
        clauses.push(`definition.definition_type IN (${types.map(() => '?').join(', ')})`);
        values.push(...types);
      }
    }
    if (input.rulesetId?.trim()) {
      clauses.push('definition.ruleset_id = ?');
      values.push(input.rulesetId.trim());
    }
    if (input.rulesetVersion?.trim()) {
      clauses.push('definition.ruleset_version = ?');
      values.push(input.rulesetVersion.trim());
    }
    if (input.sourcePackId?.trim()) {
      clauses.push('installation.pack_id = ?');
      values.push(input.sourcePackId.trim());
    }
    const query = input.query?.trim().slice(0, 200);
    if (query) {
      clauses.push(`(
        definition.id = ? COLLATE NOCASE
        OR definition.canonical_id = ? COLLATE NOCASE
        OR definition.id IN (
          SELECT definition_id FROM dndpedia_fts WHERE dndpedia_fts MATCH ?
        )
      )`);
      values.push(query, query, ftsQuery(query));
    }

    const where = clauses.join(' AND ');
    const count = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM rule_definitions definition
      JOIN rules_pack_installations installation
        ON installation.pack_id = definition.pack_id
       AND installation.version = definition.pack_version
       AND installation.active = 1
      WHERE ${where}
    `).get(...values) as unknown as { count: number };
    const totalPages = Math.max(1, Math.ceil(count.count / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = this.database.prepare(`
      ${catalogSelect}
      WHERE ${where}
      ORDER BY ${sortSql(sort)}
      LIMIT ? OFFSET ?
    `).all(...values, pageSize, (page - 1) * pageSize) as unknown as CatalogRow[];

    return {
      items: rows.map((row) => ({
        definitionId: row.definitionId,
        canonicalId: row.canonicalId,
        name: row.name,
        definitionType: row.definitionType,
        definitionTypeDisplayName: definitionTypeDisplayName(row.definitionType),
        shortDescription: row.shortDescription,
        rulesetId: row.rulesetId,
        rulesetVersion: row.rulesetVersion,
        rulesetDisplayName: this.rulesetDisplayName(row.rulesetId, row.rulesetVersion),
        sourcePackId: row.sourcePackId,
        sourceDisplayName: row.sourceDisplayName,
        locale: row.locale,
        completeness: row.completeness === 'full' ? 'full' : 'partial',
      })),
      page,
      pageSize,
      totalItems: count.count,
      totalPages,
      facets: this.facets(),
      activeSourceSummary: this.activeSourceSummary(),
    };
  }

  get(id: string, locale?: string | null): DndpediaEntryDetail {
    const value = id.trim();
    if (!value || value.length > 300) throw new Error('D&Dpedie potřebuje platné ID definice.');
    const localeClause = locale?.trim() ? 'AND definition.locale = ?' : '';
    const values = locale?.trim() ? [value, value, locale.trim()] : [value, value];
    const row = this.database.prepare(`
      ${catalogSelect}
      WHERE ${globalCatalogBoundary}
        AND (definition.id = ? OR definition.canonical_id = ?)
        ${localeClause}
      ORDER BY CASE WHEN definition.id = ? THEN 0 ELSE 1 END, definition.locale
      LIMIT 1
    `).get(...values, value) as unknown as CatalogRow | undefined;
    if (!row) throw new Error(`Definice ${value} není v aktivní D&Dpedii dostupná.`);

    return {
      definitionId: row.definitionId,
      canonicalId: row.canonicalId,
      name: row.name,
      definitionType: row.definitionType,
      definitionTypeDisplayName: definitionTypeDisplayName(row.definitionType),
      shortDescription: row.shortDescription,
      fullDescription: row.fullDescription ?? '',
      rulesetDisplayName: this.rulesetDisplayName(row.rulesetId, row.rulesetVersion),
      sourceDisplayName: row.sourceDisplayName,
      locale: row.locale,
      completeness: row.completeness === 'full' ? 'full' : 'partial',
      content: structuredContent(row.definitionType, parseTypedContent(row.contentJson)),
      relatedDefinitions: this.relatedDefinitions(row.definitionId),
      source: {
        canonicalId: row.canonicalId,
        rulesetDisplayName: this.rulesetDisplayName(row.rulesetId, row.rulesetVersion),
        packId: row.sourcePackId,
        packDisplayName: row.sourceDisplayName,
        packVersion: row.packVersion,
        locale: row.locale,
        license: row.license,
        attribution: row.attribution,
        sourceUrl: row.sourceUrl,
        sourceReference: row.sourceReference,
      },
    };
  }

  private facets(): DndpediaFacets {
    const types = this.database.prepare(`
      SELECT definition.definition_type AS value, COUNT(*) AS count
      FROM rule_definitions definition
      JOIN rules_pack_installations installation
        ON installation.pack_id = definition.pack_id
       AND installation.version = definition.pack_version
       AND installation.active = 1
      WHERE ${globalCatalogBoundary}
      GROUP BY definition.definition_type
      ORDER BY definition.definition_type
    `).all() as unknown as Array<{ value: string; count: number }>;
    const rulesets = this.database.prepare(`
      SELECT definition.ruleset_id AS rulesetId,
             definition.ruleset_version AS rulesetVersion, COUNT(*) AS count
      FROM rule_definitions definition
      JOIN rules_pack_installations installation
        ON installation.pack_id = definition.pack_id
       AND installation.version = definition.pack_version
       AND installation.active = 1
      WHERE ${globalCatalogBoundary}
      GROUP BY definition.ruleset_id, definition.ruleset_version
      ORDER BY definition.ruleset_id, definition.ruleset_version
    `).all() as unknown as Array<{ rulesetId: string; rulesetVersion: string; count: number }>;
    const sources = this.database.prepare(`
      SELECT installation.pack_id AS value, installation.display_name AS label,
             COUNT(definition.id) AS count
      FROM rules_pack_installations installation
      LEFT JOIN rule_definitions definition
        ON definition.pack_id = installation.pack_id
       AND definition.pack_version = installation.version
       AND definition.is_builtin = 1
       AND definition.is_homebrew = 0
       AND definition.campaign_id IS NULL
      WHERE installation.active = 1
      GROUP BY installation.pack_id, installation.display_name
      ORDER BY installation.display_name
    `).all() as unknown as Array<{ value: string; label: string; count: number }>;
    return {
      definitionTypes: types.map((item) => ({
        value: item.value, label: definitionTypeDisplayName(item.value), count: item.count,
      })),
      rulesets: rulesets.map((item) => ({
        value: `${item.rulesetId}@${item.rulesetVersion}`,
        label: this.rulesetDisplayName(item.rulesetId, item.rulesetVersion),
        count: item.count,
        rulesetId: item.rulesetId,
        rulesetVersion: item.rulesetVersion,
      })),
      sources,
    };
  }

  private activeSourceSummary(): DndpediaSearchResult['activeSourceSummary'] {
    const rows = this.database.prepare(`
      SELECT display_name AS displayName FROM rules_pack_installations
      WHERE active = 1 ORDER BY ruleset_id, ruleset_version, display_name
    `).all() as unknown as Array<{ displayName: string }>;
    return { activePackCount: rows.length, displayNames: rows.map((row) => row.displayName) };
  }

  private relatedDefinitions(definitionId: string): DndpediaEntryDetail['relatedDefinitions'] {
    const rows = this.database.prepare(`
      SELECT related.id AS definitionId, related.canonical_id AS canonicalId,
             related.name, related.definition_type AS definitionType,
             relation.relation_type AS relationType
      FROM rule_definition_relations relation
      JOIN rule_definitions related
        ON related.id = CASE
          WHEN relation.source_definition_id = ? THEN relation.target_definition_id
          ELSE relation.source_definition_id
        END
      JOIN rules_pack_installations installation
        ON installation.pack_id = related.pack_id
       AND installation.version = related.pack_version
       AND installation.active = 1
      WHERE (relation.source_definition_id = ? OR relation.target_definition_id = ?)
        AND related.is_builtin = 1 AND related.is_homebrew = 0
        AND related.campaign_id IS NULL AND related.canonical_id IS NOT NULL
      ORDER BY related.definition_type, related.name COLLATE NOCASE, related.id
    `).all(definitionId, definitionId, definitionId) as unknown as Array<{
      definitionId: string;
      canonicalId: string;
      name: string;
      definitionType: string;
      relationType: string;
    }>;
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.definitionId)) return false;
      seen.add(row.definitionId);
      return true;
    }).map((row) => ({
      ...row,
      definitionTypeDisplayName: definitionTypeDisplayName(row.definitionType),
      relationDisplayName: relationTypeDisplayName(row.relationType),
    }));
  }

  private rulesetDisplayName(rulesetId: string, rulesetVersion: string): string {
    const ruleset = this.registry.list().find((candidate) => candidate.id === rulesetId);
    const version = ruleset?.versions.find((candidate) => candidate.id === rulesetVersion);
    return ruleset && version ? `${ruleset.label} (${version.label})` : `${rulesetId} (${rulesetVersion})`;
  }
}

export function definitionTypeDisplayName(value: string): string {
  const labels: Record<string, string> = {
    Species: 'Druh', Race: 'Rasa', Lineage: 'Rod', Subrace: 'Poddruh',
    Background: 'Zázemí', Class: 'Povolání', Subclass: 'Podtřída',
    Feat: 'Výkon', Feature: 'Prvek', Spell: 'Kouzlo', Condition: 'Stav',
    Language: 'Jazyk', Proficiency: 'Zdatnost', Skill: 'Dovednost',
    DamageType: 'Typ poškození', Deity: 'Božstvo', Weapon: 'Zbraň',
    Armor: 'Zbroj', Equipment: 'Výbava', Tool: 'Nástroj', Vehicle: 'Dopravní prostředek',
    CreatureDefinition: 'Tvor', Rule: 'Pravidlo', Action: 'Akce', Property: 'Vlastnost',
    Mastery: 'Mistrovství', WeaponCategory: 'Kategorie zbraní', Custom: 'Vlastní',
  };
  return labels[value] ?? value;
}

function relationTypeDisplayName(value: string): string {
  const labels: Record<string, string> = {
    belongsToSpecies: 'Patří k druhu', belongsToRace: 'Patří k rase',
    belongsToClass: 'Patří k povolání', requiresDefinition: 'Vyžaduje',
    compatibleWith: 'Kompatibilní', incompatibleWith: 'Nekompatibilní',
    availableToClass: 'Dostupné povolání', grantsDefinition: 'Uděluje',
    hasProperty: 'Má vlastnost', hasMastery: 'Má mistrovství',
    belongsToCategory: 'Patří do kategorie', usesDefinition: 'Používá',
  };
  return labels[value] ?? value;
}

function structuredContent(definitionType: string, content: RulesPackTypedContent | null): DndpediaStructuredContent {
  if (!content) return { kind: 'generic', definitionType, facts: [], sections: [] };
  const sections = contentSections(content);
  switch (content.kind) {
    case 'Spell': {
      const facts: DndpediaFact[] = [
        fact('level', 'Úroveň', String(content.level)), fact('school', 'Škola', content.school),
        fact('castingTime', 'Seslání', content.castingTime), fact('range', 'Dosah', content.range),
        fact('components', 'Komponenty', content.components.join(', ')), fact('duration', 'Trvání', content.duration),
        fact('concentration', 'Soustředění', content.concentration ? 'Ano' : 'Ne'),
        ...(content.ritual === undefined ? [] : [fact('ritual', 'Rituál', content.ritual ? 'Ano' : 'Ne')]),
        ...optionalFacts([
          ['savingThrow', 'Záchrana', content.savingThrow],
          ['attackType', 'Útok', content.attackType],
          ['damageOrHealing', 'Poškození / léčení', content.damageOrHealing],
        ]),
      ];
      return { kind: 'spell', level: content.level, school: content.school, facts, sections };
    }
    case 'Weapon': {
      const facts = [
        fact('category', 'Kategorie', content.category), fact('damage', 'Poškození', content.damage),
        fact('damageType', 'Typ poškození', content.damageType),
        fact('properties', 'Vlastnosti', content.properties.join(', ')),
        ...optionalFacts([
          ['mastery', 'Mistrovství', content.mastery], ['cost', 'Cena', content.cost], ['weight', 'Hmotnost', content.weight],
        ]),
      ];
      return { kind: 'weapon', damage: content.damage, category: content.category, facts, sections };
    }
    case 'Armor': {
      const facts = [
        fact('category', 'Kategorie', content.category), fact('armorClass', 'AC', content.armorClass),
        fact('stealth', 'Nenápadnost', content.stealth),
        ...optionalFacts([
          ['strength', 'Síla', content.strength], ['cost', 'Cena', content.cost], ['weight', 'Hmotnost', content.weight],
          ['don', 'Oblečení', content.don], ['doff', 'Sundání', content.doff],
        ]),
      ];
      return { kind: 'armor', armorClass: content.armorClass, category: content.category, facts, sections };
    }
    case 'Species':
    case 'Race': {
      const facts = [
        fact('size', 'Velikost', content.size), fact('speed', 'Rychlost', content.speed),
        ...optionalFacts([['creatureType', 'Typ tvora', content.creatureType]]),
        ...(content.senses?.length ? [fact('senses', 'Smysly', content.senses.join(', '))] : []),
        ...(content.defenses?.length ? [fact('defenses', 'Obrany', content.defenses.join(', '))] : []),
        ...(content.languages?.length ? [fact('languages', 'Jazyky', content.languages.join(', '))] : []),
      ];
      return { kind: 'species', size: content.size, speed: content.speed, facts, sections };
    }
    case 'Class': {
      const facts = [
        fact('primaryAbilities', 'Primární vlastnosti', content.primaryAbilities.join(', ')),
        fact('hitDie', 'Kostka životů', content.hitDie),
        fact('savingThrows', 'Záchrany', content.savingThrows.join(', ')),
        fact('armorTraining', 'Zbroje', content.armorTraining.join(', ') || 'Žádné'),
        fact('weaponProficiencies', 'Zbraně', content.weaponProficiencies.join(', ')),
        ...optionalFacts([['spellcasting', 'Sesílání', content.spellcasting]]),
      ];
      return { kind: 'class', hitDie: content.hitDie, primaryAbility: content.primaryAbilities.join(', '), facts, sections };
    }
    case 'Generic':
      return {
        kind: 'generic', definitionType: content.definitionType,
        facts: content.facts.map((item) => fact(item.key, factLabel(item.key), item.value)),
        sections,
      };
  }
}

function parseTypedContent(value: string | null): RulesPackTypedContent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as RulesPackTypedContent;
    return parsed && typeof parsed === 'object' && typeof parsed.kind === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function contentSections(content: RulesPackTypedContent): DndpediaContentSection[] {
  return (content.sections ?? []).filter((section) => (
    section.id.trim() && section.title.trim() && section.paragraphs.some((paragraph) => paragraph.trim())
  )).map((section) => ({
    id: section.id, title: section.title,
    paragraphs: section.paragraphs.filter((paragraph) => paragraph.trim()),
  }));
}

function fact(key: string, label: string, value: string): DndpediaFact { return { key, label, value }; }

function optionalFacts(values: Array<[string, string, string | null | undefined]>): DndpediaFact[] {
  return values.filter((value): value is [string, string, string] => Boolean(value[2]?.trim()))
    .map(([key, label, value]) => fact(key, label, value));
}

function factLabel(value: string): string {
  const labels: Record<string, string> = {
    category: 'Kategorie', prerequisite: 'Předpoklad', repeatable: 'Opakovatelné',
    parentClass: 'Povolání', level: 'Úroveň', focus: 'Zaměření', cost: 'Cena',
    weight: 'Hmotnost', duration: 'Trvání', source: 'Zdroj',
  };
  return labels[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function dndpediaSort(value: unknown): DndpediaSort {
  return value === 'name-desc' || value === 'type' || value === 'ruleset' ? value : 'name-asc';
}

function sortSql(sort: DndpediaSort): string {
  switch (sort) {
    case 'name-desc': return 'definition.name COLLATE NOCASE DESC, definition.canonical_id DESC';
    case 'type': return 'definition.definition_type, definition.name COLLATE NOCASE, definition.canonical_id';
    case 'ruleset': return 'definition.ruleset_id, definition.ruleset_version DESC, definition.name COLLATE NOCASE';
    case 'name-asc': return 'definition.name COLLATE NOCASE, definition.canonical_id';
  }
}

function ftsQuery(value: string): string {
  const tokens = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  if (!tokens.length) return '""';
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
