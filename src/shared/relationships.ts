import type { KnowledgeVisibilityScope } from './chronicle-engine';

export type RelationshipVisibilityScope = KnowledgeVisibilityScope;

export interface RelationshipEventReference {
  eventId: string;
  eventSequence: number;
  summary: string;
  role: string;
  note: string | null;
}

export interface ActorRelationshipView {
  relationshipId: string;
  relationId: string;
  relationType: string;
  sourceEntityId: string;
  sourceName: string;
  sourceEntityType: 'Character' | 'Creature';
  targetEntityId: string;
  targetName: string;
  targetEntityType: 'Character' | 'Creature';
  visibilityScope: RelationshipVisibilityScope;
  observerEntityId: string | null;
  currentSummary: string;
  historySummary: string | null;
  eventReferences: RelationshipEventReference[];
  updatedAt: string;
}

export interface ActorRelationshipsQuery {
  campaignId: string;
  actorId: string;
  observerEntityId?: string | null;
  includeHistory?: boolean;
  maxResults?: number;
  maxCharacters?: number;
}

export interface ActorRelationshipsResult {
  actorId: string;
  observerEntityId: string | null;
  relationships: ActorRelationshipView[];
  truncated: boolean;
}
