import type { EventDraft } from './models';

export type DefinitionType =
  | 'Species'
  | 'Race'
  | 'Lineage'
  | 'Subrace'
  | 'Background'
  | 'Class'
  | 'Subclass'
  | 'Feat'
  | 'Feature'
  | 'Spell'
  | 'Condition'
  | 'Language'
  | 'Proficiency'
  | 'Skill'
  | 'DamageType'
  | 'Deity'
  | 'Weapon'
  | 'Armor'
  | 'Equipment'
  | 'Tool'
  | 'Vehicle'
  | 'CreatureDefinition'
  | 'Rule'
  | 'Action'
  | 'Property'
  | 'Mastery'
  | 'WeaponCategory'
  | 'Custom';

export type AbilityId =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export const AbilityIds: readonly AbilityId[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

export interface RuleDefinition {
  id: string;
  campaignId: string | null;
  definitionType: DefinitionType | string;
  rulesetId: string;
  rulesetVersion: string;
  name: string;
  description: string;
  source: string;
  origin: string;
  canonicalId: string | null;
  aliases: readonly string[];
  packId: string | null;
  packVersion: string;
  locale: string;
  builtIn: boolean;
  parentDefinitionIds: readonly string[];
  metadata: Readonly<Record<string, unknown>> | null;
  homebrew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterBiography {
  characterId: string;
  age: number | null;
  birthDate: string | null;
  sexId: string | null;
  genderId: string | null;
  sexualOrientationId: string | null;
  alignment: string | null;
  faithDefinitionId: string | null;
  appearance: string | null;
  biography: string | null;
  height: string | null;
  weight: string | null;
  eyes: string | null;
  hair: string | null;
  skin: string | null;
  personalityTraits: string | null;
  ideals: string | null;
  bonds: string | null;
  flaws: string | null;
  notes: string | null;
}

export interface CharacterOrigin {
  characterId: string;
  speciesId: string | null;
  lineageId: string | null;
  backgroundId: string | null;
}

export interface CharacterChoice {
  id: string;
  characterId: string;
  category: string;
  definitionId: string | null;
  value: string | null;
  override: boolean;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface CharacterClass {
  id: string;
  characterId: string;
  classId: string;
  subclassId: string | null;
  level: number;
  acquiredEventId: string | null;
}

export interface AbilityScoreState {
  characterId: string;
  abilityId: AbilityId;
  baseScore: number;
  permanentModifier: number;
  overrideScore: number | null;
}

export interface DerivedAbilityScore extends AbilityScoreState {
  temporaryModifier: number;
  temporarySetValue: number | null;
  score: number;
  modifier: number;
}

export type ProficiencyCategory =
  | 'savingThrow'
  | 'skill'
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'tool'
  | 'language'
  | 'custom';
export type ProficiencyLevel = 'none' | 'half' | 'proficient' | 'expertise';

export interface CharacterProficiency {
  id: string;
  characterId: string;
  category: ProficiencyCategory;
  targetDefinitionId: string | null;
  customTarget: string | null;
  level: ProficiencyLevel;
  sourceType: string;
  sourceId: string;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface CharacterCombatState {
  characterId: string;
  maximumHp: number;
  currentHp: number;
  temporaryHp: number;
  armorClassBase: number;
  armorClassModifier: number;
  armorClassOverride: number | null;
  initiativeModifier: number;
  deathSaveSuccesses: number;
  deathSaveFailures: number;
  inspiration: boolean;
}

export interface HitDiePool {
  id: string;
  characterId: string;
  dieSize: number;
  current: number;
  maximum: number;
  sourceType: string;
  sourceId: string;
}

export type MovementType = 'walk' | 'fly' | 'swim' | 'climb' | 'burrow' | 'custom';
export interface CharacterMovement {
  id: string;
  characterId: string;
  movementType: MovementType;
  distance: number;
  unit: string;
  sourceType: string;
  sourceId: string;
  condition: string | null;
}

export type SenseType =
  | 'darkvision'
  | 'blindsight'
  | 'tremorsense'
  | 'truesight'
  | 'custom';
export interface CharacterSense {
  id: string;
  characterId: string;
  senseType: SenseType;
  range: number | null;
  unit: string | null;
  sourceType: string;
  sourceId: string;
}

export type DefenseType =
  | 'damageResistance'
  | 'damageImmunity'
  | 'damageVulnerability'
  | 'conditionImmunity';
export interface CharacterDefense {
  id: string;
  characterId: string;
  defenseType: DefenseType;
  definitionId: string;
  sourceType: string;
  sourceId: string;
}

export interface CharacterFeature {
  id: string;
  definitionId: string | null;
  characterId: string;
  sourceType: string;
  sourceId: string;
  acquiredEventId: string | null;
  enabled: boolean;
  customName: string | null;
  customDescription: string | null;
  choices: Readonly<Record<string, unknown>> | null;
  metadata: Readonly<Record<string, unknown>> | null;
}

export type ResetRule =
  | 'shortRest'
  | 'longRest'
  | 'shortOrLongRest'
  | 'dawn'
  | 'manual'
  | 'custom';

export interface EntityResource {
  id: string;
  ownerEntityId: string;
  name: string;
  resourceType: string;
  current: number;
  maximum: number;
  resetRule: ResetRule;
  sourceDefinitionId: string | null;
  sourceFeatureId: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
}

export type ActionType = 'action' | 'bonusAction' | 'reaction' | 'freeAction' | 'special';
export interface DamageComponent {
  formula: string;
  damageTypeId: string | null;
  notes?: string;
}
export interface ActionMechanics {
  attackType?: string;
  attackBonusFormula?: string;
  attackModifier?: number;
  reach?: number;
  range?: { normal: number; long?: number; unit: string };
  target?: string;
  damage?: readonly DamageComponent[];
  savingThrow?: { abilityId: AbilityId; dc?: number; dcFormula?: string };
  effectDefinitionIds?: readonly string[];
  resourceCosts?: readonly { resourceId: string; amount: number }[];
  metadata?: Readonly<Record<string, unknown>>;
}
export interface CharacterAction {
  id: string;
  ownerEntityId: string;
  name: string;
  actionType: ActionType;
  sourceType: string;
  sourceId: string;
  mechanics: ActionMechanics;
}

export interface SpellcastingSource {
  id: string;
  characterId: string;
  sourceType: string;
  sourceId: string;
  spellcastingAbilityId: AbilityId;
  mechanism: string;
  attackModifier: number;
  dcModifier: number;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface CharacterSpell {
  id: string;
  characterId: string;
  spellId: string;
  spellcastingSourceId: string;
  known: boolean;
  prepared: boolean;
  alwaysPrepared: boolean;
  ritualAvailable: boolean;
  customNotes: string | null;
  acquiredEventId: string | null;
}

export interface SpellSlotPool {
  id: string;
  characterId: string;
  spellcastingSourceId: string | null;
  poolType: string;
  slotLevel: number;
  current: number;
  maximum: number;
  resetRule: ResetRule;
}

export type EffectModifier =
  | { kind: 'ability.add'; abilityId: AbilityId; value: number }
  | { kind: 'ability.set'; abilityId: AbilityId; value: number; priority?: number }
  | { kind: 'armorClass.add'; value: number }
  | { kind: 'armorClass.set'; value: number; priority?: number }
  | { kind: 'initiative.add'; value: number }
  | { kind: 'movement.add'; movementType: MovementType; value: number }
  | { kind: 'custom'; key: string; value: unknown };

export interface ActiveEffect {
  id: string;
  targetEntityId: string;
  definitionId: string | null;
  sourceEntityId: string | null;
  sourceFeatureId: string | null;
  sourceSpellId: string | null;
  name: string;
  startEventId: string;
  endEventId: string | null;
  durationType: string;
  durationValue: number | null;
  remainingDuration: number | null;
  concentration: boolean;
  modifiers: readonly EffectModifier[];
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface StateChangeResult<T> {
  state: T;
  eventId: string;
}

export interface StateEventInput {
  event: EventDraft;
}

export interface StateChangeRecord {
  id: string;
  entityId: string;
  eventId: string;
  stateType: string;
  stateKey: string;
  beforeValue: unknown;
  afterValue: unknown;
  metadata: Readonly<Record<string, unknown>> | null;
  recordedAt: string;
}
