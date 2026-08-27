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
  {
    version: 3,
    name: 'create_complete_character_domain',
    up(database) {
      database.exec(`
        CREATE TABLE rule_definitions (
          id TEXT PRIMARY KEY,
          definition_type TEXT NOT NULL CHECK (length(trim(definition_type)) > 0),
          ruleset_id TEXT NOT NULL,
          ruleset_version TEXT NOT NULL,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          description TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL,
          origin TEXT NOT NULL,
          metadata TEXT,
          is_homebrew INTEGER NOT NULL DEFAULT 0 CHECK (is_homebrew IN (0, 1)),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX rule_definitions_lookup_idx
          ON rule_definitions(ruleset_id, ruleset_version, definition_type, name);

        ALTER TABLE characters ADD COLUMN age INTEGER CHECK (age IS NULL OR age >= 0);
        ALTER TABLE characters ADD COLUMN birth_date TEXT;
        ALTER TABLE characters ADD COLUMN sex_id TEXT;
        ALTER TABLE characters ADD COLUMN gender_id TEXT;
        ALTER TABLE characters ADD COLUMN sexual_orientation_id TEXT;
        ALTER TABLE characters ADD COLUMN alignment TEXT;
        ALTER TABLE characters ADD COLUMN faith_definition_id TEXT REFERENCES rule_definitions(id);
        ALTER TABLE characters ADD COLUMN appearance TEXT;
        ALTER TABLE characters ADD COLUMN biography TEXT;
        ALTER TABLE characters ADD COLUMN height TEXT;
        ALTER TABLE characters ADD COLUMN weight TEXT;
        ALTER TABLE characters ADD COLUMN eyes TEXT;
        ALTER TABLE characters ADD COLUMN hair TEXT;
        ALTER TABLE characters ADD COLUMN skin TEXT;
        ALTER TABLE characters ADD COLUMN personality_traits TEXT;
        ALTER TABLE characters ADD COLUMN ideals TEXT;
        ALTER TABLE characters ADD COLUMN bonds TEXT;
        ALTER TABLE characters ADD COLUMN flaws TEXT;
        ALTER TABLE characters ADD COLUMN notes TEXT;
        ALTER TABLE characters ADD COLUMN species_id TEXT REFERENCES rule_definitions(id);
        ALTER TABLE characters ADD COLUMN lineage_id TEXT REFERENCES rule_definitions(id);
        ALTER TABLE characters ADD COLUMN background_id TEXT REFERENCES rule_definitions(id);

        CREATE TABLE character_definition_choices (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          definition_id TEXT REFERENCES rule_definitions(id),
          value_text TEXT,
          is_override INTEGER NOT NULL DEFAULT 0 CHECK (is_override IN (0, 1)),
          metadata TEXT,
          CHECK (definition_id IS NOT NULL OR value_text IS NOT NULL OR metadata IS NOT NULL)
        ) STRICT;

        CREATE TABLE character_classes (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          class_id TEXT NOT NULL REFERENCES rule_definitions(id),
          subclass_id TEXT REFERENCES rule_definitions(id),
          level INTEGER NOT NULL CHECK (level >= 1),
          acquired_event_id TEXT REFERENCES events(id),
          UNIQUE (character_id, class_id)
        ) STRICT;

        CREATE TABLE character_ability_scores (
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          ability_id TEXT NOT NULL CHECK (
            ability_id IN ('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')
          ),
          base_score INTEGER NOT NULL,
          permanent_modifier INTEGER NOT NULL DEFAULT 0,
          override_score INTEGER,
          PRIMARY KEY (character_id, ability_id)
        ) STRICT;

        CREATE TABLE character_proficiencies (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          category TEXT NOT NULL CHECK (
            category IN ('savingThrow', 'skill', 'weapon', 'armor', 'shield', 'tool', 'language', 'custom')
          ),
          target_definition_id TEXT REFERENCES rule_definitions(id),
          custom_target TEXT,
          proficiency_level TEXT NOT NULL CHECK (
            proficiency_level IN ('none', 'half', 'proficient', 'expertise')
          ),
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          metadata TEXT,
          CHECK (target_definition_id IS NOT NULL OR custom_target IS NOT NULL)
        ) STRICT;

        CREATE TABLE character_combat_state (
          character_id TEXT PRIMARY KEY REFERENCES characters(entity_id) ON DELETE CASCADE,
          maximum_hp INTEGER NOT NULL CHECK (maximum_hp >= 0),
          current_hp INTEGER NOT NULL CHECK (current_hp >= 0),
          temporary_hp INTEGER NOT NULL DEFAULT 0 CHECK (temporary_hp >= 0),
          armor_class_base INTEGER NOT NULL DEFAULT 10,
          armor_class_modifier INTEGER NOT NULL DEFAULT 0,
          armor_class_override INTEGER,
          initiative_modifier INTEGER NOT NULL DEFAULT 0,
          death_save_successes INTEGER NOT NULL DEFAULT 0 CHECK (death_save_successes BETWEEN 0 AND 3),
          death_save_failures INTEGER NOT NULL DEFAULT 0 CHECK (death_save_failures BETWEEN 0 AND 3),
          inspiration INTEGER NOT NULL DEFAULT 0 CHECK (inspiration IN (0, 1)),
          CHECK (current_hp <= maximum_hp)
        ) STRICT;

        CREATE TABLE character_hit_die_pools (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          die_size INTEGER NOT NULL CHECK (die_size IN (4, 6, 8, 10, 12, 20)),
          current_value INTEGER NOT NULL CHECK (current_value >= 0),
          maximum_value INTEGER NOT NULL CHECK (maximum_value >= 0),
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          CHECK (current_value <= maximum_value)
        ) STRICT;

        CREATE TABLE character_movements (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          movement_type TEXT NOT NULL CHECK (
            movement_type IN ('walk', 'fly', 'swim', 'climb', 'burrow', 'custom')
          ),
          distance REAL NOT NULL CHECK (distance >= 0),
          unit TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          condition_text TEXT
        ) STRICT;

        CREATE TABLE character_senses (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          sense_type TEXT NOT NULL CHECK (
            sense_type IN ('darkvision', 'blindsight', 'tremorsense', 'truesight', 'custom')
          ),
          range_value REAL,
          unit TEXT,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL
        ) STRICT;

        CREATE TABLE character_defenses (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          defense_type TEXT NOT NULL CHECK (
            defense_type IN ('damageResistance', 'damageImmunity', 'damageVulnerability', 'conditionImmunity')
          ),
          definition_id TEXT NOT NULL REFERENCES rule_definitions(id),
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL
        ) STRICT;

        CREATE TABLE character_features (
          id TEXT PRIMARY KEY,
          definition_id TEXT REFERENCES rule_definitions(id),
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          acquired_event_id TEXT REFERENCES events(id),
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          custom_name TEXT,
          custom_description TEXT,
          choices TEXT,
          metadata TEXT,
          CHECK (definition_id IS NOT NULL OR custom_name IS NOT NULL)
        ) STRICT;

        CREATE TABLE entity_resources (
          id TEXT PRIMARY KEY,
          owner_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          resource_type TEXT NOT NULL,
          current_value REAL NOT NULL,
          maximum_value REAL NOT NULL,
          reset_rule TEXT NOT NULL CHECK (
            reset_rule IN ('shortRest', 'longRest', 'shortOrLongRest', 'dawn', 'manual', 'custom')
          ),
          source_definition_id TEXT REFERENCES rule_definitions(id),
          source_feature_id TEXT REFERENCES character_features(id),
          metadata TEXT,
          CHECK (current_value >= 0 AND maximum_value >= 0 AND current_value <= maximum_value)
        ) STRICT;

        CREATE TABLE entity_actions (
          id TEXT PRIMARY KEY,
          owner_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          action_type TEXT NOT NULL CHECK (
            action_type IN ('action', 'bonusAction', 'reaction', 'freeAction', 'special')
          ),
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          mechanics TEXT NOT NULL
        ) STRICT;

        CREATE TABLE spellcasting_sources (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          source_type TEXT NOT NULL,
          source_id TEXT NOT NULL,
          spellcasting_ability_id TEXT NOT NULL CHECK (
            spellcasting_ability_id IN ('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')
          ),
          mechanism TEXT NOT NULL,
          attack_modifier INTEGER NOT NULL DEFAULT 0,
          dc_modifier INTEGER NOT NULL DEFAULT 0,
          metadata TEXT
        ) STRICT;

        CREATE TABLE character_spells (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          spell_id TEXT NOT NULL REFERENCES rule_definitions(id),
          spellcasting_source_id TEXT NOT NULL REFERENCES spellcasting_sources(id) ON DELETE CASCADE,
          known INTEGER NOT NULL CHECK (known IN (0, 1)),
          prepared INTEGER NOT NULL CHECK (prepared IN (0, 1)),
          always_prepared INTEGER NOT NULL CHECK (always_prepared IN (0, 1)),
          ritual_available INTEGER NOT NULL CHECK (ritual_available IN (0, 1)),
          custom_notes TEXT,
          acquired_event_id TEXT REFERENCES events(id),
          UNIQUE (character_id, spell_id, spellcasting_source_id)
        ) STRICT;

        CREATE TABLE spell_slot_pools (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          spellcasting_source_id TEXT REFERENCES spellcasting_sources(id) ON DELETE CASCADE,
          pool_type TEXT NOT NULL,
          slot_level INTEGER NOT NULL CHECK (slot_level >= 0),
          current_value INTEGER NOT NULL CHECK (current_value >= 0),
          maximum_value INTEGER NOT NULL CHECK (maximum_value >= 0),
          reset_rule TEXT NOT NULL CHECK (
            reset_rule IN ('shortRest', 'longRest', 'shortOrLongRest', 'dawn', 'manual', 'custom')
          ),
          CHECK (current_value <= maximum_value)
        ) STRICT;

        CREATE TABLE active_effects (
          id TEXT PRIMARY KEY,
          target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          definition_id TEXT REFERENCES rule_definitions(id),
          source_entity_id TEXT REFERENCES entities(id),
          source_feature_id TEXT REFERENCES character_features(id),
          source_spell_id TEXT REFERENCES rule_definitions(id),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          start_event_id TEXT NOT NULL REFERENCES events(id),
          end_event_id TEXT REFERENCES events(id),
          duration_type TEXT NOT NULL,
          duration_value REAL,
          remaining_duration REAL,
          concentration INTEGER NOT NULL DEFAULT 0 CHECK (concentration IN (0, 1)),
          modifiers TEXT NOT NULL DEFAULT '[]',
          metadata TEXT
        ) STRICT;

        CREATE INDEX active_effects_target_active_idx
          ON active_effects(target_entity_id, end_event_id);

        CREATE TABLE character_concentration (
          character_id TEXT PRIMARY KEY REFERENCES characters(entity_id) ON DELETE CASCADE,
          effect_id TEXT NOT NULL UNIQUE REFERENCES active_effects(id) ON DELETE CASCADE
        ) STRICT;

        CREATE TABLE state_change_history (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          state_type TEXT NOT NULL,
          state_key TEXT NOT NULL,
          before_value TEXT,
          after_value TEXT,
          metadata TEXT,
          recorded_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX state_change_history_event_idx
          ON state_change_history(entity_id, event_id);
      `);
    },
  },
];

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;
