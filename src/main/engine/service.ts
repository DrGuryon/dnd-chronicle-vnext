import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { createDomainId, requireDomainId } from '../../domain/ids';
import type {
  ChronicleEvent,
  EntityRelation,
  EntityType,
  ItemPlacement,
  KnowledgeRecord,
} from '../../domain/models';
import type {
  AddConversationMessageInput,
  BoundedResult,
  CampaignLibraryView,
  CampaignRuntimeState,
  CampaignSearchResult,
  CharacterContextSection,
  CharacterContextView,
  ChronicleToolDefinition,
  ChronicleToolDescriptor,
  ContextBudget,
  Conversation,
  ConversationMessage,
  ConversationMessageRole,
  EntityResolutionMatch,
  EntityResolutionRequest,
  EntityResolutionResult,
  ItemContextView,
  KnowledgeQuery,
  LocationContentsView,
  LocationContextView,
  RelevantEventsQuery,
  RuntimeWorkspaceView,
  SceneContextView,
  SceneParticipant,
} from '../../shared/chronicle-engine';
import { CharacterContextSections } from '../../shared/chronicle-engine';
import type { EntityCardKind, EntitySummary } from '../../shared/read-models';
import { CharacterDomainService } from '../character/service';
import { ChronicleDomainService } from '../domain/service';
import { ActorRelationshipService } from '../relationships/service';

const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS = 100;
const DEFAULT_MAX_CHARACTERS = 12_000;
const MAX_CHARACTERS = 100_000;
const DEFAULT_RECENT_MESSAGES = 8;

interface EntityRow {
  id: string;
  campaignId: string;
  entityType: EntityType;
  name: string;
  description: string;
}

interface SearchRow {
  kind: CampaignSearchResult['kind'];
  id: string;
  title: string;
  snippet: string;
  rank: number;
  entityType: string | null;
  eventSequence: number | null;
}

export class ChronicleEngineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'ChronicleEngineError';
  }
}

export class ChronicleEngineService {
  private readonly tools: readonly ChronicleToolDefinition[];

  constructor(
    private readonly database: DatabaseSync,
    private readonly domain: ChronicleDomainService,
    private readonly characters: CharacterDomainService,
    private readonly relationships: ActorRelationshipService,
  ) {
    this.tools = this.createTools();
  }

  getCampaignRuntimeState(campaignId: string): CampaignRuntimeState {
    this.requireCampaign(campaignId);
    const row = this.database.prepare(`
      SELECT campaign_id AS campaignId,
             active_player_character_id AS activePlayerCharacterId,
             active_conversation_id AS activeConversationId,
             active_scene_location_id AS activeSceneLocationId,
             updated_at AS updatedAt
      FROM campaign_runtime_state
      WHERE campaign_id = ?
    `).get(campaignId) as unknown as CampaignRuntimeState | undefined;
    return row ?? {
      campaignId,
      activePlayerCharacterId: null,
      activeConversationId: null,
      activeSceneLocationId: null,
      updatedAt: timestamp(),
    };
  }

  getRuntimeWorkspace(campaignId?: string | null): RuntimeWorkspaceView {
    const campaigns = this.database.prepare(`
      SELECT id, name, ruleset_id AS rulesetId, ruleset_version AS rulesetVersion,
             created_at AS createdAt, updated_at AS updatedAt
      FROM campaigns
      WHERE archived_at IS NULL AND (? IS NULL OR id = ?)
      ORDER BY updated_at DESC, id
    `).all(campaignId ?? null, campaignId ?? null) as unknown as Array<{
      id: string;
      name: string;
      rulesetId: string;
      rulesetVersion: string;
      createdAt: string;
      updatedAt: string;
    }>;
    return {
      campaigns: campaigns.map((campaign) => {
        const runtime = this.getCampaignRuntimeState(campaign.id);
        const characters = this.domain.listCharacters(campaign.id)
          .map((character) => this.entitySummary(character.id));
        const conversations = this.listConversations(campaign.id, { maxResults: 100 }).items;
        return {
          ...campaign,
          runtime,
          characters,
          conversations,
          activePlayerCharacter: characters.find((item) => item.id === runtime.activePlayerCharacterId) ?? null,
          conversationCount: conversations.length,
        };
      }),
    };
  }

  ensureCampaignRuntimeState(campaignId: string): CampaignRuntimeState {
    this.requireCampaign(campaignId);
    this.database.prepare(`
      INSERT OR IGNORE INTO campaign_runtime_state(
        campaign_id, active_player_character_id, active_conversation_id,
        active_scene_location_id, updated_at
      ) VALUES (?, NULL, NULL, NULL, ?)
    `).run(campaignId, timestamp());
    return this.getCampaignRuntimeState(campaignId);
  }

  getActivePlayerCharacterId(campaignId?: string): string | null {
    if (campaignId) return this.getCampaignRuntimeState(campaignId).activePlayerCharacterId;
    const row = this.database.prepare(`
      SELECT active_player_character_id AS activePlayerCharacterId
      FROM campaign_runtime_state
      WHERE active_player_character_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `).get() as unknown as { activePlayerCharacterId: string } | undefined;
    return row?.activePlayerCharacterId ?? null;
  }

  setActivePlayerCharacter(campaignId: string, characterId: string | null): CampaignRuntimeState {
    this.requireCampaign(campaignId);
    if (characterId) this.requireEntity(characterId, campaignId, 'Character');
    return this.updateRuntimeState(campaignId, 'active_player_character_id', characterId);
  }

  setActiveConversation(campaignId: string, conversationId: string | null): CampaignRuntimeState {
    this.requireCampaign(campaignId);
    if (conversationId) this.requireConversation(conversationId, campaignId);
    return this.updateRuntimeState(campaignId, 'active_conversation_id', conversationId);
  }

  setSceneLocation(campaignId: string, locationId: string | null): CampaignRuntimeState {
    this.requireCampaign(campaignId);
    if (locationId) this.requireEntity(locationId, campaignId, 'Location');
    return this.updateRuntimeState(campaignId, 'active_scene_location_id', locationId);
  }

  setSceneParticipants(
    campaignId: string,
    participants: readonly { entityId: string; participantRole: string }[],
  ): SceneParticipant[] {
    this.requireCampaign(campaignId);
    const unique = new Map<string, string>();
    for (const participant of participants) {
      this.requireEntity(participant.entityId, campaignId);
      unique.set(participant.entityId, requiredText(participant.participantRole, 'Participant role'));
    }
    this.transaction(() => {
      this.database.prepare('DELETE FROM scene_participants WHERE campaign_id = ?').run(campaignId);
      const insert = this.database.prepare(`
        INSERT INTO scene_participants(campaign_id, entity_id, participant_role, added_at)
        VALUES (?, ?, ?, ?)
      `);
      const now = timestamp();
      for (const [entityId, participantRole] of unique) {
        insert.run(campaignId, entityId, participantRole, now);
      }
    });
    return this.listSceneParticipants(campaignId);
  }

