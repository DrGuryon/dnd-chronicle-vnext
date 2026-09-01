import type { DatabaseSync } from 'node:sqlite';
import type { AiUsage, ToolUsageSummary } from '../../shared/ai';

export interface AiTurnRunStart {
  id: string;
  campaignId: string;
  conversationId: string;
  userMessageId: string;
  provider: string;
  modelId: string;
  promptVersion: string;
}

export class AiTurnRunStore {
  constructor(private readonly database: DatabaseSync) {}

  start(input: AiTurnRunStart): void {
    this.database.prepare(`
      INSERT INTO ai_turn_runs(
        id, campaign_id, conversation_id, user_message_id, assistant_message_id,
        provider, model_id, prompt_version, status, transaction_id,
        provider_response_id, started_at, completed_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'running', NULL, NULL, ?, NULL)
    `).run(
      input.id,
      input.campaignId,
      input.conversationId,
      input.userMessageId,
      input.provider,
      input.modelId,
      input.promptVersion,
      timestamp(),
    );
  }

  finish(input: {
    id: string;
    status: 'completed' | 'pending_review';
    assistantMessageId: string;
    providerResponseId: string | null;
    transactionId: string | null;
    usage: AiUsage;
    toolUsage: ToolUsageSummary;
  }): void {
    this.database.prepare(`
      UPDATE ai_turn_runs SET
        assistant_message_id = ?, status = ?, transaction_id = ?,
        provider_response_id = ?, input_tokens = ?, output_tokens = ?,
        reasoning_tokens = ?, cached_input_tokens = ?, tool_usage_json = ?, completed_at = ?
      WHERE id = ?
    `).run(
      input.assistantMessageId,
      input.status,
      input.transactionId,
      input.providerResponseId,
      input.usage.inputTokens,
      input.usage.outputTokens,
      input.usage.reasoningTokens,
      input.usage.cachedInputTokens,
      JSON.stringify(input.toolUsage),
      timestamp(),
      input.id,
    );
  }

  fail(id: string, status: 'failed' | 'cancelled', errorCode: string | null): void {
    this.database.prepare(`
      UPDATE ai_turn_runs SET status = ?, error_code = ?, completed_at = ? WHERE id = ?
    `).run(status, errorCode, timestamp(), id);
  }

  markProposalApplied(runId: string): void {
    this.database.prepare(`
      UPDATE ai_turn_runs SET status = 'completed', completed_at = ? WHERE id = ?
    `).run(timestamp(), runId);
  }
}

function timestamp(): string { return new Date().toISOString(); }
