import type { DefinitionType } from '../domain/character-models';

export const ruleDefinitionRelationTypes = [
  'belongsToSpecies',
  'belongsToRace',
  'belongsToClass',
  'requiresDefinition',
  'compatibleWith',
  'incompatibleWith',
] as const;

export type RuleDefinitionRelationType = (typeof ruleDefinitionRelationTypes)[number];

export interface RuleDefinitionRelation {
  sourceDefinitionId: string;
  targetDefinitionId: string;
  relationType: RuleDefinitionRelationType;
  metadata?: Readonly<Record<string, unknown>> | null;
}

export interface RulesPackManifest {
  schemaVersion: 1;
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
  definitions: readonly RulesPackDefinition[];
  relations: readonly RuleDefinitionRelation[];
}

export interface RulesPackDefinition {
  id: string;
  definitionType: DefinitionType;
  rulesetId: string;
  rulesetVersion: string;
  canonicalId: string;
  name: string;
  aliases: readonly string[];
  source: string;
  packId: string;
  packVersion: string;
  locale: string;
}

export interface RulesPack {
  manifest: RulesPackManifest;
  payload: RulesPackPayload;
}

export interface RulesPackStatus {
  packId: string;
  version: string;
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
