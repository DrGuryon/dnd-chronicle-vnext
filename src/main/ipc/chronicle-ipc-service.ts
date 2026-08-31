import { requireDomainId, type DomainIdPrefix } from '../../domain/ids';
import { AbilityIds } from '../../domain/character-models';
import { LifeStateIds, type Character, type EventDraft } from '../../domain/models';
import type {
  CharacterAmountCommand,
  CharacterEffectCommand,
  CharacterPoolCommand,
  CharacterResourceCommand,
  CharacterToggleCommand,
  CharacterValueCommand,
  DeathSaveCommand,
} from '../../shared/contracts';
import type {
  CampaignRuntimeState,
  ChronicleToolDescriptor,
  ChronicleToolTraceEntry,
  Conversation,
  ConversationMessage,
  RuntimeWorkspaceView,
  RuntimeWorkspaceCampaign,
  CampaignLibraryView,
  SceneContextView,
  SceneParticipant,
} from '../../shared/chronicle-engine';
import type {
  CharacterCockpitView,
  CharacterPanelPreferencesInput,
  EntityCardRequest,
  EntityCardView,
  EntitySummary,
} from '../../shared/read-models';
import { ChronicleDatabase } from '../database';
import type { CampaignAiSettings, CampaignAiSettingsUpdate, PendingTurnProposal } from '../../shared/ai';

export class ChronicleIpcService {
  constructor(private readonly database: ChronicleDatabase) {}

  listCampaigns(): RuntimeWorkspaceCampaign[] {
    return this.database.engine.getRuntimeWorkspace().campaigns;
  }

  createCampaign(value: unknown): RuntimeWorkspaceCampaign {
    const input = object(value, 'Create campaign command');
    const rulesetId = textValue(input.rulesetId, 'Ruleset ID');
    const rulesetVersion = textValue(input.rulesetVersion, 'Ruleset version');
    if (rulesetId !== 'dnd5e') throw new Error('M7 podporuje ruleset dnd5e.');
    if (rulesetVersion !== '2014' && rulesetVersion !== '2024') {
      throw new Error('Ruleset version musí být 2014 nebo 2024.');
    }
    const campaign = this.database.domain.createCampaign({
      name: boundedText(input.name, 'Název kampaně', 120),
      rulesetId,
      rulesetVersion,
    });
    this.database.engine.ensureCampaignRuntimeState(campaign.id);
    return this.database.engine.getRuntimeWorkspace(campaign.id).campaigns[0]!;
  }

  renameCampaign(value: unknown): RuntimeWorkspaceCampaign {
    const input = object(value, 'Rename campaign command');
    const campaignId = domainId(input.campaignId, 'campaign');
    this.database.domain.renameCampaign(
      campaignId,
      boundedText(input.name, 'Název kampaně', 120),
    );
    return this.database.engine.getRuntimeWorkspace(campaignId).campaigns[0]!;
  }

  archiveCampaign(value: unknown): void {
    this.database.domain.archiveCampaign(domainId(value, 'campaign'));
  }

  listCampaignCharacters(value: unknown): Character[] {
    return this.database.domain.listCharacters(domainId(value, 'campaign'));
  }

  createCharacter(value: unknown): Character {
    const input = object(value, 'Create character command');
    const campaignId = domainId(input.campaignId, 'campaign');
    const campaign = this.database.domain.getCampaign(campaignId);
    if (!campaign) throw new Error(`Kampaň ${campaignId} neexistuje.`);
    const name = boundedText(input.name, 'Jméno postavy', 120);
    const fullName = optionalBoundedText(input.fullName, 'Celé jméno', 160);
    const level = input.level === undefined || input.level === null ? 1 : finiteNumber(input.level, 'Level');
    if (!Number.isSafeInteger(level) || level < 1 || level > 20) {
      throw new Error('Level musí být celé číslo od 1 do 20.');
    }

    const character = this.database.domain.createCharacter({
      campaignId,
      name,
      fullName,
      description: '',
      characterType: 'PC',
      currentLifeStateId: LifeStateIds.alive,
    });
    for (const abilityId of AbilityIds) {
      this.database.characters.setAbilityScore({
        characterId: character.id,
        abilityId,
        baseScore: 10,
        permanentModifier: 0,
        overrideScore: null,
      });
    }
    this.database.characters.setCombatState({
      characterId: character.id,
      maximumHp: 10,
      currentHp: 10,
      temporaryHp: 0,
      armorClassBase: 10,
      armorClassModifier: 0,
      armorClassOverride: null,
      initiativeModifier: 0,
      deathSaveSuccesses: 0,
      deathSaveFailures: 0,
      inspiration: false,
    });
    this.database.characters.addMovement({
      characterId: character.id,
      movementType: 'walk',
      distance: 30,
      unit: 'ft',
      sourceType: 'bootstrap',
      sourceId: character.id,
      condition: null,
    });

    const classDefinition = this.bootstrapDefinition(
      campaign,
      'Class',
      optionalBoundedText(input.className, 'Povolání', 120) ?? 'Neurčené povolání',
    );
    this.database.characters.addClass({
      characterId: character.id,
      classId: classDefinition.id,
      subclassId: null,
      level,
      acquiredEventId: null,
    });
    const species = optionalBoundedText(input.species, 'Druh', 120);
    const background = optionalBoundedText(input.background, 'Zázemí', 120);
    this.database.characters.setOrigin(character.id, {
      speciesId: species ? this.bootstrapDefinition(campaign, 'Species', species).id : null,
      lineageId: null,
      backgroundId: background ? this.bootstrapDefinition(campaign, 'Background', background).id : null,
    });
    this.database.engine.setActivePlayerCharacter(campaignId, character.id);
    return this.database.domain.getCharacter(character.id)!;
  }

