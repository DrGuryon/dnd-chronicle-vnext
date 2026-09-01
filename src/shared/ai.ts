import type { ApprovalPolicy, ChronicleToolDescriptor, TurnTransaction, TurnValidationResult } from './chronicle-engine';
import type { TurnTransactionResult } from './chronicle-engine';
import type {
  DataChangeTransaction,
  DataChangeTransactionResult,
  DataChangeValidationResult,
  PendingDataChangeProposal,
} from './editable-domain';

export type AiProviderId = 'openai' | 'fake';
export type AiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AiVerbosity = 'low' | 'medium' | 'high';

const standardReasoningEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const gpt56ReasoningEfforts = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export function normalizeAiReasoningEffort(
  modelId: string,
  effort: AiReasoningEffort,
): AiReasoningEffort {
  return isGpt56Model(modelId) && effort === 'minimal' ? 'low' : effort;
}

export function aiReasoningEffortsForModel(modelId: string): readonly AiReasoningEffort[] {
  return isGpt56Model(modelId) ? gpt56ReasoningEfforts : standardReasoningEfforts;
}

function isGpt56Model(modelId: string): boolean {
  return /^gpt-5\.6(?:-|$)/i.test(modelId.trim());
}

export interface CampaignAiSettings {
  campaignId: string;
  provider: 'openai';
  modelId: string;
  reasoningEffort: AiReasoningEffort;
  verbosity: AiVerbosity;
  maxOutputTokens: number;
  approvalPolicy: ApprovalPolicy;
  campaignInstructions: string;
  updatedAt: string;
}

export interface CampaignAiSettingsUpdate {
  modelId?: string;
  reasoningEffort?: AiReasoningEffort;
  verbosity?: AiVerbosity;
  maxOutputTokens?: number;
  approvalPolicy?: ApprovalPolicy;
  campaignInstructions?: string;
}

export interface AiSecretStatus {
  configured: boolean;
  source: 'safe-storage' | 'environment' | 'session' | 'none';
  persistence: 'encrypted' | 'environment' | 'session' | 'none';
  maskedSuffix: string | null;
}

export interface AiToolCall {
  callId: string;
  name: string;
  arguments: unknown;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export interface ToolUsageSummary {
  totalCalls: number;
  totalRounds: number;
  byTool: Readonly<Record<string, number>>;
  cacheHits: number;
  duplicateCallsAvoided: number;
  maxReached: boolean;
}

export type AiProviderEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; callId: string; name: string }
  | { type: 'tool-finish'; callId: string; name: string; outputTruncated: boolean }
  | { type: 'usage'; usage: AiUsage }
  | { type: 'tool-usage'; usage: ToolUsageSummary }
  | { type: 'completed'; responseId: string | null; text: string };

export interface AiProviderTurnInput {
  modelId: string;
  reasoningEffort: AiReasoningEffort;
  verbosity: AiVerbosity;
  maxOutputTokens: number;
  instructions: string;
  input: readonly unknown[];
  tools: readonly ChronicleToolDescriptor[];
  executeTool(call: AiToolCall): Promise<{ output: unknown; truncated: boolean; cached?: boolean }>;
  signal?: AbortSignal;
}

export interface AiProviderConnectionResult {
  ok: boolean;
  modelId: string;
  message: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  runTurn(input: AiProviderTurnInput): AsyncIterable<AiProviderEvent>;
  testConnection(modelId: string, signal?: AbortSignal): Promise<AiProviderConnectionResult>;
}

export interface AiTurnRequest {
  campaignId: string;
  conversationId: string;
  content: string;
  retryUserMessageId?: string;
}

export interface AiProposalApplyResult {
  proposal: PendingAiProposal;
  result: TurnTransactionResult | DataChangeTransactionResult;
}

export interface PendingTurnProposal {
  kind: 'turn';
  id: string;
  turnRunId: string;
  campaignId: string;
  conversationId: string;
  transaction: TurnTransaction;
  validation: TurnValidationResult;
  status: 'pending' | 'applied' | 'rejected' | 'manual';
  createdAt: string;
  updatedAt: string;
  appliedEventId: string | null;
}

export type PendingAiProposal = PendingTurnProposal | PendingDataChangeProposal;

export type AiTurnClientEvent =
  | { type: 'started'; runId: string; conversationId: string; userMessageId: string }
  | { type: 'text-delta'; runId: string; delta: string }
  | { type: 'tool-status'; runId: string; name: string; status: 'running' | 'completed' }
  | { type: 'tool-usage'; runId: string; usage: ToolUsageSummary }
  | { type: 'proposal'; runId: string; proposal: PendingAiProposal }
  | { type: 'completed'; runId: string; assistantMessageId: string; proposal: PendingAiProposal | null }
  | { type: 'failed'; runId: string; userMessageId: string; code: string; message: string }
  | { type: 'cancelled'; runId: string };
