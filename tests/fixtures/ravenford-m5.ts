import { LifeStateIds } from '../../src/domain/models';
import type { ChronicleDatabase } from '../../src/main/database';
import { seedArqos } from './arqos';

export interface RavenfordM5Fixture extends ReturnType<typeof seedArqos> {
  miraId: string;
  alleyId: string;
  marketId: string;
  swordId: string;
  conversationId: string;
  worldKnowledgeId: string;
  miraKnowledgeId: string;
  arqosKnowledgeId: string;
}

export function seedRavenfordM5(database: ChronicleDatabase): RavenfordM5Fixture {
  const base = seedArqos(database);
  const market = database.domain.createLocation({
    id: 'loc_m5_market',
    campaignId: base.campaignId,
    locationType: 'District',
    name: 'Tržní čtvrť',
    description: 'Hlučná obchodní čtvrť Ravenfordu.',
  });
  const alley = database.domain.createLocation({
    id: 'loc_m5_back_alley',
    campaignId: base.campaignId,
    parentLocationId: market.id,
    locationType: 'Street',
    name: 'Zadní ulička',
    description: 'Úzká ulička za tržištěm.',
  });
  database.domain.moveCharacter({
    characterId: base.characterId,
    toLocationId: alley.id,
    event: {
      id: 'event_m5_arqos_enters_alley',
      eventType: 'character.moved',
      summary: 'Arqos vstoupil do zadní uličky.',
      locationId: alley.id,
    },
  });
  const mira = database.domain.createCharacter({
    id: 'char_m5_mira',
    campaignId: base.campaignId,
    name: 'Mira',
    fullName: 'Mira Vale',
    description: 'Badatelka, která zná symboly Ravenfordu.',
    characterType: 'NPC',
    currentLocationId: alley.id,
    currentLifeStateId: LifeStateIds.alive,
  });
  const sword = database.domain.createItem({
    id: 'item_m5_silver_sword',
    campaignId: base.campaignId,
    name: 'Starý stříbrný meč',
    description: 'Stará čepel s vyrytým rodovým symbolem.',
    quantity: 1,
    placement: { kind: 'location', locationId: alley.id },
  });
  database.domain.createAlias({
    id: 'alias_m5_silver_sword',
    entityId: sword.id,
    alias: 'stříbrný meč',
  });
  database.domain.createAlias({
    id: 'alias_m5_arqos_sword',
    entityId: sword.id,
    alias: 'můj meč',
    usedByEntityId: base.characterId,
  });
  const world = database.domain.createKnowledge({
    id: 'knowledge_m5_world_secret',
    campaignId: base.campaignId,
    subjectEntityId: sword.id,
    visibilityScope: 'world',
    knowledgeType: 'provenance',
    value: 'Meč patřil vrahovi Miřina otce.',
    source: 'world-truth',
  });
  const publicRecord = database.domain.createKnowledge({
    id: 'knowledge_m5_public_sword',
    campaignId: base.campaignId,
    subjectEntityId: sword.id,
    visibilityScope: 'public',
    knowledgeType: 'appearance',
    value: 'Na meči je viditelný stříbrný symbol.',
    source: 'observation',
  });
  void publicRecord;
  const miraKnowledge = database.domain.createKnowledge({
    id: 'knowledge_m5_mira_memory',
    campaignId: base.campaignId,
    subjectEntityId: sword.id,
    observerEntityId: mira.id,
    visibilityScope: 'observer',
    knowledgeType: 'memory',
    value: 'Symbol na meči už kdysi viděla.',
    source: 'memory',
  });
  const arqosKnowledge = database.domain.createKnowledge({
    id: 'knowledge_m5_arqos_observation',
    campaignId: base.campaignId,
    subjectEntityId: sword.id,
    observerEntityId: base.characterId,
    visibilityScope: 'observer',
    knowledgeType: 'observation',
    value: 'Meč je starý a neobvyklý.',
    source: 'observation',
  });
  const conversation = database.engine.createConversation(
    base.campaignId,
    'Zadní ulička',
    'conversation_m5_alley',
  );
  for (let index = 1; index <= 30; index += 1) {
    database.engine.addConversationMessage({
      id: `message_m5_${String(index).padStart(2, '0')}`,
      conversationId: conversation.id,
      campaignId: base.campaignId,
      role: index % 2 ? 'user' : 'assistant',
      content: index === 3
        ? 'Arqos našel stříbrný symbol v zatopeném sklepě.'
        : `Historická zpráva číslo ${index}.`,
      referencedEntityIds: index === 3 ? [base.characterId] : [],
    });
  }
  database.engine.setActivePlayerCharacter(base.campaignId, base.characterId);
  database.engine.setActiveConversation(base.campaignId, conversation.id);
  database.engine.setSceneLocation(base.campaignId, alley.id);
  database.engine.setSceneParticipants(base.campaignId, [
    { entityId: base.characterId, participantRole: 'player' },
    { entityId: mira.id, participantRole: 'npc' },
  ]);
  return {
    ...base,
    miraId: mira.id,
    alleyId: alley.id,
    marketId: market.id,
    swordId: sword.id,
    conversationId: conversation.id,
    worldKnowledgeId: world.id,
    miraKnowledgeId: miraKnowledge.id,
    arqosKnowledgeId: arqosKnowledge.id,
  };
}