  updateCharacterBasics(value: unknown): Character {
    const input = object(value, 'Update character basics command');
    return this.database.domain.updateCharacterBasics({
      characterId: domainId(input.characterId, 'char'),
      name: boundedText(input.name, 'Jméno postavy', 120),
      fullName: optionalBoundedText(input.fullName, 'Celé jméno', 160),
    });
  }

  getCharacterCockpit(characterId?: unknown): CharacterCockpitView | null {
    if (characterId === undefined || characterId === null || characterId === '') {
      return this.database.readModels.getInitialCockpit();
    }
    return this.database.readModels.getCharacterCockpit(domainId(characterId, 'char'));
  }

  getEntitySummary(value: unknown): EntitySummary {
    return this.database.readModels.getEntitySummary(entityCardRequest(value));
  }

  getEntityCard(value: unknown): EntityCardView {
    return this.database.readModels.getEntityCard(entityCardRequest(value));
  }

  changeHitPoints(value: unknown): CharacterCockpitView {
    const command = characterAmountCommand(value, false);
    this.requireCharacter(command.characterId);
    this.database.characters.changeHp(
      command.characterId,
      command.amount,
      this.event(command.characterId, 'combat.hp.changed', hpSummary(command.amount)),
    );
    return this.refresh(command.characterId);
  }

  setTemporaryHitPoints(value: unknown): CharacterCockpitView {
    const command = characterValueCommand(value);
    this.requireCharacter(command.characterId);
    this.database.characters.setTemporaryHp(
      command.characterId,
      command.value,
      this.event(
        command.characterId,
        'combat.temporary_hp.changed',
        `Dočasné životy nastaveny na ${command.value}.`,
      ),
    );
    return this.refresh(command.characterId);
  }

  spendResource(value: unknown): CharacterCockpitView {
    const command = resourceCommand(value);
    const resource = this.requireOwnedResource(command.characterId, command.resourceId);
    this.database.characters.spendResource(
      command.resourceId,
      command.amount,
      this.event(
        command.characterId,
        'resource.spent',
        `${resource.name}: spotřebováno ${command.amount}.`,
      ),
    );
    return this.refresh(command.characterId);
  }

  restoreResource(value: unknown): CharacterCockpitView {
    const command = resourceCommand(value);
    const resource = this.requireOwnedResource(command.characterId, command.resourceId);
    this.database.characters.restoreResource(
      command.resourceId,
      command.amount,
      this.event(
        command.characterId,
        'resource.restored',
        `${resource.name}: obnoveno ${command.amount}.`,
      ),
    );
    return this.refresh(command.characterId);
  }

  spendSpellSlot(value: unknown): CharacterCockpitView {
    const command = poolCommand(value);
    const pool = this.requireOwnedPool(command.characterId, command.poolId);
    this.database.characters.spendSpellSlot(
      command.poolId,
      this.event(
        command.characterId,
        'spell.slot.spent',
        `Sesílací pozice ${pool.slotLevel}. úrovně spotřebována.`,
      ),
    );
    return this.refresh(command.characterId);
  }

  restoreSpellSlot(value: unknown): CharacterCockpitView {
    const command = poolCommand(value);
    const pool = this.requireOwnedPool(command.characterId, command.poolId);
    this.database.characters.restoreSpellSlot(
      command.poolId,
      this.event(
        command.characterId,
        'spell.slot.restored',
        `Sesílací pozice ${pool.slotLevel}. úrovně obnovena.`,
      ),
    );
    return this.refresh(command.characterId);
  }

