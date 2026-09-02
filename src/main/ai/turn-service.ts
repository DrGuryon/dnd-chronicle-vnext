import { createDomainId } from '../../domain/ids';
import type {
  AiProvider,
  AiProviderConnectionResult,
  AiTurnClientEvent,
  AiTurnRequest,
  AiUsage,
  ToolUsageSummary,
  CampaignAiSettings,
  PendingAiProposal,
} from '../../shared/ai';
import type { ChronicleToolDescriptor, ProposedTurnTransaction } from '../../shared/chronicle-engine';
import type { TurnTransaction, TurnValidationResult } from '../../shared/chronicle-engine';
import type {
  DataChangeTransaction,
  DataChangeValidationResult,
  ProposedDataChangeTransaction,
  CharacterEditorView,
  RuleCatalogResult,
} from '../../shared/editable-domain';
import { ChronicleDatabase } from '../database';
import { ChronicleEngineError } from '../engine/service';
import { stableStringify } from '../engine/service';
import { AI_PROMPT_VERSION, buildChronicleInstructions } from './prompt-builder';
import {
  dataChangeProposalToolDescriptor,
  proposalToolDescriptor,
  ruleDefinitionSearchToolDescriptor,
  ruleDefinitionSearchBatchToolDescriptor,
  characterEditContextToolDescriptor,
  entitiesContextToolDescriptor,
} from './tool-schemas';

export type AiProviderResolver = (settings: CampaignAiSettings) => Promise<AiProvider>;

export interface AiRuntimeErrorLog {
  runId: string;
  campaignId: string;
  modelId: string;
  errorCode: string;
  timestamp: string;
  httpStatus?: number;
  providerCode?: string;
  providerType?: string;
  providerMessage?: string;
  toolName?: string;
  path?: string;
}

