import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDomainId } from '../src/domain/ids';
import { createHash } from 'node:crypto';
import { LifeStateIds } from '../src/domain/models';
import { AiTurnService } from '../src/main/ai/turn-service';
import { FakeAiProvider } from '../src/main/ai/fake-provider';
import { OpenAiProvider, type OpenAiResponsesClient } from '../src/main/ai/openai-provider';
import { ruleDefinitionSearchToolDescriptor } from '../src/main/ai/tool-schemas';
import { ChronicleDatabase } from '../src/main/database';
import { bundledRulesPacks, validatePack } from '../src/main/rules/pack-service';
import type { AiProviderEvent, ToolUsageSummary } from '../src/shared/ai';
import type { RulesPack } from '../src/shared/rules-packs';
import { seedRavenfordM5 } from './fixtures/ravenford-m5';
import { ToastService } from '../src/renderer/toast-service';
import { AiChatController } from '../src/renderer/ai-chat';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Milestone 9 rules data and diagnostics', () => {
  it('filters dependent definitions and rejects a lineage that belongs to another species', async () => {
    const { database } = await openDatabase();
    try {
      const campaign = database.domain.createCampaign({ name: 'Vztahy', rulesetId: 'dnd5e', rulesetVersion: '2014' });
      const dwarf = 'def_dnd5e_2014_species_dwarf';
      const elf = 'def_dnd5e_2014_species_elf';
      const hillDwarf = 'def_dnd5e_2014_lineage_hill_dwarf';
      expect(database.rulesCatalog.search({
        campaignId: campaign.id, rulesetId: 'dnd5e', rulesetVersion: '2014',
        definitionTypes: ['Lineage'], parentDefinitionId: dwarf, limit: 20,
      }).items.map((item) => item.id)).toEqual([hillDwarf]);
      expect(database.rulesCatalog.get(hillDwarf)?.parentDefinitionIds).toContain(dwarf);
      expect(database.rulesCatalog.search({
        campaignId: campaign.id, rulesetId: 'dnd5e', rulesetVersion: '2014',
        definitionTypes: ['Subclass'], parentDefinitionId: 'def_dnd5e_2014_class_paladin', limit: 20,
      }).items.map((item) => item.id)).toEqual(['def_dnd5e_2014_subclass_oath_of_devotion']);

      const character = database.domain.createCharacter({
        campaignId: campaign.id, name: 'Chybná kombinace', characterType: 'PC', currentLifeStateId: LifeStateIds.alive,
      });
      expect(() => database.dataChanges.apply({
        id: createDomainId('change'), campaignId: campaign.id, origin: 'manual', summary: 'Neplatný rod',
        changes: [{ type: 'character.origin.set', characterId: character.id, speciesId: elf, lineageId: hillDwarf, backgroundId: null }],
        expectedRevisions: [], sourceRunId: null, sourceMessageId: null,
      })).toThrow(/nepatří k nadřazené volbě/);

      const homebrewId = createDomainId('def');
      database.dataChanges.apply({
        id: createDomainId('change'), campaignId: campaign.id, origin: 'manual', summary: 'Homebrew rod trpaslíka',
        changes: [
          { type: 'ruleDefinition.homebrew.create', definitionId: homebrewId, definitionType: 'Lineage', name: 'Runový rod', description: '', aliases: [], parentDefinitionId: dwarf },
          { type: 'character.origin.set', characterId: character.id, speciesId: dwarf, lineageId: homebrewId, backgroundId: null },
        ], expectedRevisions: [], sourceRunId: null, sourceMessageId: null,
      });
      expect(database.rulesCatalog.get(homebrewId)?.parentDefinitionIds).toEqual([dwarf]);
    } finally { database.close(); }
  });

  it('keeps the previous pack active after invalid input and repairs a corrupt installed file on startup', async () => {
    const opened = await openDatabase();
    const active = opened.database.rulesPacks.list().find((item) => item.packId === 'dnd5e-srd-5.2.1')!;
    const invalid = structuredClone(bundledRulesPacks().find((pack) => pack.manifest.packId === active.packId)!) as RulesPack;
    invalid.payload.definitions[0]!.name = 'Poškozeno';
    await expect(opened.database.rulesPacks.install(invalid)).rejects.toThrow(/Kontrolní součet/);
    expect(opened.database.rulesPacks.list().find((item) => item.packId === active.packId)?.contentHash).toBe(active.contentHash);
    const packPath = path.join(opened.database.rulesPacks.directory, active.packId, active.version, 'pack.json');
    await writeFile(packPath, '{broken', 'utf8');
    opened.database.close();

    const reopened = await ChronicleDatabase.open(opened.directory);
    try {
      const repaired = JSON.parse(await readFile(packPath, 'utf8')) as RulesPack;
      expect(() => validatePack(repaired)).not.toThrow();
      expect(reopened.appLog.query({ category: 'rules-pack', search: 'poškozen' }).items)
        .toEqual(expect.arrayContaining([expect.objectContaining({ event: 'rules-pack.corruption-detected' })]));
    } finally { reopened.close(); }
  });

  it('activates a new pack version without invalidating stable character references', async () => {
    const { database } = await openDatabase();
    try {
      const campaign = database.domain.createCampaign({ name: 'Upgrade', rulesetId: 'dnd5e', rulesetVersion: '2014' });
      const character = database.domain.createCharacter({
        campaignId: campaign.id, name: 'Borin', characterType: 'PC', currentLifeStateId: LifeStateIds.alive,
      });
      database.characters.setOrigin(character.id, {
        speciesId: 'def_dnd5e_2014_species_dwarf', lineageId: 'def_dnd5e_2014_lineage_hill_dwarf', backgroundId: null,
      });
      const next = structuredClone(bundledRulesPacks().find((pack) => pack.manifest.packId === 'dnd5e-srd-5.1')!) as RulesPack;
      next.manifest.version = '3.1.0';
      for (const definition of next.payload.definitions) definition.packVersion = '3.1.0';
      next.payload.definitions.find((definition) => definition.id === 'def_dnd5e_2014_species_dwarf')!.aliases = ['Trpaslík', 'Dwarf folk'];
      next.manifest.contentHash = testHash(next.payload);
      const result = await database.rulesPacks.install(next);
      expect(result.status).toMatchObject({ version: '3.1.0', active: true });
      expect(database.characters.getOrigin(character.id)).toMatchObject({
        speciesId: 'def_dnd5e_2014_species_dwarf', lineageId: 'def_dnd5e_2014_lineage_hill_dwarf',
      });
      expect(database.rulesCatalog.get('def_dnd5e_2014_species_dwarf')?.aliases).toContain('Dwarf folk');
    } finally { database.close(); }
  });

  it('stores bounded searchable diagnostics without secrets and exports only sanitized values', async () => {
    const { database } = await openDatabase();
    try {
      database.appLog.write({
        severity: 'error', category: 'ai', event: 'ai.test',
        message: 'Selhal klíč sk-proj-abcdefghijklmnop',
        details: { apiKey: 'sk-secret-value', safe: 'zachovat', nested: { authorization: 'Bearer secret' } },
      });
      const page = database.appLog.query({ severity: 'error', category: 'ai', search: 'Selhal' });
      expect(page.total).toBe(1);
      expect(page.items[0]?.message).toContain('[REDACTED]');
      expect(page.items[0]?.details).toEqual({ safe: 'zachovat', nested: {} });
      expect(JSON.stringify(database.appLog.export())).not.toContain('sk-secret-value');
      expect(database.appLog.clear()).toBeGreaterThan(0);
    } finally { database.close(); }
  });
});

