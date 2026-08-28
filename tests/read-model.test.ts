import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChronicleDatabase } from '../src/main/database';
import { CharacterPanelSectionIds } from '../src/shared/read-models';
import { seedArqos } from './fixtures/arqos';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Milestone 4 Character Cockpit read model', () => {
  it('projects the multiclass Arqos fixture without duplicating rules in the renderer', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedArqos(database);

    const cockpit = database.readModels.getCharacterCockpit(fixture.characterId);
    expect(cockpit.identity).toMatchObject({
      name: 'Arqos',
      fullName: 'Arqos Vael',
      totalLevel: 8,
      classSummary: 'Paladin 5 / Warlock 3',
    });
    expect(cockpit.identity.species?.label).toBe('Aasimar');
    expect(cockpit.identity.currentLocation?.label).toBe('Strážcův krb');
    expect(cockpit.combat).toMatchObject({
      hp: { current: 52, maximum: 59, temporary: 8 },
      armorClass: 18,
      initiative: 1,
      proficiencyBonus: 3,
      inspiration: true,
    });
    expect(cockpit.primaryMovement).toEqual({ type: 'walk', distance: 30, unit: 'ft' });
    expect(cockpit.abilities.map(({ score, modifier }) => ({ score, modifier }))).toEqual([
      { score: 15, modifier: 2 },
      { score: 10, modifier: 0 },
      { score: 10, modifier: 0 },
      { score: 12, modifier: 1 },
      { score: 12, modifier: 1 },
      { score: 20, modifier: 5 },
    ]);
    expect(cockpit.resources.find((resource) => resource.id === fixture.resourceId)).toMatchObject({
      current: 1,
      maximum: 2,
      display: 'pips',
    });
    expect(cockpit.spellcasting.slotPools.find((pool) => pool.id === fixture.pactPoolId))
      .toMatchObject({ poolType: 'pact', slotLevel: 2, current: 1, maximum: 2 });
    expect(cockpit.spellcasting.spells[0]).toMatchObject({
      level: 1,
      known: true,
      concentration: true,
    });
    expect(cockpit.concentration).toMatchObject({ id: fixture.effectId, name: 'Hex' });
    expect(cockpit.effects.map((effect) => effect.name)).toEqual(['Hex', 'Frightened']);
    expect(cockpit.features.map((feature) => feature.name)).toContain('Guardian of the Hearth');
    expect(cockpit.actions[0]).toMatchObject({ attackBonus: '+8', range: '120 ft', damage: '1d10' });
    expect(cockpit.inventory[0]).toMatchObject({ name: 'Rodový meč', quantity: 1 });
    expect(cockpit.defenses[0].target.label).toBe('Necrotic');
    expect(cockpit.proficiencies[0]).toMatchObject({ label: 'Persuasion', level: 'expertise' });
    expect(cockpit.languages[0].label).toBe('Common');
    expect(cockpit.preferences.sectionOrder).toEqual(CharacterPanelSectionIds);
    database.close();
  });

  it('resolves shared Entity Cards and preserves character context', async () => {
    const database = await openTemporaryDatabase();
    const fixture = seedArqos(database);

    expect(database.readModels.getEntityCard({
      id: fixture.spellDefinitionId,
      characterId: fixture.characterId,
    })).toMatchObject({
      cardType: 'definition',
      kind: 'Spell',
      name: 'Hex',
      characterState: { known: true, spellcastingSource: 'Warlock' },
    });
    expect(database.readModels.getEntityCard({
      id: 'feature_m4_arqos_custom',
      characterId: fixture.characterId,
    })).toMatchObject({ cardType: 'feature', name: 'Guardian of the Hearth', homebrew: true });
    expect(database.readModels.getEntityCard({ id: fixture.itemId })).toMatchObject({
      cardType: 'item',
      placementLabel: 'Drží Arqos',
      aliases: ['Hearthblade'],
    });
    expect(database.readModels.getEntityCard({ id: fixture.locationId })).toMatchObject({
      cardType: 'location',
      fullPath: 'Strážcův krb',
    });
    expect(database.readModels.getEntityCard({ id: fixture.characterId })).toMatchObject({
      cardType: 'character',
      species: { label: 'Aasimar' },
    });
    expect(database.readModels.getEntityCard({ id: fixture.effectId })).toMatchObject({
      cardType: 'effect',
      active: true,
      concentration: true,
    });
    expect(database.readModels.getEntityCard({ id: 'action_m4_eldritch_blast' })).toMatchObject({
      cardType: 'action',
      actionType: 'action',
    });
    database.close();
  });

  it('persists panel preferences per campaign and character across restart', async () => {
    const userData = await createTemporaryDirectory();
    let database = await ChronicleDatabase.open(userData);
    const fixture = seedArqos(database);
    const reordered = [...CharacterPanelSectionIds].reverse();
    database.preferences.saveCharacterPanelPreferences({
      campaignId: fixture.campaignId,
      characterId: fixture.characterId,
      sectionOrder: reordered,
      collapsedSections: ['spells', 'inventory'],
      panelWidth: 500,
    });
    database.close();

    database = await ChronicleDatabase.open(userData);
    expect(database.readModels.getCharacterCockpit(fixture.characterId).preferences).toMatchObject({
      sectionOrder: reordered,
      collapsedSections: ['spells', 'inventory'],
      panelWidth: 500,
    });
    expect(() => database.preferences.saveCharacterPanelPreferences({
      campaignId: fixture.campaignId,
      characterId: fixture.characterId,
      sectionOrder: reordered.slice(1),
      collapsedSections: [],
      panelWidth: 500,
    })).toThrow('každou podporovanou sekci právě jednou');
    database.close();
  });
});

async function openTemporaryDatabase(): Promise<ChronicleDatabase> {
  return ChronicleDatabase.open(await createTemporaryDirectory());
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-vnext-read-model-'));
  temporaryDirectories.push(directory);
  return directory;
}
