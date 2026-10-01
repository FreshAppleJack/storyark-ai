import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { filterChapters, type ChapterOption } from '../planningSelectors';
import { ChapterSummaryEditor } from './ChapterSummaryEditor';
import { OverlayHorizontalScrollbar } from '../../../components/ui/OverlayHorizontalScrollbar';
import type { ChapterSummarySuggestion } from '../../../domain/chapterSummarySource';
import type { SummaryModelAvailability } from '../hooks/useChapterSummarySuggestions';

interface Props {
    chapterOptions: ChapterOption[];
    targetChapterId: string | null;
    updateChapterSummary: (id: string, summary: string) => void;
    acknowledgeChapterSummaryChanges: (chapterId: string) => void;
    suggestions: Record<string, ChapterSummarySuggestion>;
    activeSuggestionChapterId: string | null;
    modelAvailability: SummaryModelAvailability;
    modelNotice: string | null;
    isReadOnly: boolean;
    isSuggestionCurrent: (chapterId: string) => boolean;
    generateSuggestion: (chapterId: string) => void;
    stopSuggestion: (chapterId: string) => void;
    acceptSuggestion: (chapterId: string) => void;
    keepManual: (chapterId: string) => void;
    toggleSuggestionHit: (chapterId: string, hitId: string) => void;
}

