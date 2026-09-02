import type { DatabaseSync } from 'node:sqlite';
import type { DefinitionType } from '../domain/character-models';
import type { RuleDefinitionRelation, RulesPackLocalization, RulesPackTypedContent } from '../shared/rules-packs';
import { openSrdContentEntries } from './open-srd-content.generated';
import { listBuiltInRulesets } from './registry';

export interface BuiltInRuleDefinition {
  id: string;
  definitionType: DefinitionType;
  rulesetId: string;
  rulesetVersion: string;
  canonicalId: string;
  name: string;
  aliases: readonly string[];
  source: string;
  packId: string;
  packVersion: string;
  locale: string;
}

type CatalogEntry = readonly [DefinitionType, string, string, (readonly string[])?, (readonly string[])?];

const commonEntries: readonly CatalogEntry[] = [
  ['Species', 'human', 'Human', ['Člověk']],
  ['Species', 'dwarf', 'Dwarf', ['Trpaslík']],
  ['Species', 'elf', 'Elf', ['Elf']],
  ['Species', 'halfling', 'Halfling', ['Půlčík']],
  ['Species', 'dragonborn', 'Dragonborn', ['Drakorozený']],
  ['Species', 'gnome', 'Gnome', ['Gnóm']],
  ['Species', 'half-elf', 'Half-Elf', ['Půlelf'], ['2014']],
  ['Species', 'half-orc', 'Half-Orc', ['Půlork'], ['2014']],
  ['Species', 'tiefling', 'Tiefling', ['Tiefling']],
  ['Lineage', 'hill-dwarf', 'Hill Dwarf', ['Horský trpaslík'], ['2014']],
  ['Lineage', 'high-elf', 'High Elf', ['Vznešený elf'], ['2014']],
  ['Lineage', 'lightfoot-halfling', 'Lightfoot Halfling', ['Lehkonohý půlčík'], ['2014']],
  ['Class', 'barbarian', 'Barbarian', ['Barbar']],
  ['Class', 'bard', 'Bard', ['Bard']],
  ['Class', 'cleric', 'Cleric', ['Klerik']],
  ['Class', 'druid', 'Druid', ['Druid']],
  ['Class', 'fighter', 'Fighter', ['Bojovník']],
  ['Class', 'monk', 'Monk', ['Mnich']],
  ['Class', 'paladin', 'Paladin', ['Paladin']],
  ['Class', 'ranger', 'Ranger', ['Hraničář']],
  ['Class', 'rogue', 'Rogue', ['Tulák']],
  ['Class', 'sorcerer', 'Sorcerer', ['Čaroděj']],
  ['Class', 'warlock', 'Warlock', ['Černokněžník']],
  ['Class', 'wizard', 'Wizard', ['Kouzelník']],
  ['Subclass', 'champion', 'Champion', ['Šampion']],
  ['Subclass', 'life-domain', 'Life Domain', ['Doména života']],
  ['Subclass', 'school-of-evocation', 'School of Evocation', ['Škola zaklínání']],
  ['Subclass', 'oath-of-devotion', 'Oath of Devotion', ['Přísaha oddanosti']],
  ['Background', 'acolyte', 'Acolyte', ['Akolyta']],
  ['Background', 'criminal', 'Criminal', ['Zločinec'], ['2024']],
  ['Background', 'sage', 'Sage', ['Mudrc'], ['2024']],
  ['Background', 'soldier', 'Soldier', ['Voják'], ['2024']],
  ['Skill', 'acrobatics', 'Acrobatics', ['Akrobacie']],
  ['Skill', 'animal-handling', 'Animal Handling', ['Ovládání zvířat']],
  ['Skill', 'arcana', 'Arcana', ['Mystika']],
  ['Skill', 'athletics', 'Athletics', ['Atletika']],
  ['Skill', 'deception', 'Deception', ['Klamání']],
  ['Skill', 'history', 'History', ['Historie']],
  ['Skill', 'insight', 'Insight', ['Vhled']],
  ['Skill', 'intimidation', 'Intimidation', ['Zastrašování']],
  ['Skill', 'investigation', 'Investigation', ['Pátrání']],
  ['Skill', 'medicine', 'Medicine', ['Lékařství']],
  ['Skill', 'nature', 'Nature', ['Příroda']],
  ['Skill', 'perception', 'Perception', ['Vnímání']],
  ['Skill', 'performance', 'Performance', ['Vystupování']],
  ['Skill', 'persuasion', 'Persuasion', ['Přesvědčování']],
  ['Skill', 'religion', 'Religion', ['Náboženství']],
  ['Skill', 'sleight-of-hand', 'Sleight of Hand', ['Čachry']],
  ['Skill', 'stealth', 'Stealth', ['Nenápadnost']],
  ['Skill', 'survival', 'Survival', ['Přežití']],
  ['Language', 'common', 'Common', ['Obecná řeč']],
  ['Language', 'dwarvish', 'Dwarvish', ['Trpasličtina']],
  ['Language', 'elvish', 'Elvish', ['Elfština']],
  ['Language', 'giant', 'Giant', ['Obřina']],
  ['Language', 'gnomish', 'Gnomish', ['Gnómština']],
  ['Language', 'goblin', 'Goblin', ['Goblinština']],
  ['Language', 'halfling', 'Halfling', ['Půlčičtina']],
  ['Language', 'orc', 'Orc', ['Orčtina']],
  ['Language', 'abyssal', 'Abyssal', ['Abyssal']],
  ['Language', 'celestial', 'Celestial', ['Nebesština']],
  ['Language', 'draconic', 'Draconic', ['Dračí řeč']],
  ['Language', 'infernal', 'Infernal', ['Pekelná řeč']],
  ['Language', 'primordial', 'Primordial', ['Prvotní řeč']],
  ['Language', 'sylvan', 'Sylvan', ['Sylvánština']],
  ['Language', 'undercommon', 'Undercommon', ['Podzemní obecná']],
  ['DamageType', 'acid', 'Acid', ['Kyselinové']],
  ['DamageType', 'bludgeoning', 'Bludgeoning', ['Drtivé']],
  ['DamageType', 'cold', 'Cold', ['Chladné']],
  ['DamageType', 'fire', 'Fire', ['Ohnivé']],
  ['DamageType', 'force', 'Force', ['Silové']],
  ['DamageType', 'lightning', 'Lightning', ['Bleskové']],
  ['DamageType', 'necrotic', 'Necrotic', ['Nekrotické']],
  ['DamageType', 'piercing', 'Piercing', ['Bodné']],
  ['DamageType', 'poison', 'Poison', ['Jedové']],
  ['DamageType', 'psychic', 'Psychic', ['Psychické']],
  ['DamageType', 'radiant', 'Radiant', ['Zářivé']],
  ['DamageType', 'slashing', 'Slashing', ['Sečné']],
  ['DamageType', 'thunder', 'Thunder', ['Hromové']],
  ['Condition', 'blinded', 'Blinded', ['Oslepený']],
  ['Condition', 'charmed', 'Charmed', ['Okouzlený']],
  ['Condition', 'deafened', 'Deafened', ['Ohlušený']],
  ['Condition', 'frightened', 'Frightened', ['Vystrašený']],
  ['Condition', 'grappled', 'Grappled', ['Uchvácený']],
  ['Condition', 'incapacitated', 'Incapacitated', ['Vyřazený']],
  ['Condition', 'invisible', 'Invisible', ['Neviditelný']],
  ['Condition', 'paralyzed', 'Paralyzed', ['Paralyzovaný']],
  ['Condition', 'petrified', 'Petrified', ['Zkamenělý']],
  ['Condition', 'poisoned', 'Poisoned', ['Otrávený']],
  ['Condition', 'prone', 'Prone', ['Ležící']],
  ['Condition', 'restrained', 'Restrained', ['Zadržený']],
  ['Condition', 'stunned', 'Stunned', ['Omráčený']],
  ['Condition', 'unconscious', 'Unconscious', ['V bezvědomí']],
  ['Feat', 'grappler', 'Grappler', ['Zápasník']],
  ['Feat', 'skilled', 'Skilled', ['Zkušený'], ['2024']],
  ['Spell', 'bless', 'Bless', ['Požehnání']],
  ['Spell', 'cure-wounds', 'Cure Wounds', ['Léčení zranění']],
  ['Spell', 'fireball', 'Fireball', ['Ohnivá koule']],
  ['Spell', 'guidance', 'Guidance', ['Vedení']],
  ['Spell', 'healing-word', 'Healing Word', ['Léčivé slovo']],
  ['Spell', 'light', 'Light', ['Světlo']],
  ['Spell', 'mage-hand', 'Mage Hand', ['Mágova ruka']],
  ['Spell', 'magic-missile', 'Magic Missile', ['Magická střela']],
  ['Spell', 'shield', 'Shield', ['Štít']],
  ['WeaponCategory', 'martial-melee', 'Martial Melee Weapons', ['Válečné zbraně na blízko']],
  ['Property', 'versatile', 'Versatile', ['Obouruční použití']],
  ['Weapon', 'longsword', 'Longsword', ['Dlouhý meč']],
  ['Armor', 'chain-mail', 'Chain Mail', ['Kroužková zbroj']],
  ['Equipment', 'hempen-rope', 'Rope, Hempen', ['Konopné lano'], ['2014']],
  ['Tool', 'thieves-tools', "Thieves' Tools", ['Zlodějské náčiní']],
  ['Vehicle', 'rowboat', 'Rowboat', ['Veslice']],
  ['CreatureDefinition', 'goblin', 'Goblin', ['Goblin']],
  ['Rule', 'concentration', 'Concentration', ['Soustředění']],
  ['Mastery', 'sap', 'Sap', ['Oslabení'], ['2024']],
] as const;

