import type { DatabaseSync } from 'node:sqlite';
import type {
  Campaign,
  Character,
  ChronicleEvent,
  Creature,
  EntityAlias,
  EntityBase,
  EntityRelation,
  EntityType,
  Item,
  ItemPlacement,
  ItemPlacementHistoryEntry,
  KnowledgeRecord,
  Location,
} from '../../domain/models';

interface EntityIdentityRow {
  campaignId: string;
  entityType: EntityType;
}

interface PlacementRow {
  placementType: ItemPlacement['kind'];
  locationId: string | null;
  characterId: string | null;
  creatureId: string | null;
  containerItemId: string | null;
}

interface PlacementHistoryRow extends PlacementRow {
  id: string;
  itemId: string;
  fromEventId: string | null;
  toEventId: string | null;
  recordedAt: string;
}

interface LocationParentRow {
  id: string;
  name: string;
  parentLocationId: string | null;
}

export class SqliteChronicleRepository {
  constructor(private readonly database: DatabaseSync) {}

  transaction<T>(work: () => T): T {
    this.database.exec('BEGIN IMMEDIATE;');
    try {
      const result = work();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK;');
      throw error;
    }
  }

  insertCampaign(campaign: Campaign): void {
    this.database.prepare(`
      INSERT INTO campaigns(id, name, created_at, updated_at, ruleset_id, ruleset_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      campaign.name,
      campaign.createdAt,
      campaign.updatedAt,
      campaign.rulesetId,
      campaign.rulesetVersion,
    );
  }

  getCampaign(id: string): Campaign | undefined {
    return this.database.prepare(`
      SELECT id, name, ruleset_id AS rulesetId, ruleset_version AS rulesetVersion,
             created_at AS createdAt, updated_at AS updatedAt
      FROM campaigns
      WHERE id = ?
    `).get(id) as unknown as Campaign | undefined;
  }

  insertLocation(location: Location): void {
    this.insertEntity(location);
    this.database.prepare(`
      INSERT INTO locations(entity_id, parent_location_id, location_type)
      VALUES (?, ?, ?)
    `).run(location.id, location.parentLocationId, location.locationType);
  }

  getLocation(id: string): Location | undefined {
    return this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, l.parent_location_id AS parentLocationId,
             l.location_type AS locationType
      FROM entities e
      JOIN locations l ON l.entity_id = e.id
      WHERE e.id = ?
    `).get(id) as unknown as Location | undefined;
  }

  getLocationParent(id: string): LocationParentRow | undefined {
    return this.database.prepare(`
      SELECT e.id, e.name, l.parent_location_id AS parentLocationId
      FROM entities e
      JOIN locations l ON l.entity_id = e.id
      WHERE e.id = ?
    `).get(id) as unknown as LocationParentRow | undefined;
  }

  insertCharacter(character: Character): void {
    this.insertEntity(character);
    this.database.prepare(`
      INSERT INTO characters(
        entity_id, full_name, character_type, current_location_id, current_life_state_id
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      character.id,
      character.fullName,
      character.characterType,
      character.currentLocationId,
      character.currentLifeStateId,
    );
  }

  getCharacter(id: string): Character | undefined {
    return this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, c.full_name AS fullName,
             c.character_type AS characterType, c.current_location_id AS currentLocationId,
             c.current_life_state_id AS currentLifeStateId
      FROM entities e
      JOIN characters c ON c.entity_id = e.id
      WHERE e.id = ?
    `).get(id) as unknown as Character | undefined;
  }

