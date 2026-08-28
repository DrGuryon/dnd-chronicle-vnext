import type {
  CharacterPanelPreferences,
  CharacterPanelPreferencesInput,
  CharacterPanelSectionId,
} from '../../shared/read-models';
import { CharacterPanelSectionIds } from '../../shared/read-models';
import { SqliteChronicleRepository } from '../domain/repository';
import { ChronicleDomainService } from '../domain/service';
import { SqliteUiPreferencesRepository } from './repository';

const defaultCollapsed: CharacterPanelSectionId[] = [
  'bonusActions',
  'reactions',
  'inventory',
  'defenses',
  'proficiencies',
  'languages',
  'notes',
];

export class UiPreferencesService {
  constructor(
    private readonly repository: SqliteUiPreferencesRepository,
    private readonly domain: ChronicleDomainService,
    private readonly transactionRepository: SqliteChronicleRepository,
  ) {}

  getCharacterPanelPreferences(campaignId: string, characterId: string): CharacterPanelPreferences {
    this.requireCharacter(campaignId, characterId);
    return this.repository.getCharacterPanelPreferences(campaignId, characterId)
      ?? defaultPreferences(campaignId, characterId);
  }

  saveCharacterPanelPreferences(input: CharacterPanelPreferencesInput): CharacterPanelPreferences {
    return this.transactionRepository.transaction(() => {
      this.requireCharacter(input.campaignId, input.characterId);
      const sectionOrder = validateSectionOrder(input.sectionOrder);
      const collapsedSections = validateCollapsedSections(input.collapsedSections);
      if (!Number.isInteger(input.panelWidth) || input.panelWidth < 300 || input.panelWidth > 720) {
        throw new Error('Šířka panelu musí být celé číslo od 300 do 720 px.');
      }
      const preferences: CharacterPanelPreferences = {
        campaignId: input.campaignId,
        characterId: input.characterId,
        sectionOrder,
        collapsedSections,
        panelWidth: input.panelWidth,
        updatedAt: new Date().toISOString(),
      };
      this.repository.upsertCharacterPanelPreferences(preferences);
      return preferences;
    });
  }

  private requireCharacter(campaignId: string, characterId: string): void {
    const campaign = this.domain.getCampaign(campaignId);
    if (!campaign) throw new Error(`Kampaň ${campaignId} neexistuje.`);
    const character = this.domain.getCharacter(characterId);
    if (!character || character.campaignId !== campaignId) {
      throw new Error(`Character ${characterId} nepatří do kampaně ${campaignId}.`);
    }
  }
}

function defaultPreferences(campaignId: string, characterId: string): CharacterPanelPreferences {
  return {
    campaignId,
    characterId,
    sectionOrder: [...CharacterPanelSectionIds],
    collapsedSections: [...defaultCollapsed],
    panelWidth: 410,
    updatedAt: '',
  };
}

function validateSectionOrder(value: readonly CharacterPanelSectionId[]): CharacterPanelSectionId[] {
  const allowed = new Set<string>(CharacterPanelSectionIds);
  const normalized = [...value];
  if (
    normalized.length !== CharacterPanelSectionIds.length
    || new Set(normalized).size !== normalized.length
    || normalized.some((section) => !allowed.has(section))
  ) {
    throw new Error('Pořadí sekcí musí obsahovat každou podporovanou sekci právě jednou.');
  }
  return normalized;
}

function validateCollapsedSections(
  value: readonly CharacterPanelSectionId[],
): CharacterPanelSectionId[] {
  const allowed = new Set<string>(CharacterPanelSectionIds);
  const normalized = [...new Set(value)];
  if (normalized.some((section) => !allowed.has(section))) {
    throw new Error('Collapsed sections obsahují nepodporovanou sekci.');
  }
  return normalized;
}