type ContentEntry = readonly [
  string,
  DefinitionType,
  string,
  string,
  string,
  string,
  string,
  RulesPackTypedContent,
];

const contentEntries: readonly ContentEntry[] = [
  ['2024', 'Spell', 'fireball',
    'A mote of fire erupts at a point in range and engulfs nearby creatures in flame.',
    'Each creature in the spell area makes a Dexterity saving throw, taking fire damage on a failed save or half as much on a successful one. The damage increases when the spell is cast with a higher-level slot.',
    'explosion sphere dexterity save fire damage higher level', 'Spells · Fireball',
    { kind: 'Spell', level: 3, school: 'Evocation', castingTime: '1 action', range: '150 ft', components: ['V', 'S', 'M'], duration: 'Instantaneous', concentration: false, ritual: false, savingThrow: 'Dexterity', damageOrHealing: '8d6 Fire' }],
  ['2014', 'Spell', 'fireball',
    'A bright streak blossoms into a fiery explosion at a point within range.',
    'Creatures in the area make a Dexterity saving throw. A creature takes fire damage on a failed save and half as much on a successful one; higher-level spell slots increase the damage.',
    'explosion sphere dexterity save fire damage higher level', 'Spells · Fireball',
    { kind: 'Spell', level: 3, school: 'Evocation', castingTime: '1 action', range: '150 ft', components: ['V', 'S', 'M'], duration: 'Instantaneous', concentration: false, ritual: false, savingThrow: 'Dexterity', damageOrHealing: '8d6 Fire' }],
  ['2024', 'Spell', 'cure-wounds',
    'Restorative magic heals a creature you touch.',
    'A creature touched by the caster regains hit points. Casting the spell with a higher-level slot increases the amount restored.',
    'healing touch hit points higher level', 'Spells · Cure Wounds',
    { kind: 'Spell', level: 1, school: 'Abjuration', castingTime: '1 action', range: 'Touch', components: ['V', 'S'], duration: 'Instantaneous', concentration: false, ritual: false, damageOrHealing: '2d8 + spellcasting ability modifier healing' }],
  ['2014', 'Spell', 'cure-wounds',
    'A creature you touch regains hit points through restorative magic.',
    'The touched creature regains hit points. The healing increases for each spell slot level above first.',
    'healing touch hit points higher level', 'Spells · Cure Wounds',
    { kind: 'Spell', level: 1, school: 'Evocation', castingTime: '1 action', range: 'Touch', components: ['V', 'S'], duration: 'Instantaneous', concentration: false, ritual: false, damageOrHealing: '1d8 + spellcasting ability modifier healing' }],
  ['2024', 'Species', 'dwarf',
    'Dwarves are hardy humanoids whose traits emphasize resilience and a bond with stone.',
    'The dwarf species entry defines size, speed, darkvision, resilience against poison, and the Stonecunning trait. Individual characters reference this stable definition rather than copying its rules text.',
    'dwarf darkvision poison resilience stonecunning', 'Character Origins · Dwarf',
    { kind: 'Species', size: 'Medium', speed: '30 ft', creatureType: 'Humanoid', senses: ['Darkvision 120 ft'], defenses: ['Poison resistance'], languages: ['Common', 'one additional language'] }],
  ['2014', 'Species', 'elf',
    'Elves are graceful, long-lived humanoids with keen senses and an affinity for magic.',
    'The elf entry groups shared ancestry traits such as darkvision, keen senses, Fey Ancestry, and Trance. Available lineages remain separate related definitions.',
    'elf darkvision keen senses fey ancestry trance', 'Races · Elf',
    { kind: 'Race', size: 'Medium', speed: '30 ft', creatureType: 'Humanoid', senses: ['Darkvision 60 ft', 'Keen Senses'], defenses: ['Fey Ancestry'], languages: ['Common', 'Elvish'] }],
  ['2024', 'Class', 'wizard',
    'A Wizard studies arcane magic and prepares spells from a spellbook.',
    'Wizard progression uses Intelligence, a d6 Hit Point Die, prepared spellcasting, and a spellbook. Features and the Evoker subclass are represented by related definitions.',
    'wizard intelligence spellbook prepared arcane magic', 'Classes · Wizard',
    { kind: 'Class', hitDie: 'd6', primaryAbilities: ['Intelligence'], savingThrows: ['Intelligence', 'Wisdom'], armorTraining: [], weaponProficiencies: ['Simple weapons'], spellcasting: 'Prepared arcane spells from a spellbook' }],
  ['2014', 'Class', 'paladin',
    'A Paladin is a divine warrior empowered by sacred oaths.',
    'Paladins combine martial training, healing, divine magic, and an oath. Their spellcasting uses Charisma and their class progression uses a d10 Hit Die.',
    'paladin sacred oath divine martial charisma', 'Classes · Paladin',
    { kind: 'Class', hitDie: 'd10', primaryAbilities: ['Strength', 'Charisma'], savingThrows: ['Wisdom', 'Charisma'], armorTraining: ['All armor', 'Shields'], weaponProficiencies: ['Simple weapons', 'Martial weapons'], spellcasting: 'Prepared divine spells using Charisma' }],
  ['2014', 'Background', 'acolyte',
    'A life of service in a temple or religious community shapes this background.',
    'The Acolyte background provides Insight and Religion proficiency, two languages, starting equipment, and the Shelter of the Faithful feature.',
    'acolyte insight religion languages shelter faithful', 'Backgrounds · Acolyte',
    { kind: 'Generic', definitionType: 'Background', facts: [{ key: 'skills', value: 'Insight, Religion' }, { key: 'languages', value: 'Two' }, { key: 'feature', value: 'Shelter of the Faithful' }] }],
  ['2024', 'Weapon', 'longsword',
    'A versatile martial melee weapon that deals slashing damage.',
    'A longsword deals 1d8 Slashing damage in one hand or 1d10 when used with two hands through the Versatile property. Its 2024 mastery property is Sap.',
    'longsword martial melee versatile sap slashing', 'Equipment · Weapons · Longsword',
    { kind: 'Weapon', category: 'Martial melee', damage: '1d8 (1d10 versatile)', damageType: 'Slashing', properties: ['Versatile'], mastery: 'Sap', cost: '15 GP', weight: '3 lb' }],
  ['2014', 'Weapon', 'longsword',
    'A versatile martial melee weapon that deals slashing damage.',
    'A longsword deals 1d8 Slashing damage in one hand. The Versatile property raises its damage die to 1d10 when wielded with two hands.',
    'longsword martial melee versatile slashing', 'Equipment · Weapons · Longsword',
    { kind: 'Weapon', category: 'Martial melee', damage: '1d8 (1d10 versatile)', damageType: 'Slashing', properties: ['Versatile'], cost: '15 GP', weight: '3 lb' }],
  ['2024', 'Armor', 'chain-mail',
    'Heavy armor made from interlocking metal rings.',
    'Chain Mail sets base Armor Class to 16. A wearer below Strength 13 has reduced speed, and the armor imposes Disadvantage on Stealth checks.',
    'chain mail heavy armor strength stealth', 'Equipment · Armor · Chain Mail',
    { kind: 'Armor', category: 'Heavy armor', armorClass: '16', strength: '13', stealth: 'Disadvantage', cost: '75 GP', weight: '55 lb', don: '10 minutes', doff: '5 minutes' }],
  ['2014', 'Armor', 'chain-mail',
    'Heavy armor made from interlocking metal rings over quilted fabric.',
    'Chain Mail provides Armor Class 16, requires Strength 13 to avoid a speed penalty, and imposes Disadvantage on Stealth checks.',
    'chain mail heavy armor strength stealth', 'Equipment · Armor · Chain Mail',
    { kind: 'Armor', category: 'Heavy armor', armorClass: '16', strength: '13', stealth: 'Disadvantage', cost: '75 GP', weight: '55 lb', don: '10 minutes', doff: '5 minutes' }],
  ['2024', 'Rule', 'concentration',
    'Concentration governs how a creature maintains certain spells and effects.',
    'A creature can concentrate on only one effect at a time. Taking damage can require a Constitution saving throw to maintain concentration, and several other events can end it.',
    'concentration constitution saving throw damage spell effect', 'Rules Glossary · Concentration',
    { kind: 'Generic', definitionType: 'Rule', facts: [{ key: 'category', value: 'Spellcasting' }, { key: 'simultaneousEffects', value: 'One' }, { key: 'check', value: 'Constitution saving throw after damage' }] }],
] as const;

