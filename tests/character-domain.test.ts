import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DefinitionType, RuleDefinition } from '../src/domain/character-models';
import { AbilityIds } from '../src/domain/character-models';
import { LifeStateIds } from '../src/domain/models';
import { ChronicleDatabase } from '../src/main/database';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 3 complete character domain', () => {
  it('persists and evolves the multiclass Arqos scenario atomically', async () => {
    const userData = await createTemporaryDirectory();
    let chronicle = await ChronicleDatabase.open(userData);
    const campaign = chronicle.domain.createCampaign({
      id: 'campaign_arqos',
      name: 'Arqos Chronicle',
      rulesetId: 'dnd5e',
      rulesetVersion: '2024',
    });
    const arqos = chronicle.domain.createCharacter({
      id: 'char_arqos_m3',
      campaignId: campaign.id,
      name: 'Arqos',
      fullName: 'Arqos Vael',
      characterType: 'PC',
      currentLifeStateId: LifeStateIds.alive,
    });
    const characters = chronicle.characters;

    const aasimar = definition(characters, 'def_species_aasimar', 'Species', 'Aasimar');
    const background = definition(characters, 'def_background_guard', 'Background', 'City Guard');
    const paladin = definition(characters, 'def_class_paladin', 'Class', 'Paladin');
    const warlock = definition(characters, 'def_class_warlock', 'Class', 'Warlock');
    const hearth = definition(
      characters, 'def_subclass_hearth', 'Subclass', 'Oath of the Hearth', true,
    );
    const undead = definition(characters, 'def_subclass_undead', 'Subclass', 'The Undead');
    const warCaster = definition(characters, 'def_feat_war_caster', 'Feat', 'War Caster');
    const persuasion = definition(characters, 'def_skill_persuasion', 'Skill', 'Persuasion');
    const necrotic = definition(characters, 'def_damage_necrotic', 'DamageType', 'Necrotic');
    const frightened = definition(characters, 'def_condition_frightened', 'Condition', 'Frightened');
    const featureDefinitions = [
      definition(characters, 'def_feature_divinity', 'Feature', 'Channel Divinity'),
      definition(characters, 'def_feature_lay_hands', 'Feature', 'Lay on Hands'),
      definition(characters, 'def_feature_form_dread', 'Feature', 'Form of Dread'),
      definition(characters, 'def_feature_pact_blade', 'Feature', 'Pact of the Blade'),
      definition(characters, 'def_feature_aasimar_form', 'Feature', 'Aasimar Form'),
    ];
    const spellDefinitions = [
      definition(characters, 'def_spell_eldritch_blast', 'Spell', 'Eldritch Blast'),
      definition(characters, 'def_spell_booming_blade', 'Spell', 'Booming Blade'),
      definition(characters, 'def_spell_mage_hand', 'Spell', 'Mage Hand'),
      definition(characters, 'def_spell_hex', 'Spell', 'Hex'),
      definition(characters, 'def_spell_armor_agathys', 'Spell', 'Armor of Agathys'),
      definition(characters, 'def_spell_cure_wounds', 'Spell', 'Cure Wounds'),
      definition(characters, 'def_spell_lesser_restoration', 'Spell', 'Lesser Restoration'),
    ];
    const blessDefinition = definition(characters, 'def_spell_bless', 'Spell', 'Bless');

    characters.setBiography(arqos.id, {
      age: 32,
      alignment: 'Neutral Good',
      appearance: 'Silver eyes and an old city-watch cloak.',
      biography: 'A guardian who made a pact to protect his hearth.',
      personalityTraits: 'Calm under pressure.',
      ideals: 'Shelter belongs to everyone.',
      bonds: 'Ravenford is home.',
      flaws: 'Will shoulder every burden alone.',
      notes: 'Uses 2024 core rules with homebrew subclass.',
    });
    characters.setOrigin(arqos.id, {
      speciesId: aasimar.id,
      lineageId: null,
      backgroundId: background.id,
    });
    characters.addChoice({
      id: 'choice_arqos_origin_override',
      characterId: arqos.id,
      category: 'origin.language',
      definitionId: null,
      value: 'Celestial Cant',
      override: true,
      metadata: { reason: 'campaign homebrew' },
    });
    characters.addClass({
      id: 'class_arqos_paladin', characterId: arqos.id, classId: paladin.id,
      subclassId: hearth.id, level: 5, acquiredEventId: null,
    });
    characters.addClass({
      id: 'class_arqos_warlock', characterId: arqos.id, classId: warlock.id,
      subclassId: undead.id, level: 3, acquiredEventId: null,
    });

    const scores = [15, 10, 10, 12, 12, 20] as const;
    AbilityIds.forEach((abilityId, index) => characters.setAbilityScore({
      characterId: arqos.id,
      abilityId,
      baseScore: scores[index],
      permanentModifier: 0,
      overrideScore: null,
    }));
    expect(AbilityIds.map((ability) => characters.getAbilityScore(arqos.id, ability).modifier))
      .toEqual([2, 0, 0, 1, 1, 5]);
    expect(characters.getTotalLevel(arqos.id)).toBe(8);
    expect(characters.getProficiencyBonus(arqos.id)).toBe(3);

    const proficiency = characters.addProficiency({
      id: 'proficiency_arqos_persuasion',
      characterId: arqos.id,
      category: 'skill',
      targetDefinitionId: persuasion.id,
      customTarget: null,
      level: 'expertise',
      sourceType: 'background',
      sourceId: background.id,
      metadata: null,
    });
    expect(characters.getProficiencyCheckBonus(arqos.id, proficiency.id, 'charisma')).toBe(11);

    characters.setCombatState({
      characterId: arqos.id,
      maximumHp: 59,
      currentHp: 59,
      temporaryHp: 0,
      armorClassBase: 18,
      armorClassModifier: 0,
      armorClassOverride: null,
      initiativeModifier: 0,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      inspiration: true,
    });
    expect(characters.getArmorClass(arqos.id)).toBe(18);
    expect(characters.getInitiative(arqos.id)).toBe(0);
    const paladinDice = characters.addHitDiePool({
      id: 'hitdie_arqos_paladin', characterId: arqos.id, dieSize: 10,
      current: 5, maximum: 5, sourceType: 'class', sourceId: paladin.id,
    });
    characters.addHitDiePool({
      id: 'hitdie_arqos_warlock', characterId: arqos.id, dieSize: 8,
      current: 3, maximum: 3, sourceType: 'class', sourceId: warlock.id,
    });
    characters.addMovement({
      id: 'movement_arqos_walk', characterId: arqos.id, movementType: 'walk',
      distance: 30, unit: 'ft', sourceType: 'species', sourceId: aasimar.id, condition: null,
    });
    characters.addSense({
      id: 'sense_arqos_darkvision', characterId: arqos.id, senseType: 'darkvision',
      range: 60, unit: 'ft', sourceType: 'species', sourceId: aasimar.id,
    });
    characters.addDefense({
      id: 'defense_arqos_necrotic', characterId: arqos.id,
      defenseType: 'damageResistance', definitionId: necrotic.id,
      sourceType: 'species', sourceId: aasimar.id,
    });

    [...featureDefinitions, warCaster].forEach((featureDefinition, index) => {
      characters.addFeature({
        id: `feature_arqos_${index}`,
        definitionId: featureDefinition.id,
        characterId: arqos.id,
        sourceType: featureDefinition.definitionType.toLowerCase(),
        sourceId: featureDefinition.id,
        acquiredEventId: null,
        enabled: true,
        customName: null,
        customDescription: null,
        choices: index === 0 ? { oath: hearth.id } : null,
        metadata: null,
      });
    });

    const channel = characters.addResource({
      id: 'resource_channel_divinity', ownerEntityId: arqos.id, name: 'Channel Divinity',
      resourceType: 'uses', current: 0, maximum: 2, resetRule: 'shortOrLongRest',
      sourceDefinitionId: featureDefinitions[0].id, sourceFeatureId: null, metadata: null,
    });
    const layOnHands = characters.addResource({
      id: 'resource_lay_on_hands', ownerEntityId: arqos.id, name: 'Lay on Hands',
      resourceType: 'points', current: 10, maximum: 25, resetRule: 'longRest',
      sourceDefinitionId: featureDefinitions[1].id, sourceFeatureId: null, metadata: null,
    });
    characters.addResource({
      id: 'resource_form_of_dread', ownerEntityId: arqos.id, name: 'Form of Dread',
      resourceType: 'uses', current: 1, maximum: 3, resetRule: 'longRest',
      sourceDefinitionId: featureDefinitions[2].id, sourceFeatureId: null, metadata: null,
    });
    characters.addResource({
      id: 'resource_aasimar_form', ownerEntityId: arqos.id, name: 'Aasimar Form',
      resourceType: 'uses', current: 0, maximum: 1, resetRule: 'longRest',
      sourceDefinitionId: featureDefinitions[4].id, sourceFeatureId: null, metadata: null,
    });
    characters.addAction({
      id: 'action_arqos_eldritch_blast', ownerEntityId: arqos.id, name: 'Eldritch Blast',
      actionType: 'action', sourceType: 'spell', sourceId: spellDefinitions[0].id,
      mechanics: {
        attackType: 'rangedSpell', attackBonusFormula: 'spell attack',
        range: { normal: 120, unit: 'ft' },
        damage: [{ formula: '1d10', damageTypeId: null }],
      },
    });

    const paladinMagic = characters.addSpellcastingSource({
      id: 'spellsource_arqos_paladin', characterId: arqos.id, sourceType: 'class',
      sourceId: paladin.id, spellcastingAbilityId: 'charisma', mechanism: 'prepared',
      attackModifier: 0, dcModifier: 0, metadata: null,
    });
    const pactMagic = characters.addSpellcastingSource({
      id: 'spellsource_arqos_warlock', characterId: arqos.id, sourceType: 'class',
      sourceId: warlock.id, spellcastingAbilityId: 'charisma', mechanism: 'pactMagic',
      attackModifier: 0, dcModifier: 0, metadata: null,
    });
    expect(characters.getSpellAttackBonus(pactMagic.id)).toBe(8);
    expect(characters.getSpellSaveDc(pactMagic.id)).toBe(16);
    spellDefinitions.forEach((spell, index) => characters.addSpell({
      id: `spell_arqos_${index}`,
      characterId: arqos.id,
      spellId: spell.id,
      spellcastingSourceId: index >= 5 ? paladinMagic.id : pactMagic.id,
      known: index < 5,
      prepared: index >= 5,
      alwaysPrepared: index === 6,
      ritualAvailable: false,
      customNotes: null,
      acquiredEventId: null,
    }));
    characters.addSpellSlotPool({
      id: 'pool_arqos_standard_1', characterId: arqos.id,
      spellcastingSourceId: paladinMagic.id, poolType: 'standard', slotLevel: 1,
      current: 2, maximum: 4, resetRule: 'longRest',
    });
    const pactPool = characters.addSpellSlotPool({
      id: 'pool_arqos_pact_2', characterId: arqos.id,
      spellcastingSourceId: pactMagic.id, poolType: 'pact', slotLevel: 2,
      current: 2, maximum: 2, resetRule: 'shortRest',
    });
    characters.addSpellSlotPool({
      id: 'pool_arqos_custom', characterId: arqos.id,
      spellcastingSourceId: null, poolType: 'custom', slotLevel: 0,
      current: 1, maximum: 1, resetRule: 'manual',
    });

    characters.spendSpellSlot(pactPool.id, event('event_arqos_spend_pact', 'spell.slot.spent'));
    const bless = characters.addEffect({
      id: 'effect_arqos_bless', targetEntityId: arqos.id, definitionId: null,
      sourceEntityId: arqos.id, sourceFeatureId: null, sourceSpellId: blessDefinition.id,
      name: 'Bless', durationType: 'minute', durationValue: 1, remainingDuration: 1,
      concentration: true, modifiers: [], metadata: null,
      event: event('event_arqos_bless', 'effect.started'),
    });
    const hex = characters.addEffect({
      id: 'effect_arqos_hex', targetEntityId: arqos.id, definitionId: null,
      sourceEntityId: arqos.id, sourceFeatureId: null, sourceSpellId: spellDefinitions[3].id,
      name: 'Hex', durationType: 'hour', durationValue: 1, remainingDuration: 1,
      concentration: true, modifiers: [{ kind: 'ability.add', abilityId: 'charisma', value: 2 }],
      metadata: { target: 'training dummy' },
      event: event('event_arqos_hex', 'effect.started'),
    });
    expect(characters.getConcentration(arqos.id)?.id).toBe(hex.state.id);
    expect(characters.listActiveEffects(arqos.id).map((effect) => effect.id)).toEqual([hex.state.id]);
    expect(characters.getAbilityScore(arqos.id, 'charisma')).toMatchObject({ score: 22, modifier: 6 });
    expect(bless.state.id).not.toBe(hex.state.id);

    characters.changeHp(arqos.id, -7, event('event_arqos_hurt', 'combat.hp.changed'));
    expect(characters.getCombatState(arqos.id)?.currentHp).toBe(52);
    expect(() => characters.spendResource(
      layOnHands.id, 99, event('event_arqos_invalid_spend', 'resource.spent'),
    )).toThrow('nemá dostatek');
    const eventCountBeforeRest = chronicle.domain.listEvents(campaign.id).length;
    expect(chronicle.domain.listEvents(campaign.id).some((value) => value.id === 'event_arqos_invalid_spend'))
      .toBe(false);

    characters.resetResourcesForShortRest(
      arqos.id, event('event_arqos_short_rest', 'rest.short.completed'),
    );
    expect(characters.getResource(channel.id)?.current).toBe(2);
    expect(characters.getResource(layOnHands.id)?.current).toBe(10);
    expect(characters.listSpellSlotPools(arqos.id).find((pool) => pool.id === pactPool.id)?.current)
      .toBe(2);
    characters.resetResourcesForLongRest(
      arqos.id, event('event_arqos_long_rest', 'rest.long.completed'),
    );
    expect(characters.getResource(layOnHands.id)?.current).toBe(25);
    expect(characters.listSpellSlotPools(arqos.id).find((pool) => pool.poolType === 'standard')?.current)
      .toBe(4);

    characters.endConcentration(
      arqos.id, event('event_arqos_end_hex', 'concentration.ended'),
    );
    expect(characters.getConcentration(arqos.id)).toBeUndefined();
    expect(characters.getAbilityScore(arqos.id, 'charisma')).toMatchObject({ score: 20, modifier: 5 });
    characters.spendHitDie(paladinDice.id, event('event_arqos_spend_hit_die', 'hit_die.spent'));
    characters.recordDeathSave(
      arqos.id, true, event('event_arqos_death_save', 'death_save.recorded'),
    );
    const condition = characters.applyCondition({
      id: 'effect_arqos_frightened', targetEntityId: arqos.id,
      definitionId: frightened.id, sourceEntityId: null, sourceFeatureId: null,
      sourceSpellId: null, name: 'Frightened', durationType: 'round', durationValue: 1,
      remainingDuration: 1, modifiers: [], metadata: null,
      event: event('event_arqos_frightened', 'condition.applied'),
    });
    characters.removeCondition(
      condition.state.id, event('event_arqos_frightened_end', 'condition.removed'),
    );
    expect(chronicle.domain.listEvents(campaign.id).length).toBeGreaterThan(eventCountBeforeRest);

    chronicle.close();
    chronicle = await ChronicleDatabase.open(userData);
    const persisted = chronicle.characters;
    expect(persisted.listClasses(arqos.id).map((entry) => entry.level)).toEqual([5, 3]);
    expect(persisted.getBiography(arqos.id)).toMatchObject({ age: 32, alignment: 'Neutral Good' });
    expect(persisted.getOrigin(arqos.id)).toMatchObject({
      speciesId: aasimar.id, backgroundId: background.id,
    });
    expect(persisted.listDefinitions({ definitionType: 'Spell' })).toHaveLength(8);
    expect(persisted.listChoices(arqos.id)).toHaveLength(1);
    expect(persisted.listFeatures(arqos.id)).toHaveLength(6);
    expect(persisted.listProficiencies(arqos.id)).toHaveLength(1);
    expect(persisted.listMovements(arqos.id)).toHaveLength(1);
    expect(persisted.listSenses(arqos.id)).toHaveLength(1);
    expect(persisted.listDefenses(arqos.id)).toHaveLength(1);
    expect(persisted.listActions(arqos.id)).toHaveLength(1);
    expect(persisted.listSpellcastingSources(arqos.id)).toHaveLength(2);
    expect(persisted.listSpells(arqos.id)).toHaveLength(7);
    expect(persisted.listSpellSlotPools(arqos.id).map((pool) => pool.poolType))
      .toEqual(['standard', 'pact', 'custom']);
    expect(persisted.getCombatState(arqos.id)).toMatchObject({
      currentHp: 52, deathSaveSuccesses: 1,
    });
    expect(persisted.listHitDiePools(arqos.id).find((pool) => pool.id === paladinDice.id)?.current)
      .toBe(4);
    expect(persisted.listActiveEffects(arqos.id)).toEqual([]);
    expect(persisted.getConcentration(arqos.id)).toBeUndefined();
    expect(persisted.listStateChanges(arqos.id).length).toBeGreaterThanOrEqual(11);
    expect(chronicle.domain.listEvents(campaign.id).map((record) => record.id)).toEqual([
      'event_arqos_spend_pact',
      'event_arqos_bless',
      'event_arqos_hex',
      'event_arqos_hurt',
      'event_arqos_short_rest',
      'event_arqos_long_rest',
      'event_arqos_end_hex',
      'event_arqos_spend_hit_die',
      'event_arqos_death_save',
      'event_arqos_frightened',
      'event_arqos_frightened_end',
    ]);
    chronicle.close();
  });
});

function definition(
  characters: ChronicleDatabase['characters'],
  id: string,
  definitionType: DefinitionType,
  name: string,
  homebrew = false,
): RuleDefinition {
  return characters.createDefinition({
    id,
    definitionType,
    rulesetId: 'dnd5e',
    rulesetVersion: '2024',
    name,
    description: `${name} rule definition`,
    source: homebrew ? 'Ravenford Chronicle' : 'SRD-compatible test fixture',
    origin: homebrew ? 'homebrew' : 'core',
    metadata: homebrew ? { author: 'table' } : null,
    homebrew,
  });
}

function event(id: string, eventType: string) {
  return { id, eventType, summary: id.replaceAll('_', ' ') };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-character-'));
  temporaryDirectories.push(directory);
  return directory;
}