  listSceneParticipants(campaignId: string): SceneParticipant[] {
    this.requireCampaign(campaignId);
    return this.database.prepare(`
      SELECT campaign_id AS campaignId, entity_id AS entityId,
             participant_role AS participantRole, added_at AS addedAt
      FROM scene_participants
      WHERE campaign_id = ?
      ORDER BY added_at, entity_id
    `).all(campaignId) as unknown as SceneParticipant[];
  }

  createConversation(campaignId: string, titleValue?: string | null, idValue?: string): Conversation {
    this.requireCampaign(campaignId);
    const now = timestamp();
    const conversation: Conversation = {
      id: idValue ? requireDomainId(idValue, 'conversation') : createDomainId('conversation'),
      campaignId,
      title: titleValue?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    this.database.prepare(`
      INSERT INTO conversations(id, campaign_id, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      conversation.id,
      conversation.campaignId,
      conversation.title,
      conversation.createdAt,
      conversation.updatedAt,
    );
    return conversation;
  }

  getConversation(id: string): Conversation | undefined {
    return this.database.prepare(`
      SELECT id, campaign_id AS campaignId, title, created_at AS createdAt, updated_at AS updatedAt
      FROM conversations WHERE id = ?
    `).get(id) as unknown as Conversation | undefined;
  }

  getConversationMessage(id: string): ConversationMessage | undefined {
    const row = this.database.prepare(`
      SELECT id, conversation_id AS conversationId, campaign_id AS campaignId,
             sequence, role, content, created_at AS createdAt,
             related_event_id AS relatedEventId, metadata
      FROM conversation_messages
      WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? messageFromRow(row) : undefined;
  }

  listConversations(campaignId: string, budget?: ContextBudget): BoundedResult<Conversation> {
    this.requireCampaign(campaignId);
    const limits = contextLimits(budget);
    const offset = cursorOffset(budget?.cursor);
    const rows = this.database.prepare(`
      SELECT id, campaign_id AS campaignId, title, created_at AS createdAt, updated_at AS updatedAt
      FROM conversations
      WHERE campaign_id = ?
      ORDER BY updated_at DESC, id
      LIMIT ? OFFSET ?
    `).all(campaignId, limits.maxResults + 1, offset) as unknown as Conversation[];
    return boundRows(rows, limits, offset);
  }

  renameConversation(id: string, titleValue?: string | null): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Conversation ${id} neexistuje.`);
    const title = titleValue?.trim() || null;
    if (title && title.length > 120) {
      throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Název konverzace může mít nejvýše 120 znaků.');
    }
    this.database.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, timestamp(), id);
    return this.getConversation(id)!;
  }

  getCampaignLibrary(campaignId: string): CampaignLibraryView {
    this.requireCampaign(campaignId);
    const entityRows = this.database.prepare(`
      SELECT id, entity_type AS entityType, name, description
      FROM entities WHERE campaign_id = ?
      ORDER BY name COLLATE NOCASE, id
    `).all(campaignId) as unknown as Array<{
      id: string;
      entityType: EntityType;
      name: string;
      description: string;
    }>;
    const campaign = this.domain.getCampaign(campaignId)!;
    const definitions = this.database.prepare(`
      SELECT id, definition_type AS definitionType, name, description
      FROM rule_definitions
      WHERE ruleset_id = ? AND ruleset_version = ?
      ORDER BY name COLLATE NOCASE, id
    `).all(campaign.rulesetId, campaign.rulesetVersion) as unknown as Array<{
      id: string;
      definitionType: string;
      name: string;
      description: string;
    }>;
    const itemsFor = (type: EntityType): EntitySummary[] => entityRows
      .filter((row) => row.entityType === type)
      .map((row) => ({
        id: row.id,
        kind: entityKind(row.entityType),
        label: row.name,
        subtitle: row.description || row.entityType,
      }));
    return {
      campaignId,
      categories: [
        { id: 'characters', label: 'Postavy', items: itemsFor('Character') },
        { id: 'creatures', label: 'Tvorové', items: itemsFor('Creature') },
        { id: 'items', label: 'Předměty', items: itemsFor('Item') },
        { id: 'locations', label: 'Lokace', items: itemsFor('Location') },
        {
          id: 'definitions',
          label: 'Pravidla a definice',
          items: definitions.map((row) => ({
            id: row.id,
            kind: row.definitionType as EntityCardKind,
            label: row.name,
            subtitle: row.description || row.definitionType,
          })),
        },
      ],
    };
  }

  addConversationMessage(input: AddConversationMessageInput): ConversationMessage {
    const conversation = this.requireConversation(input.conversationId, input.campaignId);
    const id = input.id ? requireDomainId(input.id, 'message') : createDomainId('message');
    const role = messageRole(input.role);
    const content = requiredText(input.content, 'Message content');
    if (input.relatedEventId) this.requireEvent(input.relatedEventId, input.campaignId);
    for (const entityId of input.referencedEntityIds ?? []) {
      this.requireEntity(entityId, input.campaignId);
    }
    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
        FROM conversation_messages
        WHERE conversation_id = ?
      `).get(input.conversationId) as unknown as { nextSequence: number };
      const message: ConversationMessage = {
        id,
        conversationId: input.conversationId,
        campaignId: input.campaignId,
        sequence: row.nextSequence,
        role,
        content,
        createdAt: timestamp(),
        relatedEventId: input.relatedEventId ?? null,
        metadata: input.metadata ?? null,
      };
      this.database.prepare(`
        INSERT INTO conversation_messages(
          id, conversation_id, campaign_id, sequence, role, content,
          created_at, related_event_id, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        message.id,
        message.conversationId,
        message.campaignId,
        message.sequence,
        message.role,
        message.content,
        message.createdAt,
        message.relatedEventId,
        serializeJson(message.metadata),
      );
      const reference = this.database.prepare(`
        INSERT INTO message_entity_references(message_id, entity_id, role)
        VALUES (?, ?, 'subject')
      `);
      for (const entityId of new Set(input.referencedEntityIds ?? [])) {
        reference.run(message.id, entityId);
      }
      this.database.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
        .run(message.createdAt, conversation.id);
      return message;
    });
  }

  listConversationMessages(
    conversationId: string,
    budget?: ContextBudget,
  ): BoundedResult<ConversationMessage> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Conversation ${conversationId} neexistuje.`);
    const limits = contextLimits(budget);
    const before = budget?.cursor ? positiveInteger(Number(budget.cursor), 'Message cursor') : null;
    const rows = this.database.prepare(`
      SELECT id, conversation_id AS conversationId, campaign_id AS campaignId,
             sequence, role, content, created_at AS createdAt,
             related_event_id AS relatedEventId, metadata
      FROM conversation_messages
      WHERE conversation_id = ? AND (? IS NULL OR sequence < ?)
      ORDER BY sequence DESC
      LIMIT ?
    `).all(conversationId, before, before, limits.maxResults + 1) as unknown as Array<Record<string, unknown>>;
    const messages = rows.map(messageFromRow);
    const items = fitByCharacters(messages.slice(0, limits.maxResults), limits.maxCharacters);
    const truncated = rows.length > items.length;
    return {
      items,
      truncated,
      nextCursor: truncated && items.length > 0 ? String(items.at(-1)!.sequence) : null,
    };
  }

