import React from 'react';
import { BookOpen, FileText, Layers3 } from 'lucide-react';
import type { StoryPlanning } from '../../../types';

interface Props {
    planning: Pick<StoryPlanning, 'storySummary' | 'storyBackground'>;
    updatePlanningField: (field: 'storySummary' | 'storyBackground', value: string) => void;
}

export function StoryOverviewPanel({ planning, updatePlanningField }: Props) {
    return (
        <aside className="order-2 flex min-h-[26rem] min-w-0 flex-col border-r border-slate-200 bg-white xl:order-1 xl:min-h-0 dark:border-slate-800 dark:bg-slate-900" aria-label="Story overview">
            <div className="shrink-0 border-b border-slate-100 px-4 py-4 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <BookOpen size={15} />
                    Whole Book
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">High-level notes for the story and its setting.</p>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="mb-3 flex items-center gap-2 text-brand-700 dark:text-brand-300">
                        <FileText size={16} />
                        <h2 className="text-sm font-bold">Story Synopsis</h2>
                    </div>
                    <textarea
                        value={planning.storySummary}
                        onChange={(event) => updatePlanningField('storySummary', event.target.value)}
                        placeholder="Write the high-level story arc, main conflict, turning points, and ending direction..."
                        className="min-h-40 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                    />
                </section>
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                    <div className="mb-3 flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                        <Layers3 size={16} />
                        <h2 className="text-sm font-bold">Story Background</h2>
                    </div>
                    <textarea
                        value={planning.storyBackground}
                        onChange={(event) => updatePlanningField('storyBackground', event.target.value)}
                        placeholder="Write the world background, timeline, factions, rules, locations, and hidden context..."
                        className="min-h-44 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                    />
                </section>
            </div>
        </aside>
    );
}
