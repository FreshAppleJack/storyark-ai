import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Info, Loader2, Moon, Sparkles, Sun, Tag, Type, UserRound } from 'lucide-react';
import { useApp } from '../InteractionContent/AppContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { AI_CONTINUE_LIMITS, CHARACTER_ROLE_OPTIONS, EDITOR_SPACING_LIMITS } from '../types';

const SettingShell: React.FC<{ title: string; description: string; icon: React.ReactNode; children: React.ReactNode; badge?: string }> = ({ title, description, icon, children, badge }) => (
    <section className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/20">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
                    {icon}
                </div>
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
                        {badge && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{badge}</span>}
                    </div>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
                </div>
            </div>
            <div className="w-full lg:w-[360px]">{children}</div>
        </div>
    </section>
);

const ToggleControl: React.FC<{ enabled: boolean; onChange?: () => void; disabled?: boolean }> = ({ enabled, onChange, disabled }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onChange}
        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950 ${enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'} ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        aria-pressed={enabled}
    >
        <span className={`inline-flex h-6 w-6 transform items-center justify-center rounded-full bg-white text-slate-500 shadow-md transition-transform duration-300 ${enabled ? 'translate-x-7' : 'translate-x-1'}`}>
            {enabled ? <Check size={14} className="text-brand-600" /> : null}
        </span>
    </button>
);

const RangeControl: React.FC<{
    label: string;
    valueLabel: string;
    minLabel: string;
    maxLabel: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
}> = ({ label, valueLabel, minLabel, maxLabel, value, min, max, step, onChange }) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
            <span className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-300">{valueLabel}</span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-full accent-brand-600"
        />
        <div className="flex justify-between text-[11px] text-slate-400 dark:text-slate-500">
            <span>{minLabel}</span>
            <span>Default</span>
            <span>{maxLabel}</span>
        </div>
    </div>
);

