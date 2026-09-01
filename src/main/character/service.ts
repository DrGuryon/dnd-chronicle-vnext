import { createDomainId, requireDomainId, type DomainIdPrefix } from '../../domain/ids';
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
  DefinitionType,
  DerivedAbilityScore,
  EffectModifier,
  EntityResource,
  HitDiePool,
  RuleDefinition,
  SpellcastingSource,
  SpellSlotPool,
  StateChangeResult,
  StateChangeRecord,
} from '../../domain/character-models';
import type { Campaign, ChronicleEvent, EntityType, EventDraft } from '../../domain/models';
import { RulesEngineRegistry, type RulesEngine } from '../../rules/rules-engine';
import { SqliteChronicleRepository } from '../domain/repository';
import { SqliteCharacterRepository } from './repository';

type WithOptionalId<T extends { id: string }> = Omit<T, 'id'> & { id?: string };
type NewDefinition = Omit<
  RuleDefinition,
  'id' | 'createdAt' | 'updatedAt' | 'campaignId' | 'canonicalId' | 'aliases'
  | 'packId' | 'packVersion' | 'locale' | 'builtIn'
> & {
  id?: string;
  campaignId?: string | null;
  canonicalId?: string | null;
  aliases?: readonly string[];
  packId?: string | null;
  packVersion?: string;
  locale?: string;
  builtIn?: boolean;
};
type NewEffect = Omit<ActiveEffect, 'id' | 'startEventId' | 'endEventId'> & {
  id?: string;
  concentratingCharacterId?: string;
  event: EventDraft;
};

export class CharacterDomainService {
  constructor(
    private readonly repository: SqliteCharacterRepository,
    private readonly chronicleRepository: SqliteChronicleRepository,
    private readonly rules: RulesEngineRegistry,
  ) {}

  createDefinition(input: NewDefinition): RuleDefinition {
    return this.transaction(() => {
      const now = timestamp();
      const definition: RuleDefinition = {
        ...input,
        id: resolveId(input.id, 'def'),
        definitionType: requiredText(input.definitionType, 'Typ definice'),
        rulesetId: requiredText(input.rulesetId, 'Ruleset ID'),
        rulesetVersion: requiredText(input.rulesetVersion, 'Ruleset version'),
        name: requiredText(input.name, 'Název definice'),
        description: input.description.trim(),
        source: requiredText(input.source, 'Zdroj definice'),
        origin: requiredText(input.origin, 'Původ definice'),
        campaignId: input.campaignId ?? null,
        canonicalId: input.canonicalId ?? null,
        aliases: input.aliases ?? [],
        packId: input.packId ?? null,
        packVersion: input.packVersion ?? 'homebrew',
        locale: input.locale ?? 'cs',
        builtIn: input.builtIn ?? false,
        createdAt: now,
        updatedAt: now,
      };
      this.repository.insertDefinition(definition);
      return definition;
    });
  }

  getDefinition(id: string): RuleDefinition | undefined {
    return this.repository.getDefinition(id);
  }

  registerRulesEngine(engine: RulesEngine): void {
    this.rules.register(engine);
  }

  listDefinitions(filters: {
    rulesetId?: string;
    rulesetVersion?: string;
    definitionType?: DefinitionType | string;
  } = {}): RuleDefinition[] {
    return this.repository.listDefinitions(filters);
  }

  setBiography(
    characterId: string,
    input: Partial<Omit<CharacterBiography, 'characterId'>>,
  ): CharacterBiography {
    return this.transaction(() => {
      this.requireCharacter(characterId);
      const current = this.repository.getBiography(characterId);
      if (!current) throw new Error(`Character ${characterId} neexistuje.`);
      const biography: CharacterBiography = { ...current, ...input, characterId };
      if (biography.age !== null && (!Number.isInteger(biography.age) || biography.age < 0)) {
        throw new Error('Věk musí být nezáporné celé číslo nebo null.');
      }
      if (biography.faithDefinitionId) {
        this.requireDefinition(biography.faithDefinitionId, characterId, ['Deity', 'Custom']);
      }
      this.repository.updateBiography(biography);
      return biography;
    });
  }

  getBiography(characterId: string): CharacterBiography | undefined {
    return this.repository.getBiography(characterId);
  }

  setOrigin(characterId: string, input: Omit<CharacterOrigin, 'characterId'>): CharacterOrigin {
    return this.transaction(() => {
      this.requireCharacter(characterId);
      if (input.speciesId) this.requireDefinition(input.speciesId, characterId, ['Species', 'Race']);
      if (input.lineageId) this.requireDefinition(input.lineageId, characterId, ['Lineage', 'Subrace']);
      if (input.backgroundId) this.requireDefinition(input.backgroundId, characterId, ['Background']);
      const origin = { characterId, ...input };
      this.repository.updateOrigin(origin);
      return origin;
    });
  }

  getOrigin(characterId: string): CharacterOrigin | undefined {
    return this.repository.getOrigin(characterId);
  }

