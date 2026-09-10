import { EDITOR_SPACING_LIMITS, AI_CONTINUE_LIMITS, CHARACTER_ROLE_OPTIONS } from '../types';
import type { EditorSpacingSettings, AiContinueSettings, AutoHighlightSettings, CharacterRole } from '../types';

export const DEFAULT_EDITOR_SPACING_SETTINGS: EditorSpacingSettings = {
    editorMarginPx: EDITOR_SPACING_LIMITS.marginPx.default,
    editorLineHeight: EDITOR_SPACING_LIMITS.lineHeight.default,
};

export const DEFAULT_AI_CONTINUE_SETTINGS: AiContinueSettings = {
    contextChars: AI_CONTINUE_LIMITS.contextChars.default,
    outputChars: AI_CONTINUE_LIMITS.outputChars.default,
};

const VALID_CHARACTER_ROLES = new Set<CharacterRole>(CHARACTER_ROLE_OPTIONS.map(role => role.value));

export const normalizeAutoHighlightSettings = (settings?: Partial<AutoHighlightSettings> | null): AutoHighlightSettings => {
    const disabledRoles = Array.isArray(settings?.disabledRoles) ? settings.disabledRoles : [];
    const uniqueDisabledRoles = Array.from(new Set(disabledRoles.filter((role): role is CharacterRole => VALID_CHARACTER_ROLES.has(role as CharacterRole))));

    return {
        disabledRoles: uniqueDisabledRoles,
    };
};

const clampNumber = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
};

export const normalizeEditorSpacingSettings = (settings?: Partial<EditorSpacingSettings> | null): EditorSpacingSettings => {
    const rawMargin = Number(settings?.editorMarginPx ?? DEFAULT_EDITOR_SPACING_SETTINGS.editorMarginPx);
    const rawLineHeight = Number(settings?.editorLineHeight ?? DEFAULT_EDITOR_SPACING_SETTINGS.editorLineHeight);

    return {
        editorMarginPx: clampNumber(rawMargin, EDITOR_SPACING_LIMITS.marginPx.min, EDITOR_SPACING_LIMITS.marginPx.max),
        editorLineHeight: Number(clampNumber(rawLineHeight, EDITOR_SPACING_LIMITS.lineHeight.min, EDITOR_SPACING_LIMITS.lineHeight.max).toFixed(2)),
    };
};

export const normalizeAiContinueSettings = (settings?: Partial<AiContinueSettings> | null): AiContinueSettings => {
    const rawContextChars = Number(settings?.contextChars ?? DEFAULT_AI_CONTINUE_SETTINGS.contextChars);
    const rawOutputChars = Number(settings?.outputChars ?? DEFAULT_AI_CONTINUE_SETTINGS.outputChars);

    return {
        contextChars: Math.round(clampNumber(rawContextChars, AI_CONTINUE_LIMITS.contextChars.min, AI_CONTINUE_LIMITS.contextChars.max)),
        outputChars: Math.round(clampNumber(rawOutputChars, AI_CONTINUE_LIMITS.outputChars.min, AI_CONTINUE_LIMITS.outputChars.max)),
    };
};
