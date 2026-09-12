import { call, localKeys } from './repository';

// NULL fields mean "not set"; the frontend falls back to its defaults. The
// row itself is null only when preferences were never initialized, which is
// what authorizes the one-time localStorage import.
export interface LocalPreferences {
    databaseVersion: number;
    darkMode: boolean | null;
    editorMarginPx: number | null;
    editorLineHeight: number | null;
    aiContinueContextChars: number | null;
    aiContinueOutputChars: number | null;
    autoHighlight: { disabledRoles: string[] } | null;
    updatedAt?: number;
}
export interface SavePreferencesInput {
    expectedDatabaseVersion: number;
    darkMode: boolean | null;
    editorMarginPx: number | null;
    editorLineHeight: number | null;
    aiContinueContextChars: number | null;
    aiContinueOutputChars: number | null;
    autoHighlight: { disabledRoles: string[] } | null;
    sessionKey: string;
    revision: number;
}
export const preferencesKey = [...localKeys.all, 'preferences'] as const;
export const preferencesRepository = {
    read: () => call<LocalPreferences | null>('local_read_preferences'),
    save: (input: SavePreferencesInput) =>
        call<{ preferences: LocalPreferences; sessionKey: string; revision: number }>('local_save_preferences', { input }),
};