  addChoice(input: WithOptionalId<CharacterChoice>): CharacterChoice {
    return this.transaction(() => {
      this.requireCharacter(input.characterId);
      if (input.definitionId) this.requireDefinition(input.definitionId, input.characterId);
      const value = { ...input, id: resolveId(input.id, 'choice') };
      this.repository.insertChoice(value);
      return value;
    });
  }

  listChoices(characterId: string): CharacterChoice[] {
    this.requireCharacter(characterId);
    return this.repository.listChoices(characterId);
  }

  addClass(input: WithOptionalId<CharacterClass>): CharacterClass {
    return this.transaction(() => {
      const character = this.requireCharacter(input.characterId);
      this.requireDefinition(input.classId, input.characterId, ['Class']);
      if (input.subclassId) this.requireDefinition(input.subclassId, input.characterId, ['Subclass']);
      positiveInteger(input.level, 'Úroveň class');
      this.resolveRules(input.characterId).getProficiencyBonus(
        this.repository.getTotalLevel(input.characterId) + input.level,
      );
      this.validateEvent(input.acquiredEventId, character.campaignId);
      const value = { ...input, id: resolveId(input.id, 'class') };
      this.repository.insertClass(value);
      return value;
    });
  }

  listClasses(characterId: string): CharacterClass[] {
    this.requireCharacter(characterId);
    return this.repository.listClasses(characterId);
  }

  getTotalLevel(characterId: string): number {
    this.requireCharacter(characterId);
    return this.repository.getTotalLevel(characterId);
  }

  getProficiencyBonus(characterId: string): number {
    return this.resolveRules(characterId).getProficiencyBonus(this.getTotalLevel(characterId));
  }

  setAbilityScore(value: AbilityScoreState): AbilityScoreState {
    return this.transaction(() => {
      this.requireCharacter(value.characterId);
      integerInRange(value.baseScore, -100, 100, 'Base ability score');
      integerInRange(value.permanentModifier, -100, 100, 'Permanent ability modifier');
      if (value.overrideScore !== null) {
        integerInRange(value.overrideScore, -100, 100, 'Ability override');
      }
      this.repository.upsertAbility(value);
      return value;
    });
  }

  getAbilityScore(characterId: string, abilityId: AbilityId): DerivedAbilityScore {
    const state = this.repository.getAbility(characterId, abilityId);
    if (!state) throw new Error(`Ability ${abilityId} pro ${characterId} není nastavená.`);
    const modifiers = this.effectModifiers(characterId);
    const additions = modifiers
      .filter((modifier): modifier is Extract<EffectModifier, { kind: 'ability.add' }> => (
        modifier.kind === 'ability.add' && modifier.abilityId === abilityId
      ))
      .reduce((sum, modifier) => sum + modifier.value, 0);
    const sets = modifiers.filter((modifier): modifier is Extract<EffectModifier, { kind: 'ability.set' }> => (
      modifier.kind === 'ability.set' && modifier.abilityId === abilityId
    ));
    const temporarySetValue = highestPrioritySet(sets);
    const permanentScore = state.overrideScore ?? state.baseScore + state.permanentModifier;
    const score = (temporarySetValue ?? permanentScore) + additions;
    return {
      ...state,
      temporaryModifier: additions,
      temporarySetValue,
      score,
      modifier: this.resolveRules(characterId).getAbilityModifier(score),
    };
  }

  addProficiency(input: WithOptionalId<CharacterProficiency>): CharacterProficiency {
    return this.transaction(() => {
      this.requireCharacter(input.characterId);
      if (!input.targetDefinitionId && !input.customTarget?.trim()) {
        throw new Error('Proficiency musí odkazovat na definici nebo vlastní cíl.');
      }
      if (input.targetDefinitionId) this.requireDefinition(input.targetDefinitionId, input.characterId);
      const value = { ...input, id: resolveId(input.id, 'proficiency') };
      this.repository.insertProficiency(value);
      return value;
    });
  }

  getProficiencyCheckBonus(
    characterId: string,
    proficiencyId: string,
    abilityId: AbilityId,
  ): number {
    const proficiency = this.repository.getProficiency(proficiencyId);
    if (!proficiency || proficiency.characterId !== characterId) {
      throw new Error(`Proficiency ${proficiencyId} postavy ${characterId} neexistuje.`);
    }
    const engine = this.resolveRules(characterId);
    return this.getAbilityScore(characterId, abilityId).modifier
      + engine.getProficiencyContribution(proficiency.level, this.getProficiencyBonus(characterId));
  }

  listProficiencies(characterId: string): CharacterProficiency[] {
    this.requireCharacter(characterId);
    return this.repository.listProficiencies(characterId);
  }

  setCombatState(value: CharacterCombatState): CharacterCombatState {
    return this.transaction(() => {
      this.requireCharacter(value.characterId);
      validateCombatState(value);
      this.repository.upsertCombatState(value);
      return value;
    });
  }

