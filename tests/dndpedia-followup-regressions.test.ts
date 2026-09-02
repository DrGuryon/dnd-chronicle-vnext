import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChronicleDatabase } from '../src/main/database';
import { ChronicleIpcService } from '../src/main/ipc/chronicle-ipc-service';
import { bundledRulesPacks } from '../src/main/rules/pack-service';
import { DndpediaController } from '../src/renderer/dndpedia-controller';
import { setApplicationLocale, t } from '../src/renderer/i18n';

const temporaryDirectories: string[] = [];

interface LanguagePreferencesApi {
  getLanguagePreferences(): {
    applicationLocale: string;
    encyclopediaLocales: string[];
    supportedLocales: string[];
  };
  saveLanguagePreferences(value: unknown): {
    applicationLocale: string;
    encyclopediaLocales: string[];
    supportedLocales: string[];
  };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('D&Dpedie follow-up data regressions', () => {
  it('generates complete sentence teasers instead of truncating full detail text', () => {
    for (const pack of bundledRulesPacks()) {
      for (const definition of pack.payload.definitions) {
        for (const document of [definition, ...(definition.localizations ?? [])]) {
          const label = `${definition.canonicalId} (${document.locale})`;
          const teaser = document.shortDescription.trim();
          expect(teaser, label).toMatch(/[.!?]$/);
          expect(teaser, label).not.toMatch(/\.{3}$|\b\p{L}{1,3}$/u);
          expect(document.fullDescription.replace(/\s+/g, ' ').trim(), label).toMatch(teaser);
        }
      }
    }

    for (const pack of bundledRulesPacks()) {
      const fireball = pack.payload.definitions.find((definition) => definition.canonicalId.endsWith(':Spell:fireball'))!;
      for (const document of [fireball, ...(fireball.localizations ?? [])]) {
        expect(document.shortDescription, `${fireball.canonicalId} (${document.locale})`)
          .not.toBe(document.fullDescription.replace(/\s+/g, ' ').trim());
        expect(document.shortDescription.length, `${fireball.canonicalId} (${document.locale})`)
          .toBeLessThan(document.fullDescription.replace(/\s+/g, ' ').trim().length);
      }
    }
  });

  it('loads non-empty, sourced, structured detail for every built-in catalog record', async () => {
    const { database } = await openDatabase();
    try {
      const firstPage = database.dndpedia.search({ page: 1, pageSize: 100 });
      const pages = await Promise.all(Array.from({ length: firstPage.totalPages - 1 }, (_, index) => (
        Promise.resolve(database.dndpedia.search({ page: index + 2, pageSize: 100 }))
      )));
      const catalog = [firstPage, ...pages].flatMap((page) => page.items);
      expect(catalog).toHaveLength(firstPage.totalItems);
      expect(catalog).toHaveLength(215);
      expect(new Set(catalog.map((item) => item.canonicalId)).size).toBe(catalog.length);
      expect(catalog.filter((item) => item.completeness !== 'full').map((item) => item.canonicalId)).toEqual([]);
      const spellSlugs = [
        'bless', 'cure-wounds', 'fireball', 'guidance', 'healing-word',
        'light', 'mage-hand', 'magic-missile', 'shield',
      ];
      expect(catalog.filter((item) => item.definitionType === 'Spell').map((item) => item.canonicalId))
        .toEqual(expect.arrayContaining(['2014', '2024'].flatMap((version) => (
          spellSlugs.map((slug) => `dnd5e:${version}:Spell:${slug}`)
        ))));

      for (const { canonicalId } of catalog) {
        const localizedDetails = new Map<string, ReturnType<typeof database.dndpedia.get>>();
        for (const locale of ['en', 'cs'] as const) {
          const detail = database.dndpedia.get(canonicalId, locale);
          localizedDetails.set(locale, detail);
          expect(detail, `${canonicalId} (${locale})`).toMatchObject({
            canonicalId,
            completeness: 'full',
            requestedLocale: locale,
            locale,
            availableLocales: expect.arrayContaining(['cs', 'en']),
            usedFallback: false,
            source: {
              locale,
              license: 'CC BY 4.0',
              attribution: expect.stringContaining('System Reference Document'),
              sourceUrl: expect.stringMatching(/^https:\/\//),
              sourceReference: expect.any(String),
            },
          });
          expect(detail.name.trim().length, `${canonicalId} (${locale})`).toBeGreaterThan(1);
          expect(detail.shortDescription.trim().length, `${canonicalId} (${locale})`).toBeGreaterThan(20);
          expect(detail.fullDescription.trim().length, `${canonicalId} (${locale})`).toBeGreaterThan(40);
          expect(detail.content.facts.length, `${canonicalId} (${locale})`).toBeGreaterThan(0);
          expect(detail.content.facts.every((fact) => (
            fact.key.trim() && fact.label.trim() && fact.value.trim()
          )), `${canonicalId} (${locale})`).toBe(true);
          expect(detail.source.sourceReference?.trim().length, `${canonicalId} (${locale})`).toBeGreaterThan(2);
          if (locale === 'cs') {
            expect(detail.source.adaptationAttribution?.trim().length, canonicalId).toBeGreaterThan(10);
          } else {
            expect(detail.source.adaptationAttribution, canonicalId).toBeNull();
          }
        }

        const english = localizedDetails.get('en')!;
        const czech = localizedDetails.get('cs')!;
        expect(czech.fullDescription, canonicalId).not.toMatch(/česká adaptace otevřeného hesla typu/i);
        expect(czech.fullDescription, canonicalId).not.toMatch(/úplné původní anglické znění zůstává dostupné/i);
        expect(czech.fullDescription, canonicalId).not.toBe(english.fullDescription);
        expect(czech.content.facts.map((fact) => fact.key).sort(), canonicalId)
          .toEqual(english.content.facts.map((fact) => fact.key).sort());
        const czechFacts = factValues(czech.content.facts);
        for (const englishFact of english.content.facts) {
          if (englishFact.value === 'Yes') expect(czechFacts[englishFact.key], canonicalId).toBe('Ano');
          if (englishFact.value === 'No') expect(czechFacts[englishFact.key], canonicalId).toBe('Ne');
        }
        if (english.content.sections.length) {
          expect(czech.content.sections, canonicalId).toHaveLength(english.content.sections.length);
          for (const [index, englishSection] of english.content.sections.entries()) {
            const czechSection = czech.content.sections[index]!;
            expect(czechSection.id, canonicalId).toBe(englishSection.id);
            expect(czechSection.title.trim(), canonicalId).not.toBe(englishSection.title.trim());
            expect(czechSection.title, canonicalId).not.toMatch(/^(description|details?|effect|features?|rules?)$/i);
            expect(czechSection.paragraphs, canonicalId).not.toEqual(englishSection.paragraphs);
          }
        }
      }
    } finally {
      database.close();
    }
  });

  it('does not invent definitions in ruleset versions whose official SRD does not contain them', async () => {
    const { database } = await openDatabase();
    try {
      const invalidCanonicalIds = [
        'dnd5e:2024:Lineage:hill-dwarf',
        'dnd5e:2024:Lineage:high-elf',
        'dnd5e:2024:Lineage:lightfoot-halfling',
        'dnd5e:2024:Species:half-elf',
        'dnd5e:2024:Species:half-orc',
        'dnd5e:2024:Equipment:hempen-rope',
        'dnd5e:2024:Feat:tough',
        'dnd5e:2014:Background:criminal',
        'dnd5e:2014:Background:sage',
        'dnd5e:2014:Background:soldier',
        'dnd5e:2014:Feat:skilled',
        'dnd5e:2014:Feat:tough',
      ];
      for (const canonicalId of invalidCanonicalIds) {
        expect(() => database.dndpedia.get(canonicalId, 'en'), canonicalId).toThrow(/není v aktivní D&Dpedii/);
        expect(database.dndpedia.search({ query: canonicalId, pageSize: 20 }).items, canonicalId).toEqual([]);
      }
    } finally {
      database.close();
    }
  });

  it('does not offer retired built-ins after upgrading an existing 2.0 catalog, while preserving old IDs', async () => {
    const opened = await openDatabase();
    const legacy = JSON.parse(await readFile(
      'rules-packs/dnd5e-srd-5.2.1/2.0.0/pack.json', 'utf8',
    ));
    await opened.database.rulesPacks.install(legacy);
    try {
      const legacyOffered = opened.database.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', includeBuiltIn: true,
        includeHomebrew: false, limit: 200,
      });
      expect(legacyOffered.items.map((item) => item.id)).toContain('def_dnd5e_2024_lineage_hill_dwarf');

      await opened.database.rulesPacks.updateBundled('dnd5e-srd-5.2.1');
      expect(opened.database.rulesPacks.list().find((pack) => pack.active && pack.packId === 'dnd5e-srd-5.2.1'))
        .toMatchObject({ version: '3.0.0' });
      const offered = opened.database.rulesCatalog.search({
        rulesetId: 'dnd5e', rulesetVersion: '2024', includeBuiltIn: true,
        includeHomebrew: false, limit: 200,
      });
      expect(offered.total).toBe(107);
      expect(offered.items.map((item) => item.id)).not.toContain('def_dnd5e_2024_lineage_hill_dwarf');
      expect(offered.items.map((item) => item.id)).not.toContain('def_dnd5e_2024_feat_tough');
      expect(offered.items.map((item) => item.id)).toContain('def_dnd5e_2024_species_dwarf');
      expect(() => opened.database.dndpedia.get('dnd5e:2024:Lineage:hill-dwarf', 'en')).toThrow();
      // Direct lookup remains available so a historical character reference is not broken.
      expect(opened.database.rulesCatalog.get('def_dnd5e_2024_lineage_hill_dwarf')).toBeDefined();
    } finally {
      opened.database.close();
    }
  });

  it('keeps the key rules values of all nine catalog spells in both English and Czech', async () => {
    const { database } = await openDatabase();
    try {
      const spells = [
        { slug: 'bless', level: 1, school2014: 'Enchantment', school2024: 'Enchantment', schoolCs: 'Očarování', casting: 'action', range: '30 feet', duration: 'concentrationMinute', components: ['V', 'S', 'M'], rule: /(?:1)?d4\b/i },
        { slug: 'cure-wounds', level: 1, school2014: 'Evocation', school2024: 'Abjuration', schoolCs2014: 'Zaklínání', schoolCs2024: 'Ochranná magie', casting: 'action', range: 'Touch', duration: 'instant', components: ['V', 'S'], rule2014: /1d8/i, rule2024: /2d8/i },
        { slug: 'fireball', level: 3, school2014: 'Evocation', school2024: 'Evocation', schoolCs: 'Zaklínání', casting: 'action', range: '150 feet', duration: 'instant', components: ['V', 'S', 'M'], savingThrow: /DEX|Dexterity/i, effect: /8d6.*Fire/i, effectCs: /8d6.*Ohn/i, rule: /8d6/i },
        { slug: 'guidance', level: 0, school2014: 'Divination', school2024: 'Divination', schoolCs: 'Věštění', casting: 'action', range: 'Touch', duration: 'concentrationMinute', components: ['V', 'S'], rule: /1d4/i },
        { slug: 'healing-word', level: 1, school2014: 'Evocation', school2024: 'Abjuration', schoolCs2014: 'Zaklínání', schoolCs2024: 'Ochranná magie', casting: 'bonusAction', range: '60 feet', duration: 'instant', components: ['V'], rule2014: /1d4/i, rule2024: /2d4/i },
        { slug: 'light', level: 0, school2014: 'Evocation', school2024: 'Evocation', schoolCs: 'Zaklínání', casting: 'action', range: 'Touch', duration: 'hour', components: ['V', 'M'], rule: /20\s*(?:feet|stop)/i },
        { slug: 'mage-hand', level: 0, school2014: 'Conjuration', school2024: 'Conjuration', schoolCs: 'Vyvolávání', casting: 'action', range: '30 feet', duration: 'minute', components: ['V', 'S'], rule: /30\s*(?:feet|stop)/i },
        { slug: 'magic-missile', level: 1, school2014: 'Evocation', school2024: 'Evocation', schoolCs: 'Zaklínání', casting: 'action', range: '120 feet', duration: 'instant', components: ['V', 'S'], rule: /1d4\s*\+\s*1/i },
        { slug: 'shield', level: 1, school2014: 'Abjuration', school2024: 'Abjuration', schoolCs: 'Ochranná magie', casting: 'reaction', range: 'Self', duration: 'round', components: ['V', 'S'], rule: /\+5/i },
      ] as const;

      for (const spell of spells) {
        for (const version of ['2014', '2024'] as const) {
          const canonicalId = `dnd5e:${version}:Spell:${spell.slug}`;
          const english = database.dndpedia.get(canonicalId, 'en');
          const czech = database.dndpedia.get(canonicalId, 'cs');
          const englishFacts = factValues(english.content.facts);
          const czechFacts = factValues(czech.content.facts);
          const expectedSchool = version === '2014' ? spell.school2014 : spell.school2024;
          const expectedCzechSchool = version === '2014'
            ? ('schoolCs2014' in spell ? spell.schoolCs2014 : spell.schoolCs)
            : ('schoolCs2024' in spell ? spell.schoolCs2024 : spell.schoolCs);
          const expectedRule = version === '2014'
            ? ('rule2014' in spell ? spell.rule2014 : spell.rule)
            : ('rule2024' in spell ? spell.rule2024 : spell.rule);

          expect(english.content, canonicalId).toMatchObject({ kind: 'spell', level: spell.level, school: expectedSchool });
          expect(czech.content, canonicalId).toMatchObject({ kind: 'spell', level: spell.level, school: expectedCzechSchool });
          expect(englishFacts.level, canonicalId).toBe(String(spell.level));
          expect(czechFacts.level, canonicalId).toBe(String(spell.level));
          expect(englishFacts.school, canonicalId).toBe(expectedSchool);
          expect(czechFacts.school, canonicalId).toBe(expectedCzechSchool);
          expect(englishFacts.castingTime, canonicalId).toMatch(englishCasting(spell.casting));
          expect(czechFacts.castingTime, canonicalId).toMatch(czechCasting(spell.casting));
          expect(englishFacts.range, canonicalId).toMatch(englishRange(spell.range));
          expect(czechFacts.range, canonicalId).toMatch(czechRange(spell.range));
          expect(englishFacts.duration, canonicalId).toMatch(englishDuration(spell.duration));
          expect(czechFacts.duration, canonicalId).toMatch(czechDuration(spell.duration));
          expect(englishFacts.concentration, canonicalId).toBe(spell.duration === 'concentrationMinute' ? 'Yes' : 'No');
          expect(czechFacts.concentration, canonicalId).toBe(spell.duration === 'concentrationMinute' ? 'Ano' : 'Ne');
          for (const component of spell.components) {
            expect(englishFacts.components, canonicalId).toMatch(new RegExp(`\\b${component}\\b`));
            expect(czechFacts.components, canonicalId).toMatch(new RegExp(`\\b${component}\\b`));
          }
          expect(`${english.fullDescription} ${Object.values(englishFacts).join(' ')}`, canonicalId).toMatch(expectedRule);
          expect(`${czech.fullDescription} ${Object.values(czechFacts).join(' ')}`, canonicalId).toMatch(czechRule(expectedRule));
          if ('savingThrow' in spell) {
            expect(englishFacts.savingThrow, canonicalId).toMatch(spell.savingThrow);
            expect(czechFacts.savingThrow, canonicalId).toMatch(/Obratnost|DEX/i);
          }
          if ('effect' in spell) {
            expect(englishFacts.damageOrHealing, canonicalId).toMatch(spell.effect);
            expect(czechFacts.damageOrHealing, canonicalId).toMatch(czechRule(spell.effectCs));
          }
        }
      }
    } finally {
      database.close();
    }
  });

  it('refreshes an active source through IPC and keeps the active catalog intact after a remote error', async () => {
    const { database } = await openDatabase();
    try {
      const ipc = new ChronicleIpcService(database);
      const pack = bundledRulesPacks().find((candidate) => candidate.manifest.packId === 'dnd5e-srd-5.2.1')!;
      const before = database.rulesPacks.list().find((candidate) => candidate.packId === pack.manifest.packId)!;
      const fetchMock = vi.fn(async () => new Response(JSON.stringify(pack), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await ipc.updateRulesPacks(pack.manifest.packId);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual([expect.objectContaining({ changed: false, rolledBack: false })]);
      expect(database.rulesPacks.list().find((candidate) => candidate.active && candidate.packId === pack.manifest.packId))
        .toMatchObject({ version: before.version, contentHash: before.contentHash });

      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
      await expect(ipc.updateRulesPacks(pack.manifest.packId)).rejects.toThrow(/nepodařilo ověřit/);
      expect(database.rulesPacks.list().find((candidate) => candidate.active && candidate.packId === pack.manifest.packId))
        .toMatchObject({ version: before.version, contentHash: before.contentHash });
      expect(database.dndpedia.get('dnd5e:2024:Spell:fireball')).toMatchObject({ completeness: 'full' });
    } finally {
      database.close();
    }
  });

  it('ignores a valid remote pack that would downgrade the active bundled source', async () => {
    const { database } = await openDatabase();
    try {
      const ipc = new ChronicleIpcService(database);
      const packId = 'dnd5e-srd-5.2.1';
      const before = database.rulesPacks.list().find((candidate) => candidate.active && candidate.packId === packId)!;
      expect(before.version).toBe('3.0.0');
      const downgrade = JSON.parse(await readFile(
        'rules-packs/dnd5e-srd-5.2.1/2.0.0/pack.json', 'utf8',
      ));
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(downgrade), { status: 200 })));

      const result = await ipc.updateRulesPacks(packId);
      expect(result).toEqual([expect.objectContaining({
        changed: false,
        rolledBack: false,
        status: expect.objectContaining({ packId, version: before.version, contentHash: before.contentHash }),
      })]);
      expect(database.rulesPacks.list().find((candidate) => candidate.active && candidate.packId === packId))
        .toMatchObject({ version: before.version, contentHash: before.contentHash });
    } finally {
      database.close();
    }
  });

