import type { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'create_campaign_storage',
    up(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS application_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS campaigns (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT
        ) STRICT;

        CREATE INDEX IF NOT EXISTS campaigns_updated_at_idx
          ON campaigns(updated_at DESC);
      `);
    },
  },
];

export const latestSchemaVersion = migrations.at(-1)?.version ?? 0;