export interface BuiltInRuleContent {
  shortDescription: string;
  fullDescription: string;
  searchText: string;
  sourceReference: string;
  typedContent: RulesPackTypedContent;
  localizations: RulesPackLocalization[];
}

export function builtInRuleDefinitions(): BuiltInRuleDefinition[] {
  return listBuiltInRulesets().flatMap((ruleset) => ruleset.versions.flatMap((version) => (
    commonEntries.filter(([, , , , versions]) => !versions || versions.includes(version.id))
      .map(([definitionType, slug, name, aliases = []]) => ({
      id: `def_${ruleset.id}_${version.id}_${definitionType.toLocaleLowerCase('en-US')}_${slug.replaceAll('-', '_')}`,
      definitionType,
      rulesetId: ruleset.id,
      rulesetVersion: version.id,
      canonicalId: `${ruleset.id}:${version.id}:${definitionType}:${slug}`,
      name,
      aliases,
      source: version.sourceLabel,
      packId: version.catalogPackId,
      packVersion: version.catalogPackVersion,
      locale: 'en',
    }))
  )));
}

export function builtInRuleContent(
  rulesetVersion: string,
  definitionType: DefinitionType,
  slug: string,
): BuiltInRuleContent | undefined {
  const generated = openSrdContentEntries.find((candidate) => (
    candidate.rulesetVersion === rulesetVersion
      && candidate.definitionType === definitionType
      && candidate.slug === slug
  ));
  if (generated) return structuredClone(generated);
  const entry = contentEntries.find((candidate) => (
    candidate[0] === rulesetVersion && candidate[1] === definitionType && candidate[2] === slug
  ));
  if (!entry) return undefined;
  return {
    shortDescription: entry[3], fullDescription: entry[4], searchText: entry[5],
    sourceReference: entry[6], typedContent: structuredClone(entry[7]), localizations: [],
  };
}