describe('Milestone 9 AI tool efficiency', () => {
  it('caches identical reads within one turn and exposes batch tools with read/proposal metadata', async () => {
    const { database } = await openDatabase();
    try {
      const fixture = seedRavenfordM5(database);
      let secondCached = false;
      const provider = new FakeAiProvider([async (input) => {
        expect(input.tools.every((tool) => tool.kind === 'read' ? tool.cacheable : !tool.cacheable)).toBe(true);
        expect(input.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
          'chronicle.search_rule_definitions_batch', 'chronicle.get_entities_context', 'chronicle.get_character_edit_context',
        ]));
        const args = { campaignId: fixture.campaignId, query: 'Dwarf', definitionTypes: ['Species'], includeHomebrew: true, limit: 20 };
        const first = await input.executeTool({ callId: 'read-1', name: 'chronicle.search_rule_definitions', arguments: args });
        const second = await input.executeTool({ callId: 'read-2', name: 'chronicle.search_rule_definitions', arguments: { ...args } });
        expect(first.cached).not.toBe(true);
        secondCached = second.cached === true;
        const batch = await input.executeTool({ callId: 'batch', name: 'chronicle.search_rule_definitions_batch', arguments: {
          campaignId: fixture.campaignId,
          queries: [{ key: 'species', query: 'Elf', definitionTypes: ['Species'], includeHomebrew: true, limit: 10 }],
        } });
        expect(batch.output).toMatchObject({ results: [{ key: 'species' }] });
        return [{ type: 'completed', responseId: 'cache', text: 'Hotovo.' }] satisfies AiProviderEvent[];
      }]);
      const service = new AiTurnService(database, async () => provider);
      for await (const _event of service.runTurn({
        campaignId: fixture.campaignId, conversationId: fixture.conversationId, content: 'Najdi definice.',
      })) { /* drain */ }
      expect(secondCached).toBe(true);
    } finally { database.close(); }
  });

  it('executes independent read calls in parallel and completes gracefully after the hard limit', async () => {
    const parallelRequests: Array<Record<string, unknown>> = [];
    let active = 0;
    let maximumActive = 0;
    const client: OpenAiResponsesClient = { responses: { create: vi.fn(async (body: unknown) => {
      parallelRequests.push(body as Record<string, unknown>);
      return parallelRequests.length === 1 ? toolCallsStream(2) : completedStream('parallel-final');
    }) } };
    const provider = new OpenAiProvider(client);
    const events: AiProviderEvent[] = [];
    for await (const event of provider.runTurn({
      modelId: 'gpt-5.6-sol', reasoningEffort: 'low', verbosity: 'low', maxOutputTokens: 256,
      instructions: 'test', input: [{ role: 'user', content: 'test' }],
      tools: [ruleDefinitionSearchToolDescriptor()],
      executeTool: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { output: { ok: true }, truncated: false };
      },
    })) events.push(event);
    expect(parallelRequests[0]).toMatchObject({ parallel_tool_calls: true });
    expect(maximumActive).toBe(2);
    expect(events.find((event) => event.type === 'tool-usage')).toMatchObject({
      usage: { totalCalls: 2, totalRounds: 1, maxReached: false },
    });

    const limitedRequests: Array<Record<string, unknown>> = [];
    const execute = vi.fn();
    const limited = new OpenAiProvider({ responses: { create: vi.fn(async (body: unknown) => {
      limitedRequests.push(body as Record<string, unknown>);
      return limitedRequests.length === 1 ? toolCallsStream(2) : completedStream('limited-final');
    }) } }, { maxCalls: 1, maxRounds: 2 });
    let summary: ToolUsageSummary | undefined;
    for await (const event of limited.runTurn({
      modelId: 'gpt-5.6-sol', reasoningEffort: 'low', verbosity: 'low', maxOutputTokens: 256,
      instructions: 'test', input: [{ role: 'user', content: 'test' }],
      tools: [ruleDefinitionSearchToolDescriptor()], executeTool: execute,
    })) if (event.type === 'tool-usage') summary = event.usage;
    expect(execute).not.toHaveBeenCalled();
    expect(limitedRequests).toHaveLength(2);
    expect(limitedRequests[1]?.tools).toEqual([]);
    expect(summary).toMatchObject({ totalCalls: 2, totalRounds: 1, maxReached: true });
  });
});

