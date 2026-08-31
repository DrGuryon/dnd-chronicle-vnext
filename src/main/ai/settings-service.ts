import type { DatabaseSync } from 'node:sqlite';
import type {
  AiReasoningEffort,
  AiVerbosity,
  CampaignAiSettings,
  CampaignAiSettingsUpdate,
} from '../../shared/ai';
import type { ApprovalPolicy } from '../../shared/chronicle-engine';
import { ChronicleEngineError } from '../engine/service';

export class CampaignAiSettingsService {
  constructor(private readonly database: DatabaseSync) {}

  get(campaignId: string): CampaignAiSettings {
    this.requireCampaign(campaignId);
    this.ensureRow(campaignId);
    return this.database.prepare(`
      SELECT campaign_id AS campaignId, provider, model_id AS modelId,
             reasoning_effort AS reasoningEffort, verbosity,
             max_output_tokens AS maxOutputTokens,
             approval_policy AS approvalPolicy,
             campaign_instructions AS campaignInstructions,
             updated_at AS updatedAt
      FROM campaign_ai_settings WHERE campaign_id = ?
    `).get(campaignId) as unknown as CampaignAiSettings;
  }

  update(campaignId: string, update: CampaignAiSettingsUpdate): CampaignAiSettings {
    const current = this.get(campaignId);
    const modelId = normalizeText(update.modelId ?? current.modelId, 'Model ID', 120);
    const reasoningEffort = enumValue(
      update.reasoningEffort ?? current.reasoningEffort,
      ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const,
      'Reasoning effort',
    );
    const verbosity = enumValue(
      update.verbosity ?? current.verbosity,
      ['low', 'medium', 'high'] as const,
      'Verbosity',
    );
    const approvalPolicy = enumValue(
      update.approvalPolicy ?? current.approvalPolicy,
      ['automatic', 'review', 'manual'] as const,
      'Approval policy',
    );
    const maxOutputTokens = update.maxOutputTokens ?? current.maxOutputTokens;
    if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 32_768) {
      throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Max output tokens musí být mezi 256 a 32768.');
    }
    const campaignInstructions = (update.campaignInstructions ?? current.campaignInstructions).trim();
    if (campaignInstructions.length > 12_000) {
      throw new ChronicleEngineError('OUT_OF_BOUNDS', 'Pokyny kampaně mohou mít nejvýše 12000 znaků.');
    }
    this.database.prepare(`
      UPDATE campaign_ai_settings
      SET model_id = ?, reasoning_effort = ?, verbosity = ?, max_output_tokens = ?,
          approval_policy = ?, campaign_instructions = ?, updated_at = ?
      WHERE campaign_id = ?
    `).run(
      modelId,
      reasoningEffort satisfies AiReasoningEffort,
      verbosity satisfies AiVerbosity,
      maxOutputTokens,
      approvalPolicy satisfies ApprovalPolicy,
      campaignInstructions,
      timestamp(),
      campaignId,
    );
    return this.get(campaignId);
  }

  private ensureRow(campaignId: string): void {
    this.database.prepare(`
      INSERT OR IGNORE INTO campaign_ai_settings(campaign_id, updated_at)
      VALUES (?, ?)
    `).run(campaignId, timestamp());
  }

  private requireCampaign(campaignId: string): void {
    if (!this.database.prepare('SELECT 1 FROM campaigns WHERE id = ?').get(campaignId)) {
      throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Campaign ${campaignId} neexistuje.`);
    }
  }
}

function normalizeText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdné.`);
  if (normalized.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhé.`);
  return normalized;
}

function enumValue<const T extends readonly string[]>(value: string, allowed: T, label: string): T[number] {
  if (!allowed.includes(value)) throw new ChronicleEngineError('INVALID_INPUT', `${label} má neplatnou hodnotu.`);
  return value as T[number];
}

function timestamp(): string { return new Date().toISOString(); }
