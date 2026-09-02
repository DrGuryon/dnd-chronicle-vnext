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
import type { LanguagePreferences } from '../../shared/languages';

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
}

interface DocumentRow extends Record<string, unknown> {
  locale: string;
  name: string;
  shortDescription: string;
  completeness: 'full' | 'partial' | null;
  fullDescription: string | null;
  contentJson: string | null;
  sourceReference: string | null;
  adaptationAttribution: string | null;
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
         installation.source_url AS sourceUrl
  FROM rule_definitions definition
  JOIN rules_pack_installations installation
    ON installation.pack_id = definition.pack_id
   AND installation.version = definition.pack_version
   AND installation.active = 1
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
    private readonly languagePreferences: () => Pick<LanguagePreferences, 'encyclopediaLocales' | 'applicationLocale'> = () => ({
      encyclopediaLocales: ['en'], applicationLocale: 'cs',
    }),
  ) {}

  search(input: DndpediaSearchRequest = {}): DndpediaSearchResult {
    const pageSize = clampInteger(input.pageSize ?? 25, 1, 100);
    const requestedPage = clampInteger(input.page ?? 1, 1, 1_000_000);
    const sort = dndpediaSort(input.sort);
    const preferences = this.languagePreferences();
    const applicationLocale = preferences.applicationLocale;
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
    `).all(...values) as unknown as CatalogRow[];
    const documents = this.documentsFor(rows.map((row) => row.definitionId));

    // The active built-in catalog is deliberately small (currently 215 entries).
    // Resolve localized documents before sorting so ordering and pagination match
    // the names actually shown to the user rather than the base English names.
    const resolvedItems = rows.map((row) => {
      const document = this.resolveDocument(
        row.definitionId, undefined, preferences.encyclopediaLocales, documents.get(row.definitionId),
      );
      return {
        definitionId: row.definitionId,
        canonicalId: row.canonicalId,
        name: document.selected?.name ?? row.name,
        definitionType: row.definitionType,
        definitionTypeDisplayName: definitionTypeDisplayName(row.definitionType, applicationLocale),
        shortDescription: document.selected?.shortDescription ?? row.shortDescription,
        rulesetId: row.rulesetId,
        rulesetVersion: row.rulesetVersion,
        rulesetDisplayName: this.rulesetDisplayName(row.rulesetId, row.rulesetVersion),
        sourcePackId: row.sourcePackId,
        sourceDisplayName: row.sourceDisplayName,
        locale: document.selected?.locale ?? row.locale,
        completeness: document.selected?.completeness === 'full' ? 'full' as const : 'partial' as const,
      };
    });
    resolvedItems.sort(localizedItemComparator(sort, resolvedItems[0]?.locale ?? preferences.encyclopediaLocales[0] ?? 'en'));
    const items = resolvedItems.slice((page - 1) * pageSize, page * pageSize);

    return {
      items,
      page,
      pageSize,
      totalItems: count.count,
      totalPages,
      facets: this.facets(applicationLocale),
      activeSourceSummary: this.activeSourceSummary(),
    };
  }

  get(id: string, locale?: string | null): DndpediaEntryDetail {
    const value = id.trim();
    if (!value || value.length > 300) throw new Error('D&Dpedie potřebuje platné ID definice.');
    const row = this.database.prepare(`
      ${catalogSelect}
      WHERE ${globalCatalogBoundary}
        AND (definition.id = ? OR definition.canonical_id = ?)
      ORDER BY CASE WHEN definition.id = ? THEN 0 ELSE 1 END, definition.locale
      LIMIT 1
    `).get(value, value, value) as unknown as CatalogRow | undefined;
    if (!row) throw new Error(`Definice ${value} není v aktivní D&Dpedii dostupná.`);
    const preferences = this.languagePreferences();
    const applicationLocale = preferences.applicationLocale;
    const resolution = this.resolveDocument(row.definitionId, locale, preferences.encyclopediaLocales);
    const document = resolution.selected;

    return {
      definitionId: row.definitionId,
      canonicalId: row.canonicalId,
      name: document?.name ?? row.name,
      definitionType: row.definitionType,
      definitionTypeDisplayName: definitionTypeDisplayName(row.definitionType, applicationLocale),
      shortDescription: document?.shortDescription ?? row.shortDescription,
      fullDescription: document?.fullDescription ?? '',
      rulesetDisplayName: this.rulesetDisplayName(row.rulesetId, row.rulesetVersion),
      sourceDisplayName: row.sourceDisplayName,
      locale: document?.locale ?? row.locale,
      requestedLocale: resolution.requestedLocale,
      availableLocales: resolution.availableLocales,
      usedFallback: (document?.locale ?? row.locale) !== resolution.requestedLocale,
      completeness: document?.completeness === 'full' ? 'full' : 'partial',
      content: structuredContent(
        row.definitionType,
        parseTypedContent(document?.contentJson ?? null),
        document?.locale ?? row.locale,
      ),
      relatedDefinitions: this.relatedDefinitions(
        row.definitionId, document?.locale ?? resolution.requestedLocale, applicationLocale, preferences.encyclopediaLocales,
      ),
      source: {
        canonicalId: row.canonicalId,
        rulesetDisplayName: this.rulesetDisplayName(row.rulesetId, row.rulesetVersion),
        packId: row.sourcePackId,
        packDisplayName: row.sourceDisplayName,
        packVersion: row.packVersion,
        locale: document?.locale ?? row.locale,
        license: row.license,
        attribution: row.attribution,
        sourceUrl: row.sourceUrl,
        sourceReference: document?.sourceReference ?? null,
        adaptationAttribution: document?.adaptationAttribution ?? null,
      },
    };
  }

  private resolveDocument(
    definitionId: string,
    requestedLocale?: string | null,
    preferredLocales: readonly string[] = this.languagePreferences().encyclopediaLocales,
    availableDocuments?: readonly DocumentRow[],
  ): {
    requestedLocale: string;
    availableLocales: string[];
    selected: DocumentRow | undefined;
  } {
    const rows = availableDocuments ?? this.database.prepare(`
      SELECT locale, localized_name AS name, short_description AS shortDescription,
             completeness, full_description AS fullDescription,
             content_json AS contentJson, source_reference AS sourceReference,
             adaptation_attribution AS adaptationAttribution
      FROM rule_definition_documents
      WHERE definition_id = ?
      ORDER BY locale
    `).all(definitionId) as unknown as DocumentRow[];
    const preferred = preferredLocales.map(normalizeLocale).filter(Boolean);
    const requested = normalizeLocale(requestedLocale) || preferred[0] || 'en';
    const order = requestedLocale
      ? [...new Set([requested, 'en', ...preferred, ...rows.map((row) => row.locale)])]
      : [...new Set([...preferred, 'en', ...rows.map((row) => row.locale)])];
    const byLocale = new Map(rows.map((row) => [normalizeLocale(row.locale), row]));
    return {
      requestedLocale: requested,
      availableLocales: rows.map((row) => row.locale),
      selected: order.map((candidate) => byLocale.get(candidate)).find(Boolean),
    };
  }

  private documentsFor(definitionIds: readonly string[]): Map<string, DocumentRow[]> {
    if (!definitionIds.length) return new Map();
    const rows = this.database.prepare(`
      SELECT definition_id AS definitionId, locale, localized_name AS name,
             short_description AS shortDescription, completeness,
             full_description AS fullDescription, content_json AS contentJson,
             source_reference AS sourceReference,
             adaptation_attribution AS adaptationAttribution
      FROM rule_definition_documents
      WHERE definition_id IN (${definitionIds.map(() => '?').join(', ')})
      ORDER BY definition_id, locale
    `).all(...definitionIds) as unknown as Array<DocumentRow & { definitionId: string }>;
    const byDefinition = new Map<string, DocumentRow[]>();
    for (const row of rows) {
      const collection = byDefinition.get(row.definitionId) ?? [];
      collection.push(row);
      byDefinition.set(row.definitionId, collection);
    }
    return byDefinition;
  }

  private facets(applicationLocale: string): DndpediaFacets {
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
        value: item.value, label: definitionTypeDisplayName(item.value, applicationLocale), count: item.count,
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

  private relatedDefinitions(
    definitionId: string,
    locale: string,
    applicationLocale: string,
    preferredLocales: readonly string[],
  ): DndpediaEntryDetail['relatedDefinitions'] {
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
    const documents = this.documentsFor(rows.map((row) => row.definitionId));
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.definitionId)) return false;
      seen.add(row.definitionId);
      return true;
    }).map((row) => ({
      ...row,
      name: this.resolveDocument(row.definitionId, locale, preferredLocales, documents.get(row.definitionId)).selected?.name ?? row.name,
      definitionTypeDisplayName: definitionTypeDisplayName(row.definitionType, applicationLocale),
      relationDisplayName: relationTypeDisplayName(row.relationType, applicationLocale),
    })).sort((left, right) => left.definitionType.localeCompare(right.definitionType, 'en')
      || left.name.localeCompare(right.name, locale, { sensitivity: 'base' })
      || left.definitionId.localeCompare(right.definitionId, 'en'));
  }

  private rulesetDisplayName(rulesetId: string, rulesetVersion: string): string {
    const ruleset = this.registry.list().find((candidate) => candidate.id === rulesetId);
    const version = ruleset?.versions.find((candidate) => candidate.id === rulesetVersion);
    return ruleset && version ? `${ruleset.label} (${version.label})` : `${rulesetId} (${rulesetVersion})`;
  }
}

function normalizeLocale(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase('en-US') ?? '';
}

export function definitionTypeDisplayName(value: string, locale = 'cs'): string {
  if (locale === 'en') return value === 'CreatureDefinition' ? 'Creature' : value === 'WeaponCategory' ? 'Weapon category' : value;
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

function relationTypeDisplayName(value: string, locale: string): string {
  if (locale === 'en') {
    const english: Record<string, string> = {
      belongsToSpecies: 'Belongs to species', belongsToRace: 'Belongs to race',
      belongsToClass: 'Belongs to class', requiresDefinition: 'Requires',
      compatibleWith: 'Compatible with', incompatibleWith: 'Incompatible with',
      availableToClass: 'Available to class', grantsDefinition: 'Grants',
      hasProperty: 'Has property', hasMastery: 'Has mastery',
      belongsToCategory: 'Belongs to category', usesDefinition: 'Uses',
    };
    return english[value] ?? value;
  }
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

function structuredContent(
  definitionType: string,
  content: RulesPackTypedContent | null,
  locale: string,
): DndpediaStructuredContent {
  if (!content) return { kind: 'generic', definitionType, facts: [], sections: [] };
  const sections = contentSections(content);
  switch (content.kind) {
    case 'Spell': {
      const facts: DndpediaFact[] = [
        fact('level', factLabel('level', locale), String(content.level)), fact('school', factLabel('school', locale), content.school),
        fact('castingTime', factLabel('castingTime', locale), content.castingTime), fact('range', factLabel('range', locale), content.range),
        fact('components', factLabel('components', locale), content.components.join(', ')), fact('duration', factLabel('duration', locale), content.duration),
        fact('concentration', factLabel('concentration', locale), content.concentration ? yes(locale) : no(locale)),
        ...(content.ritual === undefined ? [] : [fact('ritual', factLabel('ritual', locale), content.ritual ? yes(locale) : no(locale))]),
        ...optionalFacts([
          ['savingThrow', factLabel('savingThrow', locale), content.savingThrow],
          ['attackType', factLabel('attackType', locale), content.attackType],
          ['damageOrHealing', factLabel('damageOrHealing', locale), content.damageOrHealing],
        ]),
      ];
      return { kind: 'spell', level: content.level, school: content.school, facts, sections };
    }
    case 'Weapon': {
      const facts = [
        fact('category', factLabel('category', locale), content.category), fact('damage', factLabel('damage', locale), content.damage),
        fact('damageType', factLabel('damageType', locale), content.damageType),
        fact('properties', factLabel('properties', locale), content.properties.join(', ')),
        ...optionalFacts([
          ['mastery', factLabel('mastery', locale), content.mastery], ['cost', factLabel('cost', locale), content.cost], ['weight', factLabel('weight', locale), content.weight],
        ]),
      ];
      return { kind: 'weapon', damage: content.damage, category: content.category, facts, sections };
    }
    case 'Armor': {
      const facts = [
        fact('category', factLabel('category', locale), content.category), fact('armorClass', 'AC', content.armorClass),
        fact('stealth', factLabel('stealth', locale), content.stealth),
        ...optionalFacts([
          ['strength', factLabel('strength', locale), content.strength], ['cost', factLabel('cost', locale), content.cost], ['weight', factLabel('weight', locale), content.weight],
          ['don', factLabel('don', locale), content.don], ['doff', factLabel('doff', locale), content.doff],
        ]),
      ];
      return { kind: 'armor', armorClass: content.armorClass, category: content.category, facts, sections };
    }
    case 'Species':
    case 'Race': {
      const facts = [
        fact('size', factLabel('size', locale), content.size), fact('speed', factLabel('speed', locale), content.speed),
        ...optionalFacts([['creatureType', factLabel('creatureType', locale), content.creatureType]]),
        ...(content.senses?.length ? [fact('senses', factLabel('senses', locale), content.senses.join(', '))] : []),
        ...(content.defenses?.length ? [fact('defenses', factLabel('defenses', locale), content.defenses.join(', '))] : []),
        ...(content.languages?.length ? [fact('languages', factLabel('languages', locale), content.languages.join(', '))] : []),
      ];
      return { kind: 'species', size: content.size, speed: content.speed, facts, sections };
    }
    case 'Class': {
      const facts = [
        fact('primaryAbilities', factLabel('primaryAbilities', locale), content.primaryAbilities.join(', ')),
        fact('hitDie', factLabel('hitDie', locale), content.hitDie),
        fact('savingThrows', factLabel('savingThrows', locale), content.savingThrows.join(', ')),
        fact('armorTraining', factLabel('armorTraining', locale), content.armorTraining.join(', ') || none(locale)),
        fact('weaponProficiencies', factLabel('weaponProficiencies', locale), content.weaponProficiencies.join(', ')),
        ...optionalFacts([['spellcasting', factLabel('spellcasting', locale), content.spellcasting]]),
      ];
      return { kind: 'class', hitDie: content.hitDie, primaryAbility: content.primaryAbilities.join(', '), facts, sections };
    }
    case 'Generic':
      return {
        kind: 'generic', definitionType: content.definitionType,
        facts: content.facts.map((item) => fact(item.key, factLabel(item.key, locale), item.value)),
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

function factLabel(value: string, locale: string): string {
  const english: Record<string, string> = {
    category: 'Category', prerequisite: 'Prerequisite', repeatable: 'Repeatable', parentClass: 'Class',
    level: 'Level', school: 'School', castingTime: 'Casting time', range: 'Range', components: 'Components',
    duration: 'Duration', concentration: 'Concentration', ritual: 'Ritual', savingThrow: 'Saving throw',
    attackType: 'Attack', damageOrHealing: 'Damage / healing', damage: 'Damage', damageType: 'Damage type',
    properties: 'Properties', mastery: 'Mastery', armorClass: 'Armor class', stealth: 'Stealth', strength: 'Strength',
    size: 'Size', speed: 'Speed', creatureType: 'Creature type', senses: 'Senses', defenses: 'Defenses',
    languages: 'Languages', primaryAbilities: 'Primary abilities', hitDie: 'Hit Die', savingThrows: 'Saving throws',
    armorTraining: 'Armor training', weaponProficiencies: 'Weapon proficiencies', spellcasting: 'Spellcasting',
    focus: 'Focus', cost: 'Cost', weight: 'Weight', don: 'Don', doff: 'Doff', source: 'Source',
  };
  if (locale === 'en') return english[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2');
  const labels: Record<string, string> = {
    category: 'Kategorie', prerequisite: 'Předpoklad', repeatable: 'Opakovatelné',
    parentClass: 'Povolání', level: 'Úroveň', school: 'Škola', castingTime: 'Seslání', range: 'Dosah',
    components: 'Komponenty', duration: 'Trvání', concentration: 'Soustředění', ritual: 'Rituál',
    savingThrow: 'Záchrana', attackType: 'Útok', damageOrHealing: 'Poškození / léčení', damage: 'Poškození',
    damageType: 'Typ poškození', properties: 'Vlastnosti', mastery: 'Mistrovství', armorClass: 'Třída zbroje',
    stealth: 'Nenápadnost', strength: 'Síla', size: 'Velikost', speed: 'Rychlost', creatureType: 'Typ tvora',
    senses: 'Smysly', defenses: 'Obrany', languages: 'Jazyky', primaryAbilities: 'Primární vlastnosti',
    hitDie: 'Kostka životů', savingThrows: 'Záchrany', armorTraining: 'Zbroje',
    weaponProficiencies: 'Zbraně', spellcasting: 'Sesílání', focus: 'Zaměření', cost: 'Cena',
    weight: 'Hmotnost', don: 'Oblečení', doff: 'Sundání', source: 'Zdroj',
  };
  return labels[value] ?? value.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function yes(locale: string): string { return locale === 'en' ? 'Yes' : 'Ano'; }
function no(locale: string): string { return locale === 'en' ? 'No' : 'Ne'; }
function none(locale: string): string { return locale === 'en' ? 'None' : 'Žádné'; }

function dndpediaSort(value: unknown): DndpediaSort {
  return value === 'name-desc' || value === 'type' || value === 'ruleset' ? value : 'name-asc';
}

function localizedItemComparator(
  sort: DndpediaSort,
  locale: string,
): (left: DndpediaSearchResult['items'][number], right: DndpediaSearchResult['items'][number]) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const byName = (left: DndpediaSearchResult['items'][number], right: DndpediaSearchResult['items'][number]) =>
    collator.compare(left.name, right.name) || collator.compare(left.canonicalId, right.canonicalId);
  switch (sort) {
    case 'name-desc': return (left, right) => -byName(left, right);
    case 'type': return (left, right) => collator.compare(left.definitionTypeDisplayName, right.definitionTypeDisplayName) || byName(left, right);
    case 'ruleset': return (left, right) => collator.compare(left.rulesetId, right.rulesetId)
      || collator.compare(right.rulesetVersion, left.rulesetVersion) || byName(left, right);
    case 'name-asc': return byName;
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
