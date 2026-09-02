export type DndpediaSort = 'name-asc' | 'name-desc' | 'type' | 'ruleset';

export interface DndpediaSearchRequest {
  query?: string | null;
  definitionType?: string | null;
  definitionTypes?: readonly string[] | null;
  rulesetId?: string | null;
  rulesetVersion?: string | null;
  sourcePackId?: string | null;
  sort?: DndpediaSort;
  page?: number;
  pageSize?: number;
}

export interface DndpediaFacetOption {
  value: string;
  label: string;
  count: number;
  rulesetId?: string;
  rulesetVersion?: string;
}

export interface DndpediaFacets {
  definitionTypes: DndpediaFacetOption[];
  rulesets: DndpediaFacetOption[];
  sources: DndpediaFacetOption[];
}

export interface DndpediaSourceSummary {
  activePackCount: number;
  displayNames: string[];
}

export interface DndpediaListItem {
  definitionId: string;
  canonicalId: string;
  name: string;
  definitionType: string;
  definitionTypeDisplayName: string;
  shortDescription: string;
  rulesetId: string;
  rulesetVersion: string;
  rulesetDisplayName: string;
  sourcePackId: string;
  sourceDisplayName: string;
  locale: string;
  completeness: 'full' | 'partial';
}

export interface DndpediaSearchResult {
  items: DndpediaListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  facets: DndpediaFacets;
  activeSourceSummary: DndpediaSourceSummary;
}

export interface DndpediaFact {
  key: string;
  label: string;
  value: string;
}

export interface DndpediaContentSection {
  id: string;
  title: string;
  paragraphs: string[];
}

interface DndpediaStructuredContentBase {
  facts: DndpediaFact[];
  sections: DndpediaContentSection[];
}

export type DndpediaStructuredContent =
  | (DndpediaStructuredContentBase & {
    kind: 'spell';
    level: number | null;
    school: string | null;
  })
  | (DndpediaStructuredContentBase & {
    kind: 'weapon';
    damage: string | null;
    category: string | null;
  })
  | (DndpediaStructuredContentBase & {
    kind: 'armor';
    armorClass: string | null;
    category: string | null;
  })
  | (DndpediaStructuredContentBase & {
    kind: 'species';
    size: string | null;
    speed: string | null;
  })
  | (DndpediaStructuredContentBase & {
    kind: 'class';
    hitDie: string | null;
    primaryAbility: string | null;
  })
  | (DndpediaStructuredContentBase & {
    kind: 'generic';
    definitionType: string;
  });

export interface DndpediaRelatedDefinition {
  definitionId: string;
  canonicalId: string;
  name: string;
  definitionType: string;
  definitionTypeDisplayName: string;
  relationType: string;
  relationDisplayName: string;
}

export interface DndpediaSourceMetadata {
  canonicalId: string;
  rulesetDisplayName: string;
  packId: string;
  packDisplayName: string;
  packVersion: string;
  locale: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  sourceReference: string | null;
  adaptationAttribution: string | null;
}

export interface DndpediaEntryDetail {
  definitionId: string;
  canonicalId: string;
  name: string;
  definitionType: string;
  definitionTypeDisplayName: string;
  shortDescription: string;
  fullDescription: string;
  rulesetDisplayName: string;
  sourceDisplayName: string;
  locale: string;
  requestedLocale: string;
  availableLocales: string[];
  usedFallback: boolean;
  completeness: 'full' | 'partial';
  content: DndpediaStructuredContent;
  relatedDefinitions: DndpediaRelatedDefinition[];
  source: DndpediaSourceMetadata;
}

export interface DndpediaEntryRequest {
  id: string;
  locale?: string | null;
}
