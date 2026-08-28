import { AbilityIds, type CharacterFeature, type RuleDefinition } from '../../domain/character-models';
import type { Character, ItemPlacement } from '../../domain/models';
import type {
  ActionCardView,
  CharacterCardView,
  CharacterCockpitView,
  CockpitActionView,
  CockpitEffectView,
  CockpitFeatureView,
  CockpitResourceView,
  CockpitSpellSlotPoolView,
  DefinitionCardView,
  EffectCardView,
  EntityCardKind,
  EntityCardRequest,
  EntityCardView,
  EntitySummary,
  FeatureCardView,
  ItemCardView,
  LocationCardView,
} from '../../shared/read-models';
import { CharacterDomainService } from '../character/service';
import { ChronicleDomainService } from '../domain/service';
import { UiPreferencesService } from '../preferences/service';

const abilityAbbreviations = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
} as const;

export class ChronicleReadModelService {
  constructor(
    private readonly domain: ChronicleDomainService,
    private readonly characters: CharacterDomainService,
    private readonly preferences: UiPreferencesService,
  ) {}

  getInitialCockpit(): CharacterCockpitView | null {
    const character = this.domain.listCharacters()[0];
    return character ? this.getCharacterCockpit(character.id) : null;
  }

  getCharacterCockpit(characterId: string): CharacterCockpitView {
    const character = this.domain.getCharacter(characterId);
    if (!character) throw new Error(`Character ${characterId} neexistuje.`);
    const classes = this.characters.listClasses(characterId);
    const classViews = classes.map((entry) => {
      const definition = this.requireDefinition(entry.classId);
      const subclass = entry.subclassId ? this.characters.getDefinition(entry.subclassId) : undefined;
      return {
        entry,
        definition,
        summary: summary(
          definition,
          subclass ? `${subclass.name} · level ${entry.level}` : `Level ${entry.level}`,
          characterId,
        ),
      };
    });
    const origin = this.characters.getOrigin(characterId);
    const combat = this.characters.getCombatState(characterId);
    if (!combat) throw new Error(`Character ${characterId} nemá combat state.`);
    const movements = this.characters.listEffectiveMovements(characterId);
    const proficiencies = this.characters.listProficiencies(characterId);
    const resources = this.characters.listResources(characterId).map((resource) => (
      this.resourceView(resource, characterId)
    ));
    const actions = this.characters.listActions(characterId).map((action) => (
      this.actionView(action, characterId)
    ));
    const features = this.characters.listFeatures(characterId).map((feature) => (
      this.featureView(feature, characterId)
    ));
    const sources = this.characters.listSpellcastingSources(characterId);
    const sourceViews = sources.map((source) => ({
      id: source.id,
      label: this.sourceLabel(source.sourceId, characterId),
      mechanism: source.mechanism,
      abilityId: source.spellcastingAbilityId,
      attackBonus: this.characters.getSpellAttackBonus(source.id),
      saveDc: this.characters.getSpellSaveDc(source.id),
      source: this.trySummary(source.sourceId, characterId),
    }));
    const spells = this.characters.listSpells(characterId).map((spell) => {
      const definition = this.requireDefinition(spell.spellId, 'Spell');
      return {
        id: spell.id,
        definition: summary(definition, spell.customNotes, characterId),
        level: metadataNumber(definition.metadata, 'level') ?? 0,
        known: spell.known,
        prepared: spell.prepared,
        alwaysPrepared: spell.alwaysPrepared,
        ritual: spell.ritualAvailable,
        concentration: metadataBoolean(definition.metadata, 'concentration'),
        spellcastingSourceId: spell.spellcastingSourceId,
      };
    });
    const slotPools = this.characters.listSpellSlotPools(characterId).map((pool) => ({
      id: pool.id,
      poolType: pool.poolType,
      slotLevel: pool.slotLevel,
      current: pool.current,
      maximum: pool.maximum,
      resetRule: pool.resetRule,
      spellcastingSourceId: pool.spellcastingSourceId,
      sourceLabel: sourceViews.find((source) => source.id === pool.spellcastingSourceId)?.label ?? null,
    }));
    const effects = this.characters.listActiveEffects(characterId).map((effect) => (
      this.effectView(effect, characterId)
    ));
    const concentrationId = this.characters.getConcentration(characterId)?.id;
    const biography = this.characters.getBiography(characterId);
    if (!biography) throw new Error(`Character ${characterId} nemá biography projection.`);

    const proficiencyViews = proficiencies.map((proficiency) => ({
      id: proficiency.id,
      category: proficiency.category,
      label: proficiency.targetDefinitionId
        ? this.requireDefinition(proficiency.targetDefinitionId).name
        : proficiency.customTarget ?? 'Unknown',
      level: proficiency.level,
      target: proficiency.targetDefinitionId
        ? summary(this.requireDefinition(proficiency.targetDefinitionId), null, characterId)
        : null,
      sourceLabel: this.sourceLabel(proficiency.sourceId, characterId),
    }));

    return {
      characterId,
      campaignId: character.campaignId,
      identity: {
        name: character.name,
        fullName: character.fullName,
        description: character.description,
        imageResourceId: character.imageResourceId,
        characterType: character.characterType,
        totalLevel: this.characters.getTotalLevel(characterId),
        classSummary: classViews
          .map(({ definition, entry }) => `${definition.name} ${entry.level}`)
          .join(' / '),
        classes: classViews.map((view) => view.summary),
        species: origin?.speciesId
          ? summary(this.requireDefinition(origin.speciesId), null, characterId)
          : null,
        background: origin?.backgroundId
          ? summary(this.requireDefinition(origin.backgroundId), null, characterId)
          : null,
        currentLocation: character.currentLocationId
          ? this.locationSummary(character.currentLocationId)
          : null,
      },
      combat: {
        hp: {
          current: combat.currentHp,
          maximum: combat.maximumHp,
          temporary: combat.temporaryHp,
        },
        armorClass: this.characters.getArmorClass(characterId),
        initiative: this.characters.getInitiative(characterId),
        proficiencyBonus: this.characters.getProficiencyBonus(characterId),
        inspiration: combat.inspiration,
        deathSaves: {
          successes: combat.deathSaveSuccesses,
          failures: combat.deathSaveFailures,
        },
      },
      primaryMovement: toPrimaryMovement(movements),
      movement: movements.map((movement) => ({
        id: movement.id,
        type: movement.movementType,
        distance: movement.distance,
        unit: movement.unit,
        condition: movement.condition,
      })),
      abilities: AbilityIds.map((abilityId) => {
        const ability = this.characters.getAbilityScore(characterId, abilityId);
        const savingThrow = proficiencies.find((proficiency) => (
          proficiency.category === 'savingThrow'
          && (
            proficiency.customTarget?.toLowerCase() === abilityId
            || metadataString(
              proficiency.targetDefinitionId
                ? this.characters.getDefinition(proficiency.targetDefinitionId)?.metadata ?? null
                : null,
              'abilityId',
            ) === abilityId
          )
        ));
        return {
          id: abilityId,
          abbreviation: abilityAbbreviations[abilityId],
          baseScore: ability.baseScore,
          permanentModifier: ability.permanentModifier,
          overrideScore: ability.overrideScore,
          temporaryModifier: ability.temporaryModifier,
          temporarySetValue: ability.temporarySetValue,
          score: ability.score,
          modifier: ability.modifier,
          savingThrow: savingThrow ? {
            level: savingThrow.level,
            bonus: this.characters.getProficiencyCheckBonus(characterId, savingThrow.id, abilityId),
          } : null,
        };
      }),
      resources,
      hitDice: this.characters.listHitDiePools(characterId).map((pool) => ({
        id: pool.id,
        dieSize: pool.dieSize,
        current: pool.current,
        maximum: pool.maximum,
      })),
      actions,
      features,
      spellcasting: { sources: sourceViews, spells, slotPools },
      effects,
      concentration: effects.find((effect) => effect.id === concentrationId) ?? null,
      defenses: this.characters.listDefenses(characterId).map((defense) => ({
        id: defense.id,
        defenseType: defense.defenseType,
        target: summary(this.requireDefinition(defense.definitionId), null, characterId),
        sourceLabel: this.sourceLabel(defense.sourceId, characterId),
      })),
      proficiencies: proficiencyViews.filter((proficiency) => proficiency.category !== 'language'),
      languages: proficiencyViews.filter((proficiency) => proficiency.category === 'language'),
      inventory: this.domain.listItemsHeldByCharacter(characterId).map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        placementLabel: `Drží ${character.name}`,
        card: entitySummary(item.id, 'Item', item.name, `×${item.quantity}`, characterId),
      })),
      notes: {
        age: biography.age,
        alignment: biography.alignment,
        appearance: biography.appearance,
        biography: biography.biography,
        personalityTraits: biography.personalityTraits,
        ideals: biography.ideals,
        bonds: biography.bonds,
        flaws: biography.flaws,
        notes: biography.notes,
      },
      preferences: this.preferences.getCharacterPanelPreferences(character.campaignId, characterId),
    };
  }

  getEntitySummary(request: EntityCardRequest): EntitySummary {
    const found = this.trySummary(request.id, request.characterId);
    if (!found) throw new Error(`Entita nebo definition ${request.id} neexistuje.`);
    return found;
  }

  getEntityCard(request: EntityCardRequest): EntityCardView {
    const definition = this.characters.getDefinition(request.id);
    if (definition) return this.definitionCard(definition, request.characterId);
    if (request.id.startsWith('feature_')) return this.featureCard(request.id, request.characterId);
    if (request.id.startsWith('action_')) return this.actionCard(request.id, request.characterId);
    if (request.id.startsWith('effect_')) return this.effectCard(request.id);
    if (request.id.startsWith('item_')) return this.itemCard(request.id, request.characterId);
    if (request.id.startsWith('loc_')) return this.locationCard(request.id, request.characterId);
    if (request.id.startsWith('char_')) return this.characterCard(request.id, request.observerEntityId);
    throw new Error(`Pro ${request.id} není dostupná Entity Card.`);
  }

  private definitionCard(
    definition: RuleDefinition,
    characterId?: string,
  ): DefinitionCardView {
    const cockpit = characterId ? this.getCharacterCockpit(characterId) : null;
    const feature = cockpit?.features.find((value) => value.definition?.id === definition.id);
    const spell = cockpit?.spellcasting.spells.find((value) => value.definition.id === definition.id);
    const characterClass = characterId
      ? this.characters.listClasses(characterId).find((entry) => (
        entry.classId === definition.id || entry.subclassId === definition.id
      ))
      : undefined;
    const characterState = spell ? {
      known: spell.known,
      prepared: spell.prepared,
      alwaysPrepared: spell.alwaysPrepared,
      ritual: spell.ritual,
      spellcastingSource: cockpit?.spellcasting.sources.find(
        (source) => source.id === spell.spellcastingSourceId,
      )?.label ?? null,
    } : feature ? {
      enabled: feature.enabled,
      source: feature.sourceLabel,
    } : characterClass ? {
      level: characterClass.level,
      subclassId: characterClass.subclassId,
    } : null;
    const relatedDefinitions: RuleDefinition[] = [];
    if (characterId && (definition.definitionType === 'Class' || definition.definitionType === 'Subclass')) {
      for (const entry of this.characters.listClasses(characterId)) {
        if (definition.definitionType === 'Class' && entry.classId === definition.id && entry.subclassId) {
          relatedDefinitions.push(this.requireDefinition(entry.subclassId));
        }
        if (definition.definitionType === 'Subclass' && entry.subclassId === definition.id) {
          relatedDefinitions.push(this.requireDefinition(entry.classId));
        }
      }
    }
    const relatedFeatures = characterId && ['Class', 'Subclass'].includes(definition.definitionType)
      ? cockpit?.features.filter((candidate) => candidate.sourceLabel === definition.name).map(
        (candidate) => candidate.card,
      ) ?? []
      : [];
    return {
      cardType: 'definition',
      id: definition.id,
      kind: cardKind(definition.definitionType),
      definitionType: definition.definitionType,
      name: definition.name,
      description: definition.description,
      imageResourceId: null,
      source: definition.source,
      origin: definition.origin,
      homebrew: definition.homebrew,
      metadata: definition.metadata,
      characterState,
      linkedResources: cockpit?.resources.filter((resource) => resource.source?.id === definition.id) ?? [],
      linkedActions: cockpit?.actions.filter((action) => action.source?.id === definition.id) ?? [],
      references: [
        ...relatedDefinitions.map((related) => summary(related, null, characterId)),
        ...relatedFeatures,
      ],
    };
  }

  private featureCard(featureId: string, contextCharacterId?: string): FeatureCardView {
    const feature = this.characters.getFeature(featureId);
    if (!feature) throw new Error(`Feature ${featureId} neexistuje.`);
    if (contextCharacterId && feature.characterId !== contextCharacterId) {
      throw new Error(`Feature ${featureId} nepatří zadané postavě.`);
    }
    const definition = feature.definitionId ? this.characters.getDefinition(feature.definitionId) : undefined;
    const cockpit = this.getCharacterCockpit(feature.characterId);
    return {
      cardType: 'feature',
      id: feature.id,
      kind: cardKind(definition?.definitionType ?? 'Feature'),
      name: feature.customName ?? definition?.name ?? 'Custom Feature',
      description: feature.customDescription ?? definition?.description ?? '',
      imageResourceId: null,
      enabled: feature.enabled,
      sourceLabel: this.sourceLabel(feature.sourceId, feature.characterId),
      homebrew: definition?.homebrew ?? true,
      linkedResources: cockpit.resources.filter((resource) => (
        resource.source?.id === feature.id || resource.source?.id === feature.definitionId
      )),
      linkedActions: cockpit.actions.filter((action) => action.source?.id === feature.id),
      references: definition ? [summary(definition, null, feature.characterId)] : [],
    };
  }

  private actionCard(actionId: string, contextCharacterId?: string): ActionCardView {
    const action = this.characters.getAction(actionId);
    if (!action) throw new Error(`Action ${actionId} neexistuje.`);
    if (contextCharacterId && action.ownerEntityId !== contextCharacterId) {
      throw new Error(`Action ${actionId} nepatří zadané postavě.`);
    }
    const source = this.trySummary(action.sourceId, action.ownerEntityId);
    return {
      cardType: 'action',
      id: action.id,
      kind: 'Action',
      name: action.name,
      description: '',
      imageResourceId: null,
      actionType: action.actionType,
      mechanics: action.mechanics as Readonly<Record<string, unknown>>,
      source,
      references: source ? [source] : [],
    };
  }

  private effectCard(effectId: string): EffectCardView {
    const effect = this.characters.getEffect(effectId);
    if (!effect) throw new Error(`Effect ${effectId} neexistuje.`);
    const definition = effect.definitionId ? this.characters.getDefinition(effect.definitionId) : undefined;
    const sourceSpell = effect.sourceSpellId ? this.characters.getDefinition(effect.sourceSpellId) : undefined;
    return {
      cardType: 'effect',
      id: effect.id,
      kind: 'Effect',
      name: effect.name,
      description: definition?.description ?? sourceSpell?.description ?? '',
      imageResourceId: null,
      active: effect.endEventId === null,
      concentration: effect.concentration,
      durationLabel: durationLabel(effect.durationType, effect.remainingDuration),
      metadata: effect.metadata,
      references: [definition, sourceSpell]
        .filter((value): value is RuleDefinition => value !== undefined)
        .map((value) => summary(value, null, effect.targetEntityId)),
    };
  }

  private itemCard(itemId: string, contextCharacterId?: string): ItemCardView {
    const item = this.domain.getItem(itemId);
    if (!item) throw new Error(`Item ${itemId} neexistuje.`);
    const placement = this.domain.getItemPlacement(itemId);
    const effective = this.domain.resolveEffectiveItemLocation(itemId);
    const effectiveLocation = effective.locationId ? this.locationSummary(effective.locationId) : null;
    const placementSummary = this.placementSummary(placement, contextCharacterId);
    return {
      cardType: 'item',
      id: item.id,
      kind: 'Item',
      name: item.name,
      description: item.description,
      imageResourceId: item.imageResourceId,
      quantity: item.quantity,
      placementLabel: placementSummary.label,
      effectiveLocation,
      aliases: this.domain.listAliases(item.id).map((alias) => alias.alias),
      history: this.domain.getItemPlacementHistory(item.id).slice(-5).map((entry) => (
        `${entry.fromEventId ?? 'počátek'}: ${this.placementSummary(entry.placement).label}`
      )),
      references: [placementSummary.reference, effectiveLocation]
        .filter((value): value is EntitySummary => value !== null),
    };
  }

  private locationCard(locationId: string, contextCharacterId?: string): LocationCardView {
    const location = this.domain.getLocation(locationId);
    if (!location) throw new Error(`Location ${locationId} neexistuje.`);
    const parent = location.parentLocationId ? this.locationSummary(location.parentLocationId) : null;
    const children = this.domain.listLocationChildren(locationId).map((child) => (
      entitySummary(child.id, 'Location', child.name, child.locationType, contextCharacterId)
    ));
    return {
      cardType: 'location',
      id: location.id,
      kind: 'Location',
      name: location.name,
      description: location.description,
      imageResourceId: location.imageResourceId,
      locationType: location.locationType,
      fullPath: this.domain.getLocationPath(location.id),
      parent,
      children,
      references: [parent, ...children].filter((value): value is EntitySummary => value !== null),
    };
  }

  private characterCard(characterId: string, observerEntityId?: string): CharacterCardView {
    const character = this.domain.getCharacter(characterId);
    if (!character) throw new Error(`Character ${characterId} neexistuje.`);
    if (observerEntityId && !this.domain.getCharacter(observerEntityId)) {
      throw new Error(`Observer ${observerEntityId} není Character.`);
    }
    const origin = this.characters.getOrigin(characterId);
    const species = origin?.speciesId
      ? summary(this.requireDefinition(origin.speciesId), null, characterId)
      : null;
    const currentLocation = character.currentLocationId
      ? this.locationSummary(character.currentLocationId)
      : null;
    const relationshipSummary = this.domain.listRelationsForEntity(characterId).map((relation) => {
      const otherId = relation.sourceEntityId === characterId
        ? relation.targetEntityId
        : relation.sourceEntityId;
      const other = this.trySummary(otherId, characterId);
      return `${relation.relationType}: ${other?.label ?? otherId}`;
    });
    return {
      cardType: 'character',
      id: character.id,
      kind: 'Character',
      name: character.name,
      description: character.description,
      imageResourceId: character.imageResourceId,
      fullName: character.fullName,
      characterType: character.characterType,
      species,
      currentLocation,
      relationshipSummary,
      references: [species, currentLocation].filter((value): value is EntitySummary => value !== null),
    };
  }

  private resourceView(
    resource: ReturnType<CharacterDomainService['listResources']>[number],
    characterId: string,
  ): CockpitResourceView {
    const dieSize = metadataNumber(resource.metadata, 'dieSize');
    const requestedDisplay = metadataString(resource.metadata, 'display');
    const display = requestedDisplay === 'dice'
      ? 'dice'
      : requestedDisplay === 'number'
        ? 'number'
        : resource.maximum <= 8 && Number.isInteger(resource.maximum)
          ? 'pips'
          : 'number';
    return {
      id: resource.id,
      name: resource.name,
      resourceType: resource.resourceType,
      current: resource.current,
      maximum: resource.maximum,
      resetRule: resource.resetRule,
      display,
      dieSize,
      source: resource.sourceFeatureId
        ? this.trySummary(resource.sourceFeatureId, characterId)
        : resource.sourceDefinitionId
          ? this.trySummary(resource.sourceDefinitionId, characterId)
          : null,
    };
  }

  private actionView(
    action: ReturnType<CharacterDomainService['listActions']>[number],
    characterId: string,
  ): CockpitActionView {
    const source = this.trySummary(action.sourceId, characterId);
    const damage = action.mechanics.damage?.map((component) => component.formula).join(' + ') ?? null;
    const range = action.mechanics.range
      ? `${action.mechanics.range.normal} ${action.mechanics.range.unit}`
      : action.mechanics.reach != null
        ? `${action.mechanics.reach} ft`
        : null;
    const attackBonus = action.mechanics.attackModifier != null
      ? signed(action.mechanics.attackModifier)
      : action.mechanics.attackBonusFormula ?? null;
    const resourceCost = action.mechanics.resourceCosts?.map((cost) => (
      `${cost.amount} ${this.characters.getResource(cost.resourceId)?.name ?? cost.resourceId}`
    )).join(', ') ?? null;
    return {
      id: action.id,
      name: action.name,
      actionType: action.actionType,
      attackBonus,
      range,
      damage,
      resourceCost,
      source,
      card: entitySummary(action.id, 'Action', action.name, action.actionType, characterId),
    };
  }

  private featureView(feature: CharacterFeature, characterId: string): CockpitFeatureView {
    const definition = feature.definitionId ? this.characters.getDefinition(feature.definitionId) : undefined;
    return {
      id: feature.id,
      name: feature.customName ?? definition?.name ?? 'Custom Feature',
      enabled: feature.enabled,
      homebrew: definition?.homebrew ?? true,
      sourceLabel: this.sourceLabel(feature.sourceId, characterId),
      definition: definition ? summary(definition, null, characterId) : null,
      card: entitySummary(
        feature.id,
        cardKind(definition?.definitionType ?? 'Feature'),
        feature.customName ?? definition?.name ?? 'Custom Feature',
        feature.sourceType,
        characterId,
      ),
    };
  }

  private effectView(
    effect: ReturnType<CharacterDomainService['listActiveEffects']>[number],
    characterId: string,
  ): CockpitEffectView {
    const definition = effect.definitionId ? this.characters.getDefinition(effect.definitionId) : undefined;
    const sourceSpell = effect.sourceSpellId ? this.characters.getDefinition(effect.sourceSpellId) : undefined;
    return {
      id: effect.id,
      name: effect.name,
      condition: definition?.definitionType === 'Condition',
      concentration: effect.concentration,
      durationLabel: durationLabel(effect.durationType, effect.remainingDuration),
      definition: definition ? summary(definition, null, characterId) : null,
      sourceSpell: sourceSpell ? summary(sourceSpell, null, characterId) : null,
      card: entitySummary(effect.id, 'Effect', effect.name, durationLabel(
        effect.durationType,
        effect.remainingDuration,
      ), characterId),
    };
  }

  private trySummary(id: string, contextCharacterId?: string): EntitySummary | null {
    const definition = this.characters.getDefinition(id);
    if (definition) return summary(definition, null, contextCharacterId);
    const character = this.domain.getCharacter(id);
    if (character) {
      return entitySummary(character.id, 'Character', character.name, character.characterType, contextCharacterId);
    }
    const location = this.domain.getLocation(id);
    if (location) return entitySummary(location.id, 'Location', location.name, location.locationType, contextCharacterId);
    const item = this.domain.getItem(id);
    if (item) return entitySummary(item.id, 'Item', item.name, `×${item.quantity}`, contextCharacterId);
    const feature = this.characters.getFeature(id);
    if (feature) {
      const featureDefinition = feature.definitionId ? this.characters.getDefinition(feature.definitionId) : undefined;
      return entitySummary(
        feature.id,
        cardKind(featureDefinition?.definitionType ?? 'Feature'),
        feature.customName ?? featureDefinition?.name ?? 'Custom Feature',
        feature.sourceType,
        contextCharacterId ?? feature.characterId,
      );
    }
    const action = this.characters.getAction(id);
    if (action) return entitySummary(action.id, 'Action', action.name, action.actionType, contextCharacterId);
    const effect = this.characters.getEffect(id);
    if (effect) return entitySummary(effect.id, 'Effect', effect.name, effect.durationType, contextCharacterId);
    return null;
  }

  private sourceLabel(sourceId: string, characterId: string): string {
    const direct = this.trySummary(sourceId, characterId);
    if (direct) return direct.label;
    const characterClass = this.characters.listClasses(characterId).find((entry) => entry.id === sourceId);
    if (characterClass) return this.requireDefinition(characterClass.classId).name;
    return sourceId;
  }

  private locationSummary(locationId: string): EntitySummary {
    const location = this.domain.getLocation(locationId);
    if (!location) throw new Error(`Location ${locationId} neexistuje.`);
    return entitySummary(location.id, 'Location', location.name, location.locationType);
  }

  private placementSummary(
    placement: ItemPlacement,
    contextCharacterId?: string,
  ): { label: string; reference: EntitySummary | null } {
    switch (placement.kind) {
      case 'location': {
        const reference = this.locationSummary(placement.locationId);
        return { label: `V lokaci ${reference.label}`, reference };
      }
      case 'character': {
        const reference = this.trySummary(placement.characterId, contextCharacterId);
        return { label: `Drží ${reference?.label ?? placement.characterId}`, reference };
      }
      case 'creature':
        return { label: `Nese creature ${placement.creatureId}`, reference: null };
      case 'container': {
        const reference = this.trySummary(placement.containerItemId, contextCharacterId);
        return { label: `V ${reference?.label ?? placement.containerItemId}`, reference };
      }
      case 'unknown':
        return { label: 'Umístění neznámé', reference: null };
    }
  }

  private requireDefinition(id: string, type?: string): RuleDefinition {
    const definition = this.characters.getDefinition(id);
    if (!definition) throw new Error(`Rule definition ${id} neexistuje.`);
    if (type && definition.definitionType !== type) {
      throw new Error(`Rule definition ${id} není typu ${type}.`);
    }
    return definition;
  }
}

