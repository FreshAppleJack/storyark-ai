/* eslint-disable react-refresh/only-export-components -- provider + hook
   pairs stay together by design (same pattern as the legacy AppContext). */
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    EditorSpacingSettings, AiContinueSettings, AutoHighlightSettings, CharacterRole,
} from '../types';
import {
    DEFAULT_EDITOR_SPACING_SETTINGS, DEFAULT_AI_CONTINUE_SETTINGS,
    normalizeEditorSpacingSettings, normalizeAiContinueSettings, normalizeAutoHighlightSettings,
} from '../domain/preferences';
import { accountApi } from '../data/accountApi';
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

const loadEditorSpacingSettingsFromStorage = (): EditorSpacingSettings => {
    try {
        return normalizeEditorSpacingSettings(JSON.parse(localStorage.getItem('storyark_editor_spacing') || 'null'));
    } catch {
        return DEFAULT_EDITOR_SPACING_SETTINGS;
    }
};

const loadAutoHighlightSettingsFromStorage = (): AutoHighlightSettings => {
    try {
        return normalizeAutoHighlightSettings(JSON.parse(localStorage.getItem('storyark_auto_highlight') || 'null'));
    } catch {
        return { disabledRoles: [] };
    }
};

const loadAiContinueSettingsFromStorage = (): AiContinueSettings => {
    try {
        return normalizeAiContinueSettings(JSON.parse(localStorage.getItem('storyark_ai_continue') || 'null'));
    } catch {
        return DEFAULT_AI_CONTINUE_SETTINGS;
    }
};

/**
 * Owns user preferences: local state + localStorage are written immediately,
 * remote sync is best effort. Server preferences reload whenever the signed
 * in identity changes (login and account switch alike).
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const { user } = useSession();
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => localStorage.getItem('storyark_dark_mode') === 'true');
    const [editorSpacingSettings, setEditorSpacingSettings] = useState<EditorSpacingSettings>(loadEditorSpacingSettingsFromStorage);
    const [aiContinueSettings, setAiContinueSettings] = useState<AiContinueSettings>(loadAiContinueSettingsFromStorage);
    const [autoHighlightSettings, setAutoHighlightSettings] = useState<AutoHighlightSettings>(loadAutoHighlightSettingsFromStorage);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode);
        document.body.style.backgroundColor = isDarkMode ? '#0f172a' : '#f8fafc';
        localStorage.setItem('storyark_dark_mode', String(isDarkMode));
    }, [isDarkMode]);

    useEffect(() => {
        localStorage.setItem('storyark_editor_spacing', JSON.stringify(editorSpacingSettings));
    }, [editorSpacingSettings]);

    useEffect(() => {
        localStorage.setItem('storyark_ai_continue', JSON.stringify(aiContinueSettings));
    }, [aiContinueSettings]);

    useEffect(() => {
        localStorage.setItem('storyark_auto_highlight', JSON.stringify(autoHighlightSettings));
    }, [autoHighlightSettings]);

    // Load server preferences whenever the identity changes.
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

    const toggleDarkMode = () => {
        setIsDarkMode(prev => {
            const next = !prev;
            void persistDarkModePreference(next);
            return next;
        });
    };

    const setDarkMode = (enabled: boolean) => {
        setIsDarkMode(enabled);
        void persistDarkModePreference(enabled);
    };

    const updateEditorSpacingSettings = (settings: Partial<EditorSpacingSettings>) => {
        setEditorSpacingSettings(prev => {
            const next = normalizeEditorSpacingSettings({ ...prev, ...settings });
            void persistEditorSpacingPreference(next);
            return next;
        });
    };

    const updateAiContinueSettings = (settings: Partial<AiContinueSettings>) => {
        setAiContinueSettings(prev => {
            const next = normalizeAiContinueSettings({ ...prev, ...settings });
            void persistAiContinuePreference(next);
            return next;
        });
    };

    const setAutoHighlightRoleEnabled = (role: CharacterRole, enabled: boolean) => {
        setAutoHighlightSettings(prev => {
            const disabledRoleSet = new Set(prev.disabledRoles);
            if (enabled) {
                disabledRoleSet.delete(role);
            } else {
                disabledRoleSet.add(role);
            }

            const next = normalizeAutoHighlightSettings({
                disabledRoles: Array.from(disabledRoleSet),
            });
            void persistAutoHighlightPreference(next);
            return next;
        });
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
