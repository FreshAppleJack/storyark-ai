import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, Moon, Sun } from 'lucide-react';
import { usePreferences } from '../InteractionContent/PreferencesContext';
import { SettingShell, ToggleControl } from '../features/settings/components/SettingControls';
import { WritingPreferences } from '../features/settings/components/WritingPreferences';
import { AiModels } from '../features/settings/components/AiModels';
import { IndexScheduleControl } from '../features/retrieval/components/IndexScheduleControl';
import { Button } from '../components/ui/Button';
import { ErrorLogSettings } from '../features/settings/components/ErrorLogSettings';

// Local mode: account/profile settings stay unmounted (no login, no account
// page); appearance and writing preferences persist to local SQLite.
const UserSettings: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const returnTo = typeof location.state?.returnTo === 'string' && location.state.returnTo.startsWith('/')
        ? location.state.returnTo
        : '/dashboard';
    const { isDarkMode, toggleDarkMode } = usePreferences();
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

                    <WritingPreferences />
                    <AiModels />
                    <IndexScheduleControl />
                    <ErrorLogSettings />
                </div>

                <div className="flex justify-end">
                    <Button variant="secondary" onClick={() => navigate('/dashboard')}>Back to Dashboard</Button>
                </div>
            </main>
        </div>
    );
};

export default UserSettings;