  getCombatState(characterId: string): CharacterCombatState | undefined {
    this.requireCharacter(characterId);
    return this.repository.getCombatState(characterId);
  }

  getArmorClass(characterId: string): number {
    const state = this.requireCombatState(characterId);
    const modifiers = this.effectModifiers(characterId);
    const additions = modifiers
      .filter((modifier): modifier is Extract<EffectModifier, { kind: 'armorClass.add' }> => (
        modifier.kind === 'armorClass.add'
      ))
      .reduce((sum, modifier) => sum + modifier.value, 0);
    const temporarySet = highestPrioritySet(
      modifiers.filter((modifier): modifier is Extract<EffectModifier, { kind: 'armorClass.set' }> => (
        modifier.kind === 'armorClass.set'
      )),
    );
    return (temporarySet ?? state.armorClassOverride ?? state.armorClassBase + state.armorClassModifier)
      + additions;
  }

  getInitiative(characterId: string): number {
    const state = this.requireCombatState(characterId);
    const additions = this.effectModifiers(characterId)
      .filter((modifier): modifier is Extract<EffectModifier, { kind: 'initiative.add' }> => (
        modifier.kind === 'initiative.add'
      ))
      .reduce((sum, modifier) => sum + modifier.value, 0);
    return this.resolveRules(characterId).getInitiative(
      this.getAbilityScore(characterId, 'dexterity').modifier,
      state.initiativeModifier + additions,
    );
  }

  addHitDiePool(input: WithOptionalId<HitDiePool>): HitDiePool {
    return this.transaction(() => {
      this.requireCharacter(input.characterId);
      if (![4, 6, 8, 10, 12, 20].includes(input.dieSize)) throw new Error('Neplatná velikost hit die.');
      nonNegativeInteger(input.current, 'Current hit dice');
      nonNegativeInteger(input.maximum, 'Maximum hit dice');
      boundedAmount(input.current, input.maximum, 'Hit dice');
      const value = { ...input, id: resolveId(input.id, 'hitdie') };
      this.repository.insertHitDiePool(value);
      return value;
    });
  }

  listHitDiePools(characterId: string): HitDiePool[] {
    this.requireCharacter(characterId);
    return this.repository.listHitDiePools(characterId);
  }

  addMovement(input: WithOptionalId<CharacterMovement>): CharacterMovement {
    finiteNumber(input.distance, 'Movement distance');
    if (input.distance < 0) throw new Error('Movement distance nesmí být záporná.');
    return this.insertCharacterValue(input, 'movement', (value) => this.repository.insertMovement(value));
  }

  listMovements(characterId: string): CharacterMovement[] {
    this.requireCharacter(characterId);
    return this.repository.listMovements(characterId);
  }

  listEffectiveMovements(characterId: string): CharacterMovement[] {
    const movements = this.listMovements(characterId);
    const modifiers = this.effectModifiers(characterId).filter(
      (modifier): modifier is Extract<EffectModifier, { kind: 'movement.add' }> => (
        modifier.kind === 'movement.add'
      ),
    );
    return movements.map((movement) => ({
      ...movement,
      distance: movement.distance + modifiers
        .filter((modifier) => modifier.movementType === movement.movementType)
        .reduce((sum, modifier) => sum + modifier.value, 0),
    }));
  }

  addSense(input: WithOptionalId<CharacterSense>): CharacterSense {
    if (input.range !== null) {
      finiteNumber(input.range, 'Sense range');
      if (input.range < 0) throw new Error('Sense range nesmí být záporný.');
    }
    return this.insertCharacterValue(input, 'sense', (value) => this.repository.insertSense(value));
  }

  listSenses(characterId: string): CharacterSense[] {
    this.requireCharacter(characterId);
    return this.repository.listSenses(characterId);
  }

  addDefense(input: WithOptionalId<CharacterDefense>): CharacterDefense {
    this.requireDefinition(
      input.definitionId,
      input.characterId,
      input.defenseType === 'conditionImmunity' ? ['Condition'] : ['DamageType'],
    );
    return this.insertCharacterValue(input, 'defense', (value) => this.repository.insertDefense(value));
  }

  listDefenses(characterId: string): CharacterDefense[] {
    this.requireCharacter(characterId);
    return this.repository.listDefenses(characterId);
  }

  addFeature(input: WithOptionalId<CharacterFeature>): CharacterFeature {
    return this.transaction(() => {
      const character = this.requireCharacter(input.characterId);
      if (input.definitionId) {
        this.requireDefinition(input.definitionId, input.characterId, ['Feature', 'Feat', 'Custom']);
      }
      if (!input.definitionId && !input.customName?.trim()) {
        throw new Error('Feature musí odkazovat na definici nebo mít vlastní název.');
      }
      this.validateEvent(input.acquiredEventId, character.campaignId);
      const value = { ...input, id: resolveId(input.id, 'feature') };
      this.repository.insertFeature(value);
      return value;
    });
  }

  listFeatures(characterId: string): CharacterFeature[] {
    this.requireCharacter(characterId);
    return this.repository.listFeatures(characterId);
  }