export class AiTurnService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly database: ChronicleDatabase,
    private readonly resolveProvider: AiProviderResolver,
    private readonly logError: (entry: AiRuntimeErrorLog) => void = () => undefined,
  ) {}

  async *runTurn(request: AiTurnRequest): AsyncIterable<AiTurnClientEvent> {
    const content = requiredText(request.content, 'Zpráva', 20_000);
    const settings = this.database.aiSettings.get(request.campaignId);
    const conversation = this.database.engine.getConversation(request.conversationId);
    if (!conversation) throw new ChronicleEngineError('ENTITY_NOT_FOUND', 'Konverzace neexistuje.');
    if (conversation.campaignId !== request.campaignId) {
      throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Konverzace patří do jiné kampaně.');
    }
    const userMessage = request.retryUserMessageId
      ? this.requireRetryMessage(request.retryUserMessageId, request.campaignId, request.conversationId, content)
      : this.database.engine.addConversationMessage({
        id: createDomainId('message'),
        campaignId: request.campaignId,
        conversationId: request.conversationId,
        role: 'user',
        content,
      });
    const runId = createDomainId('ai');
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    this.database.aiRuns.start({
      id: runId,
      campaignId: request.campaignId,
      conversationId: request.conversationId,
      userMessageId: userMessage.id,
      provider: settings.provider,
      modelId: settings.modelId,
      promptVersion: AI_PROMPT_VERSION,
    });
    yield { type: 'started', runId, conversationId: request.conversationId, userMessageId: userMessage.id };

    try {
      const provider = await this.resolveProvider(settings);
      const scene = this.database.orchestrator.buildTurnContext(request.campaignId);
      const messages = this.database.engine.listConversationMessages(request.conversationId, {
        maxResults: 30,
        maxCharacters: 40_000,
      }).items.reverse().filter((message) => message.role === 'user' || message.role === 'assistant');
      let latestValid: (
        | { kind: 'turn'; transaction: TurnTransaction; validation: TurnValidationResult }
        | { kind: 'data'; transaction: DataChangeTransaction; validation: DataChangeValidationResult }
      ) | null = null;
      let fullText = '';
      let providerResponseId: string | null = null;
      let usage = emptyUsage();
      let toolUsage = emptyToolUsage();
      const tools = [
        ...this.database.engine.listToolDescriptors(),
        ruleDefinitionSearchToolDescriptor(),
        ruleDefinitionSearchBatchToolDescriptor(),
        characterEditContextToolDescriptor(),
        entitiesContextToolDescriptor(),
        proposalToolDescriptor(),
        dataChangeProposalToolDescriptor(),
      ];
      const toolCache = new TurnToolCache(tools);
      for await (const event of provider.runTurn({
        modelId: settings.modelId,
        reasoningEffort: settings.reasoningEffort,
        verbosity: settings.verbosity,
        maxOutputTokens: settings.maxOutputTokens,
        instructions: buildChronicleInstructions(scene, settings),
        input: messages.map((message) => ({ role: message.role, content: message.content })),
        tools,
        executeTool: async (call) => {
          const cached = toolCache.get(call.name, call.arguments);
          if (cached) return { ...cached, cached: true };
          if (call.name === 'chronicle.propose_turn_transaction') {
            const candidate = this.database.aiProposals.buildAndValidate({
              campaignId: request.campaignId,
              conversationId: request.conversationId,
              sourceMessageId: userMessage.id,
              proposal: proposalValue(call.arguments),
            });
            if (candidate.validation.valid) latestValid = { kind: 'turn', ...candidate };
            return {
              output: {
                valid: candidate.validation.valid,
                errors: candidate.validation.errors,
                warnings: candidate.validation.warnings,
                normalizedProposal: candidate.validation.valid ? candidate.transaction : null,
              },
              truncated: false,
            };
          }
          if (call.name === 'chronicle.propose_data_changes') {
            const candidate = this.database.aiDataChangeProposals.buildAndValidate({
              campaignId: request.campaignId,
              conversationId: request.conversationId,
              sourceMessageId: userMessage.id,
              runId,
              proposal: dataProposalValue(call.arguments),
            });
            if (candidate.validation.valid) latestValid = { kind: 'data', ...candidate };
            return {
              output: {
                valid: candidate.validation.valid,
                errors: candidate.validation.errors,
                warnings: candidate.validation.warnings,
                normalizedProposal: candidate.validation.valid ? candidate.transaction : null,
              },
              truncated: false,
            };
          }
          if (call.name === 'chronicle.search_rule_definitions') {
            const query = ruleSearchValue(call.arguments, request.campaignId);
            const output = this.searchRules(request.campaignId, query);
            return toolCache.store(call.name, call.arguments, { output, truncated: output.truncated });
          }
          if (call.name === 'chronicle.search_rule_definitions_batch') {
            const batch = ruleSearchBatchValue(call.arguments, request.campaignId);
            const output = {
              results: batch.map((query) => ({ key: query.key, result: this.searchRules(request.campaignId, query) })),
            };
            return toolCache.store(call.name, call.arguments, { output, truncated: output.results.some((item) => item.result.truncated) });
          }
          if (call.name === 'chronicle.get_character_edit_context') {
            const value = characterEditContextValue(call.arguments, request.campaignId);
            const view = this.database.characterEditor.get(value.characterId);
            if (!view || view.character.campaignId !== request.campaignId) throw new ChronicleEngineError('ENTITY_NOT_FOUND', 'Postava pro editaci neexistuje v této kampani.');
            const definitions = characterDefinitionIds(view).map((id) => this.database.rulesCatalog.get(id)).filter(Boolean);
            return toolCache.store(call.name, call.arguments, { output: { view, definitions }, truncated: false });
          }
          if (call.name === 'chronicle.get_entities_context') {
            const value = entitiesContextValue(call.arguments, request.campaignId);
            const output = { results: value.entities.map((item) => ({
              key: item.key,
              summary: this.database.readModels.getEntitySummary({ id: item.entityId, ...(item.kind ? { kind: item.kind as never } : {}) }),
            })) };
            return toolCache.store(call.name, call.arguments, { output, truncated: false });
          }
          const output = this.database.orchestrator.executeTool(call.name, call.arguments);
          return toolCache.store(call.name, call.arguments, { output, truncated: isTruncated(output) });
        },
        signal: controller.signal,
      })) {
        if (event.type === 'text-delta') {
          fullText += event.delta;
          yield { type: 'text-delta', runId, delta: event.delta };
        } else if (event.type === 'tool-start') {
          yield { type: 'tool-status', runId, name: event.name, status: 'running' };
        } else if (event.type === 'tool-finish') {
          yield { type: 'tool-status', runId, name: event.name, status: 'completed' };
        } else if (event.type === 'usage') {
          usage = event.usage;
        } else if (event.type === 'tool-usage') {
          toolUsage = event.usage;
          yield { type: 'tool-usage', runId, usage: event.usage };
        } else if (event.type === 'completed') {
          providerResponseId = event.responseId;
          if (!fullText) fullText = event.text;
        }
      }
      const assistantMessage = this.database.engine.addConversationMessage({
        id: createDomainId('message'),
        campaignId: request.campaignId,
        conversationId: request.conversationId,
        role: 'assistant',
        content: fullText.trim() || 'Tah byl zpracován bez textové odpovědi.',
      });
      let savedProposal: PendingAiProposal | null = null;
      const finalProposal = latestValid as (
        | { kind: 'turn'; transaction: TurnTransaction; validation: TurnValidationResult }
        | { kind: 'data'; transaction: DataChangeTransaction; validation: DataChangeValidationResult }
      ) | null;
      if (finalProposal) {
        savedProposal = finalProposal.kind === 'turn'
          ? this.database.aiProposals.save({
            runId, campaignId: request.campaignId, conversationId: request.conversationId,
            transaction: finalProposal.transaction, validation: finalProposal.validation, status: 'pending',
          })
          : this.database.aiDataChangeProposals.save({
            runId, campaignId: request.campaignId, conversationId: request.conversationId,
            transaction: finalProposal.transaction, validation: finalProposal.validation, status: 'pending',
          });
        if (settings.approvalPolicy === 'automatic') {
          savedProposal = savedProposal.kind === 'turn'
            ? this.database.aiProposals.apply(savedProposal.id).proposal
            : this.database.aiDataChangeProposals.apply(savedProposal.id).proposal;
        }
        yield { type: 'proposal', runId, proposal: savedProposal };
      }
      const pending = savedProposal?.status === 'pending';
      this.database.aiRuns.finish({
        id: runId,
        status: pending ? 'pending_review' : 'completed',
        assistantMessageId: assistantMessage.id,
        providerResponseId,
        transactionId: savedProposal?.transaction.id ?? null,
        usage,
        toolUsage,
      });
      this.database.appLog.write({
        severity: pending ? 'info' : 'success', category: 'ai', campaignId: request.campaignId,
        event: pending ? 'ai.turn.pending-review' : 'ai.turn.completed',
        message: pending ? 'AI tah čeká na schválení navržených změn.' : 'AI tah byl dokončen.',
        details: { runId, modelId: settings.modelId, usage, toolUsage },
      });
      yield { type: 'completed', runId, assistantMessageId: assistantMessage.id, proposal: savedProposal };
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        this.database.aiRuns.fail(runId, 'cancelled', null);
        yield { type: 'cancelled', runId };
      } else {
        const mapped = error instanceof ChronicleEngineError
          ? error
          : new ChronicleEngineError('AI_TURN_FAILED', error instanceof Error ? error.message : String(error));
        this.database.aiRuns.fail(runId, 'failed', mapped.code);
        this.logError(runtimeErrorLog(runId, request.campaignId, settings.modelId, mapped));
        this.database.appLog.write({
          severity: 'error', category: 'ai', campaignId: request.campaignId,
          event: 'ai.turn.failed', message: mapped.message,
          details: { runId, modelId: settings.modelId, errorCode: mapped.code },
        });
        yield { type: 'failed', runId, userMessageId: userMessage.id, code: mapped.code, message: mapped.message };
      }
    } finally {
      this.controllers.delete(runId);
    }
  }

  cancel(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller) return false;
    controller.abort(new DOMException('Cancelled by user', 'AbortError'));
    return true;
  }

  async testConnection(campaignId?: string, signal?: AbortSignal): Promise<AiProviderConnectionResult> {
    const settings: CampaignAiSettings = campaignId ? this.database.aiSettings.get(campaignId) : {
      campaignId: 'global',
      provider: 'openai',
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'medium',
      verbosity: 'medium',
      maxOutputTokens: 4096,
      approvalPolicy: 'review',
      campaignInstructions: '',
      updatedAt: '',
    };
    return (await this.resolveProvider(settings)).testConnection(settings.modelId, signal);
  }

  async testRuntime(campaignId: string, signal?: AbortSignal): Promise<AiProviderConnectionResult> {
    const settings = this.database.aiSettings.get(campaignId);
    const provider = await this.resolveProvider(settings);
    const scene = this.database.orchestrator.buildTurnContext(campaignId);
    const diagnosticRunId = createDomainId('ai');
    let completed = false;
    try {
      for await (const event of provider.runTurn({
        modelId: settings.modelId,
        reasoningEffort: settings.reasoningEffort,
        verbosity: settings.verbosity,
        maxOutputTokens: settings.maxOutputTokens,
        instructions: `${buildChronicleInstructions(scene, settings)}\n\nDIAGNOSTICKÝ REŽIM: Neměň stav kampaně. Odpověz pouze OK a nevolej nástroje.`,
        input: [{ role: 'user', content: 'Reply with exactly OK. Do not call tools.' }],
        tools: [
          ...this.database.engine.listToolDescriptors(),
          ruleDefinitionSearchToolDescriptor(), ruleDefinitionSearchBatchToolDescriptor(),
          characterEditContextToolDescriptor(), entitiesContextToolDescriptor(),
          proposalToolDescriptor(), dataChangeProposalToolDescriptor(),
        ],
        executeTool: async () => ({
          output: { ok: false, diagnostic: true, message: 'Tool execution is disabled during the runtime test.' },
          truncated: false,
        }),
        signal,
      })) {
        if (event.type === 'completed') completed = true;
      }
    } catch (error) {
      const mapped = error instanceof ChronicleEngineError
        ? error
        : new ChronicleEngineError('AI_TURN_FAILED', error instanceof Error ? error.message : String(error));
      this.logError(runtimeErrorLog(diagnosticRunId, campaignId, settings.modelId, mapped));
      throw mapped;
    }
    if (!completed) throw new ChronicleEngineError('OPENAI_STREAM_INCOMPLETE', 'Test AI runtime nedostal dokončenou odpověď.');
    return { ok: true, modelId: settings.modelId, message: 'AI runtime včetně Chronicle nástrojů funguje.' };
  }

  applyProposal(id: string) {
    const applied = this.database.aiProposals.get(id)
      ? this.database.aiProposals.apply(id)
      : this.database.aiDataChangeProposals.apply(id);
    this.database.aiRuns.markProposalApplied(applied.proposal.turnRunId);
    this.database.appLog.write({ severity: 'success', category: 'data', campaignId: applied.proposal.campaignId,
      event: 'ai.proposal.applied', message: 'Navržené změny byly schváleny a použity.',
      details: { proposalId: id, runId: applied.proposal.turnRunId } });
    return applied;
  }

  rejectProposal(id: string): PendingAiProposal {
    const proposal = this.database.aiProposals.get(id)
      ? this.database.aiProposals.reject(id)
      : this.database.aiDataChangeProposals.reject(id);
    this.database.aiRuns.markProposalApplied(proposal.turnRunId);
    this.database.appLog.write({ severity: 'info', category: 'data', campaignId: proposal.campaignId,
      event: 'ai.proposal.rejected', message: 'Navržené změny byly zamítnuty.',
      details: { proposalId: id, runId: proposal.turnRunId } });
    return proposal;
  }

  private requireRetryMessage(
    id: string,
    campaignId: string,
    conversationId: string,
    content: string,
  ) {
    const message = this.database.engine.getConversationMessage(id);
    if (!message || message.campaignId !== campaignId || message.conversationId !== conversationId
      || message.role !== 'user' || message.content !== content) {
      throw new ChronicleEngineError('INVALID_INPUT', 'Původní zprávu pro opakování tahu nelze bezpečně použít.');
    }
    return message;
  }

  private searchRules(
    campaignId: string,
    query: {
      query: string | null;
      definitionTypes: string[] | null;
      includeHomebrew: boolean;
      limit: number | null;
    },
  ): RuleCatalogResult {
    const campaign = this.database.domain.getCampaign(campaignId)!;
    const limit = Number.isSafeInteger(query.limit)
      ? Math.min(100, Math.max(1, query.limit!))
      : 60;
    const global = this.database.dndpedia.search({
      query: query.query,
      definitionTypes: query.definitionTypes,
      rulesetId: campaign.rulesetId,
      rulesetVersion: campaign.rulesetVersion,
      page: 1,
      pageSize: limit,
    });
    const builtIns = global.items.map((item) => this.database.rulesCatalog.get(item.definitionId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const homebrew = query.includeHomebrew ? this.database.rulesCatalog.search({
      campaignId,
      rulesetId: campaign.rulesetId,
      rulesetVersion: campaign.rulesetVersion,
      definitionTypes: query.definitionTypes,
      query: query.query,
      includeHomebrew: true,
      includeBuiltIn: false,
      limit,
    }) : { items: [], total: 0, truncated: false };
    const items = [...builtIns, ...homebrew.items].slice(0, limit);
    const total = global.totalItems + homebrew.total;
    return { items, total, truncated: total > items.length };
  }
}

function proposalValue(value: unknown): ProposedTurnTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Proposal musí být object.');
  }
  return value as ProposedTurnTransaction;
}