function summary(
  definition: RuleDefinition,
  subtitle: string | null = null,
  contextCharacterId?: string,
): EntitySummary {
  return entitySummary(
    definition.id,
    cardKind(definition.definitionType),
    definition.name,
    subtitle ?? definition.source,
    contextCharacterId,
  );
}

function entitySummary(
  id: string,
  kind: EntityCardKind,
  label: string,
  subtitle: string | null,
  contextCharacterId?: string,
): EntitySummary {
  return {
    id,
    kind,
    label,
    subtitle,
    ...(contextCharacterId ? { contextCharacterId } : {}),
  };
}

function cardKind(value: string): EntityCardKind {
  const supported = new Set<string>([
    'Spell', 'Feature', 'Feat', 'Class', 'Subclass', 'Species', 'Race', 'Lineage',
    'Subrace', 'Background', 'Condition', 'Language', 'Skill', 'Proficiency',
    'DamageType', 'Deity', 'Custom',
  ]);
  return supported.has(value) ? value as EntityCardKind : 'Custom';
}

function toPrimaryMovement(
  movements: ReturnType<CharacterDomainService['listEffectiveMovements']>,
): CharacterCockpitView['primaryMovement'] {
  const primary = movements.find((movement) => movement.movementType === 'walk') ?? movements[0];
  return primary ? {
    type: primary.movementType,
    distance: primary.distance,
    unit: primary.unit,
  } : null;
}

function durationLabel(type: string, remaining: number | null): string {
  return remaining === null ? type : `${remaining} ${type}`;
}

function metadataNumber(
  metadata: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metadataString(
  metadata: Readonly<Record<string, unknown>> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function metadataBoolean(
  metadata: Readonly<Record<string, unknown>> | null,
  key: string,
): boolean {
  return metadata?.[key] === true;
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}
