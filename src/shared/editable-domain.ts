import type {
  AbilityId,
  AbilityScoreState,
  CharacterBiography,
  CharacterClass,
  CharacterFeature,
  CharacterOrigin,
  CharacterProficiency,
  CharacterSpell,
  DefinitionType,
  RuleDefinition,
  SpellcastingSource,
} from '../domain/character-models';
import type { Character, CharacterType } from '../domain/models';
import type { RulesetDescriptor } from '../rules/registry';

export interface RuleCatalogQuery {
  rulesetId: string;
  rulesetVersion: string;
  campaignId?: string | null;
  definitionTypes?: readonly string[] | null;
  query?: string | null;
  includeBuiltIn?: boolean;
  includeHomebrew?: boolean;
  parentDefinitionId?: string | null;
  limit?: number;
}

export interface RuleCatalogResult {
  items: RuleDefinition[];
  total: number;
  truncated: boolean;
}

export interface HomebrewDefinitionInput {
  campaignId: string;
  rulesetId: string;
  rulesetVersion: string;
  definitionType: DefinitionType | string;
  name: string;
  description?: string;
  aliases?: readonly string[];
  parentDefinitionId?: string | null;
}

export interface RuleReconciliationSuggestion {
  characterId: string;
  category: 'species' | 'lineage' | 'background' | 'class' | 'subclass'
    | 'proficiency' | 'language' | 'feature' | 'spell';
  referenceId: string;
  oldDefinition: RuleDefinition;
  suggestedDefinition: RuleDefinition;
}

export type DataChange =
  | {
    type: 'character.create';
    characterId: string;
    name: string;
    fullName: string | null;
    characterType: CharacterType;
    description: string;
  }
  | {
    type: 'character.identity.set';
    characterId: string;
    name: string;
    fullName: string | null;
    description: string;
  }
  | ({ type: 'character.biography.set'; characterId: string } & Omit<CharacterBiography, 'characterId'>)
  | ({ type: 'character.origin.set'; characterId: string } & Omit<CharacterOrigin, 'characterId'>)
  | {
    type: 'character.class.add';
    classEntryId: string;
    characterId: string;
    classId: string;
    subclassId: string | null;
    level: number;
  }
  | {
    type: 'character.class.update';
    classEntryId: string;
    characterId: string;
    classId: string;
    subclassId: string | null;
    level: number;
  }
  | { type: 'character.class.remove'; classEntryId: string; characterId: string }
  | ({ type: 'character.ability.set' } & AbilityScoreState)
  | {
    type: 'character.proficiency.add';
    proficiencyId: string;
    characterId: string;
    category: CharacterProficiency['category'];
    targetDefinitionId: string | null;
    customTarget: string | null;
    level: CharacterProficiency['level'];
  }
  | {
    type: 'character.proficiency.update';
    proficiencyId: string;
    characterId: string;
    category: CharacterProficiency['category'];
    targetDefinitionId: string | null;
    customTarget: string | null;
    level: CharacterProficiency['level'];
  }
  | { type: 'character.proficiency.remove'; proficiencyId: string; characterId: string }
  | {
    type: 'character.language.add';
    proficiencyId: string;
    characterId: string;
    languageDefinitionId: string | null;
    customLanguage: string | null;
  }
  | {
    type: 'character.language.update';
    proficiencyId: string;
    characterId: string;
    languageDefinitionId: string | null;
    customLanguage: string | null;
  }
  | { type: 'character.language.remove'; proficiencyId: string; characterId: string }
  | {
    type: 'character.feature.add';
    featureId: string;
    characterId: string;
    definitionId: string | null;
    customName: string | null;
    customDescription: string | null;
  }
  | {
    type: 'character.feature.update';
    featureId: string;
    characterId: string;
    definitionId: string | null;
    customName: string | null;
    customDescription: string | null;
  }
  | { type: 'character.feature.remove'; featureId: string; characterId: string }
  | {
    type: 'character.spellcastingSource.add';
    sourceId: string;
    characterId: string;
    sourceType: string;
    sourceDefinitionId: string;
    abilityId: AbilityId;
    mechanism: string;
  }
  | {
    type: 'character.spellcastingSource.update';
    sourceId: string;
    characterId: string;
    sourceType: string;
    sourceDefinitionId: string;
    abilityId: AbilityId;
    mechanism: string;
  }
  | { type: 'character.spellcastingSource.remove'; sourceId: string; characterId: string }
  | {
    type: 'character.spell.add';
    characterSpellId: string;
    characterId: string;
    spellId: string;
    spellcastingSourceId: string;
    known: boolean;
    prepared: boolean;
    alwaysPrepared: boolean;
    ritualAvailable: boolean;
    customNotes: string | null;
  }
  | {
    type: 'character.spell.update';
    characterSpellId: string;
    characterId: string;
    spellId: string;
    spellcastingSourceId: string;
    known: boolean;
    prepared: boolean;
    alwaysPrepared: boolean;
    ritualAvailable: boolean;
    customNotes: string | null;
  }
  | { type: 'character.spell.remove'; characterSpellId: string; characterId: string }
  | { type: 'character.notes.replace'; characterId: string; notes: string | null }
  | { type: 'character.notes.append'; characterId: string; notes: string }
  | {
    type: 'ruleDefinition.homebrew.create';
    definitionId: string;
    definitionType: string;
    name: string;
    description: string;
    aliases: readonly string[];
    parentDefinitionId?: string | null;
  }
  | {
    type: 'ruleDefinition.homebrew.update';
    definitionId: string;
    name: string;
    description: string;
    aliases: readonly string[];
  }
  | {
    type: 'ruleReference.reassign';
    characterId: string;
    category: RuleReconciliationSuggestion['category'];
    referenceId: string;
    fromDefinitionId: string;
    toDefinitionId: string;
  };

