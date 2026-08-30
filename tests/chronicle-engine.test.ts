import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LifeStateIds } from '../src/domain/models';
import { ChronicleDatabase } from '../src/main/database';
import { seedArqos } from './fixtures/arqos';
import { seedRavenfordM5 } from './fixtures/ravenford-m5';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 5 Chronicle Engine retrieval', () => {
  it('uses explicit runtime state and keeps the Hot SceneContext small', async () => {
    const database = await openTemporaryDatabase();
    const base = seedArqos(database);
    expect(database.readModels.getInitialCockpit()).toBeNull();
    database.engine.setActivePlayerCharacter(base.campaignId, base.characterId);
    expect(database.readModels.getInitialCockpit()).toMatchObject({ characterId: base.characterId });
    database.close();

    const full = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(full);
    const context = full.engine.getSceneContext(fixture.campaignId, 8);
    expect(context.activePlayerCharacter?.id).toBe(fixture.characterId);
    expect(context.sceneLocation?.id).toBe(fixture.alleyId);
    expect(context.participants.map((item) => item.id)).toEqual([fixture.characterId, fixture.miraId]);
    expect(context.recentMessages).toHaveLength(8);
    expect(context.recentMessages.map((message) => message.sequence)).toEqual([23, 24, 25, 26, 27, 28, 29, 30]);
    expect(context).not.toHaveProperty('inventory');
    expect(context).not.toHaveProperty('spells');
    expect(JSON.stringify(context)).not.toContain('Přijal pact');
    full.close();
  });

  it('separates world truth, public knowledge, and observer memories', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    const world = database.engine.getKnowledge({
      campaignId: fixture.campaignId,
      subjectEntityId: fixture.swordId,
    }).items;
    const mira = database.engine.getKnowledge({
      campaignId: fixture.campaignId,
      subjectEntityId: fixture.swordId,
      observerEntityId: fixture.miraId,
    }).items;
    const arqos = database.engine.getKnowledge({
      campaignId: fixture.campaignId,
      subjectEntityId: fixture.swordId,
      observerEntityId: fixture.characterId,
    }).items;

    expect(world.map((item) => item.id)).toEqual(expect.arrayContaining([
      fixture.worldKnowledgeId, 'knowledge_m5_public_sword',
    ]));
    expect(mira.map((item) => item.id)).toEqual(expect.arrayContaining([
      fixture.miraKnowledgeId, 'knowledge_m5_public_sword',
    ]));
    expect(mira.map((item) => item.id)).not.toContain(fixture.worldKnowledgeId);
    expect(mira.map((item) => item.id)).not.toContain(fixture.arqosKnowledgeId);
    expect(arqos.map((item) => item.id)).toContain(fixture.arqosKnowledgeId);
    expect(arqos.map((item) => item.id)).not.toContain(fixture.miraKnowledgeId);
    database.close();
  });

  it('retrieves only requested Character, Item, Location, Definition, and Relation context', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    database.domain.createRelation({
      id: 'relation_m5_mira_examining_sword',
      campaignId: fixture.campaignId,
      sourceEntityId: fixture.miraId,
      targetEntityId: fixture.swordId,
      relationType: 'examining',
    });
    const character = database.engine.getCharacterContext({
      campaignId: fixture.campaignId,
      characterId: fixture.characterId,
      sections: ['identity', 'combat'],
    });
    expect(Object.keys(character.sections)).toEqual(['identity', 'combat']);
    expect(character.sections).not.toHaveProperty('biography');
    expect(character.sections).not.toHaveProperty('inventory');

    const item = database.engine.getItemContext({
      campaignId: fixture.campaignId,
      itemId: fixture.swordId,
      observerEntityId: fixture.miraId,
      budget: { maxResults: 5 },
    });
    expect(item.placement).toEqual({ kind: 'location', locationId: fixture.alleyId });
    expect(item.relations.map((relation) => relation.id)).toContain('relation_m5_mira_examining_sword');
    expect(item.knowledge.map((entry) => entry.id)).not.toContain(fixture.worldKnowledgeId);

    const location = database.engine.getLocationContext({
      campaignId: fixture.campaignId,
      locationId: fixture.alleyId,
      budget: { maxResults: 10 },
    });
    expect(location.fullPath).toBe('Tržní čtvrť / Zadní ulička');
    expect(location.occupants.map((entry) => entry.id)).toEqual(expect.arrayContaining([
      fixture.characterId, fixture.miraId,
    ]));
    expect(location.items.map((entry) => entry.id)).toContain(fixture.swordId);
    expect(database.engine.getDefinition(fixture.spellDefinitionId)).toMatchObject({
      definitionType: 'Spell', name: 'Hex',
    });
    database.close();
  });

  it('resolves aliases deterministically and reports real ambiguity', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    expect(database.engine.resolveEntity({
      campaignId: fixture.campaignId,
      query: 'MŮJ MEČ',
      observerEntityId: fixture.characterId,
      entityTypes: ['Item'],
    })).toMatchObject({
      ambiguous: false,
      matches: [{ entity: { id: fixture.swordId }, matchType: 'observerAlias', confidence: 1 }],
    });

    const guards = ['a', 'b'].map((suffix) => database.domain.createCharacter({
      id: `char_m5_guard_${suffix}`,
      campaignId: fixture.campaignId,
      name: 'Strážný',
      characterType: 'NPC',
      currentLocationId: fixture.alleyId,
      currentLifeStateId: LifeStateIds.alive,
    }));
    const ambiguous = database.engine.resolveEntity({
      campaignId: fixture.campaignId,
      query: 'strážný',
      entityTypes: ['Character'],
    });
    expect(ambiguous.ambiguous).toBe(true);
    expect(ambiguous.matches.map((match) => match.entity.id)).toEqual(guards.map((guard) => guard.id));
    database.engine.setSceneParticipants(fixture.campaignId, [
      { entityId: guards[0].id, participantRole: 'npc' },
    ]);
    const biased = database.engine.resolveEntity({
      campaignId: fixture.campaignId,
      query: 'strážný',
      entityTypes: ['Character'],
    });
    expect(biased.ambiguous).toBe(false);
    expect(biased.matches[0].entity.id).toBe(guards[0].id);
    database.close();
  });

  it('searches Cold history in SQLite with bounds and no cross-campaign leakage', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    const other = database.domain.createCampaign({
      id: 'campaign_m5_other',
      name: 'Other',
      rulesetId: 'dnd5e',
      rulesetVersion: '2024',
    });
    database.domain.createLocation({
      id: 'loc_m5_other',
      campaignId: other.id,
      name: 'Zatopený sklep',
      locationType: 'Cellar',
      description: 'stříbrný symbol sklep',
    });
    const search = database.engine.searchCampaign({
      campaignId: fixture.campaignId,
      query: 'stříbrný symbol sklep',
      budget: { maxResults: 3 },
    });
    expect(search.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'message', id: 'message_m5_03' }),
    ]));
    expect(search.items.every((item) => item.id !== 'loc_m5_other')).toBe(true);

    const firstPage = database.engine.listConversationMessages(fixture.conversationId, { maxResults: 5 });
    expect(firstPage.items).toHaveLength(5);
    expect(firstPage.truncated).toBe(true);
    expect(firstPage.nextCursor).toBe('26');
    const secondPage = database.engine.listConversationMessages(fixture.conversationId, {
      maxResults: 5,
      cursor: firstPage.nextCursor,
    });
    expect(secondPage.items[0].sequence).toBe(25);
    const characterBounded = database.engine.listConversationMessages(fixture.conversationId, {
      maxResults: 20,
      maxCharacters: 300,
    });
    expect(characterBounded.truncated).toBe(true);
    expect(JSON.stringify(characterBounded.items).length).toBeLessThanOrEqual(300);
    database.close();
  });

  it('exposes a serializable provider-neutral read-only tool catalog', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedRavenfordM5(database);
    const descriptors = database.engine.listToolDescriptors();
    expect(descriptors.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'chronicle.get_scene_context',
      'chronicle.get_character_context',
      'chronicle.get_item_context',
      'chronicle.get_location_context',
      'chronicle.get_location_contents',
      'chronicle.get_definition',
      'chronicle.get_relations',
      'chronicle.get_knowledge',
      'chronicle.get_relevant_events',
      'chronicle.resolve_entity',
      'chronicle.search_campaign',
    ]));
    expect(descriptors.every((tool) => tool.mutatesState === false)).toBe(true);
    expect(JSON.parse(JSON.stringify(descriptors))).toEqual(descriptors);
    const before = {
      events: database.domain.listEvents(fixture.campaignId).length,
      history: database.characters.listStateChanges(fixture.characterId).length,
    };
    const result = database.orchestrator.executeTool('chronicle.get_item_context', {
      campaignId: fixture.campaignId,
      itemId: fixture.swordId,
      observerEntityId: fixture.miraId,
      budget: { maxResults: 3 },
    });
    expect(result).toMatchObject({ item: { id: fixture.swordId } });
    expect(database.domain.listEvents(fixture.campaignId)).toHaveLength(before.events);
    expect(database.characters.listStateChanges(fixture.characterId)).toHaveLength(before.history);
    expect(database.orchestrator.getTrace().map((entry) => entry.stage)).toContain('tool_called');
    database.close();
  });

  it('persists runtime, conversations, and messages across restart', async () => {
    const directory = await createTemporaryDirectory();
    let database = await ChronicleDatabase.open(directory);
    const fixture = seedRavenfordM5(database);
    database.close();
    database = await ChronicleDatabase.open(directory);
    expect(database.engine.getCampaignRuntimeState(fixture.campaignId)).toMatchObject({
      activePlayerCharacterId: fixture.characterId,
      activeConversationId: fixture.conversationId,
      activeSceneLocationId: fixture.alleyId,
    });
    expect(database.engine.listConversationMessages(fixture.conversationId, { maxResults: 50 }).items)
      .toHaveLength(30);
    expect(database.engine.listSceneParticipants(fixture.campaignId).map((entry) => entry.entityId))
      .toEqual([fixture.characterId, fixture.miraId]);
    database.close();
  });
});

async function openTemporaryDatabase(): Promise<ChronicleDatabase> {
  return ChronicleDatabase.open(await createTemporaryDirectory());
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-m5-engine-'));
  temporaryDirectories.push(directory);
  return directory;
}
