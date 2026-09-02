export const supportedApplicationLocales = ['cs', 'en'] as const;
export const supportedEncyclopediaLocales = ['cs', 'en', 'de', 'es', 'fr', 'it'] as const;

export type SupportedApplicationLocale = (typeof supportedApplicationLocales)[number];
export type SupportedEncyclopediaLocale = (typeof supportedEncyclopediaLocales)[number];

export interface LanguagePreferencesInput {
  applicationLocale: string;
  encyclopediaLocales: readonly string[];
}

export interface LanguagePreferences {
  applicationLocale: SupportedApplicationLocale;
  encyclopediaLocales: SupportedEncyclopediaLocale[];
  supportedApplicationLocales: SupportedApplicationLocale[];
  supportedEncyclopediaLocales: SupportedEncyclopediaLocale[];
  /** Compatibility alias for encyclopedia locale pickers. */
  supportedLocales: SupportedEncyclopediaLocale[];
  /** Locales with at least one document in an active rules pack. */
  availableContentLocales: string[];
}