  setInspiration(value: unknown): CharacterCockpitView {
    const command = characterToggleCommand(value);
    this.requireCharacter(command.characterId);
    this.database.characters.setInspiration(
      command.characterId,
      command.value,
      this.event(
        command.characterId,
        'combat.inspiration.changed',
        command.value ? 'Inspirace získána.' : 'Inspirace použita.',
      ),
    );
    return this.refresh(command.characterId);
  }

  recordDeathSave(value: unknown): CharacterCockpitView {
    const command = deathSaveCommand(value);
    this.requireCharacter(command.characterId);
    this.database.characters.recordDeathSave(
      command.characterId,
      command.success,
      this.event(
        command.characterId,
        'combat.death_save.recorded',
        command.success ? 'Zaznamenán úspěšný death save.' : 'Zaznamenán neúspěšný death save.',
      ),
    );
    return this.refresh(command.characterId);
  }

  endConcentration(value: unknown): CharacterCockpitView {
    const characterId = characterOnlyCommand(value);
    this.requireCharacter(characterId);
    this.database.characters.endConcentration(
      characterId,
      this.event(characterId, 'concentration.ended', 'Soustředění ukončeno.'),
    );
    return this.refresh(characterId);
  }

  removeCondition(value: unknown): CharacterCockpitView {
    const command = effectCommand(value);
    this.requireOwnedEffect(command.characterId, command.effectId);
    this.database.characters.removeCondition(
      command.effectId,
      this.event(command.characterId, 'condition.removed', 'Condition odstraněna.'),
    );
    return this.refresh(command.characterId);
  }

  endEffect(value: unknown): CharacterCockpitView {
    const command = effectCommand(value);
    const effect = this.requireOwnedEffect(command.characterId, command.effectId);
    this.database.characters.endEffect(
      command.effectId,
      this.event(command.characterId, 'effect.ended', `${effect.name} ukončen.`),
    );
    return this.refresh(command.characterId);
  }

  takeShortRest(value: unknown): CharacterCockpitView {
    const characterId = characterOnlyCommand(value);
    this.requireCharacter(characterId);
    this.database.characters.resetResourcesForShortRest(
      characterId,
      this.event(characterId, 'rest.short.completed', 'Krátký odpočinek dokončen.'),
    );
    return this.refresh(characterId);
  }

  takeLongRest(value: unknown): CharacterCockpitView {
    const characterId = characterOnlyCommand(value);
    this.requireCharacter(characterId);
    this.database.characters.resetResourcesForLongRest(
      characterId,
      this.event(characterId, 'rest.long.completed', 'Dlouhý odpočinek dokončen.'),
    );
    return this.refresh(characterId);
  }

  saveCharacterPanelPreferences(value: unknown): CharacterCockpitView {
    const input = preferencesInput(value);
    this.database.preferences.saveCharacterPanelPreferences(input);
    return this.refresh(input.characterId);
  }

  getRuntimeWorkspace(value?: unknown): RuntimeWorkspaceView {
    const campaignId = value === undefined || value === null || value === ''
      ? undefined
      : domainId(value, 'campaign');
    return this.database.engine.getRuntimeWorkspace(campaignId);
  }

  setActivePlayerCharacter(value: unknown): CampaignRuntimeState {
    const input = runtimeSelection(value, 'char');
    return this.database.engine.setActivePlayerCharacter(input.campaignId, input.entityId);
  }

  setActiveConversation(value: unknown): CampaignRuntimeState {
    const input = runtimeSelection(value, 'conversation');
    return this.database.engine.setActiveConversation(input.campaignId, input.entityId);
  }

  setSceneLocation(value: unknown): CampaignRuntimeState {
    const input = runtimeSelection(value, 'loc');
    return this.database.engine.setSceneLocation(input.campaignId, input.entityId);
  }

  setSceneParticipants(value: unknown): SceneParticipant[] {
    const input = object(value, 'Scene participants command');
    const campaignId = domainId(input.campaignId, 'campaign');
    if (!Array.isArray(input.participants)) throw new Error('Participants musí být pole.');
    return this.database.engine.setSceneParticipants(campaignId, input.participants.map((item) => {
      const participant = object(item, 'Scene participant');
      return {
        entityId: textValue(participant.entityId, 'Entity ID'),
        participantRole: textValue(participant.participantRole, 'Participant role'),
      };
    }));
  }

  createConversation(value: unknown): Conversation {
    const input = object(value, 'Create conversation command');
    const title = input.title === null || input.title === undefined
      ? null
      : textValue(input.title, 'Conversation title');
    const campaignId = domainId(input.campaignId, 'campaign');
    const conversation = this.database.engine.createConversation(campaignId, title);
    this.database.engine.setActiveConversation(campaignId, conversation.id);
    return conversation;
  }