  it('removes a stale localization when an updated pack no longer contains that locale', async () => {
    const { database } = await openDatabase();
    try {
      const canonicalId = 'dnd5e:2024:Spell:magic-missile';
      expect(database.dndpedia.get(canonicalId)).toMatchObject({ locale: 'cs', usedFallback: false });
      const next = structuredClone(bundledRulesPacks()
        .find((candidate) => candidate.manifest.packId === 'dnd5e-srd-5.2.1')!);
      next.manifest.version = '3.0.1';
      for (const definition of next.payload.definitions) definition.packVersion = next.manifest.version;
      const definition = next.payload.definitions.find((candidate) => candidate.canonicalId === canonicalId)!;
      expect(definition.localizations?.some((localization) => localization.locale === 'cs')).toBe(true);
      definition.localizations = definition.localizations?.filter((localization) => localization.locale !== 'cs');
      next.manifest.contentHash = testHash(next.payload);

      await database.rulesPacks.install(next);
      expect(database.dndpedia.get(canonicalId)).toMatchObject({
        requestedLocale: 'cs', locale: 'en', availableLocales: ['en'], usedFallback: true,
      });
    } finally {
      database.close();
    }
  });

  it('defaults language preferences to Czech plus English and persists a normalized user choice', async () => {
    const opened = await openDatabase();
    let database = opened.database;
    try {
      let ipc = languageIpc(database);
      expect(ipc.getLanguagePreferences()).toMatchObject({
        applicationLocale: 'cs',
        encyclopediaLocales: ['cs', 'en'],
        supportedLocales: expect.arrayContaining(['cs', 'en']),
      });

      expect(ipc.saveLanguagePreferences({
        applicationLocale: 'en',
        encyclopediaLocales: ['en', 'cs', 'en'],
      })).toMatchObject({ applicationLocale: 'en', encyclopediaLocales: ['en', 'cs'] });

      database.close();
      database = await ChronicleDatabase.open(opened.directory);
      ipc = languageIpc(database);
      expect(ipc.getLanguagePreferences()).toMatchObject({
        applicationLocale: 'en',
        encyclopediaLocales: ['en', 'cs'],
      });
    } finally {
      database.close();
    }
  });

