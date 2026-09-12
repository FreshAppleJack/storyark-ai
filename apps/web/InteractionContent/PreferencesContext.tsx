/* eslint-disable react-refresh/only-export-components -- provider + hook
   pairs stay together by design (same pattern as the legacy AppContext). */
import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { toast } from 'react-hot-toast';
import {
    EditorSpacingSettings, AiContinueSettings, AutoHighlightSettings, CharacterRole,
} from '../types';
import {
    DEFAULT_EDITOR_SPACING_SETTINGS, DEFAULT_AI_CONTINUE_SETTINGS,
    normalizeEditorSpacingSettings, normalizeAiContinueSettings, normalizeAutoHighlightSettings,
} from '../domain/preferences';
import { accountApi } from '../data/accountApi';
import { LocalStorageError } from '../data/local/repository';
import { preferencesRepository, type LocalPreferences } from '../data/local/preferencesRepository';
import { useSession } from './SessionContext';

interface PreferencesContextType {
    isDarkMode: boolean;
    editorSpacingSettings: EditorSpacingSettings;
    aiContinueSettings: AiContinueSettings;
    autoHighlightSettings: AutoHighlightSettings;
    toggleDarkMode: () => void;
    setDarkMode: (enabled: boolean) => void;
    updateEditorSpacingSettings: (settings: Partial<EditorSpacingSettings>) => void;
    updateAiContinueSettings: (settings: Partial<AiContinueSettings>) => void;
    setAutoHighlightRoleEnabled: (role: CharacterRole, enabled: boolean) => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

// Known localStorage keys of this origin. On desktop they are a launch cache
// (notably storyark_dark_mode, read before React mounts to avoid theme
// flicker); SQLite is the persistence authority. The cache never feeds the
// database except during the one-time import, and browser dev origins never
// share data with the desktop origin.
const STORAGE_KEYS = {
    darkMode: 'storyark_dark_mode',
    spacing: 'storyark_editor_spacing',
    aiContinue: 'storyark_ai_continue',
    autoHighlight: 'storyark_auto_highlight',
} as const;

const loadEditorSpacingSettingsFromStorage = (): EditorSpacingSettings => {
    try {
        return normalizeEditorSpacingSettings(JSON.parse(localStorage.getItem(STORAGE_KEYS.spacing) || 'null'));
    } catch {
        return DEFAULT_EDITOR_SPACING_SETTINGS;
    }
};

const loadAutoHighlightSettingsFromStorage = (): AutoHighlightSettings => {
    try {
        return normalizeAutoHighlightSettings(JSON.parse(localStorage.getItem(STORAGE_KEYS.autoHighlight) || 'null'));
    } catch {
        return { disabledRoles: [] };
    }
};

const loadAiContinueSettingsFromStorage = (): AiContinueSettings => {
    try {
        return normalizeAiContinueSettings(JSON.parse(localStorage.getItem(STORAGE_KEYS.aiContinue) || 'null'));
    } catch {
        return DEFAULT_AI_CONTINUE_SETTINGS;
    }
};

interface PreferenceValues {
    isDarkMode: boolean;
    editorSpacingSettings: EditorSpacingSettings;
    aiContinueSettings: AiContinueSettings;
    autoHighlightSettings: AutoHighlightSettings;
}

/**
 * Owns user preferences. State updates apply instantly (visual preview is not
 * persistence); on desktop every change is serialized through a save queue to
 * the single-row SQLite preferences with an optimistic version. Failures are
 * announced and never reported as saved; the visible choice stays so the user
 * can retry, while SQLite keeps the previous value.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const { user } = useSession();
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => localStorage.getItem(STORAGE_KEYS.darkMode) === 'true');
    const [editorSpacingSettings, setEditorSpacingSettings] = useState<EditorSpacingSettings>(loadEditorSpacingSettingsFromStorage);
    const [aiContinueSettings, setAiContinueSettings] = useState<AiContinueSettings>(loadAiContinueSettingsFromStorage);
    const [autoHighlightSettings, setAutoHighlightSettings] = useState<AutoHighlightSettings>(loadAutoHighlightSettingsFromStorage);

    const version = useRef(0);
    const loaded = useRef(false);
    const dirtySinceLoad = useRef(false);
    const session = useRef(crypto.randomUUID());
    const revision = useRef(0);
    const queue = useRef<Promise<void>>(Promise.resolve());
    // Keys whose raw localStorage values are preserved because they were
    // unreadable during the one-time import; cache writes skip them until the
    // user sets a replacement value through the UI.
    const preservedRawKeys = useRef(new Set<string>());
    const latest = useRef<PreferenceValues>({ isDarkMode, editorSpacingSettings, aiContinueSettings, autoHighlightSettings });
    useLayoutEffect(() => {
        latest.current = { isDarkMode, editorSpacingSettings, aiContinueSettings, autoHighlightSettings };
    }, [isDarkMode, editorSpacingSettings, aiContinueSettings, autoHighlightSettings]);

    // Callers pass the values they just computed (setState is async; the
    // queue serializes writes so each save builds on the previous version).
    const persist = useCallback((values: PreferenceValues) => {
        if (!isTauri()) return;
        // While the stored row is still loading nothing may write — defaults
        // must never race ahead and overwrite real preferences.
        if (!loaded.current) { dirtySinceLoad.current = true; return; }
        queue.current = queue.current.then(async () => {
            const rev = ++revision.current;
            try {
                const result = await preferencesRepository.save({
                    expectedDatabaseVersion: version.current,
                    darkMode: values.isDarkMode,
                    editorMarginPx: values.editorSpacingSettings.editorMarginPx,
                    editorLineHeight: values.editorSpacingSettings.editorLineHeight,
                    aiContinueContextChars: values.aiContinueSettings.contextChars,
                    aiContinueOutputChars: values.aiContinueSettings.outputChars,
                    autoHighlight: values.autoHighlightSettings,
                    sessionKey: session.current, revision: rev,
                });
                if (result.sessionKey === session.current) version.current = result.preferences.databaseVersion;
            } catch (error) {
                toast.error(error instanceof LocalStorageError && error.code === 'VERSION_CONFLICT'
                    ? 'Preferences changed in another window. Reload to sync before editing further.'
                    : 'Could not save this preference. The change is visible but not stored — try it again.');
            }
        });
    }, []);

    // Desktop bootstrap: read the authority row once. A missing row runs the
    // one-time localStorage import; an existing row is adopted as-is.
    useEffect(() => {
        if (!isTauri()) return;
        let active = true;
        const applyRow = (row: LocalPreferences) => {
            version.current = row.databaseVersion;
            setIsDarkMode(row.darkMode ?? false);
            setEditorSpacingSettings(normalizeEditorSpacingSettings({
                editorMarginPx: row.editorMarginPx ?? undefined,
                editorLineHeight: row.editorLineHeight ?? undefined,
            }));
            setAiContinueSettings(normalizeAiContinueSettings({
                contextChars: row.aiContinueContextChars ?? undefined,
                outputChars: row.aiContinueOutputChars ?? undefined,
            }));
            setAutoHighlightSettings(normalizeAutoHighlightSettings(row.autoHighlight as Partial<AutoHighlightSettings> | null));
        };
        const bootstrap = async () => {
            try {
                const row = await preferencesRepository.read();
                if (!active) return;
                if (row) {
                    version.current = row.databaseVersion;
                    loaded.current = true;
                    // A change made while the row was loading wins over the
                    // stored values and is persisted; otherwise adopt the row.
                    if (dirtySinceLoad.current) {
                        dirtySinceLoad.current = false;
                        persist(latest.current);
                    } else {
                        applyRow(row);
                    }
                    return;
                }
                // One-time import of this origin's known localStorage keys.
                // Unreadable entries fall back to defaults with notice, and
                // their raw values stay untouched.
                const corrupted: string[] = [];
                const parseJson = <T,>(key: string, normalize: (raw: unknown) => T): T | null => {
                    const raw = localStorage.getItem(key);
                    if (raw === null) return null;
                    try { return normalize(JSON.parse(raw)); } catch {
                        corrupted.push(key);
                        preservedRawKeys.current.add(key);
                        return null;
                    }
                };
                const rawDark = localStorage.getItem(STORAGE_KEYS.darkMode);
                let darkMode: boolean | null = null;
                if (rawDark === 'true' || rawDark === 'false') darkMode = rawDark === 'true';
                else if (rawDark !== null) {
                    corrupted.push(STORAGE_KEYS.darkMode);
                    preservedRawKeys.current.add(STORAGE_KEYS.darkMode);
                }
                const spacing = parseJson(STORAGE_KEYS.spacing, raw => normalizeEditorSpacingSettings(raw as Partial<EditorSpacingSettings> | null));
                const aiContinue = parseJson(STORAGE_KEYS.aiContinue, raw => normalizeAiContinueSettings(raw as Partial<AiContinueSettings> | null));
                const autoHighlight = parseJson(STORAGE_KEYS.autoHighlight, raw => normalizeAutoHighlightSettings(raw as Partial<AutoHighlightSettings> | null));
                const result = await preferencesRepository.save({
                    expectedDatabaseVersion: 0,
                    darkMode,
                    editorMarginPx: spacing?.editorMarginPx ?? null,
                    editorLineHeight: spacing?.editorLineHeight ?? null,
                    aiContinueContextChars: aiContinue?.contextChars ?? null,
                    aiContinueOutputChars: aiContinue?.outputChars ?? null,
                    autoHighlight: autoHighlight ?? null,
                    sessionKey: session.current,
                    revision: ++revision.current,
                });
                if (!active) return;
                version.current = result.preferences.databaseVersion;
                loaded.current = true;
                if (corrupted.length) {
                    toast('Some saved preferences could not be read and were reset to defaults. The original values were kept.', { icon: '⚠️' });
                }
                // State already matches the imported localStorage values.
            } catch (error) {
                if (!active) return;
                // A conflict means another session initialized first: adopt the
                // stored row, never overwrite it. Other failures keep the
                // localStorage values and retry the import on the next launch.
                if (error instanceof LocalStorageError && error.code === 'VERSION_CONFLICT') {
                    try {
                        const row = await preferencesRepository.read();
                        if (active && row) { applyRow(row); loaded.current = true; }
                    } catch { /* Retry on the next launch. */ }
                }
            }
            if (active && loaded.current && dirtySinceLoad.current) {
                dirtySinceLoad.current = false;
                persist(latest.current);
            }
        };
        void bootstrap();
        return () => { active = false; };
    }, [persist]);

    // Launch-cache writes. The first run is skipped: state already came from
    // localStorage, so writing it back can only clobber raw values the import
    // has not inspected yet (defaults must never race ahead). Keys preserved
    // from a failed import keep their original raw values until the user
    // replaces them through the UI.
    const cacheReady = useRef({ darkMode: false, spacing: false, aiContinue: false, autoHighlight: false });
    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode);
        document.body.style.backgroundColor = isDarkMode ? '#0f172a' : '#f8fafc';
        if (!cacheReady.current.darkMode) { cacheReady.current.darkMode = true; return; }
        if (!preservedRawKeys.current.has(STORAGE_KEYS.darkMode)) {
            localStorage.setItem(STORAGE_KEYS.darkMode, String(isDarkMode));
        }
    }, [isDarkMode]);

    useEffect(() => {
        if (!cacheReady.current.spacing) { cacheReady.current.spacing = true; return; }
        if (!preservedRawKeys.current.has(STORAGE_KEYS.spacing)) {
            localStorage.setItem(STORAGE_KEYS.spacing, JSON.stringify(editorSpacingSettings));
        }
    }, [editorSpacingSettings]);

    useEffect(() => {
        if (!cacheReady.current.aiContinue) { cacheReady.current.aiContinue = true; return; }
        if (!preservedRawKeys.current.has(STORAGE_KEYS.aiContinue)) {
            localStorage.setItem(STORAGE_KEYS.aiContinue, JSON.stringify(aiContinueSettings));
        }
    }, [aiContinueSettings]);

    useEffect(() => {
        if (!cacheReady.current.autoHighlight) { cacheReady.current.autoHighlight = true; return; }
        if (!preservedRawKeys.current.has(STORAGE_KEYS.autoHighlight)) {
            localStorage.setItem(STORAGE_KEYS.autoHighlight, JSON.stringify(autoHighlightSettings));
        }
    }, [autoHighlightSettings]);

    // Load server preferences whenever the identity changes (legacy path;
    // unreachable in local mode where the session user is always null).
    useEffect(() => {
        if (!user?.id) return;
        const loadPreferences = async () => {
            try {
                const settings = await accountApi.getPreferences();
                if (typeof settings.darkMode === 'boolean') setIsDarkMode(settings.darkMode);
                setEditorSpacingSettings(settings.spacing);
                setAiContinueSettings(settings.aiContinue);
                setAutoHighlightSettings(settings.autoHighlight);
            } catch (error) {
                console.error("Failed to load user settings:", error);
            }
        };
        void loadPreferences();
    }, [user?.id]);

    const persistDarkModePreference = async (enabled: boolean) => {
        if (!user) return;
        try {
            await accountApi.saveDarkMode(enabled);
        } catch (error) {
            console.error("Failed to save dark mode setting:", error);
        }
    };

    const persistEditorSpacingPreference = async (settings: EditorSpacingSettings) => {
        if (!user) return;
        try {
            await accountApi.saveSpacing(settings);
        } catch (error) {
            console.error("Failed to save editor spacing settings:", error);
        }
    };

    const persistAiContinuePreference = async (settings: AiContinueSettings) => {
        if (!user) return;
        try {
            await accountApi.saveAiContinue(settings);
        } catch (error) {
            console.error("Failed to save AI continue settings:", error);
        }
    };

    const persistAutoHighlightPreference = async (settings: AutoHighlightSettings) => {
        if (!user) return;
        try {
            await accountApi.saveAutoHighlight(settings);
        } catch (error) {
            console.error("Failed to save auto-highlight settings:", error);
        }
    };

    const setDarkMode = (enabled: boolean) => {
        preservedRawKeys.current.delete(STORAGE_KEYS.darkMode);
        setIsDarkMode(enabled);
        void persistDarkModePreference(enabled);
        persist({ ...latest.current, isDarkMode: enabled });
    };

    const toggleDarkMode = () => setDarkMode(!latest.current.isDarkMode);

    const updateEditorSpacingSettings = (settings: Partial<EditorSpacingSettings>) => {
        preservedRawKeys.current.delete(STORAGE_KEYS.spacing);
        const next = normalizeEditorSpacingSettings({ ...latest.current.editorSpacingSettings, ...settings });
        setEditorSpacingSettings(next);
        void persistEditorSpacingPreference(next);
        persist({ ...latest.current, editorSpacingSettings: next });
    };

    const updateAiContinueSettings = (settings: Partial<AiContinueSettings>) => {
        preservedRawKeys.current.delete(STORAGE_KEYS.aiContinue);
        const next = normalizeAiContinueSettings({ ...latest.current.aiContinueSettings, ...settings });
        setAiContinueSettings(next);
        void persistAiContinuePreference(next);
        persist({ ...latest.current, aiContinueSettings: next });
    };

    const setAutoHighlightRoleEnabled = (role: CharacterRole, enabled: boolean) => {
        preservedRawKeys.current.delete(STORAGE_KEYS.autoHighlight);
        const disabledRoleSet = new Set(latest.current.autoHighlightSettings.disabledRoles);
        if (enabled) {
            disabledRoleSet.delete(role);
        } else {
            disabledRoleSet.add(role);
        }
        const next = normalizeAutoHighlightSettings({ disabledRoles: Array.from(disabledRoleSet) });
        setAutoHighlightSettings(next);
        void persistAutoHighlightPreference(next);
        persist({ ...latest.current, autoHighlightSettings: next });
    };

    return (
        <PreferencesContext.Provider value={{
            isDarkMode, editorSpacingSettings, aiContinueSettings, autoHighlightSettings,
            toggleDarkMode, setDarkMode, updateEditorSpacingSettings, updateAiContinueSettings,
            setAutoHighlightRoleEnabled,
        }}>
            {children}
        </PreferencesContext.Provider>
    );
}

export const usePreferences = () => {
    const context = useContext(PreferencesContext);
    if (!context) throw new Error('usePreferences must be used within PreferencesProvider');
    return context;
};
