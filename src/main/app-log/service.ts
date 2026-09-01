import type { DatabaseSync } from 'node:sqlite';
import type {
  AppLogEntry,
  AppLogPage,
  AppLogQuery,
  AppLogWrite,
} from '../../shared/app-log';

interface CountRow { count: number }

interface LogRow {
  id: number;
  created_at: string;
  severity: AppLogEntry['severity'];
  category: AppLogEntry['category'];
  campaign_id: string | null;
  event: string;
  message: string;
  details_json: string | null;
}

const MAX_ENTRIES = 10_000;
const MAX_AGE_DAYS = 90;
const SENSITIVE_KEY = /(api.?key|authorization|credential|password|secret|token|cookie|chain.?of.?thought|reasoning.?content|raw.?request)/i;

export class AppLogService {
  constructor(private readonly database: DatabaseSync) {}

  write(input: AppLogWrite): AppLogEntry {
    const createdAt = new Date().toISOString();
    const details = input.details ? sanitizeDetails(input.details) : null;
    const result = this.database.prepare(`
      INSERT INTO app_log_entries(created_at, severity, category, campaign_id, event, message, details_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      createdAt,
      input.severity,
      input.category,
      input.campaignId ?? null,
      cleanText(input.event, 120),
      cleanText(input.message, 2_000),
      details ? JSON.stringify(details) : null,
    );
    this.prune();
    return this.get(Number(result.lastInsertRowid));
  }

  query(input: AppLogQuery = {}): AppLogPage {
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (input.severity) { clauses.push('severity = ?'); values.push(input.severity); }
    if (input.category) { clauses.push('category = ?'); values.push(input.category); }
    if (input.campaignId) { clauses.push('campaign_id = ?'); values.push(input.campaignId); }
    if (input.search?.trim()) {
      clauses.push('(message LIKE ? ESCAPE \'\\\' OR event LIKE ? ESCAPE \'\\\')');
      const search = `%${escapeLike(input.search.trim())}%`;
      values.push(search, search);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (this.database.prepare(`SELECT COUNT(*) AS count FROM app_log_entries ${where}`).get(...values) as unknown as CountRow).count;
    const rows = this.database.prepare(`
      SELECT id, created_at, severity, category, campaign_id, event, message, details_json
      FROM app_log_entries ${where}
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as unknown as LogRow[];
    return {
      items: rows.map(mapRow),
      total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    };
  }

  clear(): number {
    return Number(this.database.prepare('DELETE FROM app_log_entries').run().changes);
  }

  export(input: AppLogQuery = {}): readonly AppLogEntry[] {
    const items: AppLogEntry[] = [];
    let offset = 0;
    while (items.length < MAX_ENTRIES) {
      const page = this.query({ ...input, offset, limit: 200 });
      items.push(...page.items);
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    return items;
  }

  private get(id: number): AppLogEntry {
    const row = this.database.prepare(`
      SELECT id, created_at, severity, category, campaign_id, event, message, details_json
      FROM app_log_entries WHERE id = ?
    `).get(id) as unknown as LogRow;
    return mapRow(row);
  }

  private prune(): void {
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000).toISOString();
    this.database.prepare('DELETE FROM app_log_entries WHERE created_at < ?').run(cutoff);
    this.database.prepare(`
      DELETE FROM app_log_entries WHERE id IN (
        SELECT id FROM app_log_entries ORDER BY id DESC LIMIT -1 OFFSET ?
      )
    `).run(MAX_ENTRIES);
  }
}

function mapRow(row: LogRow): AppLogEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    severity: row.severity,
    category: row.category,
    campaignId: row.campaign_id,
    event: row.event,
    message: row.message,
    details: row.details_json ? JSON.parse(row.details_json) as Record<string, unknown> : null,
  };
}

function sanitizeDetails(value: Record<string, unknown>): Record<string, unknown> {
  const walk = (item: unknown, depth: number): unknown => {
    if (depth > 5) return '[zkráceno]';
    if (Array.isArray(item)) return item.slice(0, 50).map((entry) => walk(entry, depth + 1));
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .slice(0, 50)
        .map(([key, entry]) => [key, walk(entry, depth + 1)]));
    }
    if (typeof item === 'string') return cleanText(item, 2_000);
    return item;
  };
  return walk(value, 0) as Record<string, unknown>;
}

function cleanText(value: string, max: number): string {
  return value.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
