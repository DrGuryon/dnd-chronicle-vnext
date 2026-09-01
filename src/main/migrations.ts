import type { DatabaseSync } from 'node:sqlite';
import { seedBuiltInRuleDefinitions } from '../rules/builtin-catalog';

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
  {
    version: 4,
    name: 'create_character_panel_preferences',
    up(database) {
      database.exec(`
        CREATE TABLE character_panel_preferences (
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          section_order TEXT NOT NULL,
          collapsed_sections TEXT NOT NULL,
          panel_width INTEGER NOT NULL CHECK (panel_width BETWEEN 300 AND 720),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (campaign_id, character_id)
        ) STRICT;

        CREATE UNIQUE INDEX character_panel_preferences_character_idx
          ON character_panel_preferences(character_id);
      `);
    },
  },
  {
    version: 5,
    name: 'create_chronicle_engine',
    up(database) {
      database.exec(`
        CREATE TABLE conversations (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX conversations_campaign_updated_idx
          ON conversations(campaign_id, updated_at DESC);

        CREATE TABLE conversation_messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
          content TEXT NOT NULL CHECK (length(trim(content)) > 0),
          created_at TEXT NOT NULL,
          related_event_id TEXT REFERENCES events(id) DEFERRABLE INITIALLY DEFERRED,
          metadata TEXT,
          UNIQUE (conversation_id, sequence)
        ) STRICT;

        CREATE INDEX conversation_messages_campaign_idx
          ON conversation_messages(campaign_id, created_at DESC);
        CREATE INDEX conversation_messages_conversation_sequence_idx
          ON conversation_messages(conversation_id, sequence DESC);
        CREATE INDEX conversation_messages_related_event_idx
          ON conversation_messages(related_event_id)
          WHERE related_event_id IS NOT NULL;

        CREATE TABLE campaign_runtime_state (
          campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
          active_player_character_id TEXT REFERENCES characters(entity_id),
          active_conversation_id TEXT REFERENCES conversations(id),
          active_scene_location_id TEXT REFERENCES locations(entity_id),
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX campaign_runtime_active_character_idx
          ON campaign_runtime_state(active_player_character_id)
          WHERE active_player_character_id IS NOT NULL;

        CREATE TABLE scene_participants (
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          participant_role TEXT NOT NULL CHECK (length(trim(participant_role)) > 0),
          added_at TEXT NOT NULL,
          PRIMARY KEY (campaign_id, entity_id)
        ) STRICT;

        CREATE INDEX scene_participants_campaign_role_idx
          ON scene_participants(campaign_id, participant_role, added_at);

        CREATE TABLE event_entity_references (
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK (length(trim(role)) > 0),
          PRIMARY KEY (event_id, entity_id, role)
        ) STRICT;

        CREATE INDEX event_entity_references_entity_idx
          ON event_entity_references(entity_id, event_id);

        CREATE TABLE message_entity_references (
          message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
          entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'subject' CHECK (length(trim(role)) > 0),
          PRIMARY KEY (message_id, entity_id, role)
        ) STRICT;

        CREATE INDEX message_entity_references_entity_idx
          ON message_entity_references(entity_id, message_id);

        CREATE TABLE turn_transactions (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE RESTRICT,
          source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          source_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          payload_hash TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX turn_transactions_campaign_created_idx
          ON turn_transactions(campaign_id, created_at DESC);

        CREATE TABLE chronicle_tool_invocations (
          id INTEGER PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          input_hash TEXT NOT NULL,
          output_truncated INTEGER NOT NULL DEFAULT 0 CHECK (output_truncated IN (0, 1)),
          status TEXT NOT NULL CHECK (status IN ('success', 'validation_error', 'failure')),
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX chronicle_tool_invocations_campaign_created_idx
          ON chronicle_tool_invocations(campaign_id, created_at DESC);

        ALTER TABLE knowledge_records
          ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'world'
          CHECK (visibility_scope IN ('world', 'public', 'observer'));

        UPDATE knowledge_records
        SET visibility_scope = 'observer'
        WHERE observer_entity_id IS NOT NULL;

        ALTER TABLE entities ADD COLUMN normalized_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE entity_aliases ADD COLUMN normalized_alias TEXT NOT NULL DEFAULT '';

        UPDATE entities SET normalized_name = chronicle_normalize(name);
        UPDATE entity_aliases SET normalized_alias = chronicle_normalize(alias);

        CREATE TRIGGER entities_normalized_name_insert AFTER INSERT ON entities BEGIN
          UPDATE entities SET normalized_name = chronicle_normalize(new.name) WHERE id = new.id;
        END;
        CREATE TRIGGER entities_normalized_name_update AFTER UPDATE OF name ON entities BEGIN
          UPDATE entities SET normalized_name = chronicle_normalize(new.name) WHERE id = new.id;
        END;
        CREATE TRIGGER entity_aliases_normalized_insert AFTER INSERT ON entity_aliases BEGIN
          UPDATE entity_aliases SET normalized_alias = chronicle_normalize(new.alias) WHERE id = new.id;
        END;
        CREATE TRIGGER entity_aliases_normalized_update AFTER UPDATE OF alias ON entity_aliases BEGIN
          UPDATE entity_aliases SET normalized_alias = chronicle_normalize(new.alias) WHERE id = new.id;
        END;

        CREATE INDEX entities_normalized_lookup_idx
          ON entities(campaign_id, entity_type, normalized_name);
        CREATE INDEX entity_aliases_normalized_lookup_idx
          ON entity_aliases(normalized_alias, used_by_entity_id, to_event_id);

        CREATE INDEX knowledge_visibility_lookup_idx
          ON knowledge_records(
            campaign_id, subject_entity_id, visibility_scope, observer_entity_id, to_event_id
          );

        CREATE INDEX entity_aliases_lookup_idx
          ON entity_aliases(alias COLLATE NOCASE, used_by_entity_id, to_event_id);

        CREATE VIRTUAL TABLE campaign_search_fts USING fts5(
          kind UNINDEXED,
          record_id UNINDEXED,
          campaign_id UNINDEXED,
          title,
          body,
          tokenize = 'unicode61 remove_diacritics 2'
        );

        CREATE TRIGGER campaign_search_entity_insert AFTER INSERT ON entities BEGIN
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES ('entity', new.id, new.campaign_id, new.name, new.description);
        END;
        CREATE TRIGGER campaign_search_entity_update AFTER UPDATE OF name, description ON entities BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'entity' AND record_id = old.id;
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES ('entity', new.id, new.campaign_id, new.name, new.description);
        END;
        CREATE TRIGGER campaign_search_entity_delete AFTER DELETE ON entities BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'entity' AND record_id = old.id;
        END;

        CREATE TRIGGER campaign_search_alias_insert AFTER INSERT ON entity_aliases BEGIN
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'entity', new.entity_id, campaign_id, new.alias, new.alias
          FROM entities WHERE id = new.entity_id;
        END;
        CREATE TRIGGER campaign_search_alias_delete AFTER DELETE ON entity_aliases BEGIN
          DELETE FROM campaign_search_fts
          WHERE kind = 'entity' AND record_id = old.entity_id AND title = old.alias;
        END;

        CREATE TRIGGER campaign_search_event_insert AFTER INSERT ON events BEGIN
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES ('event', new.id, new.campaign_id, new.summary, new.summary);
        END;
        CREATE TRIGGER campaign_search_event_delete AFTER DELETE ON events BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'event' AND record_id = old.id;
        END;

        CREATE TRIGGER campaign_search_message_insert AFTER INSERT ON conversation_messages BEGIN
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES ('message', new.id, new.campaign_id, new.role, new.content);
        END;
        CREATE TRIGGER campaign_search_message_update AFTER UPDATE OF content ON conversation_messages BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'message' AND record_id = old.id;
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES ('message', new.id, new.campaign_id, new.role, new.content);
        END;
        CREATE TRIGGER campaign_search_message_delete AFTER DELETE ON conversation_messages BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'message' AND record_id = old.id;
        END;

        CREATE TRIGGER campaign_search_knowledge_insert AFTER INSERT ON knowledge_records BEGIN
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES (
            'knowledge', new.id, new.campaign_id, new.knowledge_type,
            coalesce(new.value_text, '') || ' ' || coalesce(new.reference_entity_id, '')
          );
        END;
        CREATE TRIGGER campaign_search_knowledge_update
        AFTER UPDATE OF knowledge_type, value_text, reference_entity_id ON knowledge_records BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'knowledge' AND record_id = old.id;
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          VALUES (
            'knowledge', new.id, new.campaign_id, new.knowledge_type,
            coalesce(new.value_text, '') || ' ' || coalesce(new.reference_entity_id, '')
          );
        END;
        CREATE TRIGGER campaign_search_knowledge_delete AFTER DELETE ON knowledge_records BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'knowledge' AND record_id = old.id;
        END;

        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'entity', id, campaign_id, name, description FROM entities;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'entity', a.entity_id, e.campaign_id, a.alias, a.alias
          FROM entity_aliases a JOIN entities e ON e.id = a.entity_id;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'event', id, campaign_id, summary, summary FROM events;
        INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'knowledge', id, campaign_id, knowledge_type,
                 coalesce(value_text, '') || ' ' || coalesce(reference_entity_id, '')
          FROM knowledge_records;
      `);
    },
  },
  {
    version: 6,
    name: 'create_ai_runtime_and_actor_relationships',
    up(database) {
      database.exec(`
        CREATE TABLE campaign_ai_settings (
          campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
          provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
          model_id TEXT NOT NULL DEFAULT 'gpt-5.6-sol' CHECK (length(trim(model_id)) > 0),
          reasoning_effort TEXT NOT NULL DEFAULT 'medium'
            CHECK (reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')),
          verbosity TEXT NOT NULL DEFAULT 'medium'
            CHECK (verbosity IN ('low', 'medium', 'high')),
          max_output_tokens INTEGER NOT NULL DEFAULT 4096
            CHECK (max_output_tokens BETWEEN 256 AND 32768),
          approval_policy TEXT NOT NULL DEFAULT 'review'
            CHECK (approval_policy IN ('automatic', 'review', 'manual')),
          campaign_instructions TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO campaign_ai_settings(campaign_id, updated_at)
          SELECT id, updated_at FROM campaigns;

        CREATE TABLE ai_turn_runs (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          user_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          assistant_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          prompt_version TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('running', 'completed', 'failed', 'cancelled', 'pending_review')),
          transaction_id TEXT,
          provider_response_id TEXT,
          input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
          output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
          reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
          cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
          error_code TEXT,
          started_at TEXT NOT NULL,
          completed_at TEXT
        ) STRICT;

        CREATE INDEX ai_turn_runs_campaign_started_idx
          ON ai_turn_runs(campaign_id, started_at DESC);
        CREATE INDEX ai_turn_runs_conversation_started_idx
          ON ai_turn_runs(conversation_id, started_at DESC);

        CREATE TABLE pending_turn_proposals (
          id TEXT PRIMARY KEY,
          turn_run_id TEXT NOT NULL UNIQUE REFERENCES ai_turn_runs(id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          transaction_id TEXT NOT NULL UNIQUE,
          proposal_json TEXT NOT NULL,
          validation_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'manual')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          applied_event_id TEXT REFERENCES events(id)
        ) STRICT;

        CREATE INDEX pending_turn_proposals_campaign_status_idx
          ON pending_turn_proposals(campaign_id, status, created_at DESC);

        CREATE TABLE relationship_profiles (
          id TEXT PRIMARY KEY,
          relation_id TEXT NOT NULL REFERENCES entity_relations(id) ON DELETE CASCADE,
          visibility_scope TEXT NOT NULL CHECK (visibility_scope IN ('world', 'public', 'observer')),
          observer_entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
          current_summary TEXT NOT NULL
            CHECK (length(trim(current_summary)) > 0 AND length(current_summary) <= 600),
          history_summary TEXT CHECK (history_summary IS NULL OR length(history_summary) <= 3000),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (visibility_scope = 'observer' AND observer_entity_id IS NOT NULL)
            OR (visibility_scope <> 'observer' AND observer_entity_id IS NULL)
          )
        ) STRICT;

        CREATE UNIQUE INDEX relationship_profiles_shared_scope_idx
          ON relationship_profiles(relation_id, visibility_scope)
          WHERE observer_entity_id IS NULL;
        CREATE UNIQUE INDEX relationship_profiles_observer_scope_idx
          ON relationship_profiles(relation_id, observer_entity_id)
          WHERE visibility_scope = 'observer';
        CREATE INDEX relationship_profiles_observer_idx
          ON relationship_profiles(observer_entity_id, updated_at DESC)
          WHERE observer_entity_id IS NOT NULL;

        CREATE TABLE relationship_event_references (
          relationship_id TEXT NOT NULL REFERENCES relationship_profiles(id) ON DELETE CASCADE,
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          reference_role TEXT NOT NULL DEFAULT 'evidence' CHECK (length(trim(reference_role)) > 0),
          note TEXT CHECK (note IS NULL OR length(note) <= 500),
          sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
          PRIMARY KEY (relationship_id, event_id, reference_role)
        ) STRICT;

        CREATE INDEX relationship_event_references_event_idx
          ON relationship_event_references(event_id, relationship_id);

        CREATE TRIGGER campaign_search_relationship_insert AFTER INSERT ON relationship_profiles BEGIN
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'relationship', new.id, r.campaign_id, r.relation_type,
                 new.current_summary || ' ' || coalesce(new.history_summary, '')
          FROM entity_relations r WHERE r.id = new.relation_id;
        END;
        CREATE TRIGGER campaign_search_relationship_update
        AFTER UPDATE OF current_summary, history_summary ON relationship_profiles BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'relationship' AND record_id = old.id;
          INSERT INTO campaign_search_fts(kind, record_id, campaign_id, title, body)
          SELECT 'relationship', new.id, r.campaign_id, r.relation_type,
                 new.current_summary || ' ' || coalesce(new.history_summary, '')
          FROM entity_relations r WHERE r.id = new.relation_id;
        END;
        CREATE TRIGGER campaign_search_relationship_delete AFTER DELETE ON relationship_profiles BEGIN
          DELETE FROM campaign_search_fts WHERE kind = 'relationship' AND record_id = old.id;
        END;
      `);
    },
  },
  {
    version: 7,
    name: 'create_editable_domain_and_rules_catalog',
    up(database) {
      database.exec(`
        ALTER TABLE campaign_ai_settings RENAME TO campaign_ai_settings_v6;
        CREATE TABLE campaign_ai_settings (
          campaign_id TEXT PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
          provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
          model_id TEXT NOT NULL DEFAULT 'gpt-5.6-sol' CHECK (length(trim(model_id)) > 0),
          reasoning_effort TEXT NOT NULL DEFAULT 'medium'
            CHECK (reasoning_effort IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max')),
          verbosity TEXT NOT NULL DEFAULT 'medium' CHECK (verbosity IN ('low', 'medium', 'high')),
          max_output_tokens INTEGER NOT NULL DEFAULT 4096 CHECK (max_output_tokens BETWEEN 256 AND 32768),
          approval_policy TEXT NOT NULL DEFAULT 'review' CHECK (approval_policy IN ('automatic', 'review', 'manual')),
          campaign_instructions TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        ) STRICT;
        INSERT INTO campaign_ai_settings SELECT * FROM campaign_ai_settings_v6;
        DROP TABLE campaign_ai_settings_v6;

        ALTER TABLE entities ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);

        ALTER TABLE rule_definitions ADD COLUMN campaign_id TEXT REFERENCES campaigns(id) ON DELETE CASCADE;
        ALTER TABLE rule_definitions ADD COLUMN canonical_id TEXT;
        ALTER TABLE rule_definitions ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
        ALTER TABLE rule_definitions ADD COLUMN pack_id TEXT;
        ALTER TABLE rule_definitions ADD COLUMN pack_version TEXT NOT NULL DEFAULT 'legacy';
        ALTER TABLE rule_definitions ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
        ALTER TABLE rule_definitions ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0
          CHECK (is_builtin IN (0, 1));

        CREATE UNIQUE INDEX rule_definitions_canonical_idx
          ON rule_definitions(canonical_id) WHERE canonical_id IS NOT NULL;
        CREATE INDEX rule_definitions_catalog_search_idx
          ON rule_definitions(ruleset_id, ruleset_version, definition_type, is_builtin, name);
        CREATE INDEX rule_definitions_campaign_homebrew_idx
          ON rule_definitions(campaign_id, definition_type, name)
          WHERE campaign_id IS NOT NULL;

        CREATE TABLE data_change_transactions (
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          origin TEXT NOT NULL CHECK (origin IN ('manual', 'ai', 'system')),
          summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
          payload_hash TEXT NOT NULL,
          result_json TEXT NOT NULL,
          source_run_id TEXT REFERENCES ai_turn_runs(id) ON DELETE SET NULL,
          source_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL
        ) STRICT;

        CREATE INDEX data_change_transactions_campaign_created_idx
          ON data_change_transactions(campaign_id, created_at DESC);

        CREATE TABLE data_change_audit_items (
          id INTEGER PRIMARY KEY,
          transaction_id TEXT NOT NULL REFERENCES data_change_transactions(id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL CHECK (sequence > 0),
          change_type TEXT NOT NULL,
          entity_id TEXT,
          before_json TEXT,
          after_json TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (transaction_id, sequence)
        ) STRICT;

        CREATE INDEX data_change_audit_items_entity_idx
          ON data_change_audit_items(entity_id, created_at DESC)
          WHERE entity_id IS NOT NULL;

        CREATE TABLE pending_data_change_proposals (
          id TEXT PRIMARY KEY,
          turn_run_id TEXT NOT NULL UNIQUE REFERENCES ai_turn_runs(id) ON DELETE CASCADE,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          transaction_id TEXT NOT NULL UNIQUE,
          proposal_json TEXT NOT NULL,
          validation_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'manual')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          applied_transaction_id TEXT REFERENCES data_change_transactions(id)
        ) STRICT;

        CREATE INDEX pending_data_change_proposals_campaign_status_idx
          ON pending_data_change_proposals(campaign_id, status, created_at DESC);

        CREATE TABLE rule_reference_reconciliations (
          id INTEGER PRIMARY KEY,
          campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          character_id TEXT NOT NULL REFERENCES characters(entity_id) ON DELETE CASCADE,
          old_definition_id TEXT NOT NULL REFERENCES rule_definitions(id),
          new_definition_id TEXT NOT NULL REFERENCES rule_definitions(id),
          category TEXT NOT NULL,
          transaction_id TEXT NOT NULL REFERENCES data_change_transactions(id) DEFERRABLE INITIALLY DEFERRED,
          created_at TEXT NOT NULL,
          UNIQUE (character_id, old_definition_id, new_definition_id, category)
        ) STRICT;
      `);

      seedBuiltInRuleDefinitions(database);

      database.exec(`
        CREATE TRIGGER rule_definitions_builtin_update
        BEFORE UPDATE ON rule_definitions WHEN old.is_builtin = 1 BEGIN
          SELECT RAISE(ABORT, 'Vestavěnou definici nelze upravit.');
        END;
        CREATE TRIGGER rule_definitions_builtin_delete
        BEFORE DELETE ON rule_definitions WHEN old.is_builtin = 1 BEGIN
          SELECT RAISE(ABORT, 'Vestavěnou definici nelze odstranit.');
        END;
      `);
    },
  },
];

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;
