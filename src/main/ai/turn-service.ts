import { createDomainId } from '../../domain/ids';
import type {
  AiProvider,
  AiProviderConnectionResult,
  AiTurnClientEvent,
  AiTurnRequest,
  AiUsage,
  CampaignAiSettings,
  PendingTurnProposal,
} from '../../shared/ai';
import type { ProposedTurnTransaction } from '../../shared/chronicle-engine';
import type { TurnTransaction, TurnValidationResult } from '../../shared/chronicle-engine';
import { ChronicleDatabase } from '../database';
import { ChronicleEngineError } from '../engine/service';
import { AI_PROMPT_VERSION, buildChronicleInstructions } from './prompt-builder';
import { proposalToolDescriptor } from './tool-schemas';

export type AiProviderResolver = (settings: CampaignAiSettings) => Promise<AiProvider>;

export class AiTurnService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly database: ChronicleDatabase,
    private readonly resolveProvider: AiProviderResolver,
  ) {}

  async *runTurn(request: AiTurnRequest): AsyncIterable<AiTurnClientEvent> {
    const content = requiredText(request.content, 'Zpráva', 20_000);
    const settings = this.database.aiSettings.get(request.campaignId);
    const conversation = this.database.engine.getConversation(request.conversationId);
    if (!conversation) throw new ChronicleEngineError('ENTITY_NOT_FOUND', 'Konverzace neexistuje.');
    if (conversation.campaignId !== request.campaignId) {
      throw new ChronicleEngineError('CROSS_CAMPAIGN_REFERENCE', 'Konverzace patří do jiné kampaně.');
    }
    const userMessage = this.database.engine.addConversationMessage({
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
      let latestValid: { transaction: TurnTransaction; validation: TurnValidationResult } | null = null;
      let fullText = '';
      let providerResponseId: string | null = null;
      let usage = emptyUsage();
      const tools = [...this.database.engine.listToolDescriptors(), proposalToolDescriptor()];
      for await (const event of provider.runTurn({
        modelId: settings.modelId,
        reasoningEffort: settings.reasoningEffort,
        verbosity: settings.verbosity,
        maxOutputTokens: settings.maxOutputTokens,
        instructions: buildChronicleInstructions(scene, settings),
        input: messages.map((message) => ({ role: message.role, content: message.content })),
        tools,
        executeTool: async (call) => {
          if (call.name === 'chronicle.propose_turn_transaction') {
            const candidate = this.database.aiProposals.buildAndValidate({
              campaignId: request.campaignId,
              conversationId: request.conversationId,
              sourceMessageId: userMessage.id,
              proposal: proposalValue(call.arguments),
            });
            if (candidate.validation.valid) latestValid = candidate;
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
          const output = this.database.orchestrator.executeTool(call.name, call.arguments);
          return { output, truncated: isTruncated(output) };
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
      let savedProposal: PendingTurnProposal | null = null;
      const finalProposal = latestValid as { transaction: TurnTransaction; validation: TurnValidationResult } | null;
      if (finalProposal) {
        savedProposal = this.database.aiProposals.save({
          runId,
          campaignId: request.campaignId,
          conversationId: request.conversationId,
          transaction: finalProposal.transaction,
          validation: finalProposal.validation,
          status: 'pending',
        });
        if (settings.approvalPolicy === 'automatic') {
          savedProposal = this.database.aiProposals.apply(savedProposal.id).proposal;
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
        yield { type: 'failed', runId, code: mapped.code, message: mapped.message };
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

  applyProposal(id: string) {
    const applied = this.database.aiProposals.apply(id);
    this.database.aiRuns.markProposalApplied(applied.proposal.turnRunId);
    return applied;
  }

  rejectProposal(id: string): PendingTurnProposal {
    const proposal = this.database.aiProposals.reject(id);
    this.database.aiRuns.markProposalApplied(proposal.turnRunId);
    return proposal;
  }
}

function proposalValue(value: unknown): ProposedTurnTransaction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ChronicleEngineError('INVALID_INPUT', 'Proposal musí být object.');
  }
  return value as ProposedTurnTransaction;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdná.`);
  if (value.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhá.`);
  return value.trim();
}

function emptyUsage(): AiUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
}

function isTruncated(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'truncated' in value && (value as { truncated?: unknown }).truncated);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
