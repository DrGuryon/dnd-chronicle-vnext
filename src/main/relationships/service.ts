import type { DatabaseSync } from 'node:sqlite';
import type {
  ActorRelationshipView,
  ActorRelationshipsQuery,
  ActorRelationshipsResult,
  RelationshipEventReference,
  RelationshipVisibilityScope,
} from '../../shared/relationships';
import { ChronicleEngineError } from '../engine/service';

interface ActorRow {
  id: string;
  campaignId: string;
  entityType: 'Character' | 'Creature';
}

interface RelationshipRow {
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
  updatedAt: string;
}

export class ActorRelationshipService {
  constructor(private readonly database: DatabaseSync) {}

  getActorRelationships(query: ActorRelationshipsQuery): ActorRelationshipsResult {
    const actor = this.requireActor(query.actorId, query.campaignId);
    const observerId = query.observerEntityId ?? null;
    if (observerId) this.requireActor(observerId, query.campaignId);
    const maxResults = clampInteger(query.maxResults ?? 20, 1, 50);
    const maxCharacters = clampInteger(query.maxCharacters ?? 12_000, 500, 30_000);
    const includeHistory = query.includeHistory ?? true;

    const rows = this.database.prepare(`
      SELECT
        p.id AS relationshipId,
        r.id AS relationId,
        r.relation_type AS relationType,
        r.source_entity_id AS sourceEntityId,
        source.name AS sourceName,
        source.entity_type AS sourceEntityType,
        r.target_entity_id AS targetEntityId,
        target.name AS targetName,
        target.entity_type AS targetEntityType,
        p.visibility_scope AS visibilityScope,
        p.observer_entity_id AS observerEntityId,
        p.current_summary AS currentSummary,
        p.history_summary AS historySummary,
        p.updated_at AS updatedAt
      FROM entity_relations r
      JOIN entities source ON source.id = r.source_entity_id
      JOIN entities target ON target.id = r.target_entity_id
      JOIN relationship_profiles p ON p.relation_id = r.id
      WHERE r.campaign_id = ?
        AND r.to_event_id IS NULL
        AND (r.source_entity_id = ? OR r.target_entity_id = ?)
        AND source.entity_type IN ('Character', 'Creature')
        AND target.entity_type IN ('Character', 'Creature')
        AND (
          (? IS NULL AND p.visibility_scope IN ('world', 'public'))
          OR (? IS NOT NULL AND (
            p.visibility_scope = 'public'
            OR (p.visibility_scope = 'observer' AND p.observer_entity_id = ?)
          ))
        )
      ORDER BY p.updated_at DESC, r.id, p.id
    `).all(query.campaignId, actor.id, actor.id, observerId, observerId, observerId) as unknown as RelationshipRow[];

    const selected = selectMostSpecific(rows, observerId).slice(0, maxResults + 1);
    const overLimit = selected.length > maxResults;
    const relationships: ActorRelationshipView[] = [];
    let characters = 0;
    let truncated = overLimit;

    for (const row of selected.slice(0, maxResults)) {
      const eventReferences = this.listEventReferences(row.relationshipId);
      const historySummary = includeHistory ? row.historySummary : null;
      const cost = row.currentSummary.length
        + (historySummary?.length ?? 0)
        + eventReferences.reduce((sum, reference) => sum + reference.summary.length + (reference.note?.length ?? 0), 0);
      if (relationships.length > 0 && characters + cost > maxCharacters) {
        truncated = true;
        break;
      }
      characters += cost;
      relationships.push({ ...row, historySummary, eventReferences });
    }

    return { actorId: actor.id, observerEntityId: observerId, relationships, truncated };
  }

  assertActor(actorId: string, campaignId: string): void {
    this.requireActor(actorId, campaignId);
  }

  private requireActor(actorId: string, campaignId: string): ActorRow {
    const row = this.database.prepare(`
      SELECT id, campaign_id AS campaignId, entity_type AS entityType
      FROM entities WHERE id = ?
    `).get(actorId) as unknown as ActorRow | undefined;
    if (!row) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Actor ${actorId} neexistuje.`);
    if (row.campaignId !== campaignId) {
      throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', `Actor ${actorId} patří do jiné Campaign.`);
    }
    if (row.entityType !== 'Character' && row.entityType !== 'Creature') {
      throw new ChronicleEngineError('INVALID_INPUT', `Entity ${actorId} není Character ani Creature.`);
    }
    return row;
  }

  private listEventReferences(relationshipId: string): RelationshipEventReference[] {
    return this.database.prepare(`
      SELECT
        ref.event_id AS eventId,
        event.sequence AS eventSequence,
        event.summary,
        ref.reference_role AS role,
        ref.note
      FROM relationship_event_references ref
      JOIN events event ON event.id = ref.event_id
      WHERE ref.relationship_id = ?
      ORDER BY ref.sort_order, event.sequence DESC
      LIMIT 20
    `).all(relationshipId) as unknown as RelationshipEventReference[];
  }
}

function selectMostSpecific(rows: readonly RelationshipRow[], observerId: string | null): RelationshipRow[] {
  const selected = new Map<string, RelationshipRow>();
  for (const row of rows) {
    const current = selected.get(row.relationId);
    if (!current || visibilityRank(row.visibilityScope, observerId) < visibilityRank(current.visibilityScope, observerId)) {
      selected.set(row.relationId, row);
    }
  }
  return [...selected.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function visibilityRank(scope: RelationshipVisibilityScope, observerId: string | null): number {
  if (observerId) return scope === 'observer' ? 0 : 1;
  return scope === 'world' ? 0 : 1;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}
