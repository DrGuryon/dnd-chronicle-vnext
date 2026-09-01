import type { DatabaseSync } from 'node:sqlite';
import { createDomainId } from '../../domain/ids';
import type { PendingTurnProposal } from '../../shared/ai';
import type { ProposedTurnTransaction, TurnChange, TurnTransaction } from '../../shared/chronicle-engine';
import { ChronicleEngineError } from '../engine/service';
import { TurnTransactionService } from '../engine/turn-transaction-service';

export class AiProposalService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly transactions: TurnTransactionService,
  ) {}

  buildAndValidate(input: {
    campaignId: string;
    conversationId: string;
    sourceMessageId: string;
    proposal: ProposedTurnTransaction;
  }): { transaction: TurnTransaction; validation: ReturnType<TurnTransactionService['validateTurnTransaction']> } {
    const transaction: TurnTransaction = {
      id: createDomainId('proposal'),
      campaignId: input.campaignId,
      sourceConversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      event: {
        eventType: text(input.proposal.event?.eventType, 'Event type', 120),
        summary: text(input.proposal.event?.summary, 'Event summary', 1200),
        locationId: input.proposal.event?.locationId ?? null,
      },
      changes: (input.proposal.changes ?? []).map(normalizeChange),
      metadata: null,
    };
    const validation = this.transactions.validateTurnTransaction(transaction);
    return { transaction: validation.normalizedTransaction ?? transaction, validation };
  }

  save(input: {
    runId: string;
    campaignId: string;
    conversationId: string;
    transaction: TurnTransaction;
    validation: ReturnType<TurnTransactionService['validateTurnTransaction']>;
    status: PendingTurnProposal['status'];
  }): PendingTurnProposal {
    const id = createDomainId('proposal');
    const now = timestamp();
    this.database.prepare(`
      INSERT INTO pending_turn_proposals(
        id, turn_run_id, campaign_id, conversation_id, transaction_id,
        proposal_json, validation_json, status, created_at, updated_at, applied_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      id,
      input.runId,
      input.campaignId,
      input.conversationId,
      input.transaction.id,
      JSON.stringify(input.transaction),
      JSON.stringify(input.validation),
      input.status,
      now,
      now,
    );
    return this.get(id)!;
  }

  get(id: string): PendingTurnProposal | undefined {
    const row = this.database.prepare(`
      SELECT id, turn_run_id AS turnRunId, campaign_id AS campaignId,
             conversation_id AS conversationId, transaction_id AS transactionId,
             proposal_json AS proposalJson, validation_json AS validationJson,
             status, created_at AS createdAt, updated_at AS updatedAt,
             applied_event_id AS appliedEventId
      FROM pending_turn_proposals WHERE id = ?
    `).get(id) as unknown as ProposalRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  listPending(campaignId: string): PendingTurnProposal[] {
    return (this.database.prepare(`
      SELECT id, turn_run_id AS turnRunId, campaign_id AS campaignId,
             conversation_id AS conversationId, transaction_id AS transactionId,
             proposal_json AS proposalJson, validation_json AS validationJson,
             status, created_at AS createdAt, updated_at AS updatedAt,
             applied_event_id AS appliedEventId
      FROM pending_turn_proposals
      WHERE campaign_id = ? AND status = 'pending'
      ORDER BY created_at DESC
    `).all(campaignId) as unknown as ProposalRow[]).map(fromRow);
  }

  apply(id: string) {
    const proposal = this.get(id);
    if (!proposal) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Návrh ${id} neexistuje.`);
    if (proposal.status === 'applied') {
      return { proposal, result: this.transactions.applyTurnTransaction(proposal.transaction) };
    }
    if (proposal.status !== 'pending') {
      throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Návrh už není ve stavu ke schválení.');
    }
    if (!proposal.validation.valid) {
      throw new ChronicleEngineError('INVALID_INPUT', 'Neplatný návrh nelze použít.');
    }
    const result = this.transactions.applyTurnTransaction(proposal.transaction);
    this.database.prepare(`
      UPDATE pending_turn_proposals
      SET status = 'applied', applied_event_id = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(result.eventId, timestamp(), id);
    return { proposal: this.get(id)!, result };
  }

  reject(id: string): PendingTurnProposal {
    this.requirePending(id);
    this.database.prepare(`
      UPDATE pending_turn_proposals SET status = 'rejected', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(timestamp(), id);
    return this.get(id)!;
  }

  private requirePending(id: string): PendingTurnProposal {
    const proposal = this.get(id);
    if (!proposal) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Návrh ${id} neexistuje.`);
    if (proposal.status !== 'pending') {
      throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Návrh už není ve stavu ke schválení.');
    }
    return proposal;
  }
}

interface ProposalRow {
  id: string;
  turnRunId: string;
  campaignId: string;
  conversationId: string;
  transactionId: string;
  proposalJson: string;
  validationJson: string;
  status: PendingTurnProposal['status'];
  createdAt: string;
  updatedAt: string;
  appliedEventId: string | null;
}

function fromRow(row: ProposalRow): PendingTurnProposal {
  return {
    kind: 'turn',
    id: row.id,
    turnRunId: row.turnRunId,
    campaignId: row.campaignId,
    conversationId: row.conversationId,
    transaction: JSON.parse(row.proposalJson) as TurnTransaction,
    validation: JSON.parse(row.validationJson) as PendingTurnProposal['validation'],
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedEventId: row.appliedEventId,
  };
}

function normalizeChange(change: TurnChange): TurnChange {
  const copy = structuredClone(change);
  switch (copy.type) {
    case 'effect.add': return { ...copy, effectId: copy.effectId ?? createDomainId('effect') };
    case 'relation.add': return { ...copy, relationId: copy.relationId ?? createDomainId('relation') };
    case 'knowledge.add': return { ...copy, knowledgeId: copy.knowledgeId ?? createDomainId('knowledge') };
    case 'actorRelationship.upsert': return {
      ...copy,
      relationId: copy.relationId ?? createDomainId('relation'),
      relationshipId: copy.relationshipId ?? createDomainId('relationship'),
    };
    default: return copy;
  }
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdný.`);
  if (value.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhý.`);
  return value.trim();
}

function timestamp(): string { return new Date().toISOString(); }