function dataProposalValue(value: unknown): ProposedDataChangeTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Data proposal musí být object.');
  }
  return value as ProposedDataChangeTransaction;
}

function ruleSearchValue(value: unknown, campaignId: string): {
  query: string | null;
  definitionTypes: string[] | null;
  includeHomebrew: boolean;
  limit: number | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Rule search musí být object.');
  }
  const input = value as Record<string, unknown>;
  if (input.campaignId !== campaignId) {
    throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Rule search patří jiné kampani.');
  }
  return {
    query: typeof input.query === 'string' ? input.query : null,
    definitionTypes: Array.isArray(input.definitionTypes)
      ? input.definitionTypes.filter((item): item is string => typeof item === 'string') : null,
    includeHomebrew: input.includeHomebrew !== false,
    limit: typeof input.limit === 'number' ? input.limit : null,
  };
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdná.`);
  if (value.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhá.`);
  return value.trim();
}

function emptyUsage(): AiUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
}

function emptyToolUsage(): ToolUsageSummary {
  return { totalCalls: 0, totalRounds: 0, byTool: {}, cacheHits: 0, duplicateCallsAvoided: 0, maxReached: false };
}

interface ToolResult { output: unknown; truncated: boolean; cached?: boolean }

class TurnToolCache {
  private readonly descriptors: ReadonlyMap<string, ChronicleToolDescriptor>;
  private readonly values = new Map<string, ToolResult>();
  private readonly characterContexts: Array<{ arguments: Record<string, unknown>; result: ToolResult }> = [];