  listConversations(value: unknown): Conversation[] {
    return this.database.engine.listConversations(domainId(value, 'campaign'), { maxResults: 100 }).items;
  }

  renameConversation(value: unknown): Conversation {
    const input = object(value, 'Rename conversation command');
    const title = input.title === null || input.title === undefined
      ? null
      : boundedText(input.title, 'Název konverzace', 120);
    return this.database.engine.renameConversation(domainId(input.conversationId, 'conversation'), title);
  }

  listConversationMessages(value: unknown): ConversationMessage[] {
    const conversationId = domainId(value, 'conversation');
    return this.database.engine.listConversationMessages(conversationId, {
      maxResults: 100,
      maxCharacters: 100_000,
    }).items.reverse();
  }

  getCampaignLibrary(value: unknown): CampaignLibraryView {
    return this.database.engine.getCampaignLibrary(domainId(value, 'campaign'));
  }

  getAiSettings(value: unknown): CampaignAiSettings {
    return this.database.aiSettings.get(domainId(value, 'campaign'));
  }

  saveAiSettings(value: unknown): CampaignAiSettings {
    const input = object(value, 'AI settings command');
    const settings = object(input.settings, 'AI settings') as CampaignAiSettingsUpdate;
    return this.database.aiSettings.update(domainId(input.campaignId, 'campaign'), settings);
  }

  listPendingAiProposals(value: unknown): PendingTurnProposal[] {
    return this.database.aiProposals.listPending(domainId(value, 'campaign'));
  }

  getSceneContext(value: unknown): SceneContextView {
    return this.database.engine.getSceneContext(domainId(value, 'campaign'));
  }

  getChronicleToolCatalog(): ChronicleToolDescriptor[] {
    return this.database.engine.listToolDescriptors();
  }

  getChronicleTrace(): ChronicleToolTraceEntry[] {
    return this.database.orchestrator.getTrace();
  }

  private bootstrapDefinition(
    campaign: { rulesetId: string; rulesetVersion: string },
    definitionType: 'Class' | 'Species' | 'Background',
    name: string,
  ) {
    return this.database.characters.createDefinition({
      definitionType,
      rulesetId: campaign.rulesetId,
      rulesetVersion: campaign.rulesetVersion,
      name,
      description: '',
      source: 'Campaign bootstrap',
      origin: 'user',
      metadata: { bootstrap: true },
      homebrew: true,
    });
  }

  private refresh(characterId: string): CharacterCockpitView {
    return this.database.readModels.getCharacterCockpit(characterId);
  }

  private requireCharacter(characterId: string): void {
    if (!this.database.domain.getCharacter(characterId)) {
      throw new Error(`Character ${characterId} neexistuje.`);
    }
  }

  private requireOwnedResource(characterId: string, resourceId: string) {
    this.requireCharacter(characterId);
    const resource = this.database.characters.getResource(resourceId);
    if (!resource || resource.ownerEntityId !== characterId) {
      throw new Error(`Resource ${resourceId} nepatří zadané postavě.`);
    }
    return resource;
  }

  private requireOwnedPool(characterId: string, poolId: string) {
    this.requireCharacter(characterId);
    const pool = this.database.characters.listSpellSlotPools(characterId)
      .find((candidate) => candidate.id === poolId);
    if (!pool) throw new Error(`Spell slot pool ${poolId} nepatří zadané postavě.`);
    return pool;
  }

  private requireOwnedEffect(characterId: string, effectId: string) {
    this.requireCharacter(characterId);
    const effect = this.database.characters.getEffect(effectId);
    if (!effect || effect.targetEntityId !== characterId || effect.endEventId) {
      throw new Error(`Aktivní effect ${effectId} nepatří zadané postavě.`);
    }
    return effect;
  }

  private event(characterId: string, eventType: string, summary: string): EventDraft {
    const character = this.database.domain.getCharacter(characterId);
    return {
      eventType,
      summary,
      locationId: character?.currentLocationId ?? null,
    };
  }
}

function entityCardRequest(value: unknown): EntityCardRequest {
  const input = object(value, 'Entity card request');
  const id = textValue(input.id, 'Entity ID');
  const characterId = optionalDomainId(input.characterId, 'char');
  const observerEntityId = optionalActorDomainId(input.observerEntityId);
  return {
    id,
    ...(typeof input.kind === 'string' ? { kind: input.kind as EntityCardRequest['kind'] } : {}),
    ...(characterId ? { characterId } : {}),
    ...(observerEntityId ? { observerEntityId } : {}),
  };
}