  getSceneContext(campaignId: string, recentMessageLimit = DEFAULT_RECENT_MESSAGES): SceneContextView {
    this.requireCampaign(campaignId);
    const runtime = this.getCampaignRuntimeState(campaignId);
    const activeCharacter = runtime.activePlayerCharacterId
      ? this.domain.getCharacter(runtime.activePlayerCharacterId)
      : undefined;
    const sceneLocationId = runtime.activeSceneLocationId ?? activeCharacter?.currentLocationId ?? null;
    const explicit = this.listSceneParticipants(campaignId);
    const participantIds = explicit.length > 0
      ? explicit.map((entry) => entry.entityId)
      : this.locationParticipantIds(campaignId, sceneLocationId);
    if (activeCharacter && !participantIds.includes(activeCharacter.id)) participantIds.unshift(activeCharacter.id);
    const recentMessages = runtime.activeConversationId
      ? this.recentMessages(runtime.activeConversationId, recentMessageLimit)
      : [];
    const currentSequence = this.database.prepare(`
      SELECT MAX(sequence) AS sequence FROM events WHERE campaign_id = ?
    `).get(campaignId) as unknown as { sequence: number | null };
    return {
      campaignId,
      conversationId: runtime.activeConversationId,
      activePlayerCharacter: activeCharacter ? this.entitySummary(activeCharacter.id) : null,
      sceneLocation: sceneLocationId ? this.entitySummary(sceneLocationId) : null,
      participants: participantIds.map((id) => this.entitySummary(id)),
      activeEffects: participantIds.flatMap((id) => this.characters.listActiveEffects(id)),
      concentration: activeCharacter ? this.characters.getConcentration(activeCharacter.id) ?? null : null,
      recentMessages,
      currentEventSequence: currentSequence.sequence,
    };
  }

  getCharacterContext(input: {
    campaignId: string;
    characterId: string;
    sections: readonly CharacterContextSection[];
    observerEntityId?: string | null;
    budget?: ContextBudget;
  }): CharacterContextView {
    const character = this.requireEntity(input.characterId, input.campaignId, 'Character');
    if (input.observerEntityId) this.requireEntity(input.observerEntityId, input.campaignId);
    const sections = [...new Set(input.sections)];
    for (const section of sections) {
      if (!(CharacterContextSections as readonly string[]).includes(section)) {
        throw new ChronicleEngineError('INVALID_INPUT', `Nepodporovaná Character section ${section}.`);
      }
    }
    const output: CharacterContextView = {
      characterId: input.characterId,
      campaignId: input.campaignId,
      sections: {},
      truncated: false,
    };
    for (const section of sections) {
      output.sections[section] = this.characterSection(section, character, input.observerEntityId ?? null, input.budget);
      if (JSON.stringify(output).length > contextLimits(input.budget).maxCharacters) {
        delete output.sections[section];
        output.truncated = true;
        break;
      }
    }
    return output;
  }

