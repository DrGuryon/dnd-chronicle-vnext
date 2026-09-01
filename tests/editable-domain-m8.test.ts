import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AbilityIds } from '../src/domain/character-models';
import { createDomainId } from '../src/domain/ids';
import { LifeStateIds } from '../src/domain/models';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleIpcService } from '../src/main/ipc/chronicle-ipc-service';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Milestone 8 editable Chronicle domain', () => {
  it('seeds an idempotent immutable searchable built-in catalog and exposes registry descriptors', async () => {
    const opened = await openDatabase();
    const database = opened.database;
    try {
      expect(database.rulesCatalog.listRulesets()).toMatchObject([{
        id: 'dnd5e', versions: [{ id: '2014' }, { id: '2024' }],
      }]);
      const dwarves = database.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', query: 'Trpaslík',
        definitionTypes: ['Species'], includeBuiltIn: true, includeHomebrew: false,
      });
      expect(dwarves.items).toHaveLength(1);
      expect(dwarves.items[0]).toMatchObject({
        id: 'def_dnd5e_2024_species_dwarf', name: 'Dwarf', builtIn: true,
        packId: 'dnd5e-srd-5.2.1', packVersion: '1.0.0',
      });
      const ids = database.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', includeBuiltIn: true,
        includeHomebrew: false, limit: 200,
      }).items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      database.close();

      const reopened = await ChronicleDatabase.open(opened.directory);
      try {
        const reopenedIds = reopened.rulesCatalog.search({
          rulesetId: 'dnd5e', rulesetVersion: '2024', includeBuiltIn: true,
          includeHomebrew: false, limit: 200,
        }).items.map((item) => item.id);
        expect(reopenedIds).toEqual(ids);
      } finally {
        reopened.close();
      }

      const raw = new DatabaseSync(path.join(opened.directory, 'data', 'chronicle.db'));
      expect(() => raw.prepare('UPDATE rule_definitions SET name=? WHERE id=?')
        .run('Changed', 'def_dnd5e_2024_species_dwarf')).toThrow(/Vestavěnou definici nelze upravit/);
      raw.close();
    } finally {
      database.close();
    }
  });

  it('creates and edits a complete character atomically with audit but no world event', async () => {
    const opened = await openDatabase();
    const database = opened.database;
    try {
      const campaign = database.domain.createCampaign({ name: 'Ravenford', rulesetId: 'dnd5e', rulesetVersion: '2024' });
      const dwarf = definition(database, campaign.id, 'Species', 'Dwarf');
      const soldier = definition(database, campaign.id, 'Background', 'Soldier');
      const fighter = definition(database, campaign.id, 'Class', 'Fighter');
      const athletics = definition(database, campaign.id, 'Skill', 'Athletics');
      const dwarvish = definition(database, campaign.id, 'Language', 'Dwarvish');
      const characterId = createDomainId('char');
      const saved = database.characterEditor.save({
        campaignId: campaign.id,
        characterId: undefined,
        name: 'Borin',
        fullName: 'Borin Kamenný štít',
        description: 'Strážce severní brány.',
        characterType: 'PC',
        biography: { ...emptyBiography(), biography: 'Narodil se pod horou.', notes: 'Drží hlídku.' },
        origin: { speciesId: dwarf.id, lineageId: null, backgroundId: soldier.id },
        classes: [{ id: createDomainId('class'), classId: fighter.id, subclassId: null, level: 3 }],
        abilities: AbilityIds.map((abilityId, index) => ({ abilityId, baseScore: 10 + index, permanentModifier: 0, overrideScore: null })),
        proficiencies: [
          { id: createDomainId('proficiency'), category: 'skill', targetDefinitionId: athletics.id, customTarget: null, level: 'proficient' },
          { id: createDomainId('proficiency'), category: 'language', targetDefinitionId: dwarvish.id, customTarget: null, level: 'proficient' },
        ],
        features: [], spellcastingSources: [], spells: [], homebrewDefinitions: [],
      });
      expect(saved.view.character.name).toBe('Borin');
      expect(saved.view.origin.speciesId).toBe(dwarf.id);
      expect(saved.view.classes[0]).toMatchObject({ classId: fighter.id, level: 3 });
      expect(saved.view.abilities).toHaveLength(6);
      expect(database.domain.listEvents(campaign.id)).toHaveLength(0);
      expect(database.dataChanges.listAudit(campaign.id)[0]).toMatchObject({ origin: 'manual' });

      const transaction = {
        id: createDomainId('change'),
        campaignId: campaign.id,
        origin: 'manual' as const,
        summary: 'Úprava profilu Borina',
        changes: [
          { type: 'character.identity.set' as const, characterId: saved.view.character.id, name: 'Borin Železný', fullName: null, description: 'Velitel hlídky.' },
          { type: 'character.notes.append' as const, characterId: saved.view.character.id, notes: 'Povýšen po obraně brány.' },
          { type: 'character.ability.set' as const, characterId: saved.view.character.id, abilityId: 'strength' as const, baseScore: 18, permanentModifier: 0, overrideScore: null },
        ],
        expectedRevisions: [{ entityId: saved.view.character.id, revision: saved.view.revision }],
        sourceRunId: null,
        sourceMessageId: null,
      };
      const applied = database.dataChanges.apply(transaction);
      expect(applied.alreadyApplied).toBe(false);
      expect(database.dataChanges.apply(transaction).alreadyApplied).toBe(true);
      expect(database.characterEditor.get(saved.view.character.id)).toMatchObject({
        character: { name: 'Borin Železný' },
        biography: { notes: 'Drží hlídku.\n\nPovýšen po obraně brány.' },
      });
      expect(database.domain.listEvents(campaign.id)).toHaveLength(0);

      expect(() => database.dataChanges.apply({
        ...transaction,
        id: createDomainId('change'),
        summary: 'Stará revize',
      })).toThrow(/mezitím změněna/);

      const otherCampaign = database.domain.createCampaign({ name: 'Jinde', rulesetId: 'dnd5e', rulesetVersion: '2014' });
      const other = database.domain.createCharacter({
        campaignId: otherCampaign.id, name: 'Cizinec', characterType: 'PC', currentLifeStateId: LifeStateIds.alive,
      });
      const beforeName = database.domain.getCharacter(saved.view.character.id)!.name;
      expect(() => database.dataChanges.apply({
        id: createDomainId('change'), campaignId: campaign.id, origin: 'manual', summary: 'Neplatná dávka',
        changes: [
          { type: 'character.identity.set', characterId: saved.view.character.id, name: 'Nemá zůstat', fullName: null, description: '' },
          { type: 'character.identity.set', characterId: other.id, name: 'Cizí', fullName: null, description: '' },
        ], expectedRevisions: [], sourceRunId: null, sourceMessageId: null,
      })).toThrow(/jiné kampani/);
      expect(database.domain.getCharacter(saved.view.character.id)!.name).toBe(beforeName);
    } finally {
      database.close();
    }
  });

  it('offers explicit Homebrew reconciliation and keeps AI data proposals non-mutating until approval', async () => {
    const opened = await openDatabase();
    const database = opened.database;
    try {
      const campaign = database.domain.createCampaign({ name: 'Ravenford', rulesetId: 'dnd5e', rulesetVersion: '2024' });
      const character = database.domain.createCharacter({
        campaignId: campaign.id, name: 'Arqos', characterType: 'PC', currentLifeStateId: LifeStateIds.alive,
      });
      const legacyDwarf = database.characters.createDefinition({
        campaignId: null,
        definitionType: 'Species', rulesetId: 'dnd5e', rulesetVersion: '2024',
        name: 'Trpaslík', description: '', source: 'Campaign bootstrap', origin: 'user',
        metadata: { bootstrap: true }, homebrew: true,
      });
      database.characters.setOrigin(character.id, { speciesId: legacyDwarf.id, lineageId: null, backgroundId: null });
      const suggestion = database.rulesCatalog.reconciliationSuggestions(campaign.id, character.id)[0]!;
      expect(suggestion).toMatchObject({
        category: 'species',
        oldDefinition: { id: legacyDwarf.id },
        suggestedDefinition: { id: 'def_dnd5e_2024_species_dwarf' },
      });
      const ipc = new ChronicleIpcService(database);
      ipc.applyRuleReconciliation(suggestion);
      expect(database.characters.getOrigin(character.id)?.speciesId).toBe('def_dnd5e_2024_species_dwarf');
      expect(database.rulesCatalog.reconciliationSuggestions(campaign.id, character.id)).toHaveLength(0);
      ipc.updateHomebrewDefinition({
        campaignId: campaign.id,
        definitionId: legacyDwarf.id,
        name: 'Trpaslík z hor',
        description: 'Uživatelská varianta pro Ravenford.',
        aliases: ['Horský trpaslík'],
      });
      expect(database.characters.getDefinition(legacyDwarf.id)).toMatchObject({
        name: 'Trpaslík z hor',
        description: 'Uživatelská varianta pro Ravenford.',
        aliases: ['Horský trpaslík'],
        homebrew: true,
      });
      expect(() => ipc.updateHomebrewDefinition({
        campaignId: campaign.id,
        definitionId: 'def_dnd5e_2024_species_dwarf',
        name: 'Přepsaný Dwarf',
        description: '',
        aliases: [],
      })).toThrow(/Vestavěnou definici nelze upravit/);

      const conversation = database.engine.createConversation(campaign.id, 'Profil');
      const userMessage = database.engine.addConversationMessage({
        campaignId: campaign.id, conversationId: conversation.id, role: 'user', content: 'Přejmenuj Arqose na Arqos Šedý.',
      });
      const runId = createDomainId('ai');
      database.aiRuns.start({
        id: runId, campaignId: campaign.id, conversationId: conversation.id,
        userMessageId: userMessage.id, provider: 'fake', modelId: 'fake', promptVersion: 'm8-test',
      });
      const revision = database.characterEditor.get(character.id)!.revision;
      const candidate = database.aiDataChangeProposals.buildAndValidate({
        campaignId: campaign.id, conversationId: conversation.id, sourceMessageId: userMessage.id, runId,
        proposal: {
          summary: 'Přejmenování Arqose',
          changes: [{ type: 'character.identity.set', characterId: character.id, name: 'Arqos Šedý', fullName: null, description: '' }],
          expectedRevisions: [{ entityId: character.id, revision }],
        },
      });
      expect(candidate.validation.valid).toBe(true);
      expect(database.domain.getCharacter(character.id)!.name).toBe('Arqos');
      const proposal = database.aiDataChangeProposals.save({
        runId, campaignId: campaign.id, conversationId: conversation.id,
        transaction: candidate.transaction, validation: candidate.validation, status: 'pending',
      });
      expect(database.domain.getCharacter(character.id)!.name).toBe('Arqos');
      expect(database.aiDataChangeProposals.apply(proposal.id).result.alreadyApplied).toBe(false);
      expect(database.domain.getCharacter(character.id)!.name).toBe('Arqos Šedý');
      expect(database.domain.listEvents(campaign.id)).toHaveLength(0);
      expect(database.dataChanges.listAudit(campaign.id).map((item) => item.origin)).toContain('ai');
    } finally {
      database.close();
    }
  });
});

function definition(database: ChronicleDatabase, campaignId: string, type: string, query: string) {
  const campaign = database.domain.getCampaign(campaignId)!;
  const result = database.rulesCatalog.search({
    campaignId, rulesetId: campaign.rulesetId, rulesetVersion: campaign.rulesetVersion,
    definitionTypes: [type], query, includeBuiltIn: true, includeHomebrew: false,
  }).items[0];
  if (!result) throw new Error(`Chybí fixture definice ${type}:${query}`);
  return result;
}

function emptyBiography() {
  return {
    age: null, birthDate: null, sexId: null, genderId: null, sexualOrientationId: null,
    alignment: null, faithDefinitionId: null, appearance: null, biography: null,
    height: null, weight: null, eyes: null, hair: null, skin: null,
    personalityTraits: null, ideals: null, bonds: null, flaws: null, notes: null,
  };
}

async function openDatabase(): Promise<{ directory: string; database: ChronicleDatabase }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chronicle-m8-editable-'));
  temporaryDirectories.push(directory);
  return { directory, database: await ChronicleDatabase.open(directory) };
}
