import React from 'react';
import { BrainCircuit, CheckCircle2 } from 'lucide-react';
import type { BrainstormEditor } from '../hooks/useBrainstormWorkspace';
type Props = Pick<BrainstormEditor, 'chapterOptions' | 'selectedChapterIds' | 'toggleChapter'>;
export function BrainstormChapterPicker({ chapterOptions, selectedChapterIds, toggleChapter }: Props) {
    return (
        <aside className="min-h-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <BrainCircuit size={15} />
                    Brainstorm Context
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Select the chapters that should guide the next plot direction.
                </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {chapterOptions.map(chapter => {
                    const selected = selectedChapterIds.includes(chapter.id);
                    const missingSummary = !chapter.summary.trim();
                    return (
                        <button
                            key={chapter.id}
                            onClick={() => toggleChapter(chapter.id)}
                            className={`w-full rounded-lg border px-3 py-3 text-left transition ${selected
                                    ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-slate-800'
                                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-700'
                                    }`}>
                                    {selected && <CheckCircle2 size={12} />}
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{chapter.title}</span>
                                    <span className="block truncate text-xs text-slate-400">{chapter.volumeTitle}</span>
                                    {missingSummary && <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-300">Missing summary</span>}
                                </span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </aside>
    );
}
