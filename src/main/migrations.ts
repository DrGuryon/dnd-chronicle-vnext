import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_campaign_storage',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS application_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        ) STRICT;

        CREATE INDEX IF NOT EXISTS campaigns_updated_at_idx
          ON campaigns(updated_at DESC);
      `);
    },
  },
  {
    version: 2,
    name: 'create_domain_model_foundation',
    up(database) {
      database.exec(`
        ALTER TABLE campaigns
          ADD COLUMN ruleset_id TEXT NOT NULL DEFAULT 'dnd5e';
        ALTER TABLE campaigns
          ADD COLUMN ruleset_version TEXT NOT NULL DEFAULT '2024';

        CREATE TABLE life_state_definitions (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL
        ) STRICT;

        INSERT INTO life_state_definitions(id, name, description) VALUES
          ('life_state_alive', 'Alive', 'The entity is alive.'),
          ('life_state_unconscious', 'Unconscious', 'The entity is alive but unconscious.'),
          ('life_state_dead', 'Dead', 'The entity is dead.'),
          ('life_state_unknown', 'Unknown', 'The entity life state is not known.');

        CREATE TABLE entities (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('Character', 'Creature', 'Item', 'Location')),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          description TEXT NOT NULL DEFAULT '',
          image_resource_id TEXT,
          created_event_id TEXT REFERENCES events(id) DEFERRABLE INITIALLY DEFERRED,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX entities_campaign_type_idx
          ON entities(campaign_id, entity_type, name);

        CREATE TABLE locations (
          entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
          parent_location_id TEXT REFERENCES locations(entity_id),
          location_type TEXT NOT NULL CHECK (length(trim(location_type)) > 0),
          CHECK (entity_id <> parent_location_id)
        ) STRICT;

        CREATE INDEX locations_parent_idx ON locations(parent_location_id);

        CREATE TABLE events (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          occurred_at TEXT,
          location_id TEXT REFERENCES locations(entity_id),
          summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
          source_message_id TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (campaign_id, sequence)
        ) STRICT;

        CREATE INDEX events_campaign_sequence_idx
          ON events(campaign_id, sequence);

        CREATE TABLE characters (
          entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
          full_name TEXT,
          character_type TEXT NOT NULL CHECK (character_type IN ('PC', 'NPC')),
          current_location_id TEXT REFERENCES locations(entity_id),
          current_life_state_id TEXT NOT NULL REFERENCES life_state_definitions(id)
        ) STRICT;

        CREATE TABLE creatures (
          entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
          current_location_id TEXT REFERENCES locations(entity_id),
          current_life_state_id TEXT NOT NULL REFERENCES life_state_definitions(id)
        ) STRICT;

        CREATE TABLE item_definitions (
          id TEXT PRIMARY KEY,
          ruleset_id TEXT NOT NULL,
          ruleset_version TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE items (
          entity_id TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
          item_definition_id TEXT REFERENCES item_definitions(id),
          quantity INTEGER NOT NULL CHECK (quantity >= 0)
        ) STRICT;

        CREATE TABLE entity_aliases (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          alias TEXT NOT NULL CHECK (length(trim(alias)) > 0),
          used_by_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
          from_event_id TEXT REFERENCES events(id),
          to_event_id TEXT REFERENCES events(id),
          CHECK (from_event_id IS NULL OR to_event_id IS NULL OR from_event_id <> to_event_id)
        ) STRICT;

        CREATE INDEX entity_aliases_entity_idx ON entity_aliases(entity_id, alias);

        CREATE TABLE entity_relations (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          relation_type TEXT NOT NULL CHECK (length(trim(relation_type)) > 0),
          from_event_id TEXT REFERENCES events(id),
          to_event_id TEXT REFERENCES events(id),
          metadata TEXT
        ) STRICT;

        CREATE INDEX entity_relations_source_idx
          ON entity_relations(campaign_id, source_entity_id, relation_type);
        CREATE INDEX entity_relations_target_idx
          ON entity_relations(campaign_id, target_entity_id, relation_type);

        CREATE TABLE knowledge_records (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          subject_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          observer_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
          knowledge_type TEXT NOT NULL CHECK (length(trim(knowledge_type)) > 0),
          value_text TEXT,
          reference_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
          from_event_id TEXT REFERENCES events(id),
          to_event_id TEXT REFERENCES events(id),
          confidence REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
          source TEXT,
          CHECK (value_text IS NOT NULL OR reference_entity_id IS NOT NULL)
        ) STRICT;

        CREATE INDEX knowledge_subject_observer_idx
          ON knowledge_records(campaign_id, subject_entity_id, observer_entity_id);

        CREATE TABLE item_current_placements (
          item_id TEXT PRIMARY KEY REFERENCES items(entity_id) ON DELETE CASCADE,
          placement_type TEXT NOT NULL CHECK (
            placement_type IN ('location', 'character', 'creature', 'container', 'unknown')
          ),
          location_id TEXT REFERENCES locations(entity_id),
          character_id TEXT REFERENCES characters(entity_id),
          creature_id TEXT REFERENCES creatures(entity_id),
          container_item_id TEXT REFERENCES items(entity_id),
          CHECK (
            (placement_type = 'location' AND location_id IS NOT NULL AND character_id IS NULL AND creature_id IS NULL AND container_item_id IS NULL)
            OR (placement_type = 'character' AND location_id IS NULL AND character_id IS NOT NULL AND creature_id IS NULL AND container_item_id IS NULL)
            OR (placement_type = 'creature' AND location_id IS NULL AND character_id IS NULL AND creature_id IS NOT NULL AND container_item_id IS NULL)
            OR (placement_type = 'container' AND location_id IS NULL AND character_id IS NULL AND creature_id IS NULL AND container_item_id IS NOT NULL AND item_id <> container_item_id)
            OR (placement_type = 'unknown' AND location_id IS NULL AND character_id IS NULL AND creature_id IS NULL AND container_item_id IS NULL)
          )
        ) STRICT;

        CREATE INDEX item_current_container_idx
          ON item_current_placements(container_item_id)
          WHERE container_item_id IS NOT NULL;

        CREATE TABLE item_placement_history (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL REFERENCES items(entity_id) ON DELETE CASCADE,
          placement_type TEXT NOT NULL CHECK (
            placement_type IN ('location', 'character', 'creature', 'container', 'unknown')
          ),
          location_id TEXT REFERENCES locations(entity_id),
          character_id TEXT REFERENCES characters(entity_id),
          creature_id TEXT REFERENCES creatures(entity_id),
          container_item_id TEXT REFERENCES items(entity_id),
          from_event_id TEXT REFERENCES events(id),
          to_event_id TEXT REFERENCES events(id),
          recorded_at TEXT NOT NULL,
          CHECK (
            (placement_type = 'location' AND location_id IS NOT NULL AND character_id IS NULL AND creature_id IS NULL AND container_item_id IS NULL)
            OR (placement_type = 'character' AND location_id IS NULL AND character_id IS NOT NULL AND creature_id IS NULL AND container_item_id IS NULL)
            OR (placement_type = 'creature' AND location_id IS NULL AND character_id IS NULL AND creature_id IS NOT NULL AND container_item_id IS NULL)
            OR (placement_type = 'container' AND location_id IS NULL AND character_id IS NULL AND creature_id IS NULL AND container_item_id IS NOT NULL AND item_id <> container_item_id)
            OR (placement_type = 'unknown' AND location_id IS NULL AND character_id IS NULL AND creature_id IS NULL AND container_item_id IS NULL)
          )
        ) STRICT;

        CREATE UNIQUE INDEX item_placement_history_open_idx
          ON item_placement_history(item_id)
          WHERE to_event_id IS NULL;

        CREATE TABLE entity_location_history (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          location_id TEXT REFERENCES locations(entity_id),
          from_event_id TEXT REFERENCES events(id),
          to_event_id TEXT REFERENCES events(id),
          recorded_at TEXT NOT NULL
        ) STRICT;

        CREATE UNIQUE INDEX entity_location_history_open_idx
          ON entity_location_history(entity_id)
          WHERE to_event_id IS NULL;
      `);
    },
  },
];

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;