  it('returns real Czech card content and keeps explicit English original as a per-card override', async () => {
    const { database } = await openDatabase();
    try {
      const ipc = new ChronicleIpcService(database);
      const representatives = [
        ['dnd5e:2024:Spell:bless', 'Požehnání'],
        ['dnd5e:2014:Spell:fireball', 'Ohnivá koule'],
        ['dnd5e:2024:Class:fighter', 'Bojovník'],
      ] as const;
      for (const [canonicalId, expectedCzechName] of representatives) {
        const czech = ipc.getDndpediaEntry({ id: canonicalId });
        const english = ipc.getDndpediaEntry({ id: canonicalId, locale: 'en' });
        expect(czech, canonicalId).toMatchObject({
          canonicalId,
          requestedLocale: 'cs',
          locale: 'cs',
          availableLocales: expect.arrayContaining(['cs', 'en']),
          usedFallback: false,
          completeness: 'full',
          name: expectedCzechName,
        });
        expect(english, canonicalId).toMatchObject({
          canonicalId,
          requestedLocale: 'en',
          locale: 'en',
          availableLocales: expect.arrayContaining(['cs', 'en']),
          usedFallback: false,
          completeness: 'full',
        });
        expect(czech.name, canonicalId).not.toBe(english.name);
        expect(czech.shortDescription.trim().length, canonicalId).toBeGreaterThan(20);
        expect(czech.shortDescription, canonicalId).not.toBe(english.shortDescription);
        expect(czech.fullDescription.trim().length, canonicalId).toBeGreaterThan(40);
        expect(czech.fullDescription, canonicalId).not.toBe(english.fullDescription);
      }

      const localizedList = database.dndpedia.search({
        query: 'Bojovník', definitionType: 'Class', rulesetVersion: '2024', pageSize: 20,
      });
      expect(localizedList.items).toEqual([expect.objectContaining({
        canonicalId: 'dnd5e:2024:Class:fighter',
        name: 'Bojovník',
        locale: 'cs',
        completeness: 'full',
      })]);
      expect(localizedList.items[0]!.shortDescription.trim().length).toBeGreaterThan(20);
      expect(localizedList.items[0]!.shortDescription).not.toMatch(/^A Fighter\b/i);
      expect(new ChronicleIpcService(database).getDndpediaEntry({
        id: 'dnd5e:2024:Class:fighter', locale: 'cs',
      }).relatedDefinitions.map((definition) => definition.name)).toContain('Šampion');

      const czechClassNames = database.dndpedia.search({
        definitionType: 'Class', rulesetVersion: '2024', sort: 'name-asc', pageSize: 100,
      }).items.map((item) => item.name);
      expect(czechClassNames).toEqual([...czechClassNames].sort((left, right) => left.localeCompare(right, 'cs')));

      // Czech treats "ch" as a letter after H, while English sorts it before H.
      // This makes the assertion prove that encyclopedia language, not app chrome
      // language, controls ordering of the localized names shown in the catalog.
      const raw = new DatabaseSync(database.path);
      const classDocuments = raw.prepare(`
        SELECT definition.id
        FROM rule_definitions definition
        WHERE definition.ruleset_version = '2024' AND definition.definition_type = 'Class'
        ORDER BY definition.canonical_id
      `).all() as Array<{ id: string }>;
      const rename = raw.prepare(`
        UPDATE rule_definition_documents SET localized_name = ?
        WHERE definition_id = ? AND locale = 'cs'
      `);
      classDocuments.forEach((definition, index) => {
        const name = index === 0 ? 'Hroch' : index === 1 ? 'Chata' : `Žzz ${index}`;
        rename.run(name, definition.id);
      });
      raw.close();
      database.languagePreferences.save({ applicationLocale: 'en', encyclopediaLocales: ['cs', 'en'] });
      const separatelyConfigured = database.dndpedia.search({
        definitionType: 'Class', rulesetVersion: '2024', sort: 'name-asc', pageSize: 100,
      });
      expect(separatelyConfigured.items.slice(0, 2).map((item) => item.name)).toEqual(['Hroch', 'Chata']);
      expect(separatelyConfigured.items.every((item) => item.locale === 'cs')).toBe(true);
      expect(separatelyConfigured.items.every((item) => item.definitionTypeDisplayName === 'Class')).toBe(true);
    } finally {
      database.close();
    }
  });

