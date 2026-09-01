import type { DatabaseSync } from 'node:sqlite';
import type { DefinitionType } from '../domain/character-models';
import type { RuleDefinitionRelation } from '../shared/rules-packs';
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

type CatalogEntry = readonly [DefinitionType, string, string, (readonly string[])?];

const commonEntries: readonly CatalogEntry[] = [
  ['Species', 'human', 'Human', ['Člověk']],
  ['Species', 'dwarf', 'Dwarf', ['Trpaslík']],
  ['Species', 'elf', 'Elf', ['Elf']],
  ['Species', 'halfling', 'Halfling', ['Půlčík']],
  ['Species', 'dragonborn', 'Dragonborn', ['Drakorozený']],
  ['Species', 'gnome', 'Gnome', ['Gnóm']],
  ['Species', 'half-elf', 'Half-Elf', ['Půlelf']],
  ['Species', 'half-orc', 'Half-Orc', ['Půlork']],
  ['Species', 'tiefling', 'Tiefling', ['Tiefling']],
  ['Lineage', 'hill-dwarf', 'Hill Dwarf', ['Horský trpaslík']],
  ['Lineage', 'high-elf', 'High Elf', ['Vznešený elf']],
  ['Lineage', 'lightfoot-halfling', 'Lightfoot Halfling', ['Lehkonohý půlčík']],
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
  ['Background', 'criminal', 'Criminal', ['Zločinec']],
  ['Background', 'sage', 'Sage', ['Mudrc']],
  ['Background', 'soldier', 'Soldier', ['Voják']],
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
  ['Feat', 'tough', 'Tough', ['Houževnatý']],
  ['Feat', 'skilled', 'Skilled', ['Zkušený']],
  ['Spell', 'bless', 'Bless', ['Požehnání']],
  ['Spell', 'cure-wounds', 'Cure Wounds', ['Léčení zranění']],
  ['Spell', 'fireball', 'Fireball', ['Ohnivá koule']],
  ['Spell', 'guidance', 'Guidance', ['Vedení']],
  ['Spell', 'healing-word', 'Healing Word', ['Léčivé slovo']],
  ['Spell', 'light', 'Light', ['Světlo']],
  ['Spell', 'mage-hand', 'Mage Hand', ['Mágova ruka']],
  ['Spell', 'magic-missile', 'Magic Missile', ['Magická střela']],
  ['Spell', 'shield', 'Shield', ['Štít']],
] as const;

export function builtInRuleDefinitions(): BuiltInRuleDefinition[] {
  return listBuiltInRulesets().flatMap((ruleset) => ruleset.versions.flatMap((version) => (
    commonEntries.map(([definitionType, slug, name, aliases = []]) => ({
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
  const pairs = [
    ['Lineage', 'hill-dwarf', 'Species', 'dwarf', 'belongsToSpecies'],
    ['Lineage', 'high-elf', 'Species', 'elf', 'belongsToSpecies'],
    ['Lineage', 'lightfoot-halfling', 'Species', 'halfling', 'belongsToSpecies'],
    ['Subclass', 'champion', 'Class', 'fighter', 'belongsToClass'],
    ['Subclass', 'life-domain', 'Class', 'cleric', 'belongsToClass'],
    ['Subclass', 'school-of-evocation', 'Class', 'wizard', 'belongsToClass'],
    ['Subclass', 'oath-of-devotion', 'Class', 'paladin', 'belongsToClass'],
  ] as const;
  return listBuiltInRulesets().flatMap((ruleset) => ruleset.versions.flatMap((version) => pairs.map(([
    sourceType, sourceSlug, targetType, targetSlug, relationType,
  ]) => ({
    sourceDefinitionId: definitionId(ruleset.id, version.id, sourceType, sourceSlug),
    targetDefinitionId: definitionId(ruleset.id, version.id, targetType, targetSlug),
    relationType,
  }))));
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