  getItemContext(input: {
    campaignId: string;
    itemId: string;
    observerEntityId?: string | null;
    budget?: ContextBudget;
  }): ItemContextView {
    const item = this.domain.getItem(input.itemId);
    if (!item) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Item ${input.itemId} neexistuje.`);
    if (item.campaignId !== input.campaignId) throw crossCampaign(input.itemId);
    const limits = contextLimits(input.budget);
    const aliases = this.database.prepare(`
      SELECT alias FROM entity_aliases
      WHERE entity_id = ? AND to_event_id IS NULL
      ORDER BY alias LIMIT ?
    `).all(item.id, limits.maxResults) as unknown as Array<{ alias: string }>;
    const relations = this.getRelations({
      campaignId: input.campaignId,
      entityId: item.id,
      activeOnly: true,
      direction: 'both',
      budget: input.budget,
    });
    const history = this.getRelevantEvents({
      campaignId: input.campaignId,
      entityIds: [item.id],
      budget: { ...input.budget, maxResults: Math.min(limits.maxResults, 6) },
    });
    const knowledge = this.getKnowledge({
      campaignId: input.campaignId,
      subjectEntityId: item.id,
      observerEntityId: input.observerEntityId,
      budget: input.budget,
    });
    const placement = this.domain.getItemPlacement(item.id) ?? { kind: 'unknown' };
    return {
      item: this.entitySummary(item.id),
      campaignId: item.campaignId,
      description: item.description,
      definition: item.itemDefinitionId ? this.characters.getDefinition(item.itemDefinitionId) ?? null : null,
      quantity: item.quantity,
      placement,
      effectiveLocationId: this.domain.resolveEffectiveItemLocation(item.id).locationId,
      aliases: aliases.map((row) => row.alias),
      relations: relations.items,
      history: history.items,
      knowledge: knowledge.items,
      truncated: relations.truncated || history.truncated || knowledge.truncated,
    };
  }

  getLocationContext(input: {
    campaignId: string;
    locationId: string;
    budget?: ContextBudget;
  }): LocationContextView {
    const location = this.domain.getLocation(input.locationId);
    if (!location) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Location ${input.locationId} neexistuje.`);
    if (location.campaignId !== input.campaignId) throw crossCampaign(input.locationId);
    const contents = this.getLocationContents({
      campaignId: input.campaignId,
      locationId: input.locationId,
      include: ['characters', 'creatures', 'items', 'childLocations'],
      budget: input.budget,
    });
    const events = this.getRelevantEvents({
      campaignId: input.campaignId,
      locationId: input.locationId,
      budget: input.budget,
    });
    return {
      location: this.entitySummary(location.id),
      campaignId: location.campaignId,
      locationType: location.locationType,
      description: location.description,
      fullPath: this.domain.getLocationPath(location.id),
      parent: location.parentLocationId ? this.entitySummary(location.parentLocationId) : null,
      childLocations: contents.childLocations,
      occupants: [...contents.characters, ...contents.creatures],
      items: contents.items,
      relevantEvents: events.items,
      truncated: contents.truncated || events.truncated,
    };
  }

  getLocationContents(input: {
    campaignId: string;
    locationId: string;
    include?: readonly ('characters' | 'creatures' | 'items' | 'childLocations')[];
    budget?: ContextBudget;
  }): LocationContentsView {
    this.requireEntity(input.locationId, input.campaignId, 'Location');
    const includes = new Set<'characters' | 'creatures' | 'items' | 'childLocations'>(
      input.include ?? ['characters', 'creatures', 'items', 'childLocations'],
    );
    const bucketConditions = {
      characters: 'c.entity_id IS NOT NULL',
      creatures: 'cr.entity_id IS NOT NULL',
      items: 'p.item_id IS NOT NULL',
      childLocations: 'l.entity_id IS NOT NULL',
    } as const;
    for (const include of includes) {
      if (!(include in bucketConditions)) {
        throw new ChronicleEngineError('INVALID_INPUT', `Nepodporovaný Location contents filter ${include}.`);
      }
    }
    const selectedConditions = [...includes].map((include) => bucketConditions[include]);
    if (selectedConditions.length === 0) {
      return {
        locationId: input.locationId,
        characters: [], creatures: [], items: [], childLocations: [],
        truncated: false, nextCursor: null,
      };
    }
    const limits = contextLimits(input.budget);
    const offset = cursorOffset(input.budget?.cursor);
    const rows = this.database.prepare(`
      SELECT e.id, e.entity_type AS entityType, e.name,
             CASE
               WHEN c.entity_id IS NOT NULL THEN 'characters'
               WHEN cr.entity_id IS NOT NULL THEN 'creatures'
               WHEN p.item_id IS NOT NULL THEN 'items'
               WHEN l.entity_id IS NOT NULL THEN 'childLocations'
             END AS bucket
      FROM entities e
      LEFT JOIN characters c ON c.entity_id = e.id AND c.current_location_id = ?
      LEFT JOIN creatures cr ON cr.entity_id = e.id AND cr.current_location_id = ?
      LEFT JOIN item_current_placements p
        ON p.item_id = e.id AND p.placement_type = 'location' AND p.location_id = ?
      LEFT JOIN locations l ON l.entity_id = e.id AND l.parent_location_id = ?
      WHERE e.campaign_id = ?
        AND (${selectedConditions.join(' OR ')})
      ORDER BY e.name, e.id
      LIMIT ? OFFSET ?
    `).all(
      input.locationId,
      input.locationId,
      input.locationId,
      input.locationId,
      input.campaignId,
      limits.maxResults + 1,
      offset,
    ) as unknown as Array<{ id: string; bucket: 'characters' | 'creatures' | 'items' | 'childLocations' }>;
    const accepted = rows.slice(0, limits.maxResults);
    const result: LocationContentsView = {
      locationId: input.locationId,
      characters: [],
      creatures: [],
      items: [],
      childLocations: [],
      truncated: rows.length > limits.maxResults,
      nextCursor: rows.length > limits.maxResults ? String(offset + accepted.length) : null,
    };
    for (const row of accepted) result[row.bucket].push(this.entitySummary(row.id));
    return result;
  }

  getDefinition(definitionId: string) {
    const definition = this.characters.getDefinition(definitionId);
    if (!definition) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Definition ${definitionId} neexistuje.`);
    return definition;
  }

  getRelations(input: {
    campaignId: string;
    entityId: string;
    relationTypes?: readonly string[];
    activeOnly?: boolean;
    direction?: 'incoming' | 'outgoing' | 'both';
    budget?: ContextBudget;
  }): BoundedResult<EntityRelation> {
    this.requireEntity(input.entityId, input.campaignId);
    const limits = contextLimits(input.budget);
    const direction = input.direction ?? 'both';
    const conditions = ['campaign_id = ?'];
    const params: Array<string | number> = [input.campaignId];
    if (direction === 'incoming') conditions.push('target_entity_id = ?');
    else if (direction === 'outgoing') conditions.push('source_entity_id = ?');
    else conditions.push('(source_entity_id = ? OR target_entity_id = ?)');
    params.push(input.entityId);
    if (direction === 'both') params.push(input.entityId);
    if (input.activeOnly !== false) conditions.push('to_event_id IS NULL');
    addInCondition(conditions, params, 'relation_type', input.relationTypes);
    params.push(limits.maxResults + 1);
    const rows = this.database.prepare(`
      SELECT id, campaign_id AS campaignId, source_entity_id AS sourceEntityId,
             target_entity_id AS targetEntityId, relation_type AS relationType,
             from_event_id AS fromEventId, to_event_id AS toEventId, metadata
      FROM entity_relations
      WHERE ${conditions.join(' AND ')}
      ORDER BY rowid DESC
      LIMIT ?
    `).all(...params) as unknown as Array<Record<string, unknown>>;
    const values = rows.map((row) => ({
      ...row,
      metadata: parseJsonRecord(row.metadata),
    } as unknown as EntityRelation));
    return boundRows(values, limits, 0);
  }

  getKnowledge(query: KnowledgeQuery): BoundedResult<KnowledgeRecord> {
    this.requireEntity(query.subjectEntityId, query.campaignId);
    if (query.observerEntityId) this.requireEntity(query.observerEntityId, query.campaignId);
    const limits = contextLimits(query.budget);
    const conditions = ['campaign_id = ?', 'subject_entity_id = ?'];
    const params: Array<string | number | null> = [query.campaignId, query.subjectEntityId];
    if (query.observerEntityId) {
      conditions.push(`(
        visibility_scope = 'public'
        OR (visibility_scope = 'observer' AND observer_entity_id = ?)
      )`);
      params.push(query.observerEntityId);
    } else {
      conditions.push("visibility_scope IN ('world', 'public')");
    }
    if (!query.includeHistorical) conditions.push('to_event_id IS NULL');
    addInCondition(conditions, params, 'knowledge_type', query.knowledgeTypes);
    params.push(limits.maxResults + 1);
    const rows = this.database.prepare(`
      SELECT id, campaign_id AS campaignId, subject_entity_id AS subjectEntityId,
             observer_entity_id AS observerEntityId, knowledge_type AS knowledgeType,
             value_text AS value, reference_entity_id AS referenceEntityId,
             from_event_id AS fromEventId, to_event_id AS toEventId,
             confidence, source, visibility_scope AS visibilityScope
      FROM knowledge_records
      WHERE ${conditions.join(' AND ')}
      ORDER BY rowid DESC
      LIMIT ?
    `).all(...params) as unknown as KnowledgeRecord[];
    return boundRows(rows, limits, 0);
  }

  resolveEntity(request: EntityResolutionRequest): EntityResolutionResult {
    this.requireCampaign(request.campaignId);
    if (request.observerEntityId) this.requireEntity(request.observerEntityId, request.campaignId);
    const query = requiredText(request.query, 'Entity query');
    const normalized = normalize(query);
    const entityTypes = request.entityTypes?.length ? [...new Set(request.entityTypes)] : [];
    const typeSql = entityTypes.length > 0 ? `AND e.entity_type IN (${placeholders(entityTypes.length)})` : '';
    const sceneSql = request.sceneOnly ? `AND (
      EXISTS (
        SELECT 1 FROM scene_participants sp
        WHERE sp.campaign_id = e.campaign_id AND sp.entity_id = e.id
      )
      OR e.id = COALESCE(
        (SELECT active_scene_location_id FROM campaign_runtime_state WHERE campaign_id = e.campaign_id),
        (SELECT c.current_location_id
         FROM campaign_runtime_state rs
         JOIN characters c ON c.entity_id = rs.active_player_character_id
         WHERE rs.campaign_id = e.campaign_id)
      )
    )` : '';
    const rows = this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, a.alias, a.used_by_entity_id AS usedByEntityId,
             CASE WHEN sp.entity_id IS NOT NULL THEN 1 ELSE 0 END AS sceneParticipant,
             CASE WHEN e.id = COALESCE(rs.active_scene_location_id, pc.current_location_id)
                  THEN 1 ELSE 0 END AS sceneLocation,
             CASE WHEN inventory.item_id IS NOT NULL THEN 1 ELSE 0 END AS activeInventory
      FROM entities e
      LEFT JOIN entity_aliases a ON a.entity_id = e.id AND a.to_event_id IS NULL
      LEFT JOIN campaign_runtime_state rs ON rs.campaign_id = e.campaign_id
      LEFT JOIN characters pc ON pc.entity_id = rs.active_player_character_id
      LEFT JOIN scene_participants sp ON sp.campaign_id = e.campaign_id AND sp.entity_id = e.id
      LEFT JOIN item_current_placements inventory
        ON inventory.item_id = e.id
       AND inventory.placement_type = 'character'
       AND inventory.character_id = rs.active_player_character_id
      WHERE e.campaign_id = ? ${typeSql} ${sceneSql}
        AND (e.id = ? OR e.normalized_name = ? OR a.normalized_alias = ?)
      ORDER BY e.id
      LIMIT 100
    `).all(request.campaignId, ...entityTypes, query, normalized, normalized) as unknown as Array<{
      id: string; entityType: EntityType; name: string; alias: string | null;
      usedByEntityId: string | null; sceneParticipant: number; sceneLocation: number;
      activeInventory: number;
    }>;
    const best = new Map<string, EntityResolutionMatch>();
    for (const row of rows) {
      let matchType: EntityResolutionMatch['matchType'];
      let score: number;
      if (row.id === query) [matchType, score] = ['exactId', 1];
      else if (row.alias && normalize(row.alias) === normalized && row.usedByEntityId === request.observerEntityId) {
        [matchType, score] = ['observerAlias', 1];
      } else if (row.name === query) [matchType, score] = ['exactName', 0.96];
      else if (normalize(row.name) === normalized) [matchType, score] = ['normalizedName', 0.92];
      else [matchType, score] = ['alias', 0.86];
      const bias = row.sceneParticipant ? 0.03 : row.sceneLocation ? 0.02 : row.activeInventory ? 0.01 : 0;
      const candidate: EntityResolutionMatch = {
        entity: this.entitySummary(row.id),
        matchType,
        confidence: Math.min(1, score + bias),
      };
      const previous = best.get(row.id);
      if (!previous || candidate.confidence > previous.confidence) best.set(row.id, candidate);
    }
    const matches = [...best.values()].sort((a, b) => (
      b.confidence - a.confidence || a.entity.label.localeCompare(b.entity.label)
    ));
    return {
      matches,
      ambiguous: matches.length > 1 && matches[0].confidence === matches[1].confidence,
    };
  }

  searchCampaign(input: {
    campaignId: string;
    query: string;
    observerEntityId?: string | null;
    budget?: ContextBudget;
  }): BoundedResult<CampaignSearchResult> {
    this.requireCampaign(input.campaignId);
    if (input.observerEntityId) this.requireEntity(input.observerEntityId, input.campaignId);
    const limits = contextLimits(input.budget);
    const match = ftsQuery(requiredText(input.query, 'Search query'));
    const knowledgeVisibility = input.observerEntityId
      ? `(f.kind <> 'knowledge' OR k.visibility_scope = 'public'
          OR (k.visibility_scope = 'observer' AND k.observer_entity_id = ?))`
      : `(f.kind <> 'knowledge' OR k.visibility_scope IN ('world', 'public'))`;
    const relationshipVisibility = input.observerEntityId
      ? `(f.kind <> 'relationship' OR rp.visibility_scope = 'public'
          OR (rp.visibility_scope = 'observer' AND rp.observer_entity_id = ?))`
      : `(f.kind <> 'relationship' OR rp.visibility_scope IN ('world', 'public'))`;
    const params: Array<string | number> = [match, input.campaignId];
    if (input.observerEntityId) params.push(input.observerEntityId);
    if (input.observerEntityId) params.push(input.observerEntityId);
    params.push(limits.maxResults * 4 + 1);
    let rows: SearchRow[];
    try {
      rows = this.database.prepare(`
        SELECT f.kind, f.record_id AS id, f.title,
               snippet(campaign_search_fts, 4, '', '', ' … ', 18) AS snippet,
               bm25(campaign_search_fts) AS rank,
               e.entity_type AS entityType,
               ev.sequence AS eventSequence
        FROM campaign_search_fts f
        LEFT JOIN entities e ON f.kind = 'entity' AND e.id = f.record_id
        LEFT JOIN events ev ON f.kind = 'event' AND ev.id = f.record_id
        LEFT JOIN knowledge_records k ON f.kind = 'knowledge' AND k.id = f.record_id
        LEFT JOIN relationship_profiles rp ON f.kind = 'relationship' AND rp.id = f.record_id
        WHERE campaign_search_fts MATCH ? AND f.campaign_id = ?
          AND ${knowledgeVisibility} AND ${relationshipVisibility}
        ORDER BY rank, f.rowid DESC
        LIMIT ?
      `).all(...params) as unknown as SearchRow[];
    } catch (error) {
      console.error('[Chronicle Engine] FTS search failed.', safeError(error));
      throw new ChronicleEngineError('INVALID_INPUT', 'Campaign search query nelze zpracovat.');
    }
    const unique = new Map<string, CampaignSearchResult>();
    for (const row of rows) {
      const key = `${row.kind}:${row.id}`;
      if (unique.has(key)) continue;
      unique.set(key, {
        kind: row.kind,
        id: row.id,
        score: Number(Math.max(0, 1 / (1 + Math.abs(row.rank))).toFixed(6)),
        title: row.title,
        snippet: row.snippet,
        ...(row.entityType ? { entityType: row.entityType } : {}),
        ...(row.eventSequence ? { eventSequence: row.eventSequence } : {}),
      });
    }
    return boundRows([...unique.values()], limits, 0);
  }

  getRelevantEvents(query: RelevantEventsQuery): BoundedResult<ChronicleEvent> {
    this.requireCampaign(query.campaignId);
    if (query.locationId) this.requireEntity(query.locationId, query.campaignId, 'Location');
    for (const entityId of query.entityIds ?? []) this.requireEntity(entityId, query.campaignId);
    const limits = contextLimits(query.budget);
    const conditions = ['e.campaign_id = ?'];
    const params: Array<string | number> = [query.campaignId];
    if (query.locationId) { conditions.push('e.location_id = ?'); params.push(query.locationId); }
    if (query.beforeSequence !== undefined) { conditions.push('e.sequence < ?'); params.push(positiveInteger(query.beforeSequence, 'beforeSequence')); }
    if (query.afterSequence !== undefined) { conditions.push('e.sequence > ?'); params.push(positiveInteger(query.afterSequence, 'afterSequence')); }
    addInCondition(conditions, params, 'e.event_type', query.eventTypes);
    if (query.entityIds?.length) {
      conditions.push(`EXISTS (
        SELECT 1 FROM event_entity_references er
        WHERE er.event_id = e.id AND er.entity_id IN (${placeholders(query.entityIds.length)})
      )`);
      params.push(...query.entityIds);
    }
    params.push(limits.maxResults + 1);
    const rows = this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.event_type AS eventType,
             e.sequence, e.occurred_at AS timestamp, e.location_id AS locationId,
             e.summary, e.source_message_id AS sourceMessageId, e.created_at AS createdAt
      FROM events e
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.sequence DESC
      LIMIT ?
    `).all(...params) as unknown as ChronicleEvent[];
    return boundRows(rows, limits, 0);
  }

  listToolDescriptors(): ChronicleToolDescriptor[] {
    return this.tools.map(({ execute: _execute, ...descriptor }) => structuredClone(descriptor));
  }

  executeTool(name: string, input: unknown): unknown {
    const tool = this.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new ChronicleEngineError('INVALID_INPUT', `Chronicle tool ${name} neexistuje.`);
    const campaignId = campaignIdFromToolInput(input);
    let status: 'success' | 'validation_error' | 'failure' = 'success';
    let output: unknown;
    try {
      output = tool.execute(input);
      return output;
    } catch (error) {
      status = error instanceof ChronicleEngineError ? 'validation_error' : 'failure';
      console.error(`[Chronicle Engine] Tool ${name} failed.`, safeError(error));
      throw error;
    } finally {
      if (campaignId && this.domain.getCampaign(campaignId)) {
        const truncated = isTruncated(output);
        this.database.prepare(`
          INSERT INTO chronicle_tool_invocations(
            campaign_id, tool_name, input_hash, output_truncated, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(campaignId, name, sha256(stableStringify(input)), truncated ? 1 : 0, status, timestamp());
      }
    }
  }

  rebuildSearchIndex(): void {
    this.transaction(() => {
      this.database.exec(`
        DELETE FROM campaign_search_fts;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'entity', id, campaign_id, name, description FROM entities;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'entity', a.entity_id, e.campaign_id, a.alias, a.alias
          FROM entity_aliases a JOIN entities e ON e.id = a.entity_id;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'event', id, campaign_id, summary, summary FROM events;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'message', id, campaign_id, role, content FROM conversation_messages;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'knowledge', id, campaign_id, knowledge_type,
                 coalesce(value_text, '') || ' ' || coalesce(reference_entity_id, '')
          FROM knowledge_records;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'relationship', p.id, r.campaign_id, r.relation_type,
                 p.current_summary || ' ' || coalesce(p.history_summary, '')
          FROM relationship_profiles p
          JOIN entity_relations r ON r.id = p.relation_id;
      `);
    });
  }

  private updateRuntimeState(
    campaignId: string,
    column: 'active_player_character_id' | 'active_conversation_id' | 'active_scene_location_id',
    value: string | null,
  ): CampaignRuntimeState {
    const current = this.getCampaignRuntimeState(campaignId);
    const now = timestamp();
    this.database.prepare(`
      INSERT INTO campaign_runtime_state(
        campaign_id, active_player_character_id, active_conversation_id,
        active_scene_location_id, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at
    `).run(
      campaignId,
      column === 'active_player_character_id' ? value : current.activePlayerCharacterId,
      column === 'active_conversation_id' ? value : current.activeConversationId,
      column === 'active_scene_location_id' ? value : current.activeSceneLocationId,
      now,
    );
    console.info(`[Chronicle Engine] Runtime state ${column} updated for ${campaignId}.`);
    return this.getCampaignRuntimeState(campaignId);
  }

  private recentMessages(conversationId: string, requested: number) {
    const limit = Math.min(20, Math.max(1, Math.trunc(requested)));
    const rows = this.database.prepare(`
      SELECT id, sequence, role, content, created_at AS createdAt
      FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `).all(conversationId, limit) as unknown as SceneContextView['recentMessages'];
    return rows.reverse();
  }

  private locationParticipantIds(campaignId: string, locationId: string | null): string[] {
    if (!locationId) return [];
    return (this.database.prepare(`
      SELECT e.id
      FROM entities e
      LEFT JOIN characters c ON c.entity_id = e.id
      LEFT JOIN creatures cr ON cr.entity_id = e.id
      WHERE e.campaign_id = ?
        AND (c.current_location_id = ? OR cr.current_location_id = ?)
      ORDER BY e.name, e.id
      LIMIT 20
    `).all(campaignId, locationId, locationId) as unknown as Array<{ id: string }>).map((row) => row.id);
  }

  private characterSection(
    section: CharacterContextSection,
    character: EntityRow,
    observerEntityId: string | null,
    budget?: ContextBudget,
  ): unknown {
    switch (section) {
      case 'identity': return this.domain.getCharacter(character.id);
      case 'biography': return {
        biography: this.characters.getBiography(character.id) ?? null,
        origin: this.characters.getOrigin(character.id) ?? null,
        classes: this.characters.listClasses(character.id),
      };
      case 'combat': return {
        state: this.characters.getCombatState(character.id) ?? null,
        armorClass: this.characters.getArmorClass(character.id),
        initiative: this.characters.getInitiative(character.id),
        abilities: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
          .map((id) => this.characters.getAbilityScore(character.id, id as never)),
        effects: this.characters.listActiveEffects(character.id),
        concentration: this.characters.getConcentration(character.id) ?? null,
      };
      case 'resources': return {
        resources: this.characters.listResources(character.id),
        hitDice: this.characters.listHitDiePools(character.id),
      };
      case 'actions': return this.characters.listActions(character.id);
      case 'features': return this.characters.listFeatures(character.id);
      case 'spellcasting': return {
        sources: this.characters.listSpellcastingSources(character.id),
        spells: this.characters.listSpells(character.id),
        slotPools: this.characters.listSpellSlotPools(character.id),
      };
      case 'inventory': return this.domain.listItemsHeldByCharacter(character.id);
      case 'relations': return this.getRelations({
        campaignId: character.campaignId,
        entityId: character.id,
        activeOnly: true,
        budget,
      });
      case 'relationships': return this.relationships.getActorRelationships({
        campaignId: character.campaignId,
        actorId: character.id,
        observerEntityId,
        includeHistory: true,
        maxResults: budget?.maxResults,
        maxCharacters: budget?.maxCharacters,
      });
      case 'knowledge': return this.getKnowledge({
        campaignId: character.campaignId,
        subjectEntityId: character.id,
        observerEntityId,
        budget,
      });
    }
  }

  private entitySummary(id: string): EntitySummary {
    const entity = this.entity(id);
    if (!entity) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Entity ${id} neexistuje.`);
    return {
      id: entity.id,
      kind: entityKind(entity.entityType),
      label: entity.name,
      subtitle: entity.entityType,
    };
  }

  private entity(id: string): EntityRow | undefined {
    return this.database.prepare(`
      SELECT id, campaign_id AS campaignId, entity_type AS entityType, name, description
      FROM entities WHERE id = ?
    `).get(id) as unknown as EntityRow | undefined;
  }

  private requireEntity(id: string, campaignId: string, type?: EntityType): EntityRow {
    const entity = this.entity(id);
    if (!entity) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Entity ${id} neexistuje.`, { id });
    if (entity.campaignId !== campaignId) throw crossCampaign(id);
    if (type && entity.entityType !== type) {
      throw new ChronicleEngineError('INVALID_INPUT', `Entity ${id} není typu ${type}.`);
    }
    return entity;
  }

  private requireCampaign(id: string): void {
    if (!this.domain.getCampaign(id)) {
      throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Campaign ${id} neexistuje.`, { id });
    }
  }

  private requireConversation(id: string, campaignId: string): Conversation {
    const conversation = this.getConversation(id);
    if (!conversation) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Conversation ${id} neexistuje.`);
    if (conversation.campaignId !== campaignId) throw crossCampaign(id);
    return conversation;
  }

  private requireEvent(id: string, campaignId: string): void {
    const row = this.database.prepare('SELECT campaign_id AS campaignId FROM events WHERE id = ?')
      .get(id) as unknown as { campaignId: string } | undefined;
    if (!row) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Event ${id} neexistuje.`);
    if (row.campaignId !== campaignId) throw crossCampaign(id);
  }

  private transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const value = work();
      this.database.exec('COMMIT;');
      return value;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  private createTools(): readonly ChronicleToolDefinition[] {
    const descriptor = (
      name: string,
      description: string,
      required: readonly string[],
      execute: (input: unknown) => unknown,
    ): ChronicleToolDefinition => ({
      name,
      description,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required,
        properties: Object.fromEntries(required.map((key) => [key, { type: 'string' }])),
      },
      mutatesState: false,
      kind: 'read',
      cacheable: true,
      defaultLimits: { maxResults: DEFAULT_MAX_RESULTS, maxCharacters: DEFAULT_MAX_CHARACTERS },
      execute,
    });
    return [
      descriptor('chronicle.get_scene_context', 'Small current scene context.', ['campaignId'], (value) => {
        const input = record(value); return this.getSceneContext(text(input.campaignId, 'campaignId'));
      }),
      descriptor('chronicle.get_character_context', 'Selected character sections.', ['campaignId', 'characterId', 'sections'], (value) => {
        const input = record(value);
        return this.getCharacterContext({
          campaignId: text(input.campaignId, 'campaignId'),
          characterId: text(input.characterId, 'characterId'),
          sections: stringArray(input.sections, 'sections') as CharacterContextSection[],
          observerEntityId: optionalText(input.observerEntityId),
          budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.get_item_context', 'Bounded item state and observer knowledge.', ['campaignId', 'itemId'], (value) => {
        const input = record(value); return this.getItemContext({
          campaignId: text(input.campaignId, 'campaignId'), itemId: text(input.itemId, 'itemId'),
          observerEntityId: optionalText(input.observerEntityId), budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.get_location_context', 'Location path, contents, and relevant events.', ['campaignId', 'locationId'], (value) => {
        const input = record(value); return this.getLocationContext({
          campaignId: text(input.campaignId, 'campaignId'), locationId: text(input.locationId, 'locationId'),
          budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.get_location_contents', 'Filtered summary of location contents.', ['campaignId', 'locationId'], (value) => {
        const input = record(value); return this.getLocationContents({
          campaignId: text(input.campaignId, 'campaignId'), locationId: text(input.locationId, 'locationId'),
          include: input.include ? stringArray(input.include, 'include') as never : undefined,
          budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.get_definition', 'Provider-neutral rule definition lookup.', ['definitionId'], (value) => {
        const input = record(value); return this.getDefinition(text(input.definitionId, 'definitionId'));
      }),
      descriptor('chronicle.get_relations', 'Bounded active entity relations.', ['campaignId', 'entityId'], (value) => {
        const input = record(value); return this.getRelations({
          campaignId: text(input.campaignId, 'campaignId'), entityId: text(input.entityId, 'entityId'),
          relationTypes: input.relationTypes ? stringArray(input.relationTypes, 'relationTypes') : undefined,
          activeOnly: input.activeOnly === undefined ? true : booleanValue(input.activeOnly, 'activeOnly'),
          direction: optionalText(input.direction) as 'incoming' | 'outgoing' | 'both' | undefined,
          budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.get_actor_relationships', 'Visibility-safe actor relationships with bounded history and Event references.', ['campaignId', 'actorId'], (value) => {
        const input = record(value); return this.relationships.getActorRelationships({
          campaignId: text(input.campaignId, 'campaignId'),
          actorId: text(input.actorId, 'actorId'),
          observerEntityId: optionalText(input.observerEntityId),
          includeHistory: input.includeHistory === undefined ? true : booleanValue(input.includeHistory, 'includeHistory'),
          maxResults: optionalNumber(input.maxResults),
          maxCharacters: optionalNumber(input.maxCharacters),
        });
      }),
      descriptor('chronicle.get_knowledge', 'World or observer-scoped knowledge without visibility leakage.', ['campaignId', 'subjectEntityId'], (value) => {
        const input = record(value); return this.getKnowledge({
          campaignId: text(input.campaignId, 'campaignId'), subjectEntityId: text(input.subjectEntityId, 'subjectEntityId'),
          observerEntityId: optionalText(input.observerEntityId),
          knowledgeTypes: input.knowledgeTypes ? stringArray(input.knowledgeTypes, 'knowledgeTypes') : undefined,
          includeHistorical: input.includeHistorical === undefined ? false : booleanValue(input.includeHistorical, 'includeHistorical'),
          budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.get_relevant_events', 'Filtered reverse-chronological event history.', ['campaignId'], (value) => {
        const input = record(value); return this.getRelevantEvents({
          campaignId: text(input.campaignId, 'campaignId'),
          entityIds: input.entityIds ? stringArray(input.entityIds, 'entityIds') : undefined,
          locationId: optionalText(input.locationId),
          eventTypes: input.eventTypes ? stringArray(input.eventTypes, 'eventTypes') : undefined,
          beforeSequence: optionalNumber(input.beforeSequence), afterSequence: optionalNumber(input.afterSequence),
          budget: budgetValue(input.budget),
        });
      }),
      descriptor('chronicle.resolve_entity', 'Deterministic ID, name, and alias resolution.', ['campaignId', 'query'], (value) => {
        const input = record(value); return this.resolveEntity({
          campaignId: text(input.campaignId, 'campaignId'), query: text(input.query, 'query'),
          observerEntityId: optionalText(input.observerEntityId),
          entityTypes: input.entityTypes ? stringArray(input.entityTypes, 'entityTypes') : undefined,
          sceneOnly: input.sceneOnly === undefined ? false : booleanValue(input.sceneOnly, 'sceneOnly'),
        });
      }),
      descriptor('chronicle.search_campaign', 'Bounded full-text campaign search.', ['campaignId', 'query'], (value) => {
        const input = record(value); return this.searchCampaign({
          campaignId: text(input.campaignId, 'campaignId'), query: text(input.query, 'query'),
          observerEntityId: optionalText(input.observerEntityId), budget: budgetValue(input.budget),
        });
      }),
    ];
  }
}

function messageFromRow(row: Record<string, unknown>): ConversationMessage {
  return { ...row, metadata: parseJsonRecord(row.metadata) } as unknown as ConversationMessage;
}

function entityKind(type: EntityType): EntityCardKind {
  return type;
}

function contextLimits(budget?: ContextBudget) {
  return {
    maxResults: Math.min(MAX_RESULTS, Math.max(1, Math.trunc(budget?.maxResults ?? DEFAULT_MAX_RESULTS))),
    maxCharacters: Math.min(MAX_CHARACTERS, Math.max(256, Math.trunc(budget?.maxCharacters ?? DEFAULT_MAX_CHARACTERS))),
  };
}

function boundRows<T>(rows: T[], limits: ReturnType<typeof contextLimits>, offset: number): BoundedResult<T> {
  const capped = rows.slice(0, limits.maxResults);
  const items = fitByCharacters(capped, limits.maxCharacters);
  const truncated = rows.length > items.length;
  return { items, truncated, nextCursor: truncated ? String(offset + items.length) : null };
}

function fitByCharacters<T>(items: T[], maximum: number): T[] {
  const output: T[] = [];
  let used = 2;
  for (const item of items) {
    const size = JSON.stringify(item).length + 1;
    if (output.length > 0 && used + size > maximum) break;
    output.push(item);
    used += size;
  }
  return output;
}

function cursorOffset(cursor?: string | null): number {
  if (!cursor) return 0;
  const value = Number(cursor);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function addInCondition(
  conditions: string[],
  params: Array<string | number | null>,
  column: string,
  values?: readonly string[],
): void {
  if (!values?.length) return;
  conditions.push(`${column} IN (${placeholders(values.length)})`);
  params.push(...values);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function ftsQuery(value: string): string {
  const terms = normalize(value).split(/\s+/u).filter(Boolean);
  if (terms.length === 0) throw new ChronicleEngineError('INVALID_INPUT', 'Search query nesmí být prázdný.');
  return terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ');
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('cs-CZ');
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdný.`);
  return normalized;
}