  it('does not leave representative Czech mechanics half translated', async () => {
    const { database } = await openDatabase();
    try {
      const ids = [
        'dnd5e:2024:Species:tiefling',
        'dnd5e:2024:Class:fighter',
        'dnd5e:2024:Condition:prone',
        'dnd5e:2024:Weapon:longsword',
        'dnd5e:2024:Armor:chain-mail',
        'dnd5e:2024:Tool:thieves-tools',
        'dnd5e:2014:Equipment:hempen-rope',
      ];
      const details = new Map(ids.map((id) => [id, database.dndpedia.get(id, 'cs')]));
      const untranslatedMechanics = /\b(?:Small or Medium|Darkvision|Fiendish Legacy|Otherworldly Presence|Martial Melee Weapons|Martial Weapons|Melee Weapons|Simple Weapons|Heavy Armor|Other Tools|Saving Throw|Advantage|Disadvantage|Action|Bonus Action|Reaction|Touch|Self|Instantaneous|feet|versatile|or)\b/i;
      for (const [id, detail] of details) {
        const text = [
          detail.fullDescription,
          ...detail.content.facts.map((fact) => `${fact.label}: ${fact.value}`),
          ...detail.content.sections.flatMap((section) => [section.title, ...section.paragraphs]),
        ].join(' ');
        expect(text, id).not.toMatch(untranslatedMechanics);
      }

      const tiefling = factValues(details.get('dnd5e:2024:Species:tiefling')!.content.facts);
      expect(tiefling.size).toMatch(/malý.*nebo.*střední/i);
      expect(details.get('dnd5e:2024:Species:tiefling')!.fullDescription).toMatch(/vidění.*tm|temnovid/i);
      const fighter = factValues(details.get('dnd5e:2024:Class:fighter')!.content.facts);
      expect(fighter.primaryAbilities).toMatch(/síla.*nebo.*obratnost/i);
      const prone = factValues(details.get('dnd5e:2024:Condition:prone')!.content.facts);
      expect(prone.effect).toMatch(/nevýhod.*výhod/i);
      const longsword = factValues(details.get('dnd5e:2024:Weapon:longsword')!.content.facts);
      expect(longsword.category).toMatch(/válečné.*na blízko/i);
      expect(longsword.damageType).toMatch(/sečné/i);
      expect(longsword.properties).toMatch(/obouruční/i);
      const chainMail = factValues(details.get('dnd5e:2024:Armor:chain-mail')!.content.facts);
      expect(chainMail.category).toMatch(/zbroj/i);
      const thievesTools = factValues(details.get('dnd5e:2024:Tool:thieves-tools')!.content.facts);
      expect(thievesTools.category).toMatch(/nástroje|náčiní/i);
      expect(details.get('dnd5e:2014:Equipment:hempen-rope')!.fullDescription).toMatch(/lano/i);
    } finally {
      database.close();
    }
  });

