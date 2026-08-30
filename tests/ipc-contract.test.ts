import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LifeStateIds } from '../src/domain/models';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleIpcService } from '../src/main/ipc/chronicle-ipc-service';
import { CharacterPanelSectionIds } from '../src/shared/read-models';
import { seedArqos } from './fixtures/arqos';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 4 typed IPC command layer', () => {
  it('validates commands, records canonical events, and returns refreshed DB state', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedArqos(database);
    const ipc = new ChronicleIpcService(database);

    database.engine.setActivePlayerCharacter(fixture.campaignId, fixture.characterId);
    expect(ipc.getCharacterCockpit()).toMatchObject({ characterId: fixture.characterId });
    expect(ipc.changeHitPoints({ characterId: fixture.characterId, amount: -7 }).combat.hp.current)
      .toBe(45);
    expect(ipc.setTemporaryHitPoints({ characterId: fixture.characterId, value: 4 }).combat.hp.temporary)
      .toBe(4);
    expect(ipc.spendResource({
      characterId: fixture.characterId,
      resourceId: fixture.resourceId,
      amount: 1,
    }).resources.find((resource) => resource.id === fixture.resourceId)?.current).toBe(0);
    const beforeRejectedSpend = database.domain.listEvents(fixture.campaignId).length;
    expect(() => ipc.spendResource({
      characterId: fixture.characterId,
      resourceId: fixture.resourceId,
      amount: 1,
    })).toThrow('nemá dostatek');
    expect(database.domain.listEvents(fixture.campaignId)).toHaveLength(beforeRejectedSpend);
    expect(ipc.restoreResource({
      characterId: fixture.characterId,
      resourceId: fixture.resourceId,
      amount: 1,
    }).resources.find((resource) => resource.id === fixture.resourceId)?.current).toBe(1);
    expect(ipc.spendSpellSlot({
      characterId: fixture.characterId,
      poolId: fixture.pactPoolId,
    }).spellcasting.slotPools.find((pool) => pool.id === fixture.pactPoolId)?.current).toBe(0);
    expect(ipc.restoreSpellSlot({
      characterId: fixture.characterId,
      poolId: fixture.pactPoolId,
    }).spellcasting.slotPools.find((pool) => pool.id === fixture.pactPoolId)?.current).toBe(1);
    expect(ipc.setInspiration({ characterId: fixture.characterId, value: false }).combat.inspiration)
      .toBe(false);
    expect(ipc.recordDeathSave({ characterId: fixture.characterId, success: true })
      .combat.deathSaves.successes).toBe(1);
    expect(ipc.removeCondition({
      characterId: fixture.characterId,
      effectId: fixture.conditionId,
    }).effects.map((effect) => effect.id)).not.toContain(fixture.conditionId);
    expect(ipc.endConcentration({ characterId: fixture.characterId }).concentration).toBeNull();

    const eventTypes = database.domain.listEvents(fixture.campaignId).map((event) => event.eventType);
    expect(eventTypes).toContain('combat.hp.changed');
    expect(eventTypes).toContain('resource.spent');
    expect(eventTypes).toContain('spell.slot.spent');
    expect(eventTypes).toContain('concentration.ended');
    expect(eventTypes.every((eventType) => eventType.length > 0)).toBe(true);
    database.close();
  });

  it('keeps pools scoped to their character and applies rest reset rules', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedArqos(database);
    const ipc = new ChronicleIpcService(database);

    ipc.spendResource({ characterId: fixture.characterId, resourceId: fixture.resourceId, amount: 1 });
    ipc.spendResource({
      characterId: fixture.characterId,
      resourceId: fixture.longRestResourceId,
      amount: 2,
    });
    ipc.spendSpellSlot({ characterId: fixture.characterId, poolId: fixture.pactPoolId });
    ipc.spendSpellSlot({ characterId: fixture.characterId, poolId: fixture.standardPoolId });
    const shortRest = ipc.takeShortRest({ characterId: fixture.characterId });
    expect(shortRest.resources.find((resource) => resource.id === fixture.resourceId)?.current).toBe(2);
    expect(shortRest.resources.find((resource) => resource.id === fixture.longRestResourceId)?.current).toBe(8);
    expect(shortRest.spellcasting.slotPools.find((pool) => pool.id === fixture.pactPoolId)?.current).toBe(2);
    expect(shortRest.spellcasting.slotPools.find((pool) => pool.id === fixture.standardPoolId)?.current).toBe(1);
    const longRest = ipc.takeLongRest({ characterId: fixture.characterId });
    expect(longRest.resources.find((resource) => resource.id === fixture.longRestResourceId)?.current).toBe(25);
    expect(longRest.spellcasting.slotPools.find((pool) => pool.id === fixture.standardPoolId)?.current).toBe(4);

    const other = database.domain.createCharacter({
      id: 'char_m4_intruder',
      campaignId: fixture.campaignId,
      name: 'Jiná postava',
      characterType: 'PC',
      currentLifeStateId: LifeStateIds.alive,
    });
    expect(() => ipc.spendResource({
      characterId: other.id,
      resourceId: fixture.resourceId,
      amount: 1,
    })).toThrow('nepatří zadané postavě');
    expect(() => ipc.changeHitPoints({ characterId: fixture.characterId, amount: Number.NaN }))
      .toThrow('konečné číslo');
    database.close();
  });

  it('exposes typed card queries and validates preference payloads', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedArqos(database);
    const ipc = new ChronicleIpcService(database);

    expect(ipc.getEntitySummary({
      id: fixture.spellDefinitionId,
      characterId: fixture.characterId,
    })).toMatchObject({ kind: 'Spell', label: 'Hex' });
    expect(ipc.getEntityCard({
      id: fixture.spellDefinitionId,
      characterId: fixture.characterId,
    })).toMatchObject({ cardType: 'definition', name: 'Hex' });
    const preferences = ipc.saveCharacterPanelPreferences({
      campaignId: fixture.campaignId,
      characterId: fixture.characterId,
      sectionOrder: [...CharacterPanelSectionIds].reverse(),
      collapsedSections: ['actions'],
      panelWidth: 470,
    });
    expect(preferences.preferences).toMatchObject({
      collapsedSections: ['actions'],
      panelWidth: 470,
    });
    expect(() => ipc.saveCharacterPanelPreferences({
      campaignId: fixture.campaignId,
      characterId: fixture.characterId,
      sectionOrder: CharacterPanelSectionIds,
      collapsedSections: ['not-a-section'],
      panelWidth: 470,
    })).toThrow('nepodporovanou sekci');
    database.close();
  });

  it('exposes validated runtime and conversation controls without SQL', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedArqos(database);
    const ipc = new ChronicleIpcService(database);
    expect(ipc.getRuntimeWorkspace()).toMatchObject({
      campaigns: [{ id: fixture.campaignId, runtime: { activePlayerCharacterId: null } }],
    });
    expect(ipc.setActivePlayerCharacter({
      campaignId: fixture.campaignId,
      entityId: fixture.characterId,
    }).activePlayerCharacterId).toBe(fixture.characterId);
    const conversation = ipc.createConversation({
      campaignId: fixture.campaignId,
      title: 'První scéna',
    });
    expect(ipc.setActiveConversation({
      campaignId: fixture.campaignId,
      entityId: conversation.id,
    }).activeConversationId).toBe(conversation.id);
    expect(ipc.getSceneContext(fixture.campaignId)).toMatchObject({
      activePlayerCharacter: { id: fixture.characterId },
      conversationId: conversation.id,
    });
    expect(ipc.getChronicleToolCatalog().every((tool) => tool.mutatesState === false)).toBe(true);
    database.close();
  });
});

async function openTemporaryDatabase(): Promise<ChronicleDatabase> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-ipc-'));
  temporaryDirectories.push(directory);
  return ChronicleDatabase.open(directory);
}