describe('Milestone 9 renderer lifecycle contract', () => {
  it('uses abortable editor sessions and IME-safe Enter handling with an eight-line composer', async () => {
    const [editor, chat, styles] = await Promise.all([
      readFile('src/renderer/character-editor-dialog.ts', 'utf8'),
      readFile('src/renderer/ai-chat.ts', 'utf8'),
      readFile('src/renderer/styles.css', 'utf8'),
    ]);
    expect(editor).toContain('new AbortController()');
    expect(editor.match(/signal: session\.signal/g)?.length).toBeGreaterThanOrEqual(5);
    expect(editor).toContain('previousFocus.focus()');
    expect(chat).toContain('event.isComposing');
    expect(chat).toContain('event.shiftKey');
    expect(chat).toContain('textarea.form?.requestSubmit()');
    expect(chat).toContain('lineHeight * 8');
    expect(styles).toContain('max-width: 75%');
  });

  it('deduplicates toasts, keeps at most four, and schedules the standard five-second dismissal', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    let timer = 0;
    const setTimeoutMock = vi.fn(() => ++timer);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      setTimeout: setTimeoutMock, clearTimeout: vi.fn(),
    } });
    const host = { innerHTML: '', querySelectorAll: () => [] };
    try {
      const service = new ToastService(host as unknown as HTMLElement);
      service.show('Stejná zpráva', 'info');
      service.show('Stejná zpráva', 'info');
      expect(host.innerHTML).toContain('×2');
      for (const message of ['A', 'B', 'C', 'D', 'E']) service.show(message, 'success');
      expect((host.innerHTML.match(/class="app-toast/g) ?? [])).toHaveLength(4);
      expect(setTimeoutMock).toHaveBeenCalledWith(expect.any(Function), 5_000);
    } finally { restoreGlobal('window', originalWindow); }
  });

  it('submits once on Enter while Shift+Enter and IME composition remain multiline input', () => {
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const originalAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      chronicle: { onAiTurnEvent: () => () => undefined },
    } });
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
    const root = { innerHTML: '', addEventListener: () => undefined, querySelector: () => null };
    try {
      const controller = new AiChatController(root as unknown as HTMLElement, {
        openSettings: () => undefined, createCharacter: () => undefined, createConversation: () => undefined,
      }) as unknown as { onKeyDown(event: KeyboardEvent): void };
      const requestSubmit = vi.fn();
      const textarea = { form: { requestSubmit } };
      const event = (shiftKey = false, isComposing = false) => ({
        target: { closest: () => textarea }, key: 'Enter', shiftKey, isComposing, keyCode: 13,
        preventDefault: vi.fn(),
      }) as unknown as KeyboardEvent;
      controller.onKeyDown(event());
      controller.onKeyDown(event(true));
      controller.onKeyDown(event(false, true));
      expect(requestSubmit).toHaveBeenCalledTimes(1);
    } finally {
      restoreGlobal('window', originalWindow);
      restoreGlobal('requestAnimationFrame', originalAnimationFrame);
    }
  });
});

