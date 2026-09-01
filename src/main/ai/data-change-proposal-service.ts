import type { DatabaseSync } from 'node:sqlite';
import { createDomainId } from '../../domain/ids';
import type {
  DataChange,
  DataChangeTransaction,
  PendingDataChangeProposal,
  ProposedDataChangeTransaction,
} from '../../shared/editable-domain';
import { ChronicleEngineError } from '../engine/service';
import { DataChangeService } from '../editable/data-change-service';

export class AiDataChangeProposalService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly dataChanges: DataChangeService,
  ) {}

  buildAndValidate(input: {
    campaignId: string;
    conversationId: string;
    sourceMessageId: string;
    runId: string;
    proposal: ProposedDataChangeTransaction;
  }): { transaction: DataChangeTransaction; validation: ReturnType<DataChangeService['validate']> } {
    const transaction: DataChangeTransaction = {
      id: createDomainId('change'),
      campaignId: input.campaignId,
      origin: 'ai',
      summary: requiredText(input.proposal.summary, 'Souhrn změn', 500),
      changes: (input.proposal.changes ?? []).map(normalizeChange),
      expectedRevisions: input.proposal.expectedRevisions ?? [],
      sourceRunId: input.runId,
      sourceMessageId: input.sourceMessageId,
    };
    const validation = this.dataChanges.validate(transaction);
    return { transaction: validation.normalizedTransaction ?? transaction, validation };
  }

  save(input: {
    runId: string;
    campaignId: string;
    conversationId: string;
    transaction: DataChangeTransaction;
    validation: ReturnType<DataChangeService['validate']>;
    status: PendingDataChangeProposal['status'];
  }): PendingDataChangeProposal {
    const id = createDomainId('proposal');
    const now = timestamp();
    this.database.prepare(`INSERT INTO pending_data_change_proposals(
      id, turn_run_id, campaign_id, conversation_id, transaction_id,
      proposal_json, validation_json, status, created_at, updated_at, applied_transaction_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
      id, input.runId, input.campaignId, input.conversationId, input.transaction.id,
      JSON.stringify(input.transaction), JSON.stringify(input.validation), input.status, now, now,
    );
    return this.get(id)!;
  }

  get(id: string): PendingDataChangeProposal | undefined {
    const row = this.database.prepare(`SELECT id, turn_run_id AS turnRunId,
      campaign_id AS campaignId, conversation_id AS conversationId,
      proposal_json AS proposalJson, validation_json AS validationJson, status,
      created_at AS createdAt, updated_at AS updatedAt,
      applied_transaction_id AS appliedTransactionId
      FROM pending_data_change_proposals WHERE id=?`).get(id) as unknown as ProposalRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  listPending(campaignId: string): PendingDataChangeProposal[] {
    return (this.database.prepare(`SELECT id, turn_run_id AS turnRunId,
      campaign_id AS campaignId, conversation_id AS conversationId,
      proposal_json AS proposalJson, validation_json AS validationJson, status,
      created_at AS createdAt, updated_at AS updatedAt,
      applied_transaction_id AS appliedTransactionId
      FROM pending_data_change_proposals WHERE campaign_id=? AND status='pending'
      ORDER BY created_at DESC`).all(campaignId) as unknown as ProposalRow[]).map(fromRow);
  }

  apply(id: string) {
    const proposal = this.get(id);
    if (!proposal) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Návrh ${id} neexistuje.`);
    if (proposal.status === 'applied') return { proposal, result: this.dataChanges.apply(proposal.transaction) };
    if (proposal.status !== 'pending') throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Návrh už není ke schválení.');
    if (!proposal.validation.valid) throw new ChronicleEngineError('INVALID_INPUT', 'Neplatný návrh nelze použít.');
    const result = this.dataChanges.apply(proposal.transaction);
    this.database.prepare(`UPDATE pending_data_change_proposals SET status='applied',
      applied_transaction_id=?, updated_at=? WHERE id=? AND status='pending'`)
      .run(result.transactionId, timestamp(), id);
    return { proposal: this.get(id)!, result };
  }

  reject(id: string): PendingDataChangeProposal {
    const proposal = this.get(id);
    if (!proposal) throw new ChronicleEngineError('ENTITY_NOT_FOUND', `Návrh ${id} neexistuje.`);
    if (proposal.status !== 'pending') throw new ChronicleEngineError('TRANSACTION_CONFLICT', 'Návrh už není ke schválení.');
    this.database.prepare(`UPDATE pending_data_change_proposals SET status='rejected', updated_at=?
      WHERE id=? AND status='pending'`).run(timestamp(), id);
    return this.get(id)!;
  }
}

interface ProposalRow {
  id: string;
  turnRunId: string;
  campaignId: string;
  conversationId: string;
  proposalJson: string;
  validationJson: string;
  status: PendingDataChangeProposal['status'];
  createdAt: string;
  updatedAt: string;
  appliedTransactionId: string | null;
}

function fromRow(row: ProposalRow): PendingDataChangeProposal {
  return {
    kind: 'data',
    id: row.id,
    turnRunId: row.turnRunId,
    campaignId: row.campaignId,
    conversationId: row.conversationId,
    transaction: JSON.parse(row.proposalJson) as DataChangeTransaction,
    validation: JSON.parse(row.validationJson) as PendingDataChangeProposal['validation'],
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    appliedTransactionId: row.appliedTransactionId,
  };
}

function normalizeChange(value: DataChange): DataChange {
  const change = structuredClone(value) as DataChange & Record<string, unknown>;
  switch (change.type) {
    case 'character.create':
      return { ...change, characterId: nullableId(change.characterId) ?? createDomainId('char') };
    case 'character.class.add':
      return { ...change, classEntryId: nullableId(change.classEntryId) ?? createDomainId('class') };
    case 'character.proficiency.add':
    case 'character.language.add':
      return { ...change, proficiencyId: nullableId(change.proficiencyId) ?? createDomainId('proficiency') };
    case 'character.feature.add':
      return { ...change, featureId: nullableId(change.featureId) ?? createDomainId('feature') };
    case 'character.spellcastingSource.add':
      return { ...change, sourceId: nullableId(change.sourceId) ?? createDomainId('spellsource') };
    case 'character.spell.add':
      return { ...change, characterSpellId: nullableId(change.characterSpellId) ?? createDomainId('spell') };
    case 'ruleDefinition.homebrew.create':
      return { ...change, definitionId: nullableId(change.definitionId) ?? createDomainId('def') };
    default:
      return change;
  }
}

function nullableId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new ChronicleEngineError('INVALID_INPUT', `${label} nesmí být prázdný.`);
  if (value.length > maximum) throw new ChronicleEngineError('OUT_OF_BOUNDS', `${label} je příliš dlouhý.`);
  return value.trim();
}

function timestamp(): string { return new Date().toISOString(); }