export function ChapterSummariesPanel({
    chapterOptions, targetChapterId, updateChapterSummary, acknowledgeChapterSummaryChanges, suggestions, activeSuggestionChapterId,
    modelAvailability, modelNotice, isReadOnly, isSuggestionCurrent, generateSuggestion, stopSuggestion,
    acceptSuggestion, keepManual, toggleSuggestionHit,
}: Props) {
    const [chapterSearchQuery, setChapterSearchQuery] = useState('');
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(targetChapterId);
    const [focusedChapterId, setFocusedChapterId] = useState<string | null>(null);
    const lastFocusedChapterIdRef = useRef<string | null>(null);
    const chapterStripRef = useRef<HTMLDivElement>(null);
    const chapterStripId = useId();
    const targetExists = chapterOptions.some(chapter => chapter.id === targetChapterId);
    const filteredChapters = useMemo(() => filterChapters(chapterOptions, chapterSearchQuery), [chapterOptions, chapterSearchQuery]);
    const selectedChapter = filteredChapters.find(chapter => chapter.id === selectedChapterId) ?? filteredChapters[0];
    const selectedIndex = selectedChapter ? filteredChapters.findIndex(chapter => chapter.id === selectedChapter.id) : -1;
    const summarizedCount = chapterOptions.filter(chapter => chapter.summary.trim()).length;
    const updateSearchQuery = (query: string) => {
        setChapterSearchQuery(query);
        const matches = filterChapters(chapterOptions, query);
        if (!matches.some(chapter => chapter.id === selectedChapterId)) setSelectedChapterId(matches[0]?.id ?? null);
    };

    useEffect(() => {
        if (!targetChapterId || !targetExists || lastFocusedChapterIdRef.current === targetChapterId) return;
        lastFocusedChapterIdRef.current = targetChapterId;
        setChapterSearchQuery('');
        setSelectedChapterId(targetChapterId);
        setFocusedChapterId(targetChapterId);

        const focusTimer = window.setTimeout(() => {
            document.getElementById(`outline-selector-${targetChapterId}`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
            const textarea = document.getElementById(`outline-summary-${targetChapterId}`) as HTMLTextAreaElement | null;
            textarea?.focus({ preventScroll: true });
        }, 120);
        const highlightTimer = window.setTimeout(() => {
            setFocusedChapterId(current => current === targetChapterId ? null : current);
        }, 2600);
        return () => { window.clearTimeout(focusTimer); window.clearTimeout(highlightTimer); };
    }, [targetChapterId, targetExists]);

    return (
        <main className="order-1 flex min-h-[40rem] min-w-0 flex-col overflow-hidden bg-slate-50 xl:order-2 xl:min-h-0 dark:bg-slate-950" aria-label="Chapter summaries workspace">
            <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3 xl:flex-nowrap">
                    <div className="min-w-0 xl:shrink-0">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                            <BookOpen size={17} className="text-brand-500" />
                            Chapter Summaries
                        </div>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{summarizedCount} of {chapterOptions.length} chapters summarized</p>
                    </div>
                    <div className="flex w-full min-w-0 max-w-sm items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 xl:w-auto xl:flex-1 dark:border-slate-800 dark:bg-slate-950 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                        <Search size={15} className="shrink-0 text-slate-400" />
                        <input
                            value={chapterSearchQuery}
                            onChange={(event) => updateSearchQuery(event.target.value)}
                            placeholder="Search chapters or summaries"
                            aria-label="Search chapters or summaries"
                            className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                        />
                        {chapterSearchQuery && (
                            <button type="button" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => updateSearchQuery('')} aria-label="Clear chapter search">
                                <X size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <nav className="shrink-0 border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900" aria-label="Select a chapter summary">
                {chapterSearchQuery.trim() && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{filteredChapters.length} matching chapters</p>}
                <div className="relative">
                <div id={chapterStripId} ref={chapterStripRef} className="scrollbar-hidden-x flex gap-2 overflow-x-auto pb-1">
                    {filteredChapters.map(chapter => (
                        <button
                            id={`outline-selector-${chapter.id}`}
                            key={chapter.id}
                            type="button"
                            aria-current={selectedChapter?.id === chapter.id ? 'true' : undefined}
                            onClick={() => setSelectedChapterId(chapter.id)}
                            className={`min-w-44 max-w-56 flex-1 rounded-lg border px-3 py-2 text-left transition ${selectedChapter?.id === chapter.id
                                ? 'border-brand-400 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/30'
                                : 'border-slate-200 bg-slate-50 hover:border-brand-300 dark:border-slate-800 dark:bg-slate-950 dark:hover:border-brand-800'}`}
                        >
                            <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{chapter.volumeTitle}</span>
                            <span className="mt-0.5 block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{chapter.title}</span>
                            <span className={`mt-1 block truncate text-[11px] ${chapter.summaryFreshness?.status === 'possibly-stale' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                {activeSuggestionChapterId === chapter.id ? 'Generating…' : chapter.summaryFreshness?.status === 'possibly-stale' ? 'Review changes' : chapter.summary.trim() ? 'Has summary' : 'No summary yet'}
                            </span>
                        </button>
                    ))}
                </div>
                <OverlayHorizontalScrollbar scrollElementRef={chapterStripRef} scrollElementId={chapterStripId} ariaLabel="Chapter summaries" bottomClassName="-bottom-2" />
                </div>
            </nav>

            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
                <div className="mx-auto max-w-4xl">
                    {selectedChapter && (
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Chapter {selectedIndex + 1} of {filteredChapters.length}</span>
                            {filteredChapters.length > 1 && (
                                <div className="flex items-center gap-1">
                                    <Button variant="ghost" size="sm" disabled={selectedIndex === 0} onClick={() => setSelectedChapterId(filteredChapters[selectedIndex - 1].id)} icon={<ChevronLeft size={14} />}>Previous</Button>
                                    <Button variant="ghost" size="sm" disabled={selectedIndex === filteredChapters.length - 1} onClick={() => setSelectedChapterId(filteredChapters[selectedIndex + 1].id)}>
                                        Next <ChevronRight size={14} className="ml-1 inline" />
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                    {selectedChapter && (
                        <ChapterSummaryEditor
                            key={selectedChapter.id}
                            chapter={selectedChapter}
                            focused={focusedChapterId === selectedChapter.id}
                            isReadOnly={isReadOnly}
                            isGenerating={activeSuggestionChapterId === selectedChapter.id}
                            isAnyGenerating={activeSuggestionChapterId !== null}
                            modelAvailability={modelAvailability}
                            modelNotice={modelNotice}
                            suggestion={suggestions[selectedChapter.id]}
                            isCurrent={isSuggestionCurrent(selectedChapter.id)}
                            updateChapterSummary={updateChapterSummary}
                            acknowledgeChapterSummaryChanges={acknowledgeChapterSummaryChanges}
                            generateSuggestion={generateSuggestion}
                            stopSuggestion={stopSuggestion}
                            acceptSuggestion={acceptSuggestion}
                            keepManual={keepManual}
                            toggleSuggestionHit={toggleSuggestionHit}
                        />
                    )}
                    {!selectedChapter && (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                            {chapterOptions.length === 0 ? 'Create a chapter to start writing summaries.' : 'No matching chapter summary found.'}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
