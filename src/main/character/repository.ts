import type { DatabaseSync } from 'node:sqlite';
import type {
  AbilityId,
  AbilityScoreState,
  ActiveEffect,
  CharacterAction,
  CharacterBiography,
  CharacterChoice,
  CharacterClass,
  CharacterCombatState,
  CharacterDefense,
  CharacterFeature,
  CharacterMovement,
  CharacterOrigin,
  CharacterProficiency,
  CharacterSense,
  CharacterSpell,
  EffectModifier,
  EntityResource,
  HitDiePool,
  RuleDefinition,
  SpellcastingSource,
  SpellSlotPool,
  StateChangeRecord,
} from '../../domain/character-models';

export class SqliteCharacterRepository {
  constructor(private readonly database: DatabaseSync) {}

  insertDefinition(definition: RuleDefinition): void {
    this.database.prepare(`
      INSERT INTO rule_definitions(
        id, definition_type, ruleset_id, ruleset_version, name, description,
        source, origin, metadata, is_homebrew, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      definition.id, definition.definitionType, definition.rulesetId,
      definition.rulesetVersion, definition.name, definition.description,
      definition.source, definition.origin, json(definition.metadata),
      integer(definition.homebrew), definition.createdAt, definition.updatedAt,
    );
  }

  getDefinition(id: string): RuleDefinition | undefined {
    const row = this.database.prepare(`
      SELECT id, definition_type AS definitionType, ruleset_id AS rulesetId,
             ruleset_version AS rulesetVersion, name, description, source, origin,
             metadata, is_homebrew AS homebrew, created_at AS createdAt,
             updated_at AS updatedAt
      FROM rule_definitions WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? mapDefinition(row) : undefined;
  }

  listDefinitions(filters: {
    rulesetId?: string;
    rulesetVersion?: string;
    definitionType?: string;
  } = {}): RuleDefinition[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filters.rulesetId) {
      clauses.push('ruleset_id = ?');
      values.push(filters.rulesetId);
    }
    if (filters.rulesetVersion) {
      clauses.push('ruleset_version = ?');
      values.push(filters.rulesetVersion);
    }
    if (filters.definitionType) {
      clauses.push('definition_type = ?');
      values.push(filters.definitionType);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.database.prepare(`
      SELECT id, definition_type AS definitionType, ruleset_id AS rulesetId,
             ruleset_version AS rulesetVersion, name, description, source, origin,
             metadata, is_homebrew AS homebrew, created_at AS createdAt,
             updated_at AS updatedAt
      FROM rule_definitions ${where} ORDER BY name, id
    `).all(...values) as unknown as Array<Record<string, unknown>>;
    return rows.map(mapDefinition);
  }

  updateBiography(value: CharacterBiography): void {
    this.database.prepare(`
      UPDATE characters SET
        age = ?, birth_date = ?, sex_id = ?, gender_id = ?, sexual_orientation_id = ?,
        alignment = ?, faith_definition_id = ?, appearance = ?, biography = ?, height = ?,
        weight = ?, eyes = ?, hair = ?, skin = ?, personality_traits = ?, ideals = ?,
        bonds = ?, flaws = ?, notes = ?
      WHERE entity_id = ?
    `).run(
      value.age, value.birthDate, value.sexId, value.genderId, value.sexualOrientationId,
      value.alignment, value.faithDefinitionId, value.appearance, value.biography,
      value.height, value.weight, value.eyes, value.hair, value.skin,
      value.personalityTraits, value.ideals, value.bonds, value.flaws, value.notes,
      value.characterId,
    );
  }

  getBiography(characterId: string): CharacterBiography | undefined {
    return this.database.prepare(`
      SELECT entity_id AS characterId, age, birth_date AS birthDate, sex_id AS sexId,
             gender_id AS genderId, sexual_orientation_id AS sexualOrientationId,
             alignment, faith_definition_id AS faithDefinitionId, appearance, biography,
             height, weight, eyes, hair, skin, personality_traits AS personalityTraits,
             ideals, bonds, flaws, notes
      FROM characters WHERE entity_id = ?
    `).get(characterId) as unknown as CharacterBiography | undefined;
  }

  updateOrigin(value: CharacterOrigin): void {
    this.database.prepare(`
      UPDATE characters SET species_id = ?, lineage_id = ?, background_id = ?
      WHERE entity_id = ?
    `).run(value.speciesId, value.lineageId, value.backgroundId, value.characterId);
  }

  getOrigin(characterId: string): CharacterOrigin | undefined {
    return this.database.prepare(`
      SELECT entity_id AS characterId, species_id AS speciesId, lineage_id AS lineageId,
             background_id AS backgroundId
      FROM characters WHERE entity_id = ?
    `).get(characterId) as unknown as CharacterOrigin | undefined;
  }

  insertChoice(value: CharacterChoice): void {
    this.database.prepare(`
      INSERT INTO character_definition_choices(
        id, character_id, category, definition_id, value_text, is_override, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.category, value.definitionId, value.value,
      integer(value.override), json(value.metadata),
    );
  }

  listChoices(characterId: string): CharacterChoice[] {
    const rows = this.database.prepare(`
      SELECT id, character_id AS characterId, category, definition_id AS definitionId,
             value_text AS value, is_override AS override, metadata
      FROM character_definition_choices WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      override: Boolean(row.override),
      metadata: parseObject(row.metadata),
    } as unknown as CharacterChoice));
  }

  insertClass(value: CharacterClass): void {
    this.database.prepare(`
      INSERT INTO character_classes(
        id, character_id, class_id, subclass_id, level, acquired_event_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.classId, value.subclassId,
      value.level, value.acquiredEventId,
    );
  }

  listClasses(characterId: string): CharacterClass[] {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, class_id AS classId,
             subclass_id AS subclassId, level, acquired_event_id AS acquiredEventId
      FROM character_classes WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as CharacterClass[];
  }

  getTotalLevel(characterId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(SUM(level), 0) AS totalLevel
      FROM character_classes WHERE character_id = ?
    `).get(characterId) as unknown as { totalLevel: number };
    return row.totalLevel;
  }

  upsertAbility(value: AbilityScoreState): void {
    this.database.prepare(`
      INSERT INTO character_ability_scores(
        character_id, ability_id, base_score, permanent_modifier, override_score
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(character_id, ability_id) DO UPDATE SET
        base_score = excluded.base_score,
        permanent_modifier = excluded.permanent_modifier,
        override_score = excluded.override_score
    `).run(
      value.characterId, value.abilityId, value.baseScore,
      value.permanentModifier, value.overrideScore,
    );
  }

  getAbility(characterId: string, abilityId: AbilityId): AbilityScoreState | undefined {
    return this.database.prepare(`
      SELECT character_id AS characterId, ability_id AS abilityId, base_score AS baseScore,
             permanent_modifier AS permanentModifier, override_score AS overrideScore
      FROM character_ability_scores WHERE character_id = ? AND ability_id = ?
    `).get(characterId, abilityId) as unknown as AbilityScoreState | undefined;
  }

  insertProficiency(value: CharacterProficiency): void {
    this.database.prepare(`
      INSERT INTO character_proficiencies(
        id, character_id, category, target_definition_id, custom_target,
        proficiency_level, source_type, source_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.category, value.targetDefinitionId,
      value.customTarget, value.level, value.sourceType, value.sourceId, json(value.metadata),
    );
  }

  getProficiency(id: string): CharacterProficiency | undefined {
    const row = this.database.prepare(`
      SELECT id, character_id AS characterId, category,
             target_definition_id AS targetDefinitionId, custom_target AS customTarget,
             proficiency_level AS level, source_type AS sourceType, source_id AS sourceId,
             metadata
      FROM character_proficiencies WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? { ...row, metadata: parseObject(row.metadata) } as unknown as CharacterProficiency : undefined;
  }

  listProficiencies(characterId: string): CharacterProficiency[] {
    const rows = this.database.prepare(`
      SELECT id, character_id AS characterId, category,
             target_definition_id AS targetDefinitionId, custom_target AS customTarget,
             proficiency_level AS level, source_type AS sourceType, source_id AS sourceId,
             metadata
      FROM character_proficiencies WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      metadata: parseObject(row.metadata),
    } as unknown as CharacterProficiency));
  }

  upsertCombatState(value: CharacterCombatState): void {
    this.database.prepare(`
      INSERT INTO character_combat_state(
        character_id, maximum_hp, current_hp, temporary_hp, armor_class_base,
        armor_class_modifier, armor_class_override, initiative_modifier,
        death_save_successes, death_save_failures, inspiration
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character_id) DO UPDATE SET
        maximum_hp = excluded.maximum_hp, current_hp = excluded.current_hp,
        temporary_hp = excluded.temporary_hp, armor_class_base = excluded.armor_class_base,
        armor_class_modifier = excluded.armor_class_modifier,
        armor_class_override = excluded.armor_class_override,
        initiative_modifier = excluded.initiative_modifier,
        death_save_successes = excluded.death_save_successes,
        death_save_failures = excluded.death_save_failures,
        inspiration = excluded.inspiration
    `).run(
      value.characterId, value.maximumHp, value.currentHp, value.temporaryHp,
      value.armorClassBase, value.armorClassModifier, value.armorClassOverride,
      value.initiativeModifier, value.deathSaveSuccesses, value.deathSaveFailures,
      integer(value.inspiration),
    );
  }

  getCombatState(characterId: string): CharacterCombatState | undefined {
    const row = this.database.prepare(`
      SELECT character_id AS characterId, maximum_hp AS maximumHp, current_hp AS currentHp,
             temporary_hp AS temporaryHp, armor_class_base AS armorClassBase,
             armor_class_modifier AS armorClassModifier,
             armor_class_override AS armorClassOverride,
             initiative_modifier AS initiativeModifier,
             death_save_successes AS deathSaveSuccesses,
             death_save_failures AS deathSaveFailures, inspiration
      FROM character_combat_state WHERE character_id = ?
    `).get(characterId) as unknown as Record<string, unknown> | undefined;
    return row ? { ...row, inspiration: Boolean(row.inspiration) } as unknown as CharacterCombatState : undefined;
  }

  insertHitDiePool(value: HitDiePool): void {
    this.database.prepare(`
      INSERT INTO character_hit_die_pools(
        id, character_id, die_size, current_value, maximum_value, source_type, source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.dieSize, value.current,
      value.maximum, value.sourceType, value.sourceId,
    );
  }

  getHitDiePool(id: string): HitDiePool | undefined {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, die_size AS dieSize,
             current_value AS current, maximum_value AS maximum,
             source_type AS sourceType, source_id AS sourceId
      FROM character_hit_die_pools WHERE id = ?
    `).get(id) as unknown as HitDiePool | undefined;
  }

  listHitDiePools(characterId: string): HitDiePool[] {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, die_size AS dieSize,
             current_value AS current, maximum_value AS maximum,
             source_type AS sourceType, source_id AS sourceId
      FROM character_hit_die_pools WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as HitDiePool[];
  }

  updateHitDieCurrent(id: string, current: number): void {
    this.database.prepare(
      'UPDATE character_hit_die_pools SET current_value = ? WHERE id = ?',
    ).run(current, id);
  }

  insertMovement(value: CharacterMovement): void {
    this.database.prepare(`
      INSERT INTO character_movements(
        id, character_id, movement_type, distance, unit, source_type, source_id, condition_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.movementType, value.distance, value.unit,
      value.sourceType, value.sourceId, value.condition,
    );
  }

  listMovements(characterId: string): CharacterMovement[] {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, movement_type AS movementType,
             distance, unit, source_type AS sourceType, source_id AS sourceId,
             condition_text AS condition
      FROM character_movements WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as CharacterMovement[];
  }

  insertSense(value: CharacterSense): void {
    this.database.prepare(`
      INSERT INTO character_senses(
        id, character_id, sense_type, range_value, unit, source_type, source_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.senseType, value.range,
      value.unit, value.sourceType, value.sourceId,
    );
  }

  listSenses(characterId: string): CharacterSense[] {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, sense_type AS senseType,
             range_value AS range, unit, source_type AS sourceType, source_id AS sourceId
      FROM character_senses WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as CharacterSense[];
  }

  insertDefense(value: CharacterDefense): void {
    this.database.prepare(`
      INSERT INTO character_defenses(
        id, character_id, defense_type, definition_id, source_type, source_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.defenseType, value.definitionId,
      value.sourceType, value.sourceId,
    );
  }

  listDefenses(characterId: string): CharacterDefense[] {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, defense_type AS defenseType,
             definition_id AS definitionId, source_type AS sourceType, source_id AS sourceId
      FROM character_defenses WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as CharacterDefense[];
  }

  insertFeature(value: CharacterFeature): void {
    this.database.prepare(`
      INSERT INTO character_features(
        id, definition_id, character_id, source_type, source_id, acquired_event_id,
        enabled, custom_name, custom_description, choices, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.definitionId, value.characterId, value.sourceType, value.sourceId,
      value.acquiredEventId, integer(value.enabled), value.customName,
      value.customDescription, json(value.choices), json(value.metadata),
    );
  }

  listFeatures(characterId: string): CharacterFeature[] {
    const rows = this.database.prepare(`
      SELECT id, definition_id AS definitionId, character_id AS characterId,
             source_type AS sourceType, source_id AS sourceId,
             acquired_event_id AS acquiredEventId, enabled, custom_name AS customName,
             custom_description AS customDescription, choices, metadata
      FROM character_features WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      choices: parseObject(row.choices),
      metadata: parseObject(row.metadata),
    } as unknown as CharacterFeature));
  }

  getFeature(id: string): CharacterFeature | undefined {
    const row = this.database.prepare(`
      SELECT id, definition_id AS definitionId, character_id AS characterId,
             source_type AS sourceType, source_id AS sourceId,
             acquired_event_id AS acquiredEventId, enabled, custom_name AS customName,
             custom_description AS customDescription, choices, metadata
      FROM character_features WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? {
      ...row,
      enabled: Boolean(row.enabled),
      choices: parseObject(row.choices),
      metadata: parseObject(row.metadata),
    } as unknown as CharacterFeature : undefined;
  }

  insertResource(value: EntityResource): void {
    this.database.prepare(`
      INSERT INTO entity_resources(
        id, owner_entity_id, name, resource_type, current_value, maximum_value,
        reset_rule, source_definition_id, source_feature_id, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.ownerEntityId, value.name, value.resourceType, value.current,
      value.maximum, value.resetRule, value.sourceDefinitionId,
      value.sourceFeatureId, json(value.metadata),
    );
  }

  getResource(id: string): EntityResource | undefined {
    const row = this.database.prepare(`
      SELECT id, owner_entity_id AS ownerEntityId, name, resource_type AS resourceType,
             current_value AS current, maximum_value AS maximum, reset_rule AS resetRule,
             source_definition_id AS sourceDefinitionId,
             source_feature_id AS sourceFeatureId, metadata
      FROM entity_resources WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? { ...row, metadata: parseObject(row.metadata) } as unknown as EntityResource : undefined;
  }

  listResources(ownerEntityId: string): EntityResource[] {
    const rows = this.database.prepare(`
      SELECT id, owner_entity_id AS ownerEntityId, name, resource_type AS resourceType,
             current_value AS current, maximum_value AS maximum, reset_rule AS resetRule,
             source_definition_id AS sourceDefinitionId,
             source_feature_id AS sourceFeatureId, metadata
      FROM entity_resources WHERE owner_entity_id = ? ORDER BY rowid
    `).all(ownerEntityId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row, metadata: parseObject(row.metadata) } as unknown as EntityResource));
  }

  updateResourceCurrent(id: string, current: number): void {
    this.database.prepare('UPDATE entity_resources SET current_value = ? WHERE id = ?').run(current, id);
  }

  insertAction(value: CharacterAction): void {
    this.database.prepare(`
      INSERT INTO entity_actions(
        id, owner_entity_id, name, action_type, source_type, source_id, mechanics
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.ownerEntityId, value.name, value.actionType,
      value.sourceType, value.sourceId, JSON.stringify(value.mechanics),
    );
  }

  listActions(ownerEntityId: string): CharacterAction[] {
    const rows = this.database.prepare(`
      SELECT id, owner_entity_id AS ownerEntityId, name, action_type AS actionType,
             source_type AS sourceType, source_id AS sourceId, mechanics
      FROM entity_actions WHERE owner_entity_id = ? ORDER BY rowid
    `).all(ownerEntityId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      mechanics: JSON.parse(String(row.mechanics)),
    } as unknown as CharacterAction));
  }

  getAction(id: string): CharacterAction | undefined {
    const row = this.database.prepare(`
      SELECT id, owner_entity_id AS ownerEntityId, name, action_type AS actionType,
             source_type AS sourceType, source_id AS sourceId, mechanics
      FROM entity_actions WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? {
      ...row,
      mechanics: JSON.parse(String(row.mechanics)),
    } as unknown as CharacterAction : undefined;
  }

  insertSpellcastingSource(value: SpellcastingSource): void {
    this.database.prepare(`
      INSERT INTO spellcasting_sources(
        id, character_id, source_type, source_id, spellcasting_ability_id,
        mechanism, attack_modifier, dc_modifier, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.sourceType, value.sourceId,
      value.spellcastingAbilityId, value.mechanism, value.attackModifier,
      value.dcModifier, json(value.metadata),
    );
  }

  listSpellcastingSources(characterId: string): SpellcastingSource[] {
    const rows = this.database.prepare(`
      SELECT id, character_id AS characterId, source_type AS sourceType,
             source_id AS sourceId, spellcasting_ability_id AS spellcastingAbilityId,
             mechanism, attack_modifier AS attackModifier, dc_modifier AS dcModifier, metadata
      FROM spellcasting_sources WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({ ...row, metadata: parseObject(row.metadata) } as unknown as SpellcastingSource));
  }

  getSpellcastingSource(id: string): SpellcastingSource | undefined {
    const row = this.database.prepare(`
      SELECT id, character_id AS characterId, source_type AS sourceType,
             source_id AS sourceId, spellcasting_ability_id AS spellcastingAbilityId,
             mechanism, attack_modifier AS attackModifier, dc_modifier AS dcModifier, metadata
      FROM spellcasting_sources WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row
      ? { ...row, metadata: parseObject(row.metadata) } as unknown as SpellcastingSource
      : undefined;
  }

  insertSpell(value: CharacterSpell): void {
    this.database.prepare(`
      INSERT INTO character_spells(
        id, character_id, spell_id, spellcasting_source_id, known, prepared,
        always_prepared, ritual_available, custom_notes, acquired_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.spellId, value.spellcastingSourceId,
      integer(value.known), integer(value.prepared), integer(value.alwaysPrepared),
      integer(value.ritualAvailable), value.customNotes, value.acquiredEventId,
    );
  }

  listSpells(characterId: string): CharacterSpell[] {
    const rows = this.database.prepare(`
      SELECT id, character_id AS characterId, spell_id AS spellId,
             spellcasting_source_id AS spellcastingSourceId, known, prepared,
             always_prepared AS alwaysPrepared, ritual_available AS ritualAvailable,
             custom_notes AS customNotes, acquired_event_id AS acquiredEventId
      FROM character_spells WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      known: Boolean(row.known),
      prepared: Boolean(row.prepared),
      alwaysPrepared: Boolean(row.alwaysPrepared),
      ritualAvailable: Boolean(row.ritualAvailable),
    } as unknown as CharacterSpell));
  }

  insertSlotPool(value: SpellSlotPool): void {
    this.database.prepare(`
      INSERT INTO spell_slot_pools(
        id, character_id, spellcasting_source_id, pool_type, slot_level,
        current_value, maximum_value, reset_rule
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.characterId, value.spellcastingSourceId, value.poolType,
      value.slotLevel, value.current, value.maximum, value.resetRule,
    );
  }

  getSlotPool(id: string): SpellSlotPool | undefined {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, spellcasting_source_id AS spellcastingSourceId,
             pool_type AS poolType, slot_level AS slotLevel, current_value AS current,
             maximum_value AS maximum, reset_rule AS resetRule
      FROM spell_slot_pools WHERE id = ?
    `).get(id) as unknown as SpellSlotPool | undefined;
  }

  listSlotPools(characterId: string): SpellSlotPool[] {
    return this.database.prepare(`
      SELECT id, character_id AS characterId, spellcasting_source_id AS spellcastingSourceId,
             pool_type AS poolType, slot_level AS slotLevel, current_value AS current,
             maximum_value AS maximum, reset_rule AS resetRule
      FROM spell_slot_pools WHERE character_id = ? ORDER BY rowid
    `).all(characterId) as unknown as SpellSlotPool[];
  }

  updateSlotPoolCurrent(id: string, current: number): void {
    this.database.prepare('UPDATE spell_slot_pools SET current_value = ? WHERE id = ?').run(current, id);
  }

  insertEffect(value: ActiveEffect): void {
    this.database.prepare(`
      INSERT INTO active_effects(
        id, target_entity_id, definition_id, source_entity_id, source_feature_id,
        source_spell_id, name, start_event_id, end_event_id, duration_type,
        duration_value, remaining_duration, concentration, modifiers, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      value.id, value.targetEntityId, value.definitionId, value.sourceEntityId,
      value.sourceFeatureId, value.sourceSpellId, value.name, value.startEventId,
      value.endEventId, value.durationType, value.durationValue, value.remainingDuration,
      integer(value.concentration), JSON.stringify(value.modifiers), json(value.metadata),
    );
  }

  getEffect(id: string): ActiveEffect | undefined {
    const row = this.database.prepare(`
      SELECT id, target_entity_id AS targetEntityId, definition_id AS definitionId,
             source_entity_id AS sourceEntityId, source_feature_id AS sourceFeatureId,
             source_spell_id AS sourceSpellId, name, start_event_id AS startEventId,
             end_event_id AS endEventId, duration_type AS durationType,
             duration_value AS durationValue, remaining_duration AS remainingDuration,
             concentration, modifiers, metadata
      FROM active_effects WHERE id = ?
    `).get(id) as unknown as Record<string, unknown> | undefined;
    return row ? mapEffect(row) : undefined;
  }

  listActiveEffects(targetEntityId: string): ActiveEffect[] {
    const rows = this.database.prepare(`
      SELECT id, target_entity_id AS targetEntityId, definition_id AS definitionId,
             source_entity_id AS sourceEntityId, source_feature_id AS sourceFeatureId,
             source_spell_id AS sourceSpellId, name, start_event_id AS startEventId,
             end_event_id AS endEventId, duration_type AS durationType,
             duration_value AS durationValue, remaining_duration AS remainingDuration,
             concentration, modifiers, metadata
      FROM active_effects WHERE target_entity_id = ? AND end_event_id IS NULL ORDER BY rowid
    `).all(targetEntityId) as unknown as Array<Record<string, unknown>>;
    return rows.map(mapEffect);
  }

  endEffect(id: string, eventId: string): void {
    this.database.prepare(`
      UPDATE active_effects SET end_event_id = ?, concentration = 0
      WHERE id = ? AND end_event_id IS NULL
    `).run(eventId, id);
  }

  setEffectConcentration(id: string, concentration: boolean): void {
    this.database.prepare('UPDATE active_effects SET concentration = ? WHERE id = ?').run(
      integer(concentration), id,
    );
  }

  getConcentration(characterId: string): string | undefined {
    const row = this.database.prepare(
      'SELECT effect_id AS effectId FROM character_concentration WHERE character_id = ?',
    ).get(characterId) as unknown as { effectId: string } | undefined;
    return row?.effectId;
  }

  getConcentrationOwner(effectId: string): string | undefined {
    const row = this.database.prepare(
      'SELECT character_id AS characterId FROM character_concentration WHERE effect_id = ?',
    ).get(effectId) as unknown as { characterId: string } | undefined;
    return row?.characterId;
  }

  setConcentration(characterId: string, effectId: string): void {
    this.database.prepare(`
      INSERT INTO character_concentration(character_id, effect_id) VALUES (?, ?)
      ON CONFLICT(character_id) DO UPDATE SET effect_id = excluded.effect_id
    `).run(characterId, effectId);
  }

  clearConcentration(characterId: string): void {
    this.database.prepare('DELETE FROM character_concentration WHERE character_id = ?').run(
      characterId,
    );
  }

  insertStateChange(
    id: string,
    entityId: string,
    eventId: string,
    stateType: string,
    stateKey: string,
    beforeValue: unknown,
    afterValue: unknown,
    recordedAt: string,
    metadata: Readonly<Record<string, unknown>> | null = null,
  ): void {
    this.database.prepare(`
      INSERT INTO state_change_history(
        id, entity_id, event_id, state_type, state_key, before_value,
        after_value, metadata, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, entityId, eventId, stateType, stateKey, scalar(beforeValue),
      scalar(afterValue), json(metadata), recordedAt,
    );
  }

  listStateChanges(entityId: string): StateChangeRecord[] {
    const rows = this.database.prepare(`
      SELECT id, entity_id AS entityId, event_id AS eventId, state_type AS stateType,
             state_key AS stateKey, before_value AS beforeValue, after_value AS afterValue,
             metadata, recorded_at AS recordedAt
      FROM state_change_history WHERE entity_id = ? ORDER BY rowid
    `).all(entityId) as unknown as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...row,
      beforeValue: parseScalar(row.beforeValue),
      afterValue: parseScalar(row.afterValue),
      metadata: parseObject(row.metadata),
    } as unknown as StateChangeRecord));
  }
}

function mapDefinition(row: Record<string, unknown>): RuleDefinition {
  return {
    ...row,
    metadata: parseObject(row.metadata),
    homebrew: Boolean(row.homebrew),
  } as unknown as RuleDefinition;
}

function mapEffect(row: Record<string, unknown>): ActiveEffect {
  return {
    ...row,
    concentration: Boolean(row.concentration),
    modifiers: JSON.parse(String(row.modifiers)) as EffectModifier[],
    metadata: parseObject(row.metadata),
  } as unknown as ActiveEffect;
}

function integer(value: boolean): number {
  return value ? 1 : 0;
}

function json(value: Readonly<Record<string, unknown>> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function parseObject(value: unknown): Readonly<Record<string, unknown>> | null {
  return value == null ? null : JSON.parse(String(value)) as Readonly<Record<string, unknown>>;
}

function scalar(value: unknown): string | null {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseScalar(value: unknown): unknown {
  if (value == null) return null;
  const serialized = String(value);
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    return serialized;
  }
}