export function seedBuiltInRuleDefinitions(database: DatabaseSync): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO rule_definitions(
      id, definition_type, ruleset_id, ruleset_version, name, description,
      source, origin, metadata, is_homebrew, created_at, updated_at,
      campaign_id, canonical_id, aliases, pack_id, pack_version, locale, is_builtin
    ) VALUES (?, ?, ?, ?, ?, '', ?, 'builtin', ?, 0, ?, ?, NULL, ?, ?, ?, ?, ?, 1)
  `);
  const seededAt = '2026-09-01T00:00:00.000Z';
  for (const definition of builtInRuleDefinitions()) {
    insert.run(
      definition.id,
      definition.definitionType,
      definition.rulesetId,
      definition.rulesetVersion,
      definition.name,
      definition.source,
      JSON.stringify({ license: 'CC BY 4.0', localizedNameKey: definition.canonicalId }),
      seededAt,
      seededAt,
      definition.canonicalId,
      JSON.stringify(definition.aliases),
      definition.packId,
      definition.packVersion,
      definition.locale,
    );
  }
}

export function builtInRuleRelations(): RuleDefinitionRelation[] {
  const definitionIds = new Set(builtInRuleDefinitions().map((definition) => definition.id));
  const pairs = [
    ['Lineage', 'hill-dwarf', 'Species', 'dwarf', 'belongsToSpecies'],
    ['Lineage', 'high-elf', 'Species', 'elf', 'belongsToSpecies'],
    ['Lineage', 'lightfoot-halfling', 'Species', 'halfling', 'belongsToSpecies'],
    ['Subclass', 'champion', 'Class', 'fighter', 'belongsToClass'],
    ['Subclass', 'life-domain', 'Class', 'cleric', 'belongsToClass'],
    ['Subclass', 'school-of-evocation', 'Class', 'wizard', 'belongsToClass'],
    ['Subclass', 'oath-of-devotion', 'Class', 'paladin', 'belongsToClass'],
    ['Weapon', 'longsword', 'WeaponCategory', 'martial-melee', 'belongsToCategory'],
    ['Weapon', 'longsword', 'Property', 'versatile', 'hasProperty'],
  ] as const;
  const shared = listBuiltInRulesets().flatMap((ruleset) => ruleset.versions.flatMap((version) => pairs.map(([
    sourceType, sourceSlug, targetType, targetSlug, relationType,
  ]) => ({
    sourceDefinitionId: definitionId(ruleset.id, version.id, sourceType, sourceSlug),
    targetDefinitionId: definitionId(ruleset.id, version.id, targetType, targetSlug),
    relationType,
  })).filter((relation) => definitionIds.has(relation.sourceDefinitionId)
    && definitionIds.has(relation.targetDefinitionId))));
  const versioned = listBuiltInRulesets().flatMap((ruleset) => ruleset.versions
    .filter((version) => version.id === '2024')
    .map((version) => ({
      sourceDefinitionId: definitionId(ruleset.id, version.id, 'Weapon', 'longsword'),
      targetDefinitionId: definitionId(ruleset.id, version.id, 'Mastery', 'sap'),
      relationType: 'hasMastery' as const,
    })));
  return [...shared, ...versioned].filter((relation) => definitionIds.has(relation.sourceDefinitionId)
    && definitionIds.has(relation.targetDefinitionId));
}

export function seedBuiltInRuleRelations(database: DatabaseSync): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO rule_definition_relations(
      source_definition_id, target_definition_id, relation_type
    ) VALUES (?, ?, ?)
  `);
  for (const relation of builtInRuleRelations()) {
    insert.run(relation.sourceDefinitionId, relation.targetDefinitionId, relation.relationType);
  }
}

function definitionId(rulesetId: string, rulesetVersion: string, type: DefinitionType, slug: string): string {
  return `def_${rulesetId}_${rulesetVersion}_${type.toLocaleLowerCase('en-US')}_${slug.replaceAll('-', '_')}`;
}