function characterAmountCommand(value: unknown, positive: boolean): CharacterAmountCommand {
  const input = object(value, 'Character amount command');
  const amount = finiteNumber(input.amount, 'Amount');
  if (amount === 0 || (positive && amount < 0)) throw new Error('Amount musí být kladné číslo.');
  return { characterId: domainId(input.characterId, 'char'), amount };
}

function characterValueCommand(value: unknown): CharacterValueCommand {
  const input = object(value, 'Character value command');
  const numericValue = finiteNumber(input.value, 'Value');
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error('Value musí být nezáporné celé číslo.');
  }
  return { characterId: domainId(input.characterId, 'char'), value: numericValue };
}

function characterToggleCommand(value: unknown): CharacterToggleCommand {
  const input = object(value, 'Character toggle command');
  if (typeof input.value !== 'boolean') throw new Error('Value musí být boolean.');
  return { characterId: domainId(input.characterId, 'char'), value: input.value };
}

function resourceCommand(value: unknown): CharacterResourceCommand {
  const command = characterAmountCommand(value, true);
  const input = object(value, 'Resource command');
  if (!Number.isInteger(command.amount)) throw new Error('Amount musí být celé číslo.');
  return { ...command, resourceId: domainId(input.resourceId, 'resource') };
}

function poolCommand(value: unknown): CharacterPoolCommand {
  const input = object(value, 'Spell slot command');
  return {
    characterId: domainId(input.characterId, 'char'),
    poolId: domainId(input.poolId, 'pool'),
  };
}

function effectCommand(value: unknown): CharacterEffectCommand {
  const input = object(value, 'Effect command');
  return {
    characterId: domainId(input.characterId, 'char'),
    effectId: domainId(input.effectId, 'effect'),
  };
}

function deathSaveCommand(value: unknown): DeathSaveCommand {
  const input = object(value, 'Death save command');
  if (typeof input.success !== 'boolean') throw new Error('Success musí být boolean.');
  return { characterId: domainId(input.characterId, 'char'), success: input.success };
}

function characterOnlyCommand(value: unknown): string {
  return domainId(object(value, 'Character command').characterId, 'char');
}

function preferencesInput(value: unknown): CharacterPanelPreferencesInput {
  const input = object(value, 'Character panel preferences');
  if (!Array.isArray(input.sectionOrder) || !Array.isArray(input.collapsedSections)) {
    throw new Error('Preference sekcí musí být pole.');
  }
  return {
    campaignId: domainId(input.campaignId, 'campaign'),
    characterId: domainId(input.characterId, 'char'),
    sectionOrder: input.sectionOrder.map((item) => textValue(item, 'Section ID')) as CharacterPanelPreferencesInput['sectionOrder'],
    collapsedSections: input.collapsedSections.map((item) => textValue(item, 'Section ID')) as CharacterPanelPreferencesInput['collapsedSections'],
    panelWidth: finiteNumber(input.panelWidth, 'Panel width'),
  };
}

function runtimeSelection(
  value: unknown,
  prefix: DomainIdPrefix,
): { campaignId: string; entityId: string | null } {
  const input = object(value, 'Runtime selection command');
  return {
    campaignId: domainId(input.campaignId, 'campaign'),
    entityId: input.entityId === null || input.entityId === ''
      ? null
      : domainId(input.entityId, prefix),
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} musí být objekt.`);
  }
  return value as Record<string, unknown>;
}

function domainId(value: unknown, prefix: DomainIdPrefix): string {
  return requireDomainId(textValue(value, `${prefix} ID`), prefix);
}

function optionalDomainId(value: unknown, prefix: DomainIdPrefix): string | undefined {
  return value === undefined || value === null ? undefined : domainId(value, prefix);
}

function optionalActorDomainId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const id = textValue(value, 'Actor ID');
  return id.startsWith('creature_') ? requireDomainId(id, 'creature') : requireDomainId(id, 'char');
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error(`${label} musí být neprázdný text do 200 znaků.`);
  }
  return value;
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string') throw new Error(`${label} musí být text.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} nesmí být prázdný.`);
  if (normalized.length > maximum) throw new Error(`${label} může mít nejvýše ${maximum} znaků.`);
  return normalized;
}

function optionalBoundedText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return boundedText(value, label, maximum);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} musí být konečné číslo.`);
  }
  return value;
}

function hpSummary(amount: number): string {
  return amount > 0 ? `Obnoveno ${amount} životů.` : `Ztraceno ${Math.abs(amount)} životů.`;
}
