import type { DatabaseSync } from 'node:sqlite';
import {
  supportedApplicationLocales,
  supportedEncyclopediaLocales,
  type LanguagePreferences,
  type LanguagePreferencesInput,
  type SupportedApplicationLocale,
  type SupportedEncyclopediaLocale,
} from '../../shared/languages';

const metadataKey = 'language_preferences';
const defaultApplicationLocale: SupportedApplicationLocale = 'cs';
const defaultEncyclopediaLocales: SupportedEncyclopediaLocale[] = ['cs', 'en'];

export class LanguagePreferencesService {
  constructor(private readonly database: DatabaseSync) {}

  get(): LanguagePreferences {
    const row = this.database.prepare(`
      SELECT value FROM application_metadata WHERE key = ?
    `).get(metadataKey) as { value: string } | undefined;
    if (!row) return this.withAvailability(defaults());
    try {
      const parsed = JSON.parse(row.value) as Partial<LanguagePreferencesInput>;
      return this.withAvailability(normalize(parsed));
    } catch {
      return this.withAvailability(defaults());
    }
  }

  save(input: LanguagePreferencesInput): LanguagePreferences {
    const preferences = normalize(input, true);
    this.database.prepare(`
      INSERT INTO application_metadata(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `).run(metadataKey, JSON.stringify({
      applicationLocale: preferences.applicationLocale,
      encyclopediaLocales: preferences.encyclopediaLocales,
    }), new Date().toISOString());
    return this.withAvailability(preferences);
  }

  private withAvailability(preferences: LanguagePreferences): LanguagePreferences {
    const rows = this.database.prepare(`
      SELECT DISTINCT document.locale
      FROM rule_definition_documents document
      JOIN rule_definitions definition ON definition.id = document.definition_id
      JOIN rules_pack_installations installation
        ON installation.pack_id = definition.pack_id
       AND installation.version = definition.pack_version
       AND installation.active = 1
      ORDER BY document.locale
    `).all() as Array<{ locale: string }>;
    return { ...preferences, availableContentLocales: rows.map((row) => row.locale) };
  }
}

function normalize(
  input: Partial<LanguagePreferencesInput>,
  strict = false,
): LanguagePreferences {
  const applicationLocale = applicationLocaleValue(input.applicationLocale);
  const requestedLocales = Array.isArray(input.encyclopediaLocales)
    ? input.encyclopediaLocales
    : [];
  const invalid = requestedLocales.some((locale) => !encyclopediaLocaleValue(locale));
  const encyclopediaLocales = [...new Set(requestedLocales.map(encyclopediaLocaleValue).filter(
    (locale): locale is SupportedEncyclopediaLocale => Boolean(locale),
  ))];
  if (strict && !applicationLocale) {
    throw new Error('Jazyk aplikace není podporovaný.');
  }
  if (strict && (invalid || encyclopediaLocales.length === 0)) {
    throw new Error('Jazyky encyklopedie musí obsahovat alespoň jeden podporovaný jazyk bez duplicit.');
  }
  return {
    applicationLocale: applicationLocale ?? defaultApplicationLocale,
    encyclopediaLocales: encyclopediaLocales.length ? encyclopediaLocales : [...defaultEncyclopediaLocales],
    supportedApplicationLocales: [...supportedApplicationLocales],
    supportedEncyclopediaLocales: [...supportedEncyclopediaLocales],
    supportedLocales: [...supportedEncyclopediaLocales],
    availableContentLocales: [],
  };
}

function normalizedLocale(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toLocaleLowerCase('en-US');
}

function applicationLocaleValue(value: unknown): SupportedApplicationLocale | undefined {
  const normalized = normalizedLocale(value);
  return normalized && (supportedApplicationLocales as readonly string[]).includes(normalized)
    ? normalized as SupportedApplicationLocale : undefined;
}

function encyclopediaLocaleValue(value: unknown): SupportedEncyclopediaLocale | undefined {
  const normalized = normalizedLocale(value);
  return normalized && (supportedEncyclopediaLocales as readonly string[]).includes(normalized)
    ? normalized as SupportedEncyclopediaLocale : undefined;
}

function defaults(): LanguagePreferences {
  return {
    applicationLocale: defaultApplicationLocale,
    encyclopediaLocales: [...defaultEncyclopediaLocales],
    supportedApplicationLocales: [...supportedApplicationLocales],
    supportedEncyclopediaLocales: [...supportedEncyclopediaLocales],
    supportedLocales: [...supportedEncyclopediaLocales],
    availableContentLocales: [],
  };
}