const UserSettings: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const returnTo = typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/')
        ? location.state.returnTo
        : '/dashboard';
    const {
        user,
        isDarkMode,
        toggleDarkMode,
        editorSpacingSettings,
        updateEditorSpacingSettings,
        aiContinueSettings,
        updateAiContinueSettings,
        autoHighlightSettings,
        setAutoHighlightRoleEnabled,
        updateNickname
    } = useApp();
    const [nicknameDraft, setNicknameDraft] = useState(user?.nickname || user?.username || '');
    const [isSavingNickname, setIsSavingNickname] = useState(false);
    const [nicknameStatus, setNicknameStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const isDefaultSpacing =
        editorSpacingSettings.editorMarginPx === EDITOR_SPACING_LIMITS.marginPx.default &&
        editorSpacingSettings.editorLineHeight === EDITOR_SPACING_LIMITS.lineHeight.default;
    const isDefaultAiContinue =
        aiContinueSettings.contextChars === AI_CONTINUE_LIMITS.contextChars.default &&
        aiContinueSettings.outputChars === AI_CONTINUE_LIMITS.outputChars.default;
    const currentNickname = user?.nickname || user?.username || '';
    const normalizedNicknameDraft = nicknameDraft.trim();
    const isNicknameDirty = normalizedNicknameDraft !== currentNickname;
    const isNicknameInvalid = normalizedNicknameDraft.length === 0 || normalizedNicknameDraft.length > 64;

    useEffect(() => {
        setNicknameDraft(currentNickname);
        setNicknameStatus('idle');
    }, [currentNickname]);

    const handleNicknameSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!isNicknameDirty || isNicknameInvalid || isSavingNickname) return;

        setIsSavingNickname(true);
        setNicknameStatus('idle');
        const success = await updateNickname(normalizedNicknameDraft);
        setIsSavingNickname(false);
        setNicknameStatus(success ? 'saved' : 'error');
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
            <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 px-6 py-4 backdrop-blur-xl transition-colors duration-300 dark:border-slate-800 dark:bg-slate-950/80">
                <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <button onClick={() => navigate(returnTo)} className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white">
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-brand-300">Global Preferences</p>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">User Settings</h1>
                        </div>
                    </div>
                    <div className="hidden items-center gap-3 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 sm:flex">
                        {isDarkMode ? <Moon size={16} className="text-brand-300" /> : <Sun size={16} className="text-amber-500" />}
                        {isDarkMode ? 'Dark workspace active' : 'Light workspace active'}
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
                <div className="overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-slate-100 p-8 shadow-sm dark:border-brand-900/60 dark:from-slate-900 dark:via-slate-950 dark:to-brand-950/40">
                    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                        <div>
                            <h2 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Shape StoryArk around your writing workflow.</h2>
                            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                                Manage appearance, editor comfort, profile identity, and character-tag highlighting from one global settings hub.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-xl shadow-brand-900/5 dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/20">
                            <div className="mb-4 flex items-center justify-between">
                                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Theme preview</span>
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">Live</span>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="h-3 w-3 rounded-full bg-rose-400" />
                                    <div className="h-3 w-3 rounded-full bg-amber-400" />
                                    <div className="h-3 w-3 rounded-full bg-emerald-400" />
                                </div>
                                <div className="space-y-2">
                                    <div className="h-3 w-3/4 rounded bg-slate-300 dark:bg-slate-700" />
                                    <div className="h-3 w-full rounded bg-slate-200 dark:bg-slate-800" />
                                    <div className="h-3 w-2/3 rounded bg-brand-200 dark:bg-brand-900" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-5">
                    <SettingShell
                        title="Dark Mode"
                        description="Switch the application chrome between a bright paper-like workspace and a darker low-glare writing environment. The setting is applied instantly and remembered locally."
                        icon={isDarkMode ? <Moon size={22} /> : <Sun size={22} />}
                    >
                        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{isDarkMode ? 'Dark Mode' : 'Light Mode'}</p>
                                    <span className="group relative inline-flex">
                                        <Info size={14} className="text-slate-400 hover:text-brand-500 dark:text-slate-500 dark:hover:text-brand-300" />
                                        <span className="pointer-events-none absolute left-1/2 top-6 z-30 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-600 opacity-0 shadow-xl transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                                            Due to third-party feature limitations, some scenes may not be able to be changed.
                                        </span>
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 dark:text-slate-400">Click to update the UI immediately.</p>
                            </div>
                            <ToggleControl enabled={isDarkMode} onChange={toggleDarkMode} />
                        </div>
                    </SettingShell>

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

                    <SettingShell
                        title="Author Profile"
                        description="Update the nickname shown across your books, editor surfaces, and profile-aware interactions."
                        icon={<UserRound size={22} />}
                    >
                        <form onSubmit={handleNicknameSubmit} className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                            <Input
                                label="User nickname"
                                value={nicknameDraft}
                                maxLength={64}
                                error={isNicknameInvalid}
                                helperText={
                                    isNicknameInvalid
                                        ? 'Nickname must be 1-64 characters.'
                                        : nicknameStatus === 'saved'
                                            ? 'Nickname saved.'
                                            : nicknameStatus === 'error'
                                                ? 'Save failed. Please try again.'
                                                : 'Used as your author name across the workspace.'
                                }
                                onChange={(event) => {
                                    setNicknameDraft(event.target.value);
                                    setNicknameStatus('idle');
                                }}
                            />
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-xs text-slate-400 dark:text-slate-500">{normalizedNicknameDraft.length}/64</p>
                                <Button
                                    type="submit"
                                    variant="primary"
                                    size="sm"
                                    disabled={!isNicknameDirty || isNicknameInvalid || isSavingNickname}
                                >
                                    {isSavingNickname ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Check size={14} className="mr-2" />}
                                    Save
                                </Button>
                            </div>
                        </form>
                    </SettingShell>

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
                </div>

                <div className="flex justify-end">
                    <Button variant="secondary" onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
                </div>
            </main>
        </div>
    );
};

export default UserSettings;
