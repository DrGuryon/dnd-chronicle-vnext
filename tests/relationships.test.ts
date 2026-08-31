import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChronicleDatabase } from '../src/main/database';
import type { TurnChange } from '../src/shared/chronicle-engine';
import { seedRavenfordM5 } from './fixtures/ravenford-m5';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Milestone 6 actor relationships', () => {
  it('uses world/public/observer precedence without leaking secret profiles', async () => {
    const database = await openDatabase();
    const fixture = seedRavenfordM5(database);
    const relationId = 'relation_m6_arqos_mira';
    applyRelationship(database, fixture.campaignId, 'proposal_m6_world', {
      type: 'actorRelationship.upsert',
      relationId,
      relationshipId: 'relationship_m6_world',
      sourceEntityId: fixture.characterId,
      targetEntityId: fixture.miraId,
      relationType: 'trust',
      visibilityScope: 'world',
      currentSummary: 'Mira je tajně připravena Arqose zradit.',
      historySummary: 'Skrytá dohoda s obsidiánovým konkláve.',
    });
    applyRelationship(database, fixture.campaignId, 'proposal_m6_public', {
      type: 'actorRelationship.upsert',
      relationId,
      relationshipId: 'relationship_m6_public',
      sourceEntityId: fixture.characterId,
      targetEntityId: fixture.miraId,
      relationType: 'trust',
      visibilityScope: 'public',
      currentSummary: 'Navenek si navzájem důvěřují.',
    });
    const observerResult = applyRelationship(database, fixture.campaignId, 'proposal_m6_observer', {
      type: 'actorRelationship.upsert',
      relationId,
      relationshipId: 'relationship_m6_mira',
      sourceEntityId: fixture.characterId,
      targetEntityId: fixture.miraId,
      relationType: 'trust',
      visibilityScope: 'observer',
      observerEntityId: fixture.miraId,
      currentSummary: 'Mira cítí vinu a váhá se zradou.',
      referencedEventIds: [],
      referenceCurrentEvent: true,
    });

    const world = database.relationships.getActorRelationships({
      campaignId: fixture.campaignId, actorId: fixture.characterId,
    });
    const mira = database.relationships.getActorRelationships({
      campaignId: fixture.campaignId, actorId: fixture.characterId, observerEntityId: fixture.miraId,
    });
    const arqos = database.relationships.getActorRelationships({
      campaignId: fixture.campaignId, actorId: fixture.characterId, observerEntityId: fixture.characterId,
    });
    expect(world.relationships[0]).toMatchObject({ relationshipId: 'relationship_m6_world' });
    expect(mira.relationships[0]).toMatchObject({ relationshipId: 'relationship_m6_mira' });
    expect(arqos.relationships[0]).toMatchObject({ relationshipId: 'relationship_m6_public' });
    expect(mira.relationships[0].eventReferences.map((value) => value.eventId)).toContain(observerResult.eventId);

    const hiddenSearch = database.engine.searchCampaign({
      campaignId: fixture.campaignId, query: 'obsidiánovým konkláve', observerEntityId: fixture.miraId,
    });
    expect(hiddenSearch.items).toEqual([]);
    expect(database.engine.searchCampaign({ campaignId: fixture.campaignId, query: 'obsidiánovým konkláve' }).items)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'relationship_m6_world' })]));
    database.close();
  });

  it('rejects non-actor endpoints and keeps relationship updates in the current Event transaction', async () => {
    const database = await openDatabase();
    const fixture = seedRavenfordM5(database);
    const invalid = database.turnTransactions.validateTurnTransaction({
      id: 'proposal_m6_invalid_actor',
      campaignId: fixture.campaignId,
      event: { eventType: 'relationship.changed', summary: 'Neplatný vztah.' },
      changes: [{
        type: 'actorRelationship.upsert',
        relationId: 'relation_m6_invalid',
        sourceEntityId: fixture.characterId,
        targetEntityId: fixture.swordId,
        relationType: 'owns',
        visibilityScope: 'public',
        currentSummary: 'Tohle není actor relationship.',
      }],
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors[0].message).toContain('Character nebo Creature');
    database.close();
  });
});

function applyRelationship(
  database: ChronicleDatabase,
  campaignId: string,
  transactionId: string,
  change: TurnChange,
) {
  return database.turnTransactions.applyTurnTransaction({
    id: transactionId,
    campaignId,
    event: { eventType: 'relationship.changed', summary: 'Vztah se změnil.' },
    changes: [change],
  });
}

async function openDatabase(): Promise<ChronicleDatabase> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-m6-rel-'));
  temporaryDirectories.push(directory);
  return ChronicleDatabase.open(directory);
}
