import { createDomainId, requireDomainId, type DomainIdPrefix } from '../../domain/ids';
import type {
  Campaign,
  Character,
  ChronicleEvent,
  CreateAliasInput,
  CreateCampaignInput,
  CreateCharacterInput,
  CreateCreatureInput,
  CreateItemInput,
  CreateKnowledgeInput,
  CreateLocationInput,
  CreateRelationInput,
  Creature,
  EffectiveItemLocation,
  EntityAlias,
  EntityRelation,
  EntityType,
  EventDraft,
  Item,
  ItemPlacement,
  ItemPlacementHistoryEntry,
  KnowledgeRecord,
  Location,
  MoveCharacterInput,
  TransferItemInput,
} from '../../domain/models';
import { SqliteChronicleRepository } from './repository';

export class ChronicleDomainService {
  constructor(private readonly repository: SqliteChronicleRepository) {}

  createCampaign(input: CreateCampaignInput): Campaign {
    return this.repository.transaction(() => {
      const now = timestamp();
      const campaign: Campaign = {
        id: resolveId(input.id, 'campaign'),
        name: requiredText(input.name, 'Název kampaně'),
        rulesetId: requiredText(input.rulesetId, 'Ruleset ID'),
        rulesetVersion: requiredText(input.rulesetVersion, 'Ruleset version'),
        createdAt: now,
        updatedAt: now,
      };
      this.repository.insertCampaign(campaign);
      return campaign;
    });
  }

  getCampaign(id: string): Campaign | undefined {
    return this.repository.getCampaign(id);
  }

  createLocation(input: CreateLocationInput): Location {
    return this.repository.transaction(() => {
      this.requireCampaign(input.campaignId);
      const id = resolveId(input.id, 'loc');
      const parentLocationId = input.parentLocationId ?? null;
      if (parentLocationId) {
        this.requireEntity(parentLocationId, input.campaignId, 'Location');
      }
      this.validateCreatedEvent(input.createdEventId, input.campaignId);
      const now = timestamp();
      const location: Location = {
        id,
        campaignId: input.campaignId,
        entityType: 'Location',
        name: requiredText(input.name, 'Název lokace'),
        description: input.description?.trim() ?? '',
        imageResourceId: input.imageResourceId ?? null,
        createdEventId: input.createdEventId ?? null,
        createdAt: now,
        updatedAt: now,
        parentLocationId,
        locationType: requiredText(input.locationType, 'Typ lokace'),
      };
      this.repository.insertLocation(location);
      return location;
    });
  }

  getLocation(id: string): Location | undefined {
    return this.repository.getLocation(id);
  }

  getLocationPathSegments(locationId: string): readonly string[] {
    const names: string[] = [];
    const visited = new Set<string>();
    let currentId: string | null = locationId;

    while (currentId) {
      if (visited.has(currentId)) {
        throw new Error(`Cyklus v hierarchii lokací u ${currentId}.`);
      }
      visited.add(currentId);
      const row = this.repository.getLocationParent(currentId);
      if (!row) {
        throw new Error(`Lokace ${currentId} neexistuje.`);
      }
      names.unshift(row.name);
      currentId = row.parentLocationId;
    }
    return names;
  }

  getLocationPath(locationId: string): string {
    return this.getLocationPathSegments(locationId).join(' / ');
  }

  createCharacter(input: CreateCharacterInput): Character {
    return this.repository.transaction(() => {
      this.requireCampaign(input.campaignId);
      this.validateLocation(input.currentLocationId, input.campaignId);
      this.validateLifeState(input.currentLifeStateId);
      this.validateCreatedEvent(input.createdEventId, input.campaignId);
      const now = timestamp();
      const character: Character = {
        id: resolveId(input.id, 'char'),
        campaignId: input.campaignId,
        entityType: 'Character',
        name: requiredText(input.name, 'Jméno postavy'),
        description: input.description?.trim() ?? '',
        imageResourceId: input.imageResourceId ?? null,
        createdEventId: input.createdEventId ?? null,
        createdAt: now,
        updatedAt: now,
        fullName: input.fullName?.trim() || null,
        characterType: input.characterType,
        currentLocationId: input.currentLocationId ?? null,
        currentLifeStateId: input.currentLifeStateId,
      };
      this.repository.insertCharacter(character);
      this.repository.insertInitialEntityLocation(
        createDomainId('state'),
        character.id,
        character.currentLocationId,
        character.createdEventId,
        now,
      );
      return character;
    });
  }

  getCharacter(id: string): Character | undefined {
    return this.repository.getCharacter(id);
  }

  listCharacters(campaignId?: string): Character[] {
    if (campaignId) this.requireCampaign(campaignId);
    return this.repository.listCharacters(campaignId);
  }