  getFeature(id: string): CharacterFeature | undefined {
    return this.repository.getFeature(id);
  }

  addResource(input: WithOptionalId<EntityResource>): EntityResource {
    return this.transaction(() => {
      this.requireEntity(input.ownerEntityId);
      boundedAmount(input.current, input.maximum, 'Resource');
      const value = { ...input, id: resolveId(input.id, 'resource'), name: requiredText(input.name, 'Resource name') };
      this.repository.insertResource(value);
      return value;
    });
  }

  getResource(id: string): EntityResource | undefined {
    return this.repository.getResource(id);
  }

  listResources(ownerEntityId: string): EntityResource[] {
    this.requireEntity(ownerEntityId);
    return this.repository.listResources(ownerEntityId);
  }

  addAction(input: WithOptionalId<CharacterAction>): CharacterAction {
    return this.transaction(() => {
      this.requireEntity(input.ownerEntityId);
      const value = { ...input, id: resolveId(input.id, 'action'), name: requiredText(input.name, 'Action name') };
      this.repository.insertAction(value);
      return value;
    });
  }

  listActions(ownerEntityId: string): CharacterAction[] {
    this.requireEntity(ownerEntityId);
    return this.repository.listActions(ownerEntityId);
  }

  getAction(id: string): CharacterAction | undefined {
    return this.repository.getAction(id);
  }

  addSpellcastingSource(input: WithOptionalId<SpellcastingSource>): SpellcastingSource {
    return this.insertCharacterValue(input, 'spellsource', (value) => this.repository.insertSpellcastingSource(value));
  }

  listSpellcastingSources(characterId: string): SpellcastingSource[] {
    this.requireCharacter(characterId);
    return this.repository.listSpellcastingSources(characterId);
  }

  getSpellAttackBonus(sourceId: string): number {
    const source = this.requireSpellcastingSource(sourceId);
    return this.resolveRules(source.characterId).getSpellAttackBonus(
      this.getAbilityScore(source.characterId, source.spellcastingAbilityId).modifier,
      this.getProficiencyBonus(source.characterId),
      source.attackModifier,
    );
  }

  getSpellcastingSource(id: string): SpellcastingSource | undefined {
    return this.repository.getSpellcastingSource(id);
  }

  getSpellSaveDc(sourceId: string): number {
    const source = this.requireSpellcastingSource(sourceId);
    return this.resolveRules(source.characterId).getSpellSaveDc(
      this.getAbilityScore(source.characterId, source.spellcastingAbilityId).modifier,
      this.getProficiencyBonus(source.characterId),
      source.dcModifier,
    );
  }

  addSpell(input: WithOptionalId<CharacterSpell>): CharacterSpell {
    return this.transaction(() => {
      const character = this.requireCharacter(input.characterId);
      this.requireDefinition(input.spellId, input.characterId, ['Spell']);
      const source = this.requireSpellcastingSource(input.spellcastingSourceId);
      if (source.characterId !== input.characterId) throw new Error('Spellcasting source patří jiné postavě.');
      this.validateEvent(input.acquiredEventId, character.campaignId);
      const value = { ...input, id: resolveId(input.id, 'spell') };
      this.repository.insertSpell(value);
      return value;
    });
  }

  listSpells(characterId: string): CharacterSpell[] {
    this.requireCharacter(characterId);
    return this.repository.listSpells(characterId);
  }

  addSpellSlotPool(input: WithOptionalId<SpellSlotPool>): SpellSlotPool {
    return this.transaction(() => {
      this.requireCharacter(input.characterId);
      if (input.spellcastingSourceId) {
        const source = this.requireSpellcastingSource(input.spellcastingSourceId);
        if (source.characterId !== input.characterId) throw new Error('Spell slot pool patří jiné postavě.');
      }
      boundedAmount(input.current, input.maximum, 'Spell slots');
      nonNegativeInteger(input.slotLevel, 'Spell slot level');
      nonNegativeInteger(input.current, 'Current spell slots');
      nonNegativeInteger(input.maximum, 'Maximum spell slots');
      const value = { ...input, id: resolveId(input.id, 'pool') };
      this.repository.insertSlotPool(value);
      return value;
    });
  }

  listSpellSlotPools(characterId: string): SpellSlotPool[] {
    this.requireCharacter(characterId);
    return this.repository.listSlotPools(characterId);
  }

  changeHp(characterId: string, amount: number, event: EventDraft): StateChangeResult<CharacterCombatState> {
    return this.transaction(() => {
      finiteNumber(amount, 'HP change');
      const state = this.requireCombatState(characterId);
      const previous = state.currentHp;
      const currentHp = Math.max(0, Math.min(state.maximumHp, previous + amount));
      const next = { ...state, currentHp };
      const recorded = this.insertEventForEntity(characterId, event);
      this.repository.upsertCombatState(next);
      this.recordState(characterId, recorded.id, 'combat', 'currentHp', previous, currentHp);
      return { state: next, eventId: recorded.id };
    });
  }

