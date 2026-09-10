import React from 'react';
import { Sparkles, Tag, Type } from 'lucide-react';
import { usePreferences } from '../../../InteractionContent/PreferencesContext';
import { AI_CONTINUE_LIMITS, CHARACTER_ROLE_OPTIONS, EDITOR_SPACING_LIMITS } from '../../../types';
import { SettingShell, RangeControl, ToggleControl } from './SettingControls';
export function WritingPreferences({ children }: { children?: React.ReactNode }) {
    const { editorSpacingSettings, updateEditorSpacingSettings, aiContinueSettings, updateAiContinueSettings,
        autoHighlightSettings, setAutoHighlightRoleEnabled } = usePreferences();
    const isDefaultSpacing =
        editorSpacingSettings.editorMarginPx === EDITOR_SPACING_LIMITS.marginPx.default &&
        editorSpacingSettings.editorLineHeight === EDITOR_SPACING_LIMITS.lineHeight.default;
    const isDefaultAiContinue =
        aiContinueSettings.contextChars === AI_CONTINUE_LIMITS.contextChars.default &&
        aiContinueSettings.outputChars === AI_CONTINUE_LIMITS.outputChars.default;
    return <>
        <SettingShell
            title="Typography & Editor Spacing"
            description="Fine tune the editor page margin and line height for long-form drafting. The middle position matches the original editor layout."
            icon={<Type size={22} />}
        >
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <RangeControl
                    label="Editor margin"
                    valueLabel={`${editorSpacingSettings.editorMarginPx}px`}
                    minLabel={`${EDITOR_SPACING_LIMITS.marginPx.min}px`}
                    maxLabel={`${EDITOR_SPACING_LIMITS.marginPx.max}px`}
                    value={editorSpacingSettings.editorMarginPx}
                    min={EDITOR_SPACING_LIMITS.marginPx.min}
                    max={EDITOR_SPACING_LIMITS.marginPx.max}
                    step={EDITOR_SPACING_LIMITS.marginPx.step}
                    onChange={(value) => updateEditorSpacingSettings({ editorMarginPx: value })}
                />
                <RangeControl
                    label="Line height"
                    valueLabel={`${editorSpacingSettings.editorLineHeight.toFixed(2)}x`}
                    minLabel={`${EDITOR_SPACING_LIMITS.lineHeight.min.toFixed(2)}x`}
                    maxLabel={`${EDITOR_SPACING_LIMITS.lineHeight.max.toFixed(2)}x`}
                    value={editorSpacingSettings.editorLineHeight}
                    min={EDITOR_SPACING_LIMITS.lineHeight.min}
                    max={EDITOR_SPACING_LIMITS.lineHeight.max}
                    step={EDITOR_SPACING_LIMITS.lineHeight.step}
                    onChange={(value) => updateEditorSpacingSettings({ editorLineHeight: value })}
                />
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <span>{isDefaultSpacing ? 'Using original editor spacing' : 'Custom editor spacing active'}</span>
                    <button
                        type="button"
                        onClick={() => updateEditorSpacingSettings({
                            editorMarginPx: EDITOR_SPACING_LIMITS.marginPx.default,
                            editorLineHeight: EDITOR_SPACING_LIMITS.lineHeight.default,
                        })}
                        disabled={isDefaultSpacing}
                        className="font-semibold text-brand-600 transition hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-brand-300 dark:hover:text-brand-200 dark:disabled:text-slate-600"
                    >
                        Reset
                    </button>
                </div>
            </div>
        </SettingShell>
        <SettingShell
            title="AI Continue"
            description="Tune only the AI continuation behavior: how much recent text is used as context, and roughly how long the generated continuation should be. The middle position matches the original hardcoded behavior."
            icon={<Sparkles size={22} />}
        >
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <RangeControl
                    label="Context length"
                    valueLabel={`${aiContinueSettings.contextChars} chars`}
                    minLabel={`${AI_CONTINUE_LIMITS.contextChars.min}`}
                    maxLabel={`${AI_CONTINUE_LIMITS.contextChars.max}`}
                    value={aiContinueSettings.contextChars}
                    min={AI_CONTINUE_LIMITS.contextChars.min}
                    max={AI_CONTINUE_LIMITS.contextChars.max}
                    step={AI_CONTINUE_LIMITS.contextChars.step}
                    onChange={(value) => updateAiContinueSettings({ contextChars: value })}
                />
                <RangeControl
                    label="Output length"
                    valueLabel={`~${aiContinueSettings.outputChars} chars`}
                    minLabel={`~${AI_CONTINUE_LIMITS.outputChars.min}`}
                    maxLabel={`~${AI_CONTINUE_LIMITS.outputChars.max}`}
                    value={aiContinueSettings.outputChars}
                    min={AI_CONTINUE_LIMITS.outputChars.min}
                    max={AI_CONTINUE_LIMITS.outputChars.max}
                    step={AI_CONTINUE_LIMITS.outputChars.step}
                    onChange={(value) => updateAiContinueSettings({ outputChars: value })}
                />
                <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <span>{isDefaultAiContinue ? 'Using original AI continue settings' : 'Custom AI continue settings active'}</span>
                    <button
                        type="button"
                        onClick={() => updateAiContinueSettings({
                            contextChars: AI_CONTINUE_LIMITS.contextChars.default,
                            outputChars: AI_CONTINUE_LIMITS.outputChars.default,
                        })}
                        disabled={isDefaultAiContinue}
                        className="font-semibold text-brand-600 transition hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-300 dark:text-brand-300 dark:hover:text-brand-200 dark:disabled:text-slate-600"
                    >
                        Reset
                    </button>
                </div>
            </div>
        </SettingShell>
        {children}
        <SettingShell
            title="Character Tag Auto-highlight"
            description="Choose which character roles should be automatically highlighted when their names appear in the editor."
            icon={<Tag size={22} />}
        >
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                {CHARACTER_ROLE_OPTIONS.map((role) => {
                    const enabled = !autoHighlightSettings.disabledRoles.includes(role.value);
                    return (
                        <div key={role.value} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                            <div>
                                <p className="text-sm font-semibold text-slate-900 dark:text-white">{role.label}</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400">{role.description}</p>
                            </div>
                            <ToggleControl
                                enabled={enabled}
                                onChange={() => setAutoHighlightRoleEnabled(role.value, !enabled)}
                            />
                        </div>
                    );
                })}
            </div>
        </SettingShell>
    </>;
}
