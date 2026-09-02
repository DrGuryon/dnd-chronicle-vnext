import type { DefinitionType } from '../domain/character-models';

export const ruleDefinitionRelationTypes = [
  'belongsToSpecies',
  'belongsToRace',
  'belongsToClass',
  'requiresDefinition',
  'compatibleWith',
  'incompatibleWith',
  'availableToClass',
  'grantsDefinition',
  'hasProperty',
  'hasMastery',
  'belongsToCategory',
  'usesDefinition',
] as const;

export type RuleDefinitionRelationType = (typeof ruleDefinitionRelationTypes)[number];

export interface RuleDefinitionRelation {
  sourceDefinitionId: string;
  targetDefinitionId: string;
  relationType: RuleDefinitionRelationType;
  metadata?: Readonly<Record<string, unknown>> | null;
}

export interface RulesPackManifest {
  schemaVersion: 1 | 3;
  packId: string;
  version: string;
  rulesetId: string;
  rulesetVersion: string;
  displayName: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  updateUrl: string;
  publishedAt: string;
  contentHash: string;
}

export interface RulesPackPayload {
  definitions: RulesPackDefinition[];
  relations: RuleDefinitionRelation[];
}

export interface RulesPackContentSection {
  id: string;
  title: string;
  paragraphs: string[];
}

interface RulesPackContentBase {
  sections?: RulesPackContentSection[];
}

export type RulesPackTypedContent =
  | (RulesPackContentBase & {
    kind: 'Spell';
    level: number;
    school: string;
    castingTime: string;
    range: string;
    components: string[];
    duration: string;
    concentration: boolean;
    ritual?: boolean;
    savingThrow?: string | null;
    attackType?: string | null;
    damageOrHealing?: string | null;
  })
  | (RulesPackContentBase & {
    kind: 'Weapon';
    category: string;
    damage: string;
    damageType: string;
    properties: string[];
    mastery?: string | null;
    cost?: string | null;
    weight?: string | null;
  })
  | (RulesPackContentBase & {
    kind: 'Armor';
    category: string;
    armorClass: string;
    strength?: string | null;
    stealth: string;
    cost?: string | null;
    weight?: string | null;
    don?: string | null;
    doff?: string | null;
  })
  | (RulesPackContentBase & {
    kind: 'Species' | 'Race';
    size: string;
    speed: string;
    creatureType?: string | null;
    senses?: string[];
    defenses?: string[];
    languages?: string[];
  })
  | (RulesPackContentBase & {
    kind: 'Class';
    hitDie: string;
    primaryAbilities: string[];
    savingThrows: string[];
    armorTraining: string[];
    weaponProficiencies: string[];
    spellcasting?: string | null;
  })
  | (RulesPackContentBase & {
    kind: 'Generic';
    definitionType: DefinitionType;
    facts: Array<{ key: string; value: string }>;
  });

export interface RulesPackDefinition {
  id: string;
  definitionType: DefinitionType;
  rulesetId: string;
  rulesetVersion: string;
  canonicalId: string;
  name: string;
  aliases: string[];
  source: string;
  packId: string;
  packVersion: string;
  locale: string;
  shortDescription?: string;
  completeness?: 'full' | 'partial';
  contentSchemaVersion?: 1;
  fullDescription?: string;
  typedContent?: RulesPackTypedContent;
  searchText?: string;
  sourceReference?: string;
}

export interface RulesPack {
  manifest: RulesPackManifest;
  payload: RulesPackPayload;
}

export interface RulesPackStatus {
  packId: string;
  version: string;
  schemaVersion: 1 | 3;
  displayName: string;
  rulesetVersion: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  updateUrl: string;
  contentHash: string;
  installedAt: string;
  activatedAt: string | null;
  active: boolean;
}

export interface RulesPackUpdateResult {
  status: RulesPackStatus;
  changed: boolean;
  rolledBack: boolean;
}