  createCreature(input: CreateCreatureInput): Creature {
    return this.repository.transaction(() => {
      this.requireCampaign(input.campaignId);
      this.validateLocation(input.currentLocationId, input.campaignId);
      this.validateLifeState(input.currentLifeStateId);
      this.validateCreatedEvent(input.createdEventId, input.campaignId);
      const now = timestamp();
      const creature: Creature = {
        id: resolveId(input.id, 'creature'),
        campaignId: input.campaignId,
        entityType: 'Creature',
        name: requiredText(input.name, 'Název creature'),
        description: input.description?.trim() ?? '',
        imageResourceId: input.imageResourceId ?? null,
        createdEventId: input.createdEventId ?? null,
        createdAt: now,
        updatedAt: now,
        currentLocationId: input.currentLocationId ?? null,
        currentLifeStateId: input.currentLifeStateId,
      };
      this.repository.insertCreature(creature);
      this.repository.insertInitialEntityLocation(
        createDomainId('state'),
        creature.id,
        creature.currentLocationId,
        creature.createdEventId,
        now,
      );
      return creature;
    });
  }

  getCreature(id: string): Creature | undefined {
    return this.repository.getCreature(id);
  }

  createItem(input: CreateItemInput): Item {
    return this.repository.transaction(() => {
      this.requireCampaign(input.campaignId);
      const id = resolveId(input.id, 'item');
      this.validateCreatedEvent(input.createdEventId, input.campaignId);
      if (input.itemDefinitionId && !this.repository.itemDefinitionExists(input.itemDefinitionId)) {
        throw new Error(`Item definition ${input.itemDefinitionId} neexistuje.`);
      }
      if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) {
        throw new Error('Quantity předmětu musí být nezáporné celé číslo.');
      }
      this.validatePlacement(input.placement, input.campaignId, id);
      const now = timestamp();
      const item: Item = {
        id,
        campaignId: input.campaignId,
        entityType: 'Item',
        name: requiredText(input.name, 'Název předmětu'),
        description: input.description?.trim() ?? '',
        imageResourceId: input.imageResourceId ?? null,
        createdEventId: input.createdEventId ?? null,
        createdAt: now,
        updatedAt: now,
        itemDefinitionId: input.itemDefinitionId ?? null,
        quantity: input.quantity,
      };
      this.repository.insertItem(item);
      this.repository.insertInitialItemPlacement(
        createDomainId('state'),
        item.id,
        input.placement,
        item.createdEventId,
        now,
      );
      return item;
    });
  }

  getItem(id: string): Item | undefined {
    return this.repository.getItem(id);
  }

  listItemsHeldByCharacter(characterId: string): Item[] {
    this.requireCharacter(characterId);
    return this.repository.listItemsHeldByCharacter(characterId);
  }

  listLocationChildren(locationId: string): Location[] {
    this.requireEntity(locationId, undefined, 'Location');
    return this.repository.listLocationChildren(locationId);
  }

  listAliases(entityId: string): EntityAlias[] {
    this.requireEntity(entityId);
    return this.repository.listAliases(entityId);
  }

  listRelationsForEntity(entityId: string): EntityRelation[] {
    this.requireEntity(entityId);
    return this.repository.listRelationsForEntity(entityId);
  }

  getItemPlacement(itemId: string): ItemPlacement {
    this.requireItem(itemId);
    const placement = this.repository.getItemPlacement(itemId);
    if (!placement) {
      throw new Error(`Předmět ${itemId} nemá aktuální placement.`);
    }
    return placement;
  }

  getItemPlacementHistory(itemId: string): ItemPlacementHistoryEntry[] {
    this.requireItem(itemId);
    return this.repository.getItemPlacementHistory(itemId);
  }

  resolveEffectiveItemLocation(itemId: string): EffectiveItemLocation {
    this.requireItem(itemId);
    const visited = new Set<string>();
    const resolutionPath: string[] = [itemId];
    let currentItemId = itemId;

    while (true) {
      if (visited.has(currentItemId)) {
        throw new Error(`Cyklus v kontejnerech při řešení lokace předmětu ${itemId}.`);
      }
      visited.add(currentItemId);
      const placement = this.repository.getItemPlacement(currentItemId);
      if (!placement) {
        throw new Error(`Předmět ${currentItemId} nemá aktuální placement.`);
      }

      switch (placement.kind) {
        case 'location':
          return {
            locationId: placement.locationId,
            resolutionPath: [...resolutionPath, placement.locationId],
          };
        case 'character': {
          const locationId = this.repository.getCharacterLocation(placement.characterId);
          if (locationId === undefined) {
            throw new Error(`Character ${placement.characterId} neexistuje.`);
          }
          return {
            locationId,
            resolutionPath: locationId
              ? [...resolutionPath, placement.characterId, locationId]
              : [...resolutionPath, placement.characterId],
          };
        }
        case 'creature': {
          const locationId = this.repository.getCreatureLocation(placement.creatureId);
          if (locationId === undefined) {
            throw new Error(`Creature ${placement.creatureId} neexistuje.`);
          }
          return {
            locationId,
            resolutionPath: locationId
              ? [...resolutionPath, placement.creatureId, locationId]
              : [...resolutionPath, placement.creatureId],
          };
        }
        case 'container':
          currentItemId = placement.containerItemId;
          resolutionPath.push(currentItemId);
          break;
        case 'unknown':
          return { locationId: null, resolutionPath };
      }
    }
  }

  recordEvent(campaignId: string, draft: EventDraft): ChronicleEvent {
    return this.repository.transaction(() => {
      this.requireCampaign(campaignId);
      return this.insertEvent(campaignId, draft);
    });
  }

  listEvents(campaignId: string): ChronicleEvent[] {
    this.requireCampaign(campaignId);
    return this.repository.listEvents(campaignId);
  }

  moveCharacter(input: MoveCharacterInput): ChronicleEvent {
    return this.repository.transaction(() => {
      const character = this.requireCharacter(input.characterId);
      this.validateLocation(input.toLocationId, character.campaignId);
      const event = this.insertEvent(character.campaignId, {
        ...input.event,
        locationId:
          input.event.locationId === undefined ? input.toLocationId : input.event.locationId,
      });
      const now = timestamp();
      this.repository.moveCharacter(
        character.id,
        input.toLocationId,
        event.id,
        createDomainId('state'),
        now,
      );
      return event;
    });
  }

  transferItem(input: TransferItemInput): ChronicleEvent {
    return this.repository.transaction(() => {
      const item = this.requireItem(input.itemId);
      this.validatePlacement(input.placement, item.campaignId, item.id);
      const previousLocation = this.resolveEffectiveItemLocation(item.id).locationId;
      const event = this.insertEvent(item.campaignId, {
        ...input.event,
        locationId:
          input.event.locationId === undefined ? previousLocation : input.event.locationId,
      });
      this.repository.replaceItemPlacement(
        createDomainId('state'),
        item.id,
        input.placement,
        event.id,
        timestamp(),
      );
      return event;
    });
  }

  createAlias(input: CreateAliasInput): EntityAlias {
    return this.repository.transaction(() => {
      const entity = this.requireEntity(input.entityId);
      if (input.usedByEntityId) {
        this.requireEntity(input.usedByEntityId, entity.campaignId);
      }
      this.validateEventRange(input.fromEventId, input.toEventId, entity.campaignId);
      const alias: EntityAlias = {
        id: resolveId(input.id, 'alias'),
        entityId: input.entityId,
        alias: requiredText(input.alias, 'Alias'),
        usedByEntityId: input.usedByEntityId ?? null,
        fromEventId: input.fromEventId ?? null,
        toEventId: input.toEventId ?? null,
      };
      this.repository.insertAlias(alias);
      return alias;
    });
  }

  createRelation(input: CreateRelationInput): EntityRelation {
    return this.repository.transaction(() => {
      this.requireCampaign(input.campaignId);
      this.requireEntity(input.sourceEntityId, input.campaignId);
      this.requireEntity(input.targetEntityId, input.campaignId);
      this.validateEventRange(input.fromEventId, input.toEventId, input.campaignId);
      const relation: EntityRelation = {
        id: resolveId(input.id, 'relation'),
        campaignId: input.campaignId,
        sourceEntityId: input.sourceEntityId,
        targetEntityId: input.targetEntityId,
        relationType: requiredText(input.relationType, 'Typ vztahu'),
        fromEventId: input.fromEventId ?? null,
        toEventId: input.toEventId ?? null,
        metadata: input.metadata ?? null,
      };
      this.repository.insertRelation(relation);
      return relation;
    });
  }

  createKnowledge(input: CreateKnowledgeInput): KnowledgeRecord {
    return this.repository.transaction(() => {
      this.requireCampaign(input.campaignId);
      this.requireEntity(input.subjectEntityId, input.campaignId);
      if (input.observerEntityId) {
        this.requireEntity(input.observerEntityId, input.campaignId);
      }
      if (input.referenceEntityId) {
        this.requireEntity(input.referenceEntityId, input.campaignId);
      }
      this.validateEventRange(input.fromEventId, input.toEventId, input.campaignId);
      if (input.value == null && input.referenceEntityId == null) {
        throw new Error('Knowledge záznam musí obsahovat value nebo referenceEntityId.');
      }
      if (
        input.confidence != null
        && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
      ) {
        throw new Error('Confidence musí být číslo od 0 do 1.');
      }
      const record: KnowledgeRecord = {
        id: resolveId(input.id, 'knowledge'),
        campaignId: input.campaignId,
        subjectEntityId: input.subjectEntityId,
        observerEntityId: input.observerEntityId ?? null,
        knowledgeType: requiredText(input.knowledgeType, 'Knowledge type'),
        value: input.value ?? null,
        referenceEntityId: input.referenceEntityId ?? null,
        fromEventId: input.fromEventId ?? null,
        toEventId: input.toEventId ?? null,
        confidence: input.confidence ?? null,
        source: input.source ?? null,
      };
      this.repository.insertKnowledge(record);
      return record;
    });
  }

  private insertEvent(campaignId: string, draft: EventDraft): ChronicleEvent {
    if (draft.locationId) {
      this.requireEntity(draft.locationId, campaignId, 'Location');
    }
    const now = timestamp();
    const event: ChronicleEvent = {
      id: resolveId(draft.id, 'event'),
      campaignId,
      eventType: requiredText(draft.eventType, 'Typ eventu'),
      sequence: this.repository.nextEventSequence(campaignId),
      timestamp: draft.timestamp ?? null,
      locationId: draft.locationId ?? null,
      summary: requiredText(draft.summary, 'Shrnutí eventu'),
      sourceMessageId: draft.sourceMessageId ?? null,
      createdAt: now,
    };
    this.repository.insertEvent(event);
    return event;
  }

  private validatePlacement(placement: ItemPlacement, campaignId: string, itemId: string): void {
    switch (placement.kind) {
      case 'location':
        this.requireEntity(placement.locationId, campaignId, 'Location');
        break;
      case 'character':
        this.requireEntity(placement.characterId, campaignId, 'Character');
        break;
      case 'creature':
        this.requireEntity(placement.creatureId, campaignId, 'Creature');
        break;
      case 'container':
        this.requireEntity(placement.containerItemId, campaignId, 'Item');
        this.assertNoContainerCycle(itemId, placement.containerItemId);
        break;
      case 'unknown':
        break;
    }
  }

  private assertNoContainerCycle(itemId: string, containerItemId: string): void {
    const visited = new Set<string>([itemId]);
    let currentId = containerItemId;
    while (true) {
      if (visited.has(currentId)) {
        throw new Error(`Placement by vytvořil cyklus kontejnerů pro ${itemId}.`);
      }
      visited.add(currentId);
      const placement = this.repository.getItemPlacement(currentId);
      if (!placement || placement.kind !== 'container') {
        return;
      }
      currentId = placement.containerItemId;
    }
  }

  private validateLocation(locationId: string | null | undefined, campaignId: string): void {
    if (locationId) {
      this.requireEntity(locationId, campaignId, 'Location');
    }
  }

  private validateLifeState(lifeStateId: string): void {
    if (!this.repository.lifeStateExists(lifeStateId)) {
      throw new Error(`Life state ${lifeStateId} neexistuje.`);
    }
  }

  private validateCreatedEvent(eventId: string | null | undefined, campaignId: string): void {
    if (eventId && !this.repository.eventBelongsToCampaign(eventId, campaignId)) {
      throw new Error(`Event ${eventId} nepatří do kampaně ${campaignId}.`);
    }
  }

  private validateEventRange(
    fromEventId: string | null | undefined,
    toEventId: string | null | undefined,
    campaignId: string,
  ): void {
    this.validateCreatedEvent(fromEventId, campaignId);
    this.validateCreatedEvent(toEventId, campaignId);
  }

  private requireCampaign(id: string): Campaign {
    const campaign = this.repository.getCampaign(id);
    if (!campaign) {
      throw new Error(`Kampaň ${id} neexistuje.`);
    }
    return campaign;
  }

  private requireEntity(
    id: string,
    campaignId?: string,
    entityType?: EntityType,
  ): { campaignId: string; entityType: EntityType } {
    const entity = this.repository.getEntityIdentity(id);
    if (!entity) {
      throw new Error(`Entita ${id} neexistuje.`);
    }
    if (campaignId && entity.campaignId !== campaignId) {
      throw new Error(`Entita ${id} nepatří do kampaně ${campaignId}.`);
    }
    if (entityType && entity.entityType !== entityType) {
      throw new Error(`Entita ${id} není typu ${entityType}.`);
    }
    return entity;
  }

  private requireCharacter(id: string): Character {
    const character = this.repository.getCharacter(id);
    if (!character) throw new Error(`Character ${id} neexistuje.`);
    return character;
  }

  private requireItem(id: string): Item {
    const item = this.repository.getItem(id);
    if (!item) throw new Error(`Předmět ${id} neexistuje.`);
    return item;
  }
}

function resolveId(id: string | undefined, prefix: DomainIdPrefix): string {
  return id ? requireDomainId(id, prefix) : createDomainId(prefix);
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} nesmí být prázdný.`);
  }
  return normalized;
}

function timestamp(): string {
  return new Date().toISOString();
}
