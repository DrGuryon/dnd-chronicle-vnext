export type EntityType = 'Character' | 'Creature' | 'Item' | 'Location';
export type CharacterType = 'PC' | 'NPC';

export const LifeStateIds = {
  alive: 'life_state_alive',
  unconscious: 'life_state_unconscious',
  dead: 'life_state_dead',
  unknown: 'life_state_unknown',
} as const;

export interface Campaign {
  id: string;
  name: string;
  rulesetId: string;
  rulesetVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityBase {
  id: string;
  campaignId: string;
  entityType: EntityType;
  name: string;
  description: string;
  imageResourceId: string | null;
  createdEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Location extends EntityBase {
  entityType: 'Location';
  parentLocationId: string | null;
  locationType: string;
}

export interface Character extends EntityBase {
  entityType: 'Character';
  fullName: string | null;
  characterType: CharacterType;
  currentLocationId: string | null;
  currentLifeStateId: string;
}

export interface Creature extends EntityBase {
  entityType: 'Creature';
  currentLocationId: string | null;
  currentLifeStateId: string;
}

export interface Item extends EntityBase {
  entityType: 'Item';
  itemDefinitionId: string | null;
  quantity: number;
}

export interface ChronicleEvent {
  id: string;
  campaignId: string;
  eventType: string;
  sequence: number;
  timestamp: string | null;
  locationId: string | null;
  summary: string;
  sourceMessageId: string | null;
  createdAt: string;
}

export interface EntityAlias {
  id: string;
  entityId: string;
  alias: string;
  usedByEntityId: string | null;
  fromEventId: string | null;
  toEventId: string | null;
}

export interface EntityRelation {
  id: string;
  campaignId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  fromEventId: string | null;
  toEventId: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface KnowledgeRecord {
  id: string;
  campaignId: string;
  subjectEntityId: string;
  observerEntityId: string | null;
  knowledgeType: string;
  value: string | null;
  referenceEntityId: string | null;
  fromEventId: string | null;
  toEventId: string | null;
  confidence: number | null;
  source: string | null;
}

export type ItemPlacement =
  | { kind: 'location'; locationId: string }
  | { kind: 'character'; characterId: string }
  | { kind: 'creature'; creatureId: string }
  | { kind: 'container'; containerItemId: string }
  | { kind: 'unknown' };

export interface ItemPlacementHistoryEntry {
  id: string;
  itemId: string;
  placement: ItemPlacement;
  fromEventId: string | null;
  toEventId: string | null;
  recordedAt: string;
}

export interface EffectiveItemLocation {
  locationId: string | null;
  resolutionPath: readonly string[];
}

export interface CreateCampaignInput {
  id?: string;
  name: string;
  rulesetId: string;
  rulesetVersion: string;
}

export interface CreateLocationInput {
  id?: string;
  campaignId: string;
  parentLocationId?: string | null;
  locationType: string;
  name: string;
  description?: string;
  imageResourceId?: string | null;
  createdEventId?: string | null;
}

export interface CreateCharacterInput {
  id?: string;
  campaignId: string;
  name: string;
  fullName?: string | null;
  description?: string;
  characterType: CharacterType;
  currentLocationId?: string | null;
  currentLifeStateId: string;
  imageResourceId?: string | null;
  createdEventId?: string | null;
}

export interface CreateCreatureInput {
  id?: string;
  campaignId: string;
  name: string;
  description?: string;
  currentLocationId?: string | null;
  currentLifeStateId: string;
  imageResourceId?: string | null;
  createdEventId?: string | null;
}

export interface CreateItemInput {
  id?: string;
  campaignId: string;
  itemDefinitionId?: string | null;
  name: string;
  description?: string;
  quantity: number;
  imageResourceId?: string | null;
  createdEventId?: string | null;
  placement: ItemPlacement;
}

export interface EventDraft {
  id?: string;
  eventType: string;
  timestamp?: string | null;
  locationId?: string | null;
  summary: string;
  sourceMessageId?: string | null;
}

export interface MoveCharacterInput {
  characterId: string;
  toLocationId: string | null;
  event: EventDraft;
}

export interface TransferItemInput {
  itemId: string;
  placement: ItemPlacement;
  event: EventDraft;
}

export interface CreateAliasInput {
  id?: string;
  entityId: string;
  alias: string;
  usedByEntityId?: string | null;
  fromEventId?: string | null;
  toEventId?: string | null;
}

export interface CreateRelationInput {
  id?: string;
  campaignId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  fromEventId?: string | null;
  toEventId?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
}

export interface CreateKnowledgeInput {
  id?: string;
  campaignId: string;
  subjectEntityId: string;
  observerEntityId?: string | null;
  knowledgeType: string;
  value?: string | null;
  referenceEntityId?: string | null;
  fromEventId?: string | null;
  toEventId?: string | null;
  confidence?: number | null;
  source?: string | null;
}