  setTemporaryHp(characterId: string, value: number, event: EventDraft): StateChangeResult<CharacterCombatState> {
    return this.transaction(() => {
      nonNegativeInteger(value, 'Temporary HP');
      const state = this.requireCombatState(characterId);
      const next = { ...state, temporaryHp: value };
      const recorded = this.insertEventForEntity(characterId, event);
      this.repository.upsertCombatState(next);
      this.recordState(characterId, recorded.id, 'combat', 'temporaryHp', state.temporaryHp, value);
      return { state: next, eventId: recorded.id };
    });
  }

  spendResource(resourceId: string, amount: number, event: EventDraft): StateChangeResult<EntityResource> {
    return this.changeResource(resourceId, -positiveAmount(amount, 'Resource spend'), event, false);
  }

  restoreResource(resourceId: string, amount: number, event: EventDraft): StateChangeResult<EntityResource> {
    return this.changeResource(resourceId, positiveAmount(amount, 'Resource restore'), event, true);
  }

  spendSpellSlot(poolId: string, event: EventDraft): StateChangeResult<SpellSlotPool> {
    return this.transaction(() => {
      const pool = this.requireSlotPool(poolId);
      if (pool.current < 1) throw new Error(`Spell slot pool ${poolId} je prázdný.`);
      const recorded = this.insertEventForEntity(pool.characterId, event);
      const state = { ...pool, current: pool.current - 1 };
      this.repository.updateSlotPoolCurrent(pool.id, state.current);
      this.recordState(pool.characterId, recorded.id, 'spellSlot', pool.id, pool.current, state.current);
      return { state, eventId: recorded.id };
    });
  }

  restoreSpellSlot(poolId: string, event: EventDraft): StateChangeResult<SpellSlotPool> {
    return this.transaction(() => {
      const pool = this.requireSlotPool(poolId);
      if (pool.current >= pool.maximum) throw new Error(`Spell slot pool ${poolId} je už plný.`);
      const recorded = this.insertEventForEntity(pool.characterId, event);
      const state = { ...pool, current: pool.current + 1 };
      this.repository.updateSlotPoolCurrent(pool.id, state.current);
      this.recordState(pool.characterId, recorded.id, 'spellSlot', pool.id, pool.current, state.current);
      return { state, eventId: recorded.id };
    });
  }

  resetResourcesForShortRest(characterId: string, event: EventDraft): StateChangeResult<{
    resources: EntityResource[];
    spellSlotPools: SpellSlotPool[];
  }> {
    return this.resetForRest(characterId, 'short', event);
  }

  resetResourcesForLongRest(characterId: string, event: EventDraft): StateChangeResult<{
    resources: EntityResource[];
    spellSlotPools: SpellSlotPool[];
  }> {
    return this.resetForRest(characterId, 'long', event);
  }

  addEffect(input: NewEffect): StateChangeResult<ActiveEffect> {
    return this.transaction(() => this.addEffectInTransaction(input));
  }

  endEffect(effectId: string, event: EventDraft): StateChangeResult<ActiveEffect> {
    return this.transaction(() => {
      const effect = this.requireActiveEffect(effectId);
      const recorded = this.insertEventForEntity(effect.targetEntityId, event);
      this.repository.endEffect(effect.id, recorded.id);
      const concentratingCharacter = this.repository.getConcentrationOwner(effect.id);
      if (concentratingCharacter) this.repository.clearConcentration(concentratingCharacter);
      const state = { ...effect, endEventId: recorded.id, concentration: false };
      this.recordState(effect.targetEntityId, recorded.id, 'effect', effect.id, 'active', 'ended');
      return { state, eventId: recorded.id };
    });
  }

  applyCondition(input: Omit<NewEffect, 'concentration'> & { definitionId: string }): StateChangeResult<ActiveEffect> {
    this.requireDefinition(input.definitionId, input.targetEntityId, ['Condition']);
    return this.addEffect({ ...input, concentration: false });
  }

  removeCondition(effectId: string, event: EventDraft): StateChangeResult<ActiveEffect> {
    const effect = this.requireActiveEffect(effectId);
    if (!effect.definitionId || this.repository.getDefinition(effect.definitionId)?.definitionType !== 'Condition') {
      throw new Error(`Effect ${effectId} není condition.`);
    }
    return this.endEffect(effectId, event);
  }

  startConcentration(
    characterId: string,
    effectId: string,
    event: EventDraft,
  ): StateChangeResult<ActiveEffect> {
    return this.transaction(() => {
      this.requireCharacter(characterId);
      const effect = this.requireActiveEffect(effectId);
      this.requireEntity(effect.targetEntityId, this.requireCharacter(characterId).campaignId);
      const recorded = this.insertEventForEntity(characterId, event);
      this.replaceConcentration(characterId, effect, recorded.id);
      return { state: { ...effect, concentration: true }, eventId: recorded.id };
    });
  }

