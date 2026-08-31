import type { ActiveEffect, RuleDefinition } from '../domain/character-models';
import type { ChronicleEvent, EntityRelation, ItemPlacement, KnowledgeRecord } from '../domain/models';
import type { EntitySummary } from './read-models';

export type ConversationMessageRole = 'user' | 'assistant' | 'system' | 'tool';
export type KnowledgeVisibilityScope = 'world' | 'public' | 'observer';

export interface CampaignRuntimeState {
  campaignId: string;
  activePlayerCharacterId: string | null;
  activeConversationId: string | null;
  activeSceneLocationId: string | null;
  updatedAt: string;
}

export interface RuntimeWorkspaceCampaign {
  id: string;
  name: string;
  rulesetId: string;
  rulesetVersion: string;
  createdAt: string;
  updatedAt: string;
  runtime: CampaignRuntimeState;
  characters: EntitySummary[];
  conversations: Conversation[];
  activePlayerCharacter: EntitySummary | null;
  conversationCount: number;
}

export interface RuntimeWorkspaceView {
  campaigns: RuntimeWorkspaceCampaign[];
}

export type LibraryCategoryId = 'characters' | 'creatures' | 'items' | 'locations' | 'definitions';

export interface LibraryCategoryView {
  id: LibraryCategoryId;
  label: string;
  items: EntitySummary[];
}

export interface CampaignLibraryView {
  campaignId: string;
  categories: LibraryCategoryView[];
}

export interface SceneParticipant {
  campaignId: string;
  entityId: string;
  participantRole: string;
  addedAt: string;
}

export interface Conversation {
  id: string;
  campaignId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  campaignId: string;
  sequence: number;
  role: ConversationMessageRole;
  content: string;
  createdAt: string;
  relatedEventId: string | null;
  metadata: Readonly<Record<string, unknown>> | null;
}

export interface AddConversationMessageInput {
  id?: string;
  conversationId: string;
  campaignId: string;
  role: ConversationMessageRole;
  content: string;
  relatedEventId?: string | null;
  metadata?: Readonly<Record<string, unknown>> | null;
  referencedEntityIds?: readonly string[];
}

export interface ContextBudget {
  maxResults?: number;
  maxCharacters?: number;
  cursor?: string | null;
}