export interface DataChangeExpectedRevision {
  entityId: string;
  revision: number;
}

export interface DataChangeTransaction {
  id: string;
  campaignId: string;
  origin: 'manual' | 'ai' | 'system';
  summary: string;
  changes: readonly DataChange[];
  expectedRevisions: readonly DataChangeExpectedRevision[];
  sourceRunId: string | null;
  sourceMessageId: string | null;
}

export interface ProposedDataChangeTransaction {
  summary: string;
  changes: readonly DataChange[];
  expectedRevisions?: readonly DataChangeExpectedRevision[] | null;
  reasoningSummary?: string | null;
}

export interface DataChangeIssue {
  code: string;
  message: string;
  changeIndex?: number;
}

export interface DataChangeValidationResult {
  valid: boolean;
  errors: readonly DataChangeIssue[];
  warnings: readonly DataChangeIssue[];
  normalizedTransaction: DataChangeTransaction | null;
}

export interface AppliedDataChange {
  type: DataChange['type'];
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface DataChangeTransactionResult {
  transactionId: string;
  campaignId: string;
  alreadyApplied: boolean;
  changedEntityIds: readonly string[];
  changes: readonly AppliedDataChange[];
  createdAt: string;
}

export interface PendingDataChangeProposal {
  kind: 'data';
  id: string;
  turnRunId: string;
  campaignId: string;
  conversationId: string;
  transaction: DataChangeTransaction;
  validation: DataChangeValidationResult;
  status: 'pending' | 'applied' | 'rejected' | 'manual';
  createdAt: string;
  updatedAt: string;
  appliedTransactionId: string | null;
}

export interface CharacterEditorView {
  character: Character;
  revision: number;
  biography: CharacterBiography;
  origin: CharacterOrigin;
  classes: readonly CharacterClass[];
  abilities: readonly AbilityScoreState[];
  proficiencies: readonly CharacterProficiency[];
  features: readonly CharacterFeature[];
  spellcastingSources: readonly SpellcastingSource[];
  spells: readonly CharacterSpell[];
}

export interface CharacterDraft {
  campaignId: string;
  characterId?: string;
  baseRevision?: number;
  name: string;
  fullName: string | null;
  description: string;
  characterType: CharacterType;
  biography: Omit<CharacterBiography, 'characterId'>;
  origin: Omit<CharacterOrigin, 'characterId'>;
  classes: readonly Omit<CharacterClass, 'characterId' | 'acquiredEventId'>[];
  abilities: readonly Omit<AbilityScoreState, 'characterId'>[];
  proficiencies: readonly Omit<CharacterProficiency, 'characterId' | 'sourceType' | 'sourceId' | 'metadata'>[];
  features: readonly Omit<CharacterFeature, 'characterId' | 'sourceType' | 'sourceId' | 'acquiredEventId' | 'enabled' | 'choices' | 'metadata'>[];
  spellcastingSources: readonly Omit<SpellcastingSource, 'characterId' | 'attackModifier' | 'dcModifier' | 'metadata'>[];
  spells: readonly Omit<CharacterSpell, 'characterId' | 'acquiredEventId'>[];
  homebrewDefinitions?: readonly (Omit<HomebrewDefinitionInput, 'campaignId' | 'rulesetId' | 'rulesetVersion'> & { id: string })[];
}

export interface DataChangeAuditTransaction {
  id: string;
  campaignId: string;
  origin: DataChangeTransaction['origin'];
  summary: string;
  changedEntityIds: readonly string[];
  createdAt: string;
}

export interface EditableDomainCatalog {
  rulesets: RulesetDescriptor[];
}