  listCharacters(campaignId?: string): Character[] {
    const where = campaignId ? 'WHERE e.campaign_id = ?' : '';
    const statement = this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, c.full_name AS fullName,
             c.character_type AS characterType, c.current_location_id AS currentLocationId,
             c.current_life_state_id AS currentLifeStateId
      FROM entities e
      JOIN characters c ON c.entity_id = e.id
      ${where}
      ORDER BY e.created_at, e.id
    `);
    return (campaignId ? statement.all(campaignId) : statement.all()) as unknown as Character[];
  }

  insertCreature(creature: Creature): void {
    this.insertEntity(creature);
    this.database.prepare(`
      INSERT INTO creatures(entity_id, current_location_id, current_life_state_id)
      VALUES (?, ?, ?)
    `).run(
      creature.id,
      creature.currentLocationId,
      creature.currentLifeStateId,
    );
  }

  getCreature(id: string): Creature | undefined {
    return this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, c.current_location_id AS currentLocationId,
             c.current_life_state_id AS currentLifeStateId
      FROM entities e
      JOIN creatures c ON c.entity_id = e.id
      WHERE e.id = ?
    `).get(id) as unknown as Creature | undefined;
  }

  insertItem(item: Item): void {
    this.insertEntity(item);
    this.database.prepare(`
      INSERT INTO items(entity_id, item_definition_id, quantity)
      VALUES (?, ?, ?)
    `).run(item.id, item.itemDefinitionId, item.quantity);
  }

  getItem(id: string): Item | undefined {
    return this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, i.item_definition_id AS itemDefinitionId,
             i.quantity
      FROM entities e
      JOIN items i ON i.entity_id = e.id
      WHERE e.id = ?
    `).get(id) as unknown as Item | undefined;
  }

  listItemsHeldByCharacter(characterId: string): Item[] {
    return this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, i.item_definition_id AS itemDefinitionId,
             i.quantity
      FROM item_current_placements p
      JOIN items i ON i.entity_id = p.item_id
      JOIN entities e ON e.id = i.entity_id
      WHERE p.placement_type = 'character' AND p.character_id = ?
      ORDER BY e.name, e.id
    `).all(characterId) as unknown as Item[];
  }

  listLocationChildren(parentLocationId: string): Location[] {
    return this.database.prepare(`
      SELECT e.id, e.campaign_id AS campaignId, e.entity_type AS entityType,
             e.name, e.description, e.image_resource_id AS imageResourceId,
             e.created_event_id AS createdEventId, e.created_at AS createdAt,
             e.updated_at AS updatedAt, l.parent_location_id AS parentLocationId,
             l.location_type AS locationType
      FROM locations l
      JOIN entities e ON e.id = l.entity_id
      WHERE l.parent_location_id = ?
      ORDER BY e.name, e.id
    `).all(parentLocationId) as unknown as Location[];
  }

  getEntityIdentity(id: string): EntityIdentityRow | undefined {
    return this.database.prepare(`
      SELECT campaign_id AS campaignId, entity_type AS entityType
      FROM entities
      WHERE id = ?
    `).get(id) as unknown as EntityIdentityRow | undefined;
  }

  lifeStateExists(id: string): boolean {
    return this.database.prepare(
      'SELECT 1 AS found FROM life_state_definitions WHERE id = ?',
    ).get(id) !== undefined;
  }

  itemDefinitionExists(id: string): boolean {
    return this.database.prepare('SELECT 1 AS found FROM item_definitions WHERE id = ?').get(id)
      !== undefined;
  }

  eventBelongsToCampaign(id: string, campaignId: string): boolean {
    return this.database.prepare(
      'SELECT 1 AS found FROM events WHERE id = ? AND campaign_id = ?',
    ).get(id, campaignId) !== undefined;
  }

  nextEventSequence(campaignId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS nextSequence
      FROM events
      WHERE campaign_id = ?
    `).get(campaignId) as unknown as { nextSequence: number };
    return row.nextSequence;
  }

  insertEvent(event: ChronicleEvent): void {
    this.database.prepare(`
      INSERT INTO events(
        id, campaign_id, event_type, sequence, occurred_at, location_id,
        summary, source_message_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.campaignId,
      event.eventType,
      event.sequence,
      event.timestamp,
      event.locationId,
      event.summary,
      event.sourceMessageId,
      event.createdAt,
    );
  }

  listEvents(campaignId: string): ChronicleEvent[] {
    return this.database.prepare(`
      SELECT id, campaign_id AS campaignId, event_type AS eventType, sequence,
             occurred_at AS timestamp, location_id AS locationId, summary,
             source_message_id AS sourceMessageId, created_at AS createdAt
      FROM events
      WHERE campaign_id = ?
      ORDER BY sequence
    `).all(campaignId) as unknown as ChronicleEvent[];
  }

  insertInitialEntityLocation(
    historyId: string,
    entityId: string,
    locationId: string | null,
    fromEventId: string | null,
    recordedAt: string,
  ): void {
    this.database.prepare(`
      INSERT INTO entity_location_history(
        id, entity_id, location_id, from_event_id, to_event_id, recorded_at
      ) VALUES (?, ?, ?, ?, NULL, ?)
    `).run(historyId, entityId, locationId, fromEventId, recordedAt);
  }

  moveCharacter(
    characterId: string,
    locationId: string | null,
    eventId: string,
    historyId: string,
    updatedAt: string,
  ): void {
    this.database.prepare(`
      UPDATE entity_location_history
      SET to_event_id = ?
      WHERE entity_id = ? AND to_event_id IS NULL
    `).run(eventId, characterId);
    this.database.prepare(`
      INSERT INTO entity_location_history(
        id, entity_id, location_id, from_event_id, to_event_id, recorded_at
      ) VALUES (?, ?, ?, ?, NULL, ?)
    `).run(historyId, characterId, locationId, eventId, updatedAt);
    this.database.prepare(
      'UPDATE characters SET current_location_id = ? WHERE entity_id = ?',
    ).run(locationId, characterId);
    this.database.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(
      updatedAt,
      characterId,
    );
  }

  getCharacterLocation(characterId: string): string | null | undefined {
    const row = this.database.prepare(`
      SELECT current_location_id AS currentLocationId
      FROM characters
      WHERE entity_id = ?
    `).get(characterId) as unknown as { currentLocationId: string | null } | undefined;
    return row?.currentLocationId;
  }

  getCreatureLocation(creatureId: string): string | null | undefined {
    const row = this.database.prepare(`
      SELECT current_location_id AS currentLocationId
      FROM creatures
      WHERE entity_id = ?
    `).get(creatureId) as unknown as { currentLocationId: string | null } | undefined;
    return row?.currentLocationId;
  }

  insertInitialItemPlacement(
    historyId: string,
    itemId: string,
    placement: ItemPlacement,
    fromEventId: string | null,
    recordedAt: string,
  ): void {
    const columns = placementColumns(placement);
    this.database.prepare(`
      INSERT INTO item_current_placements(
        item_id, placement_type, location_id, character_id, creature_id, container_item_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(itemId, ...columns);
    this.insertPlacementHistory(historyId, itemId, placement, fromEventId, null, recordedAt);
  }

  replaceItemPlacement(
    historyId: string,
    itemId: string,
    placement: ItemPlacement,
    eventId: string,
    recordedAt: string,
  ): void {
    const closed = this.database.prepare(`
      UPDATE item_placement_history
      SET to_event_id = ?
      WHERE item_id = ? AND to_event_id IS NULL
    `).run(eventId, itemId);
    if (Number(closed.changes) !== 1) {
      throw new Error(`Předmět ${itemId} nemá právě jeden otevřený placement záznam.`);
    }

    const columns = placementColumns(placement);
    this.database.prepare(`
      UPDATE item_current_placements
      SET placement_type = ?, location_id = ?, character_id = ?, creature_id = ?,
          container_item_id = ?
      WHERE item_id = ?
    `).run(...columns, itemId);
    this.insertPlacementHistory(historyId, itemId, placement, eventId, null, recordedAt);
    this.database.prepare('UPDATE entities SET updated_at = ? WHERE id = ?').run(recordedAt, itemId);
  }

  getItemPlacement(itemId: string): ItemPlacement | undefined {
    const row = this.database.prepare(`
      SELECT placement_type AS placementType, location_id AS locationId,
             character_id AS characterId, creature_id AS creatureId,
             container_item_id AS containerItemId
      FROM item_current_placements
      WHERE item_id = ?
    `).get(itemId) as unknown as PlacementRow | undefined;
    return row ? rowToPlacement(row) : undefined;
  }

  getItemPlacementHistory(itemId: string): ItemPlacementHistoryEntry[] {
    const rows = this.database.prepare(`
      SELECT id, item_id AS itemId, placement_type AS placementType,
             location_id AS locationId, character_id AS characterId,
             creature_id AS creatureId, container_item_id AS containerItemId,
             from_event_id AS fromEventId, to_event_id AS toEventId,
             recorded_at AS recordedAt
      FROM item_placement_history
      WHERE item_id = ?
      ORDER BY rowid
    `).all(itemId) as unknown as PlacementHistoryRow[];
    return rows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      placement: rowToPlacement(row),
      fromEventId: row.fromEventId,
      toEventId: row.toEventId,
      recordedAt: row.recordedAt,
    }));
  }

  insertAlias(alias: EntityAlias): void {
    this.database.prepare(`
      INSERT INTO entity_aliases(
        id, entity_id, alias, used_by_entity_id, from_event_id, to_event_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      alias.id,
      alias.entityId,
      alias.alias,
      alias.usedByEntityId,
      alias.fromEventId,
      alias.toEventId,
    );
  }

  listAliases(entityId: string): EntityAlias[] {
    return this.database.prepare(`
      SELECT id, entity_id AS entityId, alias, used_by_entity_id AS usedByEntityId,
             from_event_id AS fromEventId, to_event_id AS toEventId
      FROM entity_aliases WHERE entity_id = ? ORDER BY rowid
    `).all(entityId) as unknown as EntityAlias[];
  }

  insertRelation(relation: EntityRelation): void {
    this.database.prepare(`
      INSERT INTO entity_relations(
        id, campaign_id, source_entity_id, target_entity_id, relation_type,
        from_event_id, to_event_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relation.id,
      relation.campaignId,
      relation.sourceEntityId,
      relation.targetEntityId,
      relation.relationType,
      relation.fromEventId,
      relation.toEventId,
      relation.metadata === null ? null : JSON.stringify(relation.metadata),
    );
  }

  listRelationsForEntity(entityId: string): EntityRelation[] {
    const rows = this.database.prepare(`
      SELECT id, campaign_id AS campaignId, source_entity_id AS sourceEntityId,
             target_entity_id AS targetEntityId, relation_type AS relationType,
             from_event_id AS fromEventId, to_event_id AS toEventId, metadata
      FROM entity_relations
      WHERE source_entity_id = ? OR target_entity_id = ?
      ORDER BY rowid
    `).all(entityId, entityId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      metadata: row.metadata == null
        ? null
        : JSON.parse(String(row.metadata)) as Readonly<Record<string, unknown>>,
    } as unknown as EntityRelation));
  }

  insertKnowledge(record: KnowledgeRecord): void {
    this.database.prepare(`
      INSERT INTO knowledge_records(
        id, campaign_id, subject_entity_id, observer_entity_id, knowledge_type,
        value_text, reference_entity_id, from_event_id, to_event_id, confidence, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.campaignId,
      record.subjectEntityId,
      record.observerEntityId,
      record.knowledgeType,
      record.value,
      record.referenceEntityId,
      record.fromEventId,
      record.toEventId,
      record.confidence,
      record.source,
    );
  }

  private insertEntity(entity: EntityBase): void {
    this.database.prepare(`
      INSERT INTO entities(
        id, campaign_id, entity_type, name, description, image_resource_id,
        created_event_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entity.id,
      entity.campaignId,
      entity.entityType,
      entity.name,
      entity.description,
      entity.imageResourceId,
      entity.createdEventId,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private insertPlacementHistory(
    historyId: string,
    itemId: string,
    placement: ItemPlacement,
    fromEventId: string | null,
    toEventId: string | null,
    recordedAt: string,
  ): void {
    const columns = placementColumns(placement);
    this.database.prepare(`
      INSERT INTO item_placement_history(
        id, item_id, placement_type, location_id, character_id, creature_id,
        container_item_id, from_event_id, to_event_id, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(historyId, itemId, ...columns, fromEventId, toEventId, recordedAt);
  }
}

function placementColumns(placement: ItemPlacement): readonly [
  ItemPlacement['kind'],
  string | null,
  string | null,
  string | null,
  string | null,
] {
  switch (placement.kind) {
    case 'location':
      return ['location', placement.locationId, null, null, null];
    case 'character':
      return ['character', null, placement.characterId, null, null];
    case 'creature':
      return ['creature', null, null, placement.creatureId, null];
    case 'container':
      return ['container', null, null, null, placement.containerItemId];
    case 'unknown':
      return ['unknown', null, null, null, null];
  }
}

function rowToPlacement(row: PlacementRow): ItemPlacement {
  switch (row.placementType) {
    case 'location':
      if (!row.locationId) throw invalidPlacementRow(row);
      return { kind: 'location', locationId: row.locationId };
    case 'character':
      if (!row.characterId) throw invalidPlacementRow(row);
      return { kind: 'character', characterId: row.characterId };
    case 'creature':
      if (!row.creatureId) throw invalidPlacementRow(row);
      return { kind: 'creature', creatureId: row.creatureId };
    case 'container':
      if (!row.containerItemId) throw invalidPlacementRow(row);
      return { kind: 'container', containerItemId: row.containerItemId };
    case 'unknown':
      return { kind: 'unknown' };
  }
}

function invalidPlacementRow(row: PlacementRow): Error {
  return new Error(`Databáze obsahuje neplatný placement typu ${row.placementType}.`);
}