async function openDatabase(): Promise<{ directory: string; database: ChronicleDatabase }> {
  const directory = await mkdtemp(path.join(tmpdir(), 'chronicle-m9-'));
  temporaryDirectories.push(directory);
  return { directory, database: await ChronicleDatabase.open(directory) };
}

async function* toolCallsStream(count: number) {
  const calls = Array.from({ length: count }, (_, index) => ({
    type: 'function_call', id: `fc_${index}`, call_id: `call_${index}`,
    name: 'chronicle_search_rule_definitions',
    arguments: JSON.stringify({ campaignId: 'campaign_test', query: null, definitionTypes: null, includeHomebrew: true, limit: null }),
    status: 'completed',
  }));
  yield { type: 'response.completed', sequence_number: 1, response: { id: 'tool-response', output: calls, usage: null } };
}

async function* completedStream(id: string) {
  yield { type: 'response.output_text.delta', delta: 'Dokončeno.', item_id: 'message', output_index: 0, content_index: 0, logprobs: [], sequence_number: 1 };
  yield { type: 'response.completed', sequence_number: 2, response: { id, output: [], usage: null } };
}

function restoreGlobal(name: string, descriptor?: PropertyDescriptor): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor);
  else Reflect.deleteProperty(globalThis, name);
}

function testHash(value: unknown): string {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.keys(item as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((item as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(item);
  };
  return `sha256:${createHash('sha256').update(stable(value)).digest('hex')}`;
}
