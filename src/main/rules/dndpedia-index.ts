import type { DatabaseSync } from 'node:sqlite';

export function rebuildDndpediaSearchIndex(database: DatabaseSync): void {
  database.exec(`
    DELETE FROM dndpedia_fts;
    INSERT INTO dndpedia_fts(
      definition_id, canonical_id, name, aliases, short_description,
      full_description, search_text
    )
    SELECT definition.id, definition.canonical_id, definition.name,
           definition.aliases, definition.description,
           coalesce(document.full_description, ''), coalesce(document.search_text, '')
    FROM rule_definitions definition
    JOIN rules_pack_installations installation
      ON installation.pack_id = definition.pack_id
     AND installation.version = definition.pack_version
     AND installation.active = 1
    LEFT JOIN rule_definition_documents document
      ON document.definition_id = definition.id
     AND document.locale = definition.locale
    WHERE definition.is_builtin = 1
      AND definition.is_homebrew = 0
      AND definition.campaign_id IS NULL
      AND definition.canonical_id IS NOT NULL;
  `);
}
