import React from 'react';
import type { ChapterSummarySuggestion } from '../../../domain/chapterSummarySource';
import type { ChapterOption } from '../planningSelectors';
import type { SummaryModelAvailability } from '../hooks/useChapterSummarySuggestions';
import { ChapterSummarySuggestionReview } from './ChapterSummarySuggestionReview';

const FRESHNESS_REASON_LABELS: Record<string, string> = {
    'paragraph-content-or-structure-changed': 'Chapter text or paragraph structure changed.',
    'paragraphs-added': 'Paragraphs were added.',
    'paragraphs-removed': 'Paragraphs were removed.',
    'character-mentions-changed': 'Character mentions changed.',
    'foreshadowing-links-changed': 'Foreshadowing links changed.',
    'foreshadowing-note-content-changed': 'Foreshadowing notes changed.',
    'chapter-title-changed': 'The chapter title changed.',
    'content-format-changed': 'The chapter content format changed.',
    'content-format-version-changed': 'The chapter content format version changed.',
    'structured-source-metadata-changed': 'Tracked source structure changed.',
    'allowed-setting-or-character-source-changed': 'A setting or character source changed or is no longer available.',
    'allowed-source-baseline-unavailable': 'The original setting or character source versions cannot be checked.',
    'generation-metadata-unavailable': 'This summary is marked AI-adopted, but its generation record is missing or invalid.',
};

function summaryFreshnessMessage(chapter: ChapterOption): string | null {
    const freshness = chapter.summaryFreshness;
    if (!chapter.summary || !freshness || freshness.status === 'missing') return null;
    if (freshness.status === 'needs-review') {
        if (freshness.reasons.includes('generation-metadata-unavailable')) {
            return FRESHNESS_REASON_LABELS['generation-metadata-unavailable'];
        }
        return 'No verifiable source snapshot is recorded for this summary. Review it and edit it to establish a baseline.';
    }
    if (freshness.status === 'current' && freshness.sourceVersionChanged) {
        return 'The chapter database version differs from this snapshot, but no tracked text, structure, or reference change was detected.';
    }
    if (freshness.status !== 'possibly-stale') return null;
    return freshness.reasons.map(reason => FRESHNESS_REASON_LABELS[reason] ?? 'A tracked source changed.').join(' ');
}

interface Props {
    chapter: ChapterOption;
    focused: boolean;
    isReadOnly: boolean;
    isGenerating: boolean;
    isAnyGenerating: boolean;
    modelAvailability: SummaryModelAvailability;
    modelNotice: string | null;
    suggestion?: ChapterSummarySuggestion;
    isCurrent: boolean;
    updateChapterSummary: (id: string, summary: string) => void;
    acknowledgeChapterSummaryChanges: (chapterId: string) => void;
    generateSuggestion: (chapterId: string) => void;
    stopSuggestion: (chapterId: string) => void;
    acceptSuggestion: (chapterId: string) => void;
    keepManual: (chapterId: string) => void;
    toggleSuggestionHit: (chapterId: string, hitId: string) => void;
}

export function ChapterSummaryEditor({
    chapter, focused, isReadOnly, isGenerating, isAnyGenerating, modelAvailability, modelNotice,
    suggestion, isCurrent, updateChapterSummary, acknowledgeChapterSummaryChanges,
    generateSuggestion, stopSuggestion, acceptSuggestion, keepManual, toggleSuggestionHit,
}: Props) {
    const freshnessMessage = summaryFreshnessMessage(chapter);
    return (
        <section
            id={`outline-chapter-${chapter.id}`}
            className={`rounded-xl border bg-white p-5 shadow-sm transition dark:bg-slate-900 ${focused
                ? 'border-brand-300 ring-2 ring-brand-100 dark:border-brand-700 dark:ring-brand-900/40'
                : 'border-slate-200 dark:border-slate-800'}`}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{chapter.volumeTitle}</p>
                    <h2 className="mt-1 break-words text-xl font-bold text-slate-900 dark:text-white">{chapter.title}</h2>
                </div>
                {chapter.summary.trim() && (
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {chapter.summaryProvenance === 'ai-adopted' ? 'AI adopted' : 'Author written'}
                    </span>
                )}
            </div>

            <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor={`outline-summary-${chapter.id}`} className="text-xs font-semibold text-slate-700 dark:text-slate-200">Current summary</label>
                    {chapter.summaryFreshness?.status === 'possibly-stale' && <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Possible changes — review</span>}
                    {chapter.summaryFreshness?.status === 'needs-review' && <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Source snapshot unavailable</span>}
                </div>
                <textarea
                    id={`outline-summary-${chapter.id}`}
                    value={chapter.summary}
                    onChange={(event) => updateChapterSummary(chapter.id, event.target.value)}
                    placeholder="Chapter plot summary..."
                    disabled={isReadOnly || chapter.isReadOnly}
                    className="h-48 min-h-48 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white disabled:opacity-60 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                />
                {freshnessMessage && <p className={`mt-2 text-xs leading-5 ${chapter.sourceChanged ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'}`}>{freshnessMessage}</p>}
                {chapter.summaryFreshness?.status === 'possibly-stale' && !isReadOnly && !chapter.isReadOnly && (
                    <button
                        type="button"
                        className="mt-2 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
                        title="Keep this summary and treat the current source as reviewed"
                        onClick={() => acknowledgeChapterSummaryChanges(chapter.id)}
                    >
                        Keep summary and mark reviewed
                    </button>
                )}
            </div>

            <ChapterSummarySuggestionReview
                chapterId={chapter.id}
                chapterTitle={chapter.title}
                volumeTitle={chapter.volumeTitle}
                hasWrittenText={chapter.hasWrittenText}
                isReadOnly={isReadOnly || chapter.isReadOnly}
                isGenerating={isGenerating}
                isAnyGenerating={isAnyGenerating}
                modelAvailability={modelAvailability}
                modelNotice={modelNotice}
                suggestion={suggestion}
                isCurrent={isCurrent}
                onGenerate={generateSuggestion}
                onStop={stopSuggestion}
                onAccept={acceptSuggestion}
                onKeepManual={keepManual}
                onToggleHit={toggleSuggestionHit}
            />
        </section>
    );
}