  it('falls back clearly to English if the preferred Czech document is unavailable', async () => {
    const { database } = await openDatabase();
    try {
      const canonicalId = 'dnd5e:2024:Spell:magic-missile';
      const raw = new DatabaseSync(database.path);
      raw.prepare(`DELETE FROM rule_definition_documents
        WHERE definition_id = (SELECT id FROM rule_definitions WHERE canonical_id = ?) AND locale = 'cs'`)
        .run(canonicalId);
      raw.close();

      expect(new ChronicleIpcService(database).getDndpediaEntry({ id: canonicalId })).toMatchObject({
        canonicalId,
        requestedLocale: 'cs',
        locale: 'en',
        availableLocales: ['en'],
        usedFallback: true,
        completeness: 'full',
      });
    } finally {
      database.close();
    }
  });
});

describe('D&Dpedie follow-up renderer contract', () => {
  it('switches shared application chrome, settings, and D&Dpedie labels between Czech and English', () => {
    vi.stubGlobal('document', { documentElement: { lang: 'cs' } });
    expect(setApplicationLocale('en')).toBe('en');
    expect(t('nav.campaigns')).toBe('Campaigns');
    expect(t('settings.applicationLanguage')).toBe('Application language');
    expect(t('dndpedia.search')).toBe('Search');
    expect(document.documentElement.lang).toBe('en');

    expect(setApplicationLocale('cs')).toBe('cs');
    expect(t('nav.campaigns')).toBe('Kampaně');
    expect(t('settings.applicationLanguage')).toBe('Jazyk aplikace');
    expect(t('dndpedia.search')).toBe('Hledat');
    expect(document.documentElement.lang).toBe('cs');
  });

  it('keeps the same focused search input after "Boj", a debounce pause, and continued typing', async () => {
    vi.useFakeTimers();
    const input = {
      value: 'Boj',
      closest: (selector: string) => selector === '[data-dndpedia-control="query"]' ? input : null,
    };
    const harness = dndpediaRootHarness(input);
    vi.stubGlobal('document', { activeElement: input, documentElement: { lang: 'cs' } });
    setApplicationLocale('cs');
    const searches = vi.fn(async (request: { query?: string | null }) => emptySearchResult(request.query));
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      chronicle: {
        searchDndpedia: searches,
        getLanguagePreferences: async () => ({
          applicationLocale: 'cs', encyclopediaLocales: ['cs', 'en'], supportedLocales: ['cs', 'en'],
        }),
      },
    });
    const dialog = { addEventListener: () => undefined };
    const controller = new DndpediaController(
      harness.root as unknown as HTMLElement,
      dialog as unknown as HTMLDialogElement,
      { openRulesPackSettings: () => undefined, notify: () => undefined },
    ) as unknown as { renderedLocale: string; onInput(event: Event): void };
    controller.renderedLocale = 'cs';

    controller.onInput({ target: input } as unknown as Event);
    await vi.advanceTimersByTimeAsync(251);
    expect(searches).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Boj' }));
    expect(document.activeElement).toBe(input);
    expect(harness.shellReplacementCount()).toBe(0);

    input.value = 'Bojovník';
    controller.onInput({ target: input } as unknown as Event);
    await vi.advanceTimersByTimeAsync(251);
    expect(searches).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Bojovník' }));
    expect(document.activeElement).toBe(input);
    expect(harness.shellReplacementCount()).toBe(0);
  });

  it('exposes source refresh progress and language controls without replacing the search control on debounce', async () => {
    const [controller, settings] = await Promise.all([
      readFile('src/renderer/dndpedia-controller.ts', 'utf8'),
      readFile('src/renderer/ai-settings.ts', 'utf8'),
    ]);

    expect(controller).toContain('data-dndpedia-action="refresh-sources"');
    expect(controller).toContain('data-dndpedia-refresh-status');
    expect(controller).toContain('aria-live="polite"');
    expect(controller).toContain('window.chronicle.updateRulesPacks');
    expect(controller).toContain('data-dndpedia-detail-locale');
    expect(controller).toContain('data-dndpedia-locale-fallback');
    expect(controller).toContain('data-dndpedia-results-body');
    expect(controller).toContain('ensureShell()');
    expect(controller).toContain('renderCatalogChrome()');
    expect(controller).toContain('renderResultsRegion()');
    const searchBody = controller.match(
      /private async search\([^)]*\): Promise<void> \{([\s\S]*?)\r?\n  \}\r?\n\r?\n  private /,
    )?.[1] ?? '';
    expect(searchBody).not.toContain('this.render()');
    expect(searchBody).toContain('this.renderResultsRegion()');

    expect(settings).toContain('data-language-settings-form');
    expect(settings).toContain('name="applicationLocale"');
    expect(settings).toContain('name="encyclopediaLocales"');
    expect(settings).toContain('data-encyclopedia-language-list');
    expect(settings).toContain('preferences.supportedEncyclopediaLocales.map');
    expect(settings).toContain("t('settings.contentUnavailable')");
    expect(settings).toContain("t('settings.addLanguage')");
    expect(settings).toContain('window.chronicle.getLanguagePreferences');
    expect(settings).toContain('window.chronicle.saveLanguagePreferences');
  });

  it('keeps canonical IDs behind the developer-only UI gate', async () => {
    const controller = await readFile('src/renderer/dndpedia-controller.ts', 'utf8');
    expect(controller).toContain('developerMode');
    expect(controller).toContain('data-developer-only');
    expect(controller).not.toContain('<th scope="col">Objekt a canonical ID</th>');
  });
});

