export const CharacterPanelSectionIds = [
  'actions',
  'bonusActions',
  'reactions',
  'features',
  'spells',
  'spellSlots',
  'inventory',
  'defenses',
  'proficiencies',
  'languages',
  'effects',
  'relationships',
  'notes',
] as const;

export type CharacterPanelSectionId = typeof CharacterPanelSectionIds[number];

export interface CharacterPanelPreferences {
  campaignId: string;
  characterId: string;
  sectionOrder: CharacterPanelSectionId[];
  collapsedSections: CharacterPanelSectionId[];
  panelWidth: number;
  updatedAt: string;
}

export type EntityCardKind =
  | 'Spell'
  | 'Feature'
  | 'Feat'
  | 'Class'
  | 'Subclass'
  | 'Species'
  | 'Race'
  | 'Lineage'
  | 'Subrace'
  | 'Background'
  | 'Condition'
  | 'Language'
  | 'Skill'
  | 'Proficiency'
  | 'DamageType'
  | 'Deity'
  | 'Custom'
  | 'Item'
  | 'Location'
  | 'Character'
  | 'Creature'
  | 'Effect'
  | 'Action'
  | 'Event';

export interface EntitySummary {
  id: string;
  kind: EntityCardKind;
  label: string;
  subtitle: string | null;
  contextCharacterId?: string;
}

export interface EntityCardRequest {
  id: string;
  kind?: EntityCardKind;
  characterId?: string;
  observerEntityId?: string;
}

export interface CharacterPanelPreferencesInput {
  campaignId: string;
  characterId: string;
  sectionOrder: readonly CharacterPanelSectionId[];
  collapsedSections: readonly CharacterPanelSectionId[];
  panelWidth: number;
}

export interface CockpitAbilityView {
  id: 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma';
  abbreviation: string;
  baseScore: number;
  permanentModifier: number;
  overrideScore: number | null;
  temporaryModifier: number;
  temporarySetValue: number | null;
  score: number;
  modifier: number;
  savingThrow: {
    level: 'none' | 'half' | 'proficient' | 'expertise';
    bonus: number;
  } | null;
}

export interface CockpitResourceView {
  id: string;
  name: string;
  resourceType: string;
  current: number;
  maximum: number;
  resetRule: string;
  display: 'pips' | 'number' | 'dice';
  dieSize: number | null;
  source: EntitySummary | null;
}

export interface CockpitActionView {
  id: string;
  name: string;
  actionType: 'action' | 'bonusAction' | 'reaction' | 'freeAction' | 'special';
  attackBonus: string | null;
  range: string | null;
  damage: string | null;
  resourceCost: string | null;
  source: EntitySummary | null;
  card: EntitySummary;
}

export interface CockpitFeatureView {
  id: string;
  name: string;
  enabled: boolean;
  homebrew: boolean;
  sourceLabel: string;
  definition: EntitySummary | null;
  card: EntitySummary;
}

export interface CockpitSpellView {
  id: string;
  definition: EntitySummary;
  level: number;
  known: boolean;
  prepared: boolean;
  alwaysPrepared: boolean;
  ritual: boolean;
  concentration: boolean;
  spellcastingSourceId: string;
}

export interface CockpitSpellcastingSourceView {
  id: string;
  label: string;
  mechanism: string;
  abilityId: string;
  attackBonus: number;
  saveDc: number;
  source: EntitySummary | null;
}

export interface CockpitSpellSlotPoolView {
  id: string;
  poolType: string;
  slotLevel: number;
  current: number;
  maximum: number;
  resetRule: string;
  spellcastingSourceId: string | null;
  sourceLabel: string | null;
}

export interface CockpitEffectView {
  id: string;
  name: string;
  condition: boolean;
  concentration: boolean;
  durationLabel: string;
  definition: EntitySummary | null;
  sourceSpell: EntitySummary | null;
  card: EntitySummary;
}

export interface CockpitProficiencyView {
  id: string;
  category: string;
  label: string;
  level: 'none' | 'half' | 'proficient' | 'expertise';
  target: EntitySummary | null;
  sourceLabel: string;
}

export interface CockpitDefenseView {
  id: string;
  defenseType: string;
  target: EntitySummary;
  sourceLabel: string;
}

export interface CockpitInventoryItemView {
  id: string;
  name: string;
  quantity: number;
  placementLabel: string;
  card: EntitySummary;
}

