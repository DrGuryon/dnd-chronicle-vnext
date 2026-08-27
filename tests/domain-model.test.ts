import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LifeStateIds } from '../src/domain/models';
import { ChronicleDatabase } from '../src/main/database';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 2 domain model', () => {
  it('persists location hierarchy, event-backed item transfers, and effective location', async () => {
    const userData = await createTemporaryDirectory();
    let chronicle = await ChronicleDatabase.open(userData);
    let domain = chronicle.domain;

    const campaign = domain.createCampaign({
      id: 'campaign_ravenford',
      name: 'Ravenford Chronicle',
      rulesetId: 'dnd5e',
      rulesetVersion: '2024',
    });
    const ravenford = domain.createLocation({
      id: 'loc_ravenford',
      campaignId: campaign.id,
      locationType: 'City',
      name: 'Ravenford',
    });
    const market = domain.createLocation({
      id: 'loc_market_district',
      campaignId: campaign.id,
      parentLocationId: ravenford.id,
      locationType: 'District',
      name: 'Tržní čtvrť',
    });
    const alley = domain.createLocation({
      id: 'loc_back_alley',
      campaignId: campaign.id,
      parentLocationId: market.id,
      locationType: 'Alley',
      name: 'Zadní ulička',
    });
    const docks = domain.createLocation({
      id: 'loc_docks',
      campaignId: campaign.id,
      parentLocationId: ravenford.id,
      locationType: 'District',
      name: 'Doky',
    });
    const arqos = domain.createCharacter({
      id: 'char_arqos',
      campaignId: campaign.id,
      name: 'Arqos',
      characterType: 'PC',
      currentLocationId: alley.id,
      currentLifeStateId: LifeStateIds.alive,
    });
    const sword = domain.createItem({
      id: 'item_sword',
      campaignId: campaign.id,
      name: 'Meč',
      description: 'Starý meč nalezený v uličce.',
      quantity: 1,
      placement: { kind: 'location', locationId: alley.id },
    });

    expect(domain.getLocationPath(alley.id)).toBe('Ravenford / Tržní čtvrť / Zadní ulička');
    expect(domain.resolveEffectiveItemLocation(sword.id)).toEqual({
      locationId: alley.id,
      resolutionPath: [sword.id, alley.id],
    });

    const pickup = domain.transferItem({
      itemId: sword.id,
      placement: { kind: 'character', characterId: arqos.id },
      event: {
        id: 'event_arqos_picked_up_sword',
        eventType: 'item.picked_up',
        summary: 'Arqos zvedl meč',
      },
    });
    expect(pickup.sequence).toBe(1);
    expect(domain.resolveEffectiveItemLocation(sword.id)).toEqual({
      locationId: alley.id,
      resolutionPath: [sword.id, arqos.id, alley.id],
    });

    const movement = domain.moveCharacter({
      characterId: arqos.id,
      toLocationId: docks.id,
      event: {
        id: 'event_arqos_moved_to_docks',
        eventType: 'character.moved',
        summary: 'Arqos odešel do doků',
      },
    });
    expect(movement.sequence).toBe(2);
    expect(domain.resolveEffectiveItemLocation(sword.id).locationId).toBe(docks.id);

    const history = domain.getItemPlacementHistory(sword.id);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      placement: { kind: 'location', locationId: alley.id },
      fromEventId: null,
      toEventId: pickup.id,
    });
    expect(history[1]).toMatchObject({
      placement: { kind: 'character', characterId: arqos.id },
      fromEventId: pickup.id,
      toEventId: null,
    });

    domain.createAlias({
      id: 'alias_arqos_sword',
      entityId: sword.id,
      alias: 'Můj meč',
      usedByEntityId: arqos.id,
      fromEventId: pickup.id,
    });
    domain.createRelation({
      id: 'relation_arqos_owns_sword',
      campaignId: campaign.id,
      sourceEntityId: arqos.id,
      targetEntityId: sword.id,
      relationType: 'owns',
      fromEventId: pickup.id,
      metadata: { acquiredIn: 'back-alley' },
    });
    domain.createKnowledge({
      id: 'knowledge_arqos_knows_sword',
      campaignId: campaign.id,
      subjectEntityId: sword.id,
      observerEntityId: arqos.id,
      knowledgeType: 'identity',
      value: 'Arqos ví, že jde o starý meč.',
      fromEventId: pickup.id,
      confidence: 1,
      source: 'event',
    });

    chronicle.close();
    chronicle = await ChronicleDatabase.open(userData);
    domain = chronicle.domain;

    expect(domain.getCampaign(campaign.id)?.name).toBe('Ravenford Chronicle');
    expect(domain.getCharacter(arqos.id)?.currentLocationId).toBe(docks.id);
    expect(domain.getItem(sword.id)?.quantity).toBe(1);
    expect(domain.getItemPlacement(sword.id)).toEqual({
      kind: 'character',
      characterId: arqos.id,
    });
    expect(domain.resolveEffectiveItemLocation(sword.id).locationId).toBe(docks.id);
    expect(domain.listEvents(campaign.id).map((event) => event.id)).toEqual([
      pickup.id,
      movement.id,
    ]);
    expect(domain.getItemPlacementHistory(sword.id)).toHaveLength(2);
    chronicle.close();
  });

  it('rejects a cyclic item-container transfer without recording an event', async () => {
    const userData = await createTemporaryDirectory();
    const chronicle = await ChronicleDatabase.open(userData);
    const domain = chronicle.domain;
    const campaign = domain.createCampaign({
      id: 'campaign_cycle_test',
      name: 'Cycle test',
      rulesetId: 'dnd5e',
      rulesetVersion: '2024',
    });
    const first = domain.createItem({
      id: 'item_first_container',
      campaignId: campaign.id,
      name: 'První vak',
      quantity: 1,
      placement: { kind: 'unknown' },
    });
    const second = domain.createItem({
      id: 'item_second_container',
      campaignId: campaign.id,
      name: 'Druhý vak',
      quantity: 1,
      placement: { kind: 'unknown' },
    });
    domain.transferItem({
      itemId: first.id,
      placement: { kind: 'container', containerItemId: second.id },
      event: { eventType: 'item.stored', summary: 'První vak vložen do druhého' },
    });

    expect(() => domain.transferItem({
      itemId: second.id,
      placement: { kind: 'container', containerItemId: first.id },
      event: { eventType: 'item.stored', summary: 'Neplatný cyklus' },
    })).toThrow('cyklus kontejnerů');
    expect(domain.listEvents(campaign.id)).toHaveLength(1);
    chronicle.close();
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-domain-'));
  temporaryDirectories.push(directory);
  return directory;
}

