import type {
  ApprovalPolicy,
  ChronicleToolTraceEntry,
  ProposedTurnTransaction,
  SceneContextView,
  TurnTransaction,
  TurnTransactionResult,
  TurnValidationResult,
} from '../../shared/chronicle-engine';
import { ChronicleEngineService } from './service';
import { TurnTransactionService } from './turn-transaction-service';

export class ChronicleOrchestrator {
  private readonly trace: ChronicleToolTraceEntry[] = [];

  constructor(
    private readonly engine: ChronicleEngineService,
    private readonly transactions: TurnTransactionService,
    readonly approvalPolicy: ApprovalPolicy = 'review',
  ) {}

  buildTurnContext(campaignId: string): SceneContextView {
    const context = this.engine.getSceneContext(campaignId);
    this.record('scene_context_built', {
      campaignId,
      participantCount: context.participants.length,
      recentMessageCount: context.recentMessages.length,
    });
    return context;
  }

  executeTool(name: string, input: unknown): unknown {
    const output = this.engine.executeTool(name, input);
    this.record('tool_called', { name });
    if (isTruncated(output)) this.record('tool_output_truncated', { name });
    return output;
  }

  validateProposedTransaction(input: {
    transactionId: string;
    campaignId: string;
    proposal: ProposedTurnTransaction;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
  }): TurnValidationResult {
    const transaction = this.toTransaction(input);
    const result = this.transactions.validateTurnTransaction(transaction);
    this.record('transaction_validated', {
      transactionId: input.transactionId,
      valid: result.valid,
      errorCodes: result.errors.map((error) => error.code),
      approvalPolicy: this.approvalPolicy,
    });
    return result;
  }

  commitTransaction(transaction: TurnTransaction): TurnTransactionResult {
    const result = this.transactions.applyTurnTransaction(transaction);
    this.record('transaction_committed', {
      transactionId: result.transactionId,
      eventId: result.eventId,
      alreadyApplied: result.alreadyApplied,
    });
    return result;
  }

  getTrace(): ChronicleToolTraceEntry[] {
    return structuredClone(this.trace);
  }

  clearTrace(): void {
    this.trace.length = 0;
  }

  toTransaction(input: {
    transactionId: string;
    campaignId: string;
    proposal: ProposedTurnTransaction;
    sourceConversationId?: string | null;
    sourceMessageId?: string | null;
  }): TurnTransaction {
    return {
      id: input.transactionId,
      campaignId: input.campaignId,
      sourceConversationId: input.sourceConversationId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      event: { ...input.proposal.event },
      changes: input.proposal.changes.map((change) => structuredClone(change)),
      metadata: input.proposal.reasoningSummary
        ? { reasoningSummary: input.proposal.reasoningSummary }
        : null,
    };
  }

  private record(stage: ChronicleToolTraceEntry['stage'], detail: Readonly<Record<string, unknown>>): void {
    this.trace.push({ stage, at: new Date().toISOString(), detail });
    if (this.trace.length > 100) this.trace.splice(0, this.trace.length - 100);
  }
}

function isTruncated(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'truncated' in value && (value as { truncated?: unknown }).truncated);
}