async function openDatabase(): Promise<{ directory: string; database: ChronicleDatabase }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-dndpedia-followup-'));
  temporaryDirectories.push(directory);
  return { directory, database: await ChronicleDatabase.open(directory) };
}

function languageIpc(database: ChronicleDatabase): LanguagePreferencesApi {
  return new ChronicleIpcService(database) as unknown as LanguagePreferencesApi;
}

function testHash(value: unknown): string {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(',')}]`;
    if (item && typeof item === 'object') {
      return `{${Object.keys(item as Record<string, unknown>).sort().map((key) => (
        `${JSON.stringify(key)}:${stable((item as Record<string, unknown>)[key])}`
      )).join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}

function factValues(facts: Array<{ key: string; value: string }>): Record<string, string> {
  return Object.fromEntries(facts.map((fact) => [fact.key, fact.value]));
}

function czechRule(expression: RegExp): RegExp {
  return new RegExp(expression.source.replace(/d(?=\d)/g, '[dk]'), expression.flags);
}

function englishCasting(value: string): RegExp {
  if (value === 'bonusAction') return /^(?:1 )?bonus action$/i;
  if (value === 'reaction') return /^(?:1 )?reaction\b/i;
  return /^(?:1 )?action$/i;
}

function czechCasting(value: string): RegExp {
  if (value === 'bonusAction') return /^(?:1 )?bonusová akce$/i;
  if (value === 'reaction') return /^(?:1 )?reakce\b/i;
  return /^(?:1 )?akce$/i;
}

function englishRange(value: string): RegExp {
  if (value === 'Touch') return /^Touch$/i;
  if (value === 'Self') return /^Self$/i;
  return new RegExp(`^${value.replace(' feet', '\\s+feet')}$`, 'i');
}

function czechRange(value: string): RegExp {
  if (value === 'Touch') return /^Dotyk$/i;
  if (value === 'Self') return /^(?:Sesilatel|Vlastní osoba)$/i;
  return new RegExp(`^${value.replace(' feet', '\\s+stop')}$`, 'i');
}

function englishDuration(value: string): RegExp {
  if (value === 'concentrationMinute') return /^(?:Concentration, )?(?:Up to )?1 minute$/i;
  if (value === 'instant') return /^Instantaneous$/i;
  if (value === 'hour') return /^1 hour$/i;
  if (value === 'round') return /^1 round$/i;
  return /^1 minute$/i;
}

function czechDuration(value: string): RegExp {
  if (value === 'concentrationMinute') return /^(?:Soustředění, )?(?:až )?1 minut(?:a|u)$/i;
  if (value === 'instant') return /^Okamžit(?:é|á)$/i;
  if (value === 'hour') return /^1 hodin(?:a|u)$/i;
  if (value === 'round') return /^1 kolo$/i;
  return /^1 minut(?:a|u)$/i;
}

function emptySearchResult(query?: string | null) {
  return {
    items: [], page: 1, pageSize: 25, totalItems: 0, totalPages: 1,
    facets: { definitionTypes: [], rulesets: [], sources: [] },
    activeSourceSummary: { activePackCount: 2, displayNames: ['SRD 5.1', 'SRD 5.2.1'] },
    query,
  };
}

function dndpediaRootHarness(searchInput: { value: string }) {
  let shellReplacements = 0;
  const clear = { hidden: true };
  const reset = { hidden: true };
  const resultRegion = { setAttribute: vi.fn() };
  const resultBody = { innerHTML: '' };
  const textNode = () => ({ textContent: '' });
  const sourceCount = textNode();
  const sourceNames = textNode();
  const resultCount = textNode();
  const refreshLabel = textNode();
  const refreshButton = {
    disabled: false,
    setAttribute: vi.fn(),
    classList: { toggle: vi.fn() },
    querySelector: () => refreshLabel,
  };
  const refreshStatus = { textContent: '', className: '', setAttribute: vi.fn(), removeAttribute: vi.fn() };
  const selects = new Map<string, { dataset: Record<string, string>; innerHTML: string; value: string }>();
  const root = {
    addEventListener: () => undefined,
    get innerHTML() { return ''; },
    set innerHTML(_value: string) { shellReplacements += 1; },
    querySelector(selector: string) {
      if (selector === '[data-dndpedia-shell]') return {};
      if (selector === '[data-dndpedia-control="query"]') return searchInput;
      if (selector === '[data-dndpedia-action="clear-query"]') return clear;
      if (selector === '[data-dndpedia-action="reset"]') return reset;
      if (selector === '[data-dndpedia-results]') return resultRegion;
      if (selector === '[data-dndpedia-results-body]') return resultBody;
      if (selector === '[data-dndpedia-source-count]') return sourceCount;
      if (selector === '[data-dndpedia-source-names]') return sourceNames;
      if (selector === '[data-dndpedia-result-count]') return resultCount;
      if (selector === '[data-dndpedia-action="refresh-sources"]') return refreshButton;
      if (selector === '[data-dndpedia-refresh-status]') return refreshStatus;
      const key = selector.match(/^\[data-dndpedia-control="(.+)"\]$/)?.[1];
      if (!key) return null;
      const select = selects.get(key) ?? { dataset: {}, innerHTML: '', value: '' };
      selects.set(key, select);
      return select;
    },
  };
  return { root, shellReplacementCount: () => shellReplacements };
}