  endConcentration(characterId: string, event: EventDraft): StateChangeResult<ActiveEffect | null> {
    return this.transaction(() => {
      this.requireCharacter(characterId);
      const effectId = this.repository.getConcentration(characterId);
      const recorded = this.insertEventForEntity(characterId, event);
      if (!effectId) return { state: null, eventId: recorded.id };
      const effect = this.requireActiveEffect(effectId);
      this.repository.endEffect(effect.id, recorded.id);
      this.repository.clearConcentration(characterId);
      this.recordState(characterId, recorded.id, 'concentration', 'activeEffect', effect.id, null);
      return { state: { ...effect, endEventId: recorded.id, concentration: false }, eventId: recorded.id };
    });
  }

  getConcentration(characterId: string): ActiveEffect | undefined {
    const effectId = this.repository.getConcentration(characterId);
    return effectId ? this.repository.getEffect(effectId) : undefined;
  }

  getEffect(id: string): ActiveEffect | undefined {
    return this.repository.getEffect(id);
  }

  listActiveEffects(entityId: string): ActiveEffect[] {
    this.requireEntity(entityId);
    return this.repository.listActiveEffects(entityId);
  }

  listStateChanges(entityId: string): StateChangeRecord[] {
    this.requireEntity(entityId);
    return this.repository.listStateChanges(entityId);
  }

  spendHitDie(poolId: string, event: EventDraft): StateChangeResult<HitDiePool> {
    return this.transaction(() => {
      const pool = this.requireHitDiePool(poolId);
      if (pool.current < 1) throw new Error(`Hit die pool ${poolId} je prázdný.`);
      const recorded = this.insertEventForEntity(pool.characterId, event);
      const state = { ...pool, current: pool.current - 1 };
      this.repository.updateHitDieCurrent(pool.id, state.current);
      this.recordState(pool.characterId, recorded.id, 'hitDie', pool.id, pool.current, state.current);
      return { state, eventId: recorded.id };
    });
  }

  recordDeathSave(
    characterId: string,
    success: boolean,
    event: EventDraft,
  ): StateChangeResult<CharacterCombatState> {
    return this.transaction(() => {
      const state = this.requireCombatState(characterId);
      const key = success ? 'deathSaveSuccesses' : 'deathSaveFailures';
      const previous = state[key];
      if (previous >= 3) throw new Error(`Death save ${success ? 'successes' : 'failures'} jsou už na maximu.`);
      const next = { ...state, [key]: previous + 1 };
      const recorded = this.insertEventForEntity(characterId, event);
      this.repository.upsertCombatState(next);
      this.recordState(characterId, recorded.id, 'combat', key, previous, previous + 1);
      return { state: next, eventId: recorded.id };
    });
  }

  setInspiration(
    characterId: string,
    inspiration: boolean,
    event: EventDraft,
  ): StateChangeResult<CharacterCombatState> {
    return this.transaction(() => {
      const state = this.requireCombatState(characterId);
      const recorded = this.insertEventForEntity(characterId, event);
      const next = { ...state, inspiration };
      this.repository.upsertCombatState(next);
      this.recordState(
        characterId,
        recorded.id,
        'combat',
        'inspiration',
        state.inspiration,
        inspiration,
      );
      return { state: next, eventId: recorded.id };
    });
  }

  private addEffectInTransaction(input: NewEffect): StateChangeResult<ActiveEffect> {
    const target = this.requireEntity(input.targetEntityId);
    if (input.definitionId) this.requireDefinition(input.definitionId, input.targetEntityId);
    if (input.sourceEntityId) this.requireEntity(input.sourceEntityId, target.campaignId);
    if (input.sourceSpellId) this.requireDefinition(input.sourceSpellId, input.targetEntityId, ['Spell']);
    const { event, concentratingCharacterId, id, ...effectInput } = input;
    const recorded = this.insertEventForEntity(input.targetEntityId, event);
    const effect: ActiveEffect = {
      ...effectInput,
      id: resolveId(id, 'effect'),
      name: requiredText(input.name, 'Effect name'),
      startEventId: recorded.id,
      endEventId: null,
    };
    this.repository.insertEffect(effect);
    if (effect.concentration) {
      const characterId = concentratingCharacterId ?? effect.targetEntityId;
      this.requireEntity(characterId, target.campaignId, 'Character');
      this.replaceConcentration(characterId, effect, recorded.id);
    }
    this.recordState(effect.targetEntityId, recorded.id, 'effect', effect.id, null, 'active');
    return { state: effect, eventId: recorded.id };
  }

  private replaceConcentration(characterId: string, effect: ActiveEffect, eventId: string): void {
    const previousId = this.repository.getConcentration(characterId);
    if (previousId && previousId !== effect.id) {
      this.repository.endEffect(previousId, eventId);
      this.recordState(characterId, eventId, 'effect', previousId, 'active', 'ended');
    }
    this.repository.setEffectConcentration(effect.id, true);
    this.repository.setConcentration(characterId, effect.id);
    this.recordState(characterId, eventId, 'concentration', 'activeEffect', previousId ?? null, effect.id);
  }

