import type { ProficiencyLevel } from '../domain/character-models';

export interface RulesEngine {
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  getAbilityModifier(score: number): number;
  getProficiencyBonus(totalLevel: number): number;
  getProficiencyContribution(level: ProficiencyLevel, proficiencyBonus: number): number;
  getInitiative(abilityModifier: number, initiativeModifier: number): number;
  getSpellAttackBonus(
    abilityModifier: number,
    proficiencyBonus: number,
    attackModifier: number,
  ): number;
  getSpellSaveDc(abilityModifier: number, proficiencyBonus: number, dcModifier: number): number;
}

export class Dnd5eRulesEngine implements RulesEngine {
  readonly rulesetId = 'dnd5e';

  constructor(readonly rulesetVersion: '2014' | '2024') {}

  getAbilityModifier(score: number): number {
    return Math.floor((score - 10) / 2);
  }

  getProficiencyBonus(totalLevel: number): number {
    if (!Number.isInteger(totalLevel) || totalLevel < 1 || totalLevel > 20) {
      throw new Error(`D&D 5E total level musí být celé číslo 1–20, obdrženo ${totalLevel}.`);
    }
    return 2 + Math.floor((totalLevel - 1) / 4);
  }

  getProficiencyContribution(level: ProficiencyLevel, proficiencyBonus: number): number {
    switch (level) {
      case 'none':
        return 0;
      case 'half':
        return Math.floor(proficiencyBonus / 2);
      case 'proficient':
        return proficiencyBonus;
      case 'expertise':
        return proficiencyBonus * 2;
    }
  }

  getInitiative(abilityModifier: number, initiativeModifier: number): number {
    return abilityModifier + initiativeModifier;
  }

  getSpellAttackBonus(
    abilityModifier: number,
    proficiencyBonus: number,
    attackModifier: number,
  ): number {
    return abilityModifier + proficiencyBonus + attackModifier;
  }

  getSpellSaveDc(abilityModifier: number, proficiencyBonus: number, dcModifier: number): number {
    return 8 + abilityModifier + proficiencyBonus + dcModifier;
  }
}

export class RulesEngineRegistry {
  private readonly engines = new Map<string, RulesEngine>();

  constructor() {
    this.register(new Dnd5eRulesEngine('2014'));
    this.register(new Dnd5eRulesEngine('2024'));
  }

  register(engine: RulesEngine): void {
    this.engines.set(key(engine.rulesetId, engine.rulesetVersion), engine);
  }

  resolve(rulesetId: string, rulesetVersion: string): RulesEngine {
    const engine = this.engines.get(key(rulesetId, rulesetVersion));
    if (!engine) {
      throw new Error(
        `RulesEngine pro ${rulesetId}@${rulesetVersion} není registrovaný. `
        + 'Custom ruleset může dodat vlastní implementaci bez změny doménového schématu.',
      );
    }
    return engine;
  }
}

function key(rulesetId: string, rulesetVersion: string): string {
  return `${rulesetId}@${rulesetVersion}`;
}
