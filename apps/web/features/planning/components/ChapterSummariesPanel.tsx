import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { filterChapters, type ChapterOption } from '../planningSelectors';
interface Props {
    chapterOptions: ChapterOption[]; targetChapterId: string | null;
    updateChapterSummary: (id: string, summary: string) => void;
}
export function ChapterSummariesPanel({ chapterOptions, targetChapterId, updateChapterSummary }: Props) {
    const [chapterSearchQuery, setChapterSearchQuery] = useState('');
    const [focusedChapterId, setFocusedChapterId] = useState<string | null>(null);
    const lastFocusedChapterIdRef = useRef<string | null>(null);
    const targetExists = chapterOptions.some(chapter => chapter.id === targetChapterId);
    const filteredChapters = useMemo(() => filterChapters(chapterOptions, chapterSearchQuery), [chapterOptions, chapterSearchQuery]);
    useEffect(() => {
        if (
            !targetChapterId ||
            lastFocusedChapterIdRef.current === targetChapterId ||
            !targetExists
        ) {
            return;
        }

        lastFocusedChapterIdRef.current = targetChapterId;
        setChapterSearchQuery('');
        setFocusedChapterId(targetChapterId);

        const focusTimer = window.setTimeout(() => {
            document.getElementById(`outline-chapter-${targetChapterId}`)?.scrollIntoView({
                block: 'center',
                behavior: 'smooth',
            });
            const textarea = document.getElementById(`outline-summary-${targetChapterId}`) as HTMLTextAreaElement | null;
            textarea?.focus({ preventScroll: true });
        }, 120);

        const highlightTimer = window.setTimeout(() => {
            setFocusedChapterId(prev => prev === targetChapterId ? null : prev);
        }, 2600);

        return () => { window.clearTimeout(focusTimer); window.clearTimeout(highlightTimer); };
    }, [targetChapterId, targetExists]);

    return (
        <aside className="min-h-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <BookOpen size={15} />
                    Chapter Summaries
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-950 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                    <Search size={15} className="flex-shrink-0 text-slate-400" />
                    <input
                        value={chapterSearchQuery}
                        onChange={(event) => setChapterSearchQuery(event.target.value)}
                        placeholder="Search chapters or summaries"
                        className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                    />
                    {chapterSearchQuery && (
                        <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setChapterSearchQuery('')}>
                            <X size={13} />
                        </button>
                    )}
                </div>
                {chapterSearchQuery.trim() && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {filteredChapters.length === 1 ? '1 chapter found' : `${filteredChapters.length} chapters found`}
                    </p>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {filteredChapters.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">No matching chapters found.</div>
                ) : filteredChapters.map(chapter => (
                    <section
                        id={`outline-chapter-${chapter.id}`}
                        key={chapter.id}
                        className={`rounded-lg border bg-white p-3 shadow-sm transition ${focusedChapterId === chapter.id
                                ? 'border-brand-300 ring-2 ring-brand-100 dark:border-brand-700 dark:ring-brand-900/40'
                                : 'border-slate-200 dark:border-slate-800'
                            } dark:bg-slate-950`}
                    >
                        <div className="mb-2">
                            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{chapter.volumeTitle}</p>
                            <h3 className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-white">{chapter.title}</h3>
                        </div>
                        <textarea
                            id={`outline-summary-${chapter.id}`}
                            value={chapter.summary}
                            onChange={(event) => updateChapterSummary(chapter.id, event.target.value)}
                            placeholder="Chapter plot summary..."
                            className="h-28 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                        />
                    </section>
                ))}
            </div>
        </aside>
    );
}