function messageRole(value: string): ConversationMessageRole {
  if (['user', 'assistant', 'system', 'tool'].includes(value)) return value as ConversationMessageRole;
  throw new ChronicleEngineError('INVALID_INPUT', `Nepodporovaná message role ${value}.`);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ChronicleEngineError('INVALID_INPUT', `${label} musí být kladné celé číslo.`);
  }
  return value;
}

function parseJsonRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value == null) return null;
  return JSON.parse(String(value)) as Readonly<Record<string, unknown>>;
}

function serializeJson(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function crossCampaign(id: string): ChronicleEngineError {
  return new ChronicleEngineError(
    'CROSS_CAMPAIGN_REFERENCE',
    `Reference ${id} patří do jiné Campaign.`,
    { id },
  );
}

function timestamp(): string { return new Date().toISOString(); }
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex'); }

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTruncated(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'truncated' in value && (value as { truncated?: unknown }).truncated);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Tool input musí být object.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new ChronicleEngineError('INVALID_INPUT', `${label} musí být text.`);
  return requiredText(value, label);
}

function optionalText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return text(value, 'Optional text');
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ChronicleEngineError('INVALID_INPUT', `${label} musí být pole textů.`);
  }
  return value.map((item) => requiredText(item, label));
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ChronicleEngineError('INVALID_INPUT', `${label} musí být boolean.`);
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Číselný parametr musí být konečné číslo.');
  }
  return value;
}

function budgetValue(value: unknown): ContextBudget | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value);
  return {
    maxResults: optionalNumber(input.maxResults),
    maxCharacters: optionalNumber(input.maxCharacters),
    cursor: optionalText(input.cursor),
  };
}

function campaignIdFromToolInput(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>).campaignId;
  return typeof candidate === 'string' ? candidate : null;
}
