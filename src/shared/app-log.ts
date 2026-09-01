export const appLogSeverities = ['info', 'success', 'warning', 'error'] as const;
export type AppLogSeverity = (typeof appLogSeverities)[number];

export const appLogCategories = ['application', 'ai', 'updater', 'rules-pack', 'data'] as const;
export type AppLogCategory = (typeof appLogCategories)[number];

export interface AppLogEntry {
  id: number;
  createdAt: string;
  severity: AppLogSeverity;
  category: AppLogCategory;
  campaignId: string | null;
  event: string;
  message: string;
  details: Record<string, unknown> | null;
}

export interface AppLogQuery {
  severity?: AppLogSeverity;
  category?: AppLogCategory;
  campaignId?: string;
  search?: string;
  offset?: number;
  limit?: number;
}

export interface AppLogPage {
  items: readonly AppLogEntry[];
  total: number;
  nextOffset: number | null;
}

export interface AppLogWrite {
  severity: AppLogSeverity;
  category: AppLogCategory;
  campaignId?: string | null;
  event: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export type AppLogExportFormat = 'json' | 'txt';
