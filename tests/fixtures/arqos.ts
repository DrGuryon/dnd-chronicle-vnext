import type { DefinitionType, RuleDefinition } from '../../src/domain/character-models';
import { AbilityIds } from '../../src/domain/character-models';
import { LifeStateIds } from '../../src/domain/models';
import type { ChronicleDatabase } from '../../src/main/database';

export interface ArqosFixture {
  campaignId: string;
  characterId: string;
  locationId: string;
  resourceId: string;
  longRestResourceId: string;
  pactPoolId: string;
  standardPoolId: string;
  effectId: string;
  conditionId: string;
  spellDefinitionId: string;
  featureDefinitionId: string;
  itemId: string;
}

export function seedArqos(database: ChronicleDatabase): ArqosFixture {
  const campaign = database.domain.createCampaign({
    id: 'campaign_arqos_m4',
    name: 'Ravenford Chronicle',
    rulesetId: 'dnd5e',
    rulesetVersion: '2024',
  });
  const location = database.domain.createLocation({
    id: 'loc_ravenford_hearth',
    campaignId: campaign.id,
    locationType: 'Sanctuary',
    name: 'Strážcův krb',
    description: 'Bezpečné místo v srdci Ravenfordu.',
  });
  const arqos = database.domain.createCharacter({
    id: 'char_arqos_m4',
    campaignId: campaign.id,
    name: 'Arqos',
    fullName: 'Arqos Vael',
    description: 'Strážce Ravenfordu.',
    characterType: 'PC',
    currentLocationId: location.id,
    currentLifeStateId: LifeStateIds.alive,
  });
  const characters = database.characters;
  const aasimar = definition(characters, 'def_m4_species_aasimar', 'Species', 'Aasimar');
  const guard = definition(characters, 'def_m4_background_guard', 'Background', 'City Guard');
  const paladin = definition(characters, 'def_m4_class_paladin', 'Class', 'Paladin');
  const warlock = definition(characters, 'def_m4_class_warlock', 'Class', 'Warlock');
  const hearth = definition(
    characters,
    'def_m4_subclass_hearth',
    'Subclass',
    'Oath of the Hearth',
    { oath: true },
    true,
  );
  const undead = definition(characters, 'def_m4_subclass_undead', 'Subclass', 'The Undead');
  const feature = definition(
    characters,
    'def_m4_feature_divinity',
    'Feature',
    'Channel Divinity',
  );
  const spell = definition(
    characters,
    'def_m4_spell_hex',
    'Spell',
    'Hex',
    { level: 1, concentration: true, school: 'Enchantment' },
  );
  const frightened = definition(
    characters,
    'def_m4_condition_frightened',
    'Condition',
    'Frightened',
  );
  const necrotic = definition(
    characters,
    'def_m4_damage_necrotic',
    'DamageType',
    'Necrotic',
  );
  const persuasion = definition(
    characters,
    'def_m4_skill_persuasion',
    'Skill',
    'Persuasion',
  );
  const common = definition(
    characters,
    'def_m4_language_common',
    'Language',
    'Common',
  );

  characters.setBiography(arqos.id, {
    age: 32,
    alignment: 'Neutral Good',
    appearance: 'Stříbrné oči a starý plášť městské stráže.',
    biography: 'Přijal pact, aby ochránil svůj domov.',
    personalityTraits: 'Klidný pod tlakem.',
    ideals: 'Každý si zaslouží bezpečný domov.',
    bonds: 'Ravenford je jeho domov.',
    flaws: 'Každé břemeno nese sám.',
    notes: 'Multiclass testovací postava pro Character Cockpit.',
  });
  characters.setOrigin(arqos.id, {
    speciesId: aasimar.id,
    lineageId: null,
    backgroundId: guard.id,
  });
  characters.addClass({
    id: 'class_m4_arqos_paladin',
    characterId: arqos.id,
    classId: paladin.id,
    subclassId: hearth.id,
    level: 5,
    acquiredEventId: null,
  });
  characters.addClass({
    id: 'class_m4_arqos_warlock',
    characterId: arqos.id,
    classId: warlock.id,
    subclassId: undead.id,
    level: 3,
    acquiredEventId: null,
  });

  const scores = [15, 10, 10, 12, 12, 20] as const;
  AbilityIds.forEach((abilityId, index) => characters.setAbilityScore({
    characterId: arqos.id,
    abilityId,
    baseScore: scores[index],
    permanentModifier: 0,
    overrideScore: null,
  }));
  characters.setCombatState({
    characterId: arqos.id,
    maximumHp: 59,
    currentHp: 52,
    temporaryHp: 8,
    armorClassBase: 18,
    armorClassModifier: 0,
    armorClassOverride: null,
    initiativeModifier: 0,
    deathSaveSuccesses: 0,
    deathSaveFailures: 0,
    inspiration: true,
  });
  characters.addMovement({
    id: 'movement_m4_arqos_walk',
    characterId: arqos.id,
    movementType: 'walk',
    distance: 30,
    unit: 'ft',
    sourceType: 'species',
    sourceId: aasimar.id,
    condition: null,
  });
  characters.addFeature({
    id: 'feature_m4_arqos_divinity',
    definitionId: feature.id,
    characterId: arqos.id,
    sourceType: 'class',
    sourceId: paladin.id,
    acquiredEventId: null,
    enabled: true,
    customName: null,
    customDescription: null,
    choices: null,
    metadata: null,
  });
  characters.addFeature({
    id: 'feature_m4_arqos_custom',
    definitionId: null,
    characterId: arqos.id,
    sourceType: 'campaign',
    sourceId: arqos.id,
    acquiredEventId: null,
    enabled: true,
    customName: 'Guardian of the Hearth',
    customDescription: 'Arqos chrání spojence u svého krbu.',
    choices: null,
    metadata: null,
  });
  const resource = characters.addResource({
    id: 'resource_m4_channel_divinity',
    ownerEntityId: arqos.id,
    name: 'Channel Divinity',
    resourceType: 'uses',
    current: 1,
    maximum: 2,
    resetRule: 'shortOrLongRest',
    sourceDefinitionId: feature.id,
    sourceFeatureId: null,
    metadata: { display: 'pips' },
  });
  const longRestResource = characters.addResource({
    id: 'resource_m4_lay_on_hands',
    ownerEntityId: arqos.id,
    name: 'Lay on Hands',
    resourceType: 'points',
    current: 10,
    maximum: 25,
    resetRule: 'longRest',
    sourceDefinitionId: feature.id,
    sourceFeatureId: null,
    metadata: { display: 'number' },
  });
  characters.addAction({
    id: 'action_m4_eldritch_blast',
    ownerEntityId: arqos.id,
    name: 'Eldritch Blast',
    actionType: 'action',
    sourceType: 'spell',
    sourceId: spell.id,
    mechanics: {
      attackModifier: 8,
      range: { normal: 120, unit: 'ft' },
      damage: [{ formula: '1d10', damageTypeId: null }],
    },
  });
  characters.addAction({
    id: 'action_m4_guardian_reaction',
    ownerEntityId: arqos.id,
    name: 'Guardian Intercept',
    actionType: 'reaction',
    sourceType: 'feature',
    sourceId: feature.id,
    mechanics: {},
  });

  const pactSource = characters.addSpellcastingSource({
    id: 'spellsource_m4_arqos_warlock',
    characterId: arqos.id,
    sourceType: 'class',
    sourceId: warlock.id,
    spellcastingAbilityId: 'charisma',
    mechanism: 'pactMagic',
    attackModifier: 0,
    dcModifier: 0,
    metadata: null,
  });
  const paladinSource = characters.addSpellcastingSource({
    id: 'spellsource_m4_arqos_paladin',
    characterId: arqos.id,
    sourceType: 'class',
    sourceId: paladin.id,
    spellcastingAbilityId: 'charisma',
    mechanism: 'prepared',
    attackModifier: 0,
    dcModifier: 0,
    metadata: null,
  });
  characters.addSpell({
    id: 'spell_m4_arqos_hex',
    characterId: arqos.id,
    spellId: spell.id,
    spellcastingSourceId: pactSource.id,
    known: true,
    prepared: false,
    alwaysPrepared: false,
    ritualAvailable: false,
    customNotes: null,
    acquiredEventId: null,
  });
  const pactPool = characters.addSpellSlotPool({
    id: 'pool_m4_arqos_pact',
    characterId: arqos.id,
    spellcastingSourceId: pactSource.id,
    poolType: 'pact',
    slotLevel: 2,
    current: 1,
    maximum: 2,
    resetRule: 'shortRest',
  });
  const standardPool = characters.addSpellSlotPool({
    id: 'pool_m4_arqos_standard',
    characterId: arqos.id,
    spellcastingSourceId: paladinSource.id,
    poolType: 'standard',
    slotLevel: 1,
    current: 2,
    maximum: 4,
    resetRule: 'longRest',
  });
  characters.addProficiency({
    id: 'proficiency_m4_persuasion',
    characterId: arqos.id,
    category: 'skill',
    targetDefinitionId: persuasion.id,
    customTarget: null,
    level: 'expertise',
    sourceType: 'background',
    sourceId: guard.id,
    metadata: null,
  });
  characters.addProficiency({
    id: 'proficiency_m4_common',
    characterId: arqos.id,
    category: 'language',
    targetDefinitionId: common.id,
    customTarget: null,
    level: 'proficient',
    sourceType: 'species',
    sourceId: aasimar.id,
    metadata: null,
  });
  characters.addDefense({
    id: 'defense_m4_necrotic',
    characterId: arqos.id,
    defenseType: 'damageResistance',
    definitionId: necrotic.id,
    sourceType: 'species',
    sourceId: aasimar.id,
  });
  const item = database.domain.createItem({
    id: 'item_m4_hearth_blade',
    campaignId: campaign.id,
    name: 'Rodový meč',
    description: 'Čepel děděná mezi strážci krbu.',
    quantity: 1,
    placement: { kind: 'character', characterId: arqos.id },
  });
  database.domain.createAlias({
    id: 'alias_m4_hearth_blade',
    entityId: item.id,
    alias: 'Hearthblade',
  });
  const concentration = characters.addEffect({
    id: 'effect_m4_hex',
    targetEntityId: arqos.id,
    definitionId: null,
    sourceEntityId: arqos.id,
    sourceFeatureId: null,
    sourceSpellId: spell.id,
    name: 'Hex',
    durationType: 'hour',
    durationValue: 1,
    remainingDuration: 1,
    concentration: true,
    modifiers: [{ kind: 'initiative.add', value: 1 }],
    metadata: { target: 'training dummy' },
    event: { id: 'event_m4_hex_started', eventType: 'effect.started', summary: 'Arqos seslal Hex.' },
  });
  const condition = characters.applyCondition({
    id: 'effect_m4_frightened',
    targetEntityId: arqos.id,
    definitionId: frightened.id,
    sourceEntityId: null,
    sourceFeatureId: null,
    sourceSpellId: null,
    name: 'Frightened',
    durationType: 'round',
    durationValue: 1,
    remainingDuration: 1,
    modifiers: [],
    metadata: null,
    event: {
      id: 'event_m4_frightened_started',
      eventType: 'condition.applied',
      summary: 'Arqos je frightened.',
    },
  });

  return {
    campaignId: campaign.id,
    characterId: arqos.id,
    locationId: location.id,
    resourceId: resource.id,
    longRestResourceId: longRestResource.id,
    pactPoolId: pactPool.id,
    standardPoolId: standardPool.id,
    effectId: concentration.state.id,
    conditionId: condition.state.id,
    spellDefinitionId: spell.id,
    featureDefinitionId: feature.id,
    itemId: item.id,
  };
}

function definition(
  characters: ChronicleDatabase['characters'],
  id: string,
  definitionType: DefinitionType,
  name: string,
  metadata: Readonly<Record<string, unknown>> | null = null,
  homebrew = false,
): RuleDefinition {
  return characters.createDefinition({
    id,
    definitionType,
    rulesetId: 'dnd5e',
    rulesetVersion: '2024',
    name,
    description: `${name} – testovací pravidlový popis.`,
    source: homebrew ? 'Ravenford Chronicle' : 'SRD-compatible fixture',
    origin: homebrew ? 'homebrew' : 'core',
    metadata,
    homebrew,
  });
}