  constructor(descriptors: readonly ChronicleToolDescriptor[]) {
    this.descriptors = new Map(descriptors.map((descriptor) => [descriptor.name, descriptor]));
  }

  get(name: string, args: unknown): ToolResult | undefined {
    if (!this.isCacheable(name)) return undefined;
    const exact = this.values.get(this.key(name, args));
    if (exact) return exact;
    if (name !== 'chronicle.get_character_context' || !isRecord(args)) return undefined;
    const requestedSections = stringValues(args.sections);
    const base = stableStringify({ ...args, sections: undefined });
    return this.characterContexts.find((entry) => (
      stableStringify({ ...entry.arguments, sections: undefined }) === base
      && requestedSections.every((section) => stringValues(entry.arguments.sections).includes(section))
    ))?.result;
  }

  store(name: string, args: unknown, result: ToolResult): ToolResult {
    if (!this.isCacheable(name)) return result;
    this.values.set(this.key(name, args), result);
    if (name === 'chronicle.get_character_context' && isRecord(args)) {
      this.characterContexts.push({ arguments: structuredClone(args), result });
    }
    return result;
  }

  private isCacheable(name: string): boolean {
    const descriptor = this.descriptors.get(name);
    return descriptor?.kind === 'read' && descriptor.cacheable;
  }

