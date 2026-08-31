import type { DatabaseSync } from 'node:sqlite';
import type {
  CharacterPanelPreferences,
  CharacterPanelSectionId,
} from '../../shared/read-models';
import { CharacterPanelSectionIds } from '../../shared/read-models';

export class SqliteUiPreferencesRepository {
  constructor(private readonly database: DatabaseSync) {}

  getCharacterPanelPreferences(
    campaignId: string,
    characterId: string,
  ): CharacterPanelPreferences | undefined {
    const row = this.database.prepare(`
      SELECT campaign_id AS campaignId, character_id AS characterId,
             section_order AS sectionOrder, collapsed_sections AS collapsedSections,
             panel_width AS panelWidth, updated_at AS updatedAt
      FROM character_panel_preferences
      WHERE campaign_id = ? AND character_id = ?
    `).get(campaignId, characterId) as unknown as Record<string, unknown> | undefined;
    return row ? mapPreferences(row) : undefined;
  }

  upsertCharacterPanelPreferences(preferences: CharacterPanelPreferences): void {
    this.database.prepare(`
      INSERT INTO character_panel_preferences(
        campaign_id, character_id, section_order, collapsed_sections, panel_width, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(campaign_id, character_id) DO UPDATE SET
        section_order = excluded.section_order,
        collapsed_sections = excluded.collapsed_sections,
        panel_width = excluded.panel_width,
        updated_at = excluded.updated_at
    `).run(
      preferences.campaignId,
      preferences.characterId,
      JSON.stringify(preferences.sectionOrder),
      JSON.stringify(preferences.collapsedSections),
      preferences.panelWidth,
      preferences.updatedAt,
    );
  }
}

function mapPreferences(row: Record<string, unknown>): CharacterPanelPreferences {
  const storedOrder = JSON.parse(String(row.sectionOrder)) as CharacterPanelSectionId[];
  const validStored = storedOrder.filter((section) => (
    (CharacterPanelSectionIds as readonly string[]).includes(section)
  ));
  const missing = CharacterPanelSectionIds.filter((section) => !validStored.includes(section));
  const storedCollapsed = JSON.parse(String(row.collapsedSections)) as CharacterPanelSectionId[];
  return {
    campaignId: String(row.campaignId),
    characterId: String(row.characterId),
    sectionOrder: [...validStored, ...missing],
    collapsedSections: storedCollapsed.filter((section) => (
      (CharacterPanelSectionIds as readonly string[]).includes(section)
    )),
    panelWidth: Number(row.panelWidth),
    updatedAt: String(row.updatedAt),
  };
}
