import React from 'react';
import { FileText, Layers3 } from 'lucide-react';
import type { StoryPlanning } from '../../../types';
interface Props {
    planning: Pick<StoryPlanning, 'storySummary' | 'storyBackground'>;
    updatePlanningField: (field: 'storySummary' | 'storyBackground', value: string) => void;
}
export function StoryOverviewPanel({ planning, updatePlanningField }: Props) {
    return (
        <main className="min-h-0 overflow-y-auto p-6">
            <div className="mx-auto max-w-4xl space-y-5">
                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-300">
                                <FileText size={14} />
                                Whole Book
                            </div>
                            <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Story Synopsis</h2>
                        </div>
                    </div>
                    <textarea
                        value={planning.storySummary}
                        onChange={(event) => updatePlanningField('storySummary', event.target.value)}
                        placeholder="Write the high-level story arc, main conflict, turning points, and ending direction..."
                        className="min-h-56 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                    />
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="mb-4">
                        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                            <Layers3 size={14} />
                            Setting
                        </div>
                        <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Story Background</h2>
                    </div>
                    <textarea
                        value={planning.storyBackground}
                        onChange={(event) => updatePlanningField('storyBackground', event.target.value)}
                        placeholder="Write the world background, timeline, factions, rules, locations, and hidden context..."
                        className="min-h-64 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                    />
                </section>
            </div>
        </main>
    );
}