export interface BoundedResult<T> {
  items: T[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface SceneMessageSummary {
  id: string;
  sequence: number;
  role: ConversationMessageRole;
  content: string;
  createdAt: string;
}

export interface SceneContextView {
  campaignId: string;
  conversationId: string | null;
  activePlayerCharacter: EntitySummary | null;
  sceneLocation: EntitySummary | null;
  participants: EntitySummary[];
  activeEffects: ActiveEffect[];
  concentration: ActiveEffect | null;
  recentMessages: SceneMessageSummary[];
  currentEventSequence: number | null;
}

export const CharacterContextSections = [
  'identity', 'biography', 'combat', 'resources', 'actions', 'features',
  'spellcasting', 'inventory', 'relations', 'relationships', 'knowledge',
] as const;
export type CharacterContextSection = typeof CharacterContextSections[number];

export interface CharacterContextView {
  characterId: string;
  campaignId: string;
  sections: Partial<Record<CharacterContextSection, unknown>>;
  truncated: boolean;
}

export interface ItemContextView {
  item: EntitySummary;
  campaignId: string;
  description: string;
  definition: RuleDefinition | null;
  quantity: number;
  placement: ItemPlacement;
  effectiveLocationId: string | null;
  aliases: string[];
  relations: EntityRelation[];
  history: ChronicleEvent[];
  knowledge: KnowledgeRecord[];
  truncated: boolean;
}

export interface LocationContextView {
  location: EntitySummary;
  campaignId: string;
  locationType: string;
  description: string;
  fullPath: string;
  parent: EntitySummary | null;
  childLocations: EntitySummary[];
  occupants: EntitySummary[];
  items: EntitySummary[];
  relevantEvents: ChronicleEvent[];
  truncated: boolean;
}

export interface LocationContentsView {
  locationId: string;
  characters: EntitySummary[];
  creatures: EntitySummary[];
  items: EntitySummary[];
  childLocations: EntitySummary[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface KnowledgeQuery {
  campaignId: string;
  subjectEntityId: string;
  observerEntityId?: string | null;
  knowledgeTypes?: readonly string[];
  includeHistorical?: boolean;
  budget?: ContextBudget;
}

export interface EntityResolutionRequest {
  campaignId: string;
  query: string;
  observerEntityId?: string | null;
  entityTypes?: readonly string[];
  sceneOnly?: boolean;
}

export type EntityMatchType = 'exactId' | 'exactName' | 'normalizedName' | 'alias' | 'observerAlias';
export interface EntityResolutionMatch {
  entity: EntitySummary;
  matchType: EntityMatchType;
  confidence: number;
}
export interface EntityResolutionResult {
  matches: EntityResolutionMatch[];
  ambiguous: boolean;
}

export interface CampaignSearchResult {
  kind: 'entity' | 'event' | 'message' | 'knowledge' | 'relationship';
  id: string;
  score: number;
  title: string;
  snippet: string;
  entityType?: string;
  eventSequence?: number;
}

export interface RelevantEventsQuery {
  campaignId: string;
  entityIds?: readonly string[];
  locationId?: string | null;
  eventTypes?: readonly string[];
  beforeSequence?: number;
  afterSequence?: number;
  budget?: ContextBudget;
}

export interface ChronicleToolDescriptor {
  name: string;
  description: string;
  inputSchema: Readonly<Record<string, unknown>>;
  mutatesState: false;
  defaultLimits: { maxResults: number; maxCharacters: number };
}

export interface ChronicleToolDefinition<TInput = unknown, TOutput = unknown>
  extends ChronicleToolDescriptor {
  execute(input: TInput): TOutput | Promise<TOutput>;
}

export type ChronicleToolTraceStage =
  | 'scene_context_built'
  | 'tool_called'
  | 'tool_output_truncated'
  | 'transaction_validated'
  | 'transaction_committed';

export interface ChronicleToolTraceEntry {
  stage: ChronicleToolTraceStage;
  at: string;
  detail: Readonly<Record<string, unknown>>;
}

export type TurnChange =
  | { type: 'hp.delta'; characterId: string; amount: number }
  | { type: 'temporaryHp.set'; characterId: string; value: number }
  | { type: 'resource.delta'; characterId: string; resourceId: string; amount: number }
  | { type: 'spellSlot.delta'; characterId: string; poolId: string; amount: number }
  | { type: 'character.move'; characterId: string; locationId: string | null }
  | { type: 'item.transfer'; itemId: string; placement: ItemPlacement }
  | {
      type: 'effect.add'; effectId?: string; targetEntityId: string;
      definitionId?: string | null; sourceEntityId?: string | null;
      sourceFeatureId?: string | null; sourceSpellId?: string | null;
      name: string; durationType: string; durationValue?: number | null;
      remainingDuration?: number | null; concentration?: boolean;
      modifiers?: readonly unknown[]; metadata?: Readonly<Record<string, unknown>> | null;
    }
  | { type: 'effect.end'; effectId: string }
  | { type: 'concentration.end'; characterId: string }
  | { type: 'inspiration.set'; characterId: string; value: boolean }
  | { type: 'deathSave.record'; characterId: string; success: boolean }
  | {
      type: 'relation.add'; relationId?: string; sourceEntityId: string;
      targetEntityId: string; relationType: string;
      metadata?: Readonly<Record<string, unknown>> | null;
    }
  | { type: 'relation.end'; relationId: string }
  | {
      type: 'actorRelationship.upsert'; relationshipId?: string;
      relationId?: string; sourceEntityId: string; targetEntityId: string;
      relationType: string; visibilityScope: KnowledgeVisibilityScope;
      observerEntityId?: string | null; currentSummary: string;
      historySummary?: string | null; referencedEventIds?: readonly string[];
      referenceCurrentEvent?: boolean;
    }
  | {
      type: 'knowledge.add'; knowledgeId?: string; subjectEntityId: string;
      observerEntityId?: string | null; visibilityScope: KnowledgeVisibilityScope;
      knowledgeType: string; value?: string | null; referenceEntityId?: string | null;
      confidence?: number | null; source?: string | null;
    }
  | { type: 'knowledge.end'; knowledgeId: string };

export interface TurnTransaction {
  id: string;
  campaignId: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  event: {
    id?: string;
    eventType: string;
    summary: string;
    locationId?: string | null;
    entityReferences?: readonly { entityId: string; role: string }[];
  };
  changes: readonly TurnChange[];
  metadata?: Readonly<Record<string, unknown>> | null;
}

export interface ProposedTurnTransaction {
  event: { eventType: string; summary: string; locationId?: string | null };
  changes: readonly TurnChange[];
  reasoningSummary?: string;
}

export type ApprovalPolicy = 'automatic' | 'review' | 'manual';

export type ChronicleErrorCode =
  | 'ENTITY_NOT_FOUND'
  | 'AMBIGUOUS_ENTITY'
  | 'OUT_OF_BOUNDS'
  | 'INSUFFICIENT_RESOURCE'
  | 'CROSS_CAMPAIGN_REFERENCE'
  | 'TRANSACTION_CONFLICT'
  | 'TRANSACTION_ID_REUSED'
  | 'KNOWLEDGE_SCOPE_DENIED'
  | 'INVALID_INPUT';

export interface TurnValidationIssue {
  code: ChronicleErrorCode;
  message: string;
  changeIndex?: number;
  field?: string;
}

export interface TurnValidationResult {
  valid: boolean;
  normalizedTransaction?: TurnTransaction;
  errors: TurnValidationIssue[];
  warnings: TurnValidationIssue[];
}

export interface AppliedTurnChange {
  type: TurnChange['type'];
  entityIds: string[];
}

export interface TurnTransactionResult {
  transactionId: string;
  eventId: string;
  appliedChanges: AppliedTurnChange[];
  affectedEntityIds: string[];
  alreadyApplied: boolean;
}