  private key(name: string, args: unknown): string { return `${name}:${stableStringify(args)}`; }
}

interface RuleBatchQuery {
  key: string;
  query: string | null;
  definitionTypes: string[] | null;
  includeHomebrew: boolean;
  limit: number | null;
}

function ruleSearchBatchValue(value: unknown, campaignId: string): RuleBatchQuery[] {
  if (!isRecord(value) || value.campaignId !== campaignId || !Array.isArray(value.queries)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Batch rule search má neplatný vstup nebo patří jiné kampani.');
  }
  if (value.queries.length < 1 || value.queries.length > 20) throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Batch může obsahovat 1–20 dotazů.');
  return value.queries.map((item, index) => {
    if (!isRecord(item) || typeof item.key !== 'string' || !item.key.trim()) throw new ChronicleEngineError('INVALID_INPUT', `Dotazu ${index + 1} chybí klíč.`);
    return { key: item.key.slice(0, 100), ...ruleSearchValue({ ...item, campaignId }, campaignId) };
  });
}

function characterEditContextValue(value: unknown, campaignId: string): { characterId: string } {
  if (!isRecord(value) || value.campaignId !== campaignId || typeof value.characterId !== 'string') {
    throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Character edit context má neplatný vstup nebo patří jiné kampani.');
  }
  return { characterId: value.characterId };
}

