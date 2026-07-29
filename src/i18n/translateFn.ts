import type { TranslateParams, TranslationKey } from "./translate";

// Extracted so pure content modules (src/content/*) can accept a translator as a parameter
// without importing the full i18n runtime module (react/expo-localization), just its type.
export type TranslateFn = (key: TranslationKey, params?: TranslateParams) => string;