  private changeResource(
    resourceId: string,
    delta: number,
    event: EventDraft,
    capAtMaximum: boolean,
  ): StateChangeResult<EntityResource> {
    return this.transaction(() => {
      const resource = this.repository.getResource(resourceId);
      if (!resource) throw new Error(`Resource ${resourceId} neexistuje.`);
      const raw = resource.current + delta;
      if (raw < 0) throw new Error(`Resource ${resourceId} nemá dostatek bodů.`);
      const current = capAtMaximum ? Math.min(resource.maximum, raw) : raw;
      if (current > resource.maximum) throw new Error(`Resource ${resourceId} by překročil maximum.`);
      const recorded = this.insertEventForEntity(resource.ownerEntityId, event);
      const state = { ...resource, current };
      this.repository.updateResourceCurrent(resource.id, current);
      this.recordState(resource.ownerEntityId, recorded.id, 'resource', resource.id, resource.current, current);
      return { state, eventId: recorded.id };
    });
  }

  private resetForRest(
    characterId: string,
    rest: 'short' | 'long',
    event: EventDraft,
  ): StateChangeResult<{ resources: EntityResource[]; spellSlotPools: SpellSlotPool[] }> {
    return this.transaction(() => {
      this.requireCharacter(characterId);
      const recorded = this.insertEventForEntity(characterId, event);
      const resetRules = rest === 'short'
        ? new Set(['shortRest', 'shortOrLongRest'])
        : new Set(['shortRest', 'shortOrLongRest', 'longRest']);
      const resources = this.repository.listResources(characterId).map((resource) => {
        if (!resetRules.has(resource.resetRule) || resource.current === resource.maximum) return resource;
        this.repository.updateResourceCurrent(resource.id, resource.maximum);
        this.recordState(characterId, recorded.id, 'resource', resource.id, resource.current, resource.maximum);
        return { ...resource, current: resource.maximum };
      });
      const spellSlotPools = this.repository.listSlotPools(characterId).map((pool) => {
        if (!resetRules.has(pool.resetRule) || pool.current === pool.maximum) return pool;
        this.repository.updateSlotPoolCurrent(pool.id, pool.maximum);
        this.recordState(characterId, recorded.id, 'spellSlot', pool.id, pool.current, pool.maximum);
        return { ...pool, current: pool.maximum };
      });
      return { state: { resources, spellSlotPools }, eventId: recorded.id };
    });
  }

  private insertCharacterValue<T extends { id: string; characterId: string }>(
    input: Omit<T, 'id'> & { id?: string },
    prefix: DomainIdPrefix,
    insert: (value: T) => void,
  ): T {
    return this.transaction(() => {
      this.requireCharacter(input.characterId);
      const value = { ...input, id: resolveId(input.id, prefix) } as T;
      insert(value);
      return value;
    });
  }

  private requireCharacter(id: string): { campaignId: string; entityType: EntityType } {
    return this.requireEntity(id, undefined, 'Character');
  }

  private requireEntity(
    id: string,
    campaignId?: string,
    entityType?: EntityType,
  ): { campaignId: string; entityType: EntityType } {
    const entity = this.chronicleRepository.getEntityIdentity(id);
    if (!entity) throw new Error(`Entita ${id} neexistuje.`);
    if (campaignId && entity.campaignId !== campaignId) throw new Error(`Entita ${id} patří jiné kampani.`);
    if (entityType && entity.entityType !== entityType) throw new Error(`Entita ${id} není typu ${entityType}.`);
    return entity;
  }

  private requireDefinition(
    definitionId: string,
    characterOrEntityId: string,
    types?: readonly DefinitionType[],
  ): RuleDefinition {
    const definition = this.repository.getDefinition(definitionId);
    if (!definition) throw new Error(`Rule definition ${definitionId} neexistuje.`);
    const entity = this.requireEntity(characterOrEntityId);
    const campaign = this.requireCampaign(entity.campaignId);
    if (definition.rulesetId !== campaign.rulesetId || definition.rulesetVersion !== campaign.rulesetVersion) {
      throw new Error(`Rule definition ${definitionId} nepatří do rulesetu kampaně.`);
    }
    if (types && !types.includes(definition.definitionType as DefinitionType)) {
      throw new Error(`Rule definition ${definitionId} není typu ${types.join(' nebo ')}.`);
    }
    return definition;
  }

  private requireCampaign(id: string): Campaign {
    const campaign = this.chronicleRepository.getCampaign(id);
    if (!campaign) throw new Error(`Kampaň ${id} neexistuje.`);
    return campaign;
  }

  private requireCombatState(characterId: string): CharacterCombatState {
    this.requireCharacter(characterId);
    const state = this.repository.getCombatState(characterId);
    if (!state) throw new Error(`Combat state postavy ${characterId} není nastavený.`);
    return state;
  }

  private requireSpellcastingSource(id: string): SpellcastingSource {
    const source = this.repository.getSpellcastingSource(id);
    if (!source) throw new Error(`Spellcasting source ${id} neexistuje.`);
    return source;
  }