function entitiesContextValue(value: unknown, campaignId: string): {
  entities: Array<{ key: string; entityId: string; kind: string | null }>;
} {
  if (!isRecord(value) || value.campaignId !== campaignId || !Array.isArray(value.entities)) {
    throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Entities context má neplatný vstup nebo patří jiné kampani.');
  }
  if (value.entities.length < 1 || value.entities.length > 20) throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Entities context může obsahovat 1–20 položek.');
  return { entities: value.entities.map((item, index) => {
    if (!isRecord(item) || typeof item.key !== 'string' || typeof item.entityId !== 'string') {
      throw new ChronicleEngineError('INVALID_INPUT', `Entita ${index + 1} má neplatný klíč nebo ID.`);
    }
    return { key: item.key.slice(0, 100), entityId: item.entityId, kind: typeof item.kind === 'string' ? item.kind : null };
  }) };
}

function characterDefinitionIds(view: CharacterEditorView): string[] {
  return [...new Set([
    view.biography.faithDefinitionId,
    view.origin.speciesId, view.origin.lineageId, view.origin.backgroundId,
    ...view.classes.flatMap((item) => [item.classId, item.subclassId]),
    ...view.proficiencies.map((item) => item.targetDefinitionId),
    ...view.features.map((item) => item.definitionId),
    ...view.spellcastingSources.map((item) => item.sourceId),
    ...view.spells.map((item) => item.spellId),
  ].filter((id): id is string => Boolean(id)) )];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function isTruncated(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'truncated' in value && (value as { truncated?: unknown }).truncated);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function runtimeErrorLog(
  runId: string,
  campaignId: string,
  modelId: string,
  error: ChronicleEngineError,
): AiRuntimeErrorLog {
  const detail = error.details;
  return compact({
    runId,
    campaignId,
    modelId,
    errorCode: error.code,
    timestamp: new Date().toISOString(),
    httpStatus: typeof detail.httpStatus === 'number' ? detail.httpStatus : undefined,
    providerCode: detailText(detail.providerCode),
    providerType: detailText(detail.providerType),
    providerMessage: detailText(detail.providerMessage),
    toolName: detailText(detail.toolName),
    path: detailText(detail.path),
  }) as unknown as AiRuntimeErrorLog;
}

function detailText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 500) : undefined;
}

function compact(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
