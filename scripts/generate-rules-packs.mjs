import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogSource = await readFile(path.join(root, 'src/rules/builtin-catalog.ts'), 'utf8');
const match = catalogSource.match(/const commonEntries:[\s\S]*?=\s*(\[[\s\S]*?\])\s*as const;/);
if (!match) throw new Error('Nelze načíst normalizovaný commonEntries katalog.');
// The extracted expression is a repository-owned array literal without executable calls.
const entries = Function(`"use strict"; return (${match[1]});`)();

const versions = [
  {
    rulesetVersion: '2014', packId: 'dnd5e-srd-5.1', version: '1.0.0',
    source: 'D&D 5E SRD 5.1 (CC BY 4.0)',
    sourceUrl: 'https://www.dndbeyond.com/resources/1781-systems-reference-document-srd',
    publishedAt: '2023-01-27T00:00:00.000Z',
  },
  {
    rulesetVersion: '2024', packId: 'dnd5e-srd-5.2.1', version: '1.0.0',
    source: 'D&D 5E SRD 5.2.1 (CC BY 4.0)', sourceUrl: 'https://www.dndbeyond.com/srd',
    publishedAt: '2025-04-22T00:00:00.000Z',
  },
];
const relationPairs = [
  ['Lineage', 'hill-dwarf', 'Species', 'dwarf', 'belongsToSpecies'],
  ['Lineage', 'high-elf', 'Species', 'elf', 'belongsToSpecies'],
  ['Lineage', 'lightfoot-halfling', 'Species', 'halfling', 'belongsToSpecies'],
  ['Subclass', 'champion', 'Class', 'fighter', 'belongsToClass'],
  ['Subclass', 'life-domain', 'Class', 'cleric', 'belongsToClass'],
  ['Subclass', 'school-of-evocation', 'Class', 'wizard', 'belongsToClass'],
  ['Subclass', 'oath-of-devotion', 'Class', 'paladin', 'belongsToClass'],
];

for (const version of versions) {
  const id = (type, slug) => `def_dnd5e_${version.rulesetVersion}_${type.toLocaleLowerCase('en-US')}_${slug.replaceAll('-', '_')}`;
  const payload = {
    definitions: entries.map(([definitionType, slug, name, aliases = []]) => ({
      id: id(definitionType, slug), definitionType, rulesetId: 'dnd5e',
      rulesetVersion: version.rulesetVersion,
      canonicalId: `dnd5e:${version.rulesetVersion}:${definitionType}:${slug}`,
      name, aliases, source: version.source, packId: version.packId,
      packVersion: version.version, locale: 'en',
    })),
    relations: relationPairs.map(([sourceType, sourceSlug, targetType, targetSlug, relationType]) => ({
      sourceDefinitionId: id(sourceType, sourceSlug), targetDefinitionId: id(targetType, targetSlug), relationType,
    })),
  };
  validate(payload);
  const pack = {
    manifest: {
      schemaVersion: 1, packId: version.packId, version: version.version,
      rulesetId: 'dnd5e', rulesetVersion: version.rulesetVersion, displayName: version.source,
      license: 'CC BY 4.0',
      attribution: 'Dungeons & Dragons System Reference Document, Wizards of the Coast LLC.',
      sourceUrl: version.sourceUrl,
      updateUrl: `https://raw.githubusercontent.com/DrGuryon/dnd-chronicle-vnext/main/rules-packs/${version.packId}/latest.json`,
      publishedAt: version.publishedAt, contentHash: hash(payload),
    },
    payload,
  };
  const rendered = `${JSON.stringify(pack, null, 2)}\n`;
  const directory = path.join(root, 'rules-packs', version.packId);
  await mkdir(path.join(directory, version.version), { recursive: true });
  for (const output of [path.join(directory, version.version, 'pack.json'), path.join(directory, 'latest.json')]) {
    if (process.argv.includes('--check')) {
      const current = await readFile(output, 'utf8').catch(() => '');
      if (current !== rendered) throw new Error(`Vygenerovaný rules pack není aktuální: ${path.relative(root, output)}`);
    } else {
      await writeFile(output, rendered, 'utf8');
    }
  }
}

function validate(payload) {
  const ids = new Set(payload.definitions.map((definition) => definition.id));
  if (ids.size !== payload.definitions.length) throw new Error('Duplicitní ID definice.');
  for (const relation of payload.relations) {
    if (!ids.has(relation.sourceDefinitionId) || !ids.has(relation.targetDefinitionId)) throw new Error('Osiřelý vztah definic.');
  }
}

function hash(value) {
  return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