  private requireSlotPool(id: string): SpellSlotPool {
    const pool = this.repository.getSlotPool(id);
    if (!pool) throw new Error(`Spell slot pool ${id} neexistuje.`);
    return pool;
  }

  private requireHitDiePool(id: string): HitDiePool {
    const pool = this.repository.getHitDiePool(id);
    if (!pool) throw new Error(`Hit die pool ${id} neexistuje.`);
    return pool;
  }

  private requireActiveEffect(id: string): ActiveEffect {
    const effect = this.repository.getEffect(id);
    if (!effect || effect.endEventId) throw new Error(`Aktivní effect ${id} neexistuje.`);
    return effect;
  }

  private resolveRules(characterId: string): RulesEngine {
    const character = this.requireCharacter(characterId);
    const campaign = this.requireCampaign(character.campaignId);
    return this.rules.resolve(campaign.rulesetId, campaign.rulesetVersion);
  }

  private effectModifiers(entityId: string): readonly EffectModifier[] {
    return this.repository.listActiveEffects(entityId).flatMap((effect) => effect.modifiers);
  }

  private insertEventForEntity(entityId: string, draft: EventDraft): ChronicleEvent {
    const entity = this.requireEntity(entityId);
    if (draft.locationId) this.requireEntity(draft.locationId, entity.campaignId, 'Location');
    const now = timestamp();
    const event: ChronicleEvent = {
      id: resolveId(draft.id, 'event'),
      campaignId: entity.campaignId,
      eventType: requiredText(draft.eventType, 'Event type'),
      sequence: this.chronicleRepository.nextEventSequence(entity.campaignId),
      timestamp: draft.timestamp ?? null,
      locationId: draft.locationId ?? null,
      summary: requiredText(draft.summary, 'Event summary'),
      sourceMessageId: draft.sourceMessageId ?? null,
      createdAt: now,
    };
    this.chronicleRepository.insertEvent(event);
    return event;
  }

  private validateEvent(eventId: string | null, campaignId: string): void {
    if (eventId && !this.chronicleRepository.eventBelongsToCampaign(eventId, campaignId)) {
      throw new Error(`Event ${eventId} nepatří do kampaně ${campaignId}.`);
    }
  }

  private recordState(
    entityId: string,
    eventId: string,
    stateType: string,
    stateKey: string,
    before: unknown,
    after: unknown,
  ): void {
    this.repository.insertStateChange(
      createDomainId('state'), entityId, eventId, stateType, stateKey,
      before, after, timestamp(),
    );
  }

  private transaction<T>(work: () => T): T {
    return this.chronicleRepository.transaction(work);
  }
}

function resolveId(id: string | undefined, prefix: DomainIdPrefix): string {
  return id ? requireDomainId(id, prefix) : createDomainId(prefix);
}

function highestPrioritySet<T extends { value: number; priority?: number }>(values: readonly T[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((selected, candidate) => (
    (candidate.priority ?? 0) >= (selected.priority ?? 0) ? candidate : selected
  )).value;
}

function validateCombatState(state: CharacterCombatState): void {
  nonNegativeInteger(state.maximumHp, 'Maximum HP');
  integerInRange(state.currentHp, 0, state.maximumHp, 'Current HP');
  nonNegativeInteger(state.temporaryHp, 'Temporary HP');
  integerInRange(state.armorClassBase, -100, 100, 'Armor Class base');
  integerInRange(state.armorClassModifier, -100, 100, 'Armor Class modifier');
  if (state.armorClassOverride !== null) {
    integerInRange(state.armorClassOverride, -100, 100, 'Armor Class override');
  }
  integerInRange(state.initiativeModifier, -100, 100, 'Initiative modifier');
  integerInRange(state.deathSaveSuccesses, 0, 3, 'Death save successes');
  integerInRange(state.deathSaveFailures, 0, 3, 'Death save failures');
}

function boundedAmount(current: number, maximum: number, label: string): void {
  finiteNumber(current, `${label} current`);
  finiteNumber(maximum, `${label} maximum`);
  if (current < 0 || maximum < 0 || current > maximum) {
    throw new Error(`${label} musí splňovat 0 ≤ current ≤ maximum.`);
  }
}

function positiveAmount(value: number, label: string): number {
  finiteNumber(value, label);
  if (value <= 0) throw new Error(`${label} musí být kladné číslo.`);
  return value;
}

function nonNegativeInteger(value: number, label: string): void {
  integerInRange(value, 0, Number.MAX_SAFE_INTEGER, label);
}

function positiveInteger(value: number, label: string): void {
  integerInRange(value, 1, Number.MAX_SAFE_INTEGER, label);
}

function integerInRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} musí být celé číslo od ${minimum} do ${maximum}.`);
  }
}

function finiteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} musí být konečné číslo.`);
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} nesmí být prázdný.`);
  return normalized;
}

function timestamp(): string {
  return new Date().toISOString();
}