export interface CharacterCockpitView {
  characterId: string;
  campaignId: string;
  identity: {
    name: string;
    fullName: string | null;
    description: string;
    imageResourceId: string | null;
    characterType: 'PC' | 'NPC';
    totalLevel: number;
    classSummary: string;
    classes: EntitySummary[];
    species: EntitySummary | null;
    background: EntitySummary | null;
    currentLocation: EntitySummary | null;
  };
  combat: {
    hp: { current: number; maximum: number; temporary: number };
    armorClass: number;
    initiative: number;
    proficiencyBonus: number;
    inspiration: boolean;
    deathSaves: { successes: number; failures: number };
  };
  primaryMovement: { type: string; distance: number; unit: string } | null;
  movement: Array<{ id: string; type: string; distance: number; unit: string; condition: string | null }>;
  abilities: CockpitAbilityView[];
  resources: CockpitResourceView[];
  hitDice: Array<{ id: string; dieSize: number; current: number; maximum: number }>;
  actions: CockpitActionView[];
  features: CockpitFeatureView[];
  spellcasting: {
    sources: CockpitSpellcastingSourceView[];
    spells: CockpitSpellView[];
    slotPools: CockpitSpellSlotPoolView[];
  };
  effects: CockpitEffectView[];
  concentration: CockpitEffectView | null;
  defenses: CockpitDefenseView[];
  proficiencies: CockpitProficiencyView[];
  languages: CockpitProficiencyView[];
  inventory: CockpitInventoryItemView[];
  relationships: import('./relationships').ActorRelationshipView[];
  notes: {
    age: number | null;
    alignment: string | null;
    appearance: string | null;
    biography: string | null;
    personalityTraits: string | null;
    ideals: string | null;
    bonds: string | null;
    flaws: string | null;
    notes: string | null;
  };
  preferences: CharacterPanelPreferences;
}

export interface EntityCardBase {
  id: string;
  kind: EntityCardKind;
  name: string;
  description: string;
  imageResourceId: string | null;
  references: EntitySummary[];
}

export interface DefinitionCardView extends EntityCardBase {
  cardType: 'definition';
  definitionType: string;
  source: string;
  origin: string;
  homebrew: boolean;
  metadata: Readonly<Record<string, unknown>> | null;
  characterState: Readonly<Record<string, unknown>> | null;
  linkedResources: CockpitResourceView[];
  linkedActions: CockpitActionView[];
}

export interface FeatureCardView extends EntityCardBase {
  cardType: 'feature';
  enabled: boolean;
  sourceLabel: string;
  homebrew: boolean;
  linkedResources: CockpitResourceView[];
  linkedActions: CockpitActionView[];
}

export interface ItemCardView extends EntityCardBase {
  cardType: 'item';
  quantity: number;
  placementLabel: string;
  effectiveLocation: EntitySummary | null;
  aliases: string[];
  history: string[];
}

export interface LocationCardView extends EntityCardBase {
  cardType: 'location';
  locationType: string;
  fullPath: string;
  parent: EntitySummary | null;
  children: EntitySummary[];
}

export interface CharacterCardView extends EntityCardBase {
  cardType: 'character';
  fullName: string | null;
  characterType: 'PC' | 'NPC';
  species: EntitySummary | null;
  currentLocation: EntitySummary | null;
  relationshipSummary: string[];
  relationships: import('./relationships').ActorRelationshipView[];
}

export interface CreatureCardView extends EntityCardBase {
  cardType: 'creature';
  currentLocation: EntitySummary | null;
  currentLifeStateId: string;
  relationshipSummary: string[];
  relationships: import('./relationships').ActorRelationshipView[];
}

export interface EffectCardView extends EntityCardBase {
  cardType: 'effect';
  active: boolean;
  concentration: boolean;
  durationLabel: string;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface ActionCardView extends EntityCardBase {
  cardType: 'action';
  actionType: string;
  mechanics: Readonly<Record<string, unknown>>;
  source: EntitySummary | null;
}

export interface EventCardView extends EntityCardBase {
  cardType: 'event';
  eventType: string;
  sequence: number;
  timestamp: string | null;
  sourceMessageId: string | null;
  location: EntitySummary | null;
}

export type EntityCardView =
  | DefinitionCardView
  | FeatureCardView
  | ItemCardView
  | LocationCardView
  | CharacterCardView
  | CreatureCardView
  | EffectCardView
  | ActionCardView
  | EventCardView;
