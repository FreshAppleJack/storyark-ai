import { useState } from 'react';
import { Check, Eye, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { ChapterSummarySuggestion } from '../../../domain/chapterSummarySource';
import type { SummaryModelAvailability } from '../hooks/useChapterSummarySuggestions';
import { RetrievalContextPanel } from '../../retrieval/components/RetrievalContextPanel';

interface Props {
    chapterId: string;
    chapterTitle: string;
    volumeTitle: string;
    hasWrittenText: boolean;
    isReadOnly: boolean;
    isGenerating: boolean;
    isAnyGenerating: boolean;
    modelAvailability: SummaryModelAvailability;
    modelNotice: string | null;
    suggestion?: ChapterSummarySuggestion;
    isCurrent: boolean;
    onGenerate: (chapterId: string) => void;
    onStop: (chapterId: string) => void;
    onAccept: (chapterId: string) => void;
    onKeepManual: (chapterId: string) => void;
    onToggleHit: (chapterId: string, hitId: string) => void;
}

function statusText(suggestion: ChapterSummarySuggestion, isCurrent: boolean): string {
    switch (suggestion.status) {
        case 'starting': return 'Preparing the chapter snapshot and local supporting sources…';
        case 'streaming': return 'Streaming into a temporary suggestion. The saved summary is unchanged.';
        case 'candidate': return isCurrent
            ? 'Suggestion ready. Your current summary stays unchanged until you accept it.'
            : 'The source changed after generation. This suggestion is preserved for review but cannot be accepted.';
        case 'invalid': return 'The response could not be used as a summary. Raw text is preserved below; the current summary is unchanged.';
        case 'cancelled': return 'Generation stopped. The current summary is unchanged.';
        case 'stale': return 'The chapter, planning, or a supporting source changed. Review or regenerate; this suggestion was not adopted.';
        case 'adopting': return 'Saving the accepted summary through the planning version check…';
        case 'save-failed': return 'The suggestion is present in the planning draft, but its save failed. Resolve the save conflict before retrying.';
        case 'failed': return 'Generation failed. The current summary is unchanged.';
        default: return 'Suggestion is waiting for review.';
    }
}

export function ChapterSummarySuggestionReview({
    chapterId,
    chapterTitle,
    volumeTitle,
    hasWrittenText,
    isReadOnly,
    isGenerating,
    isAnyGenerating,
    modelAvailability,
    modelNotice,
    suggestion,
    isCurrent,
    onGenerate,
    onStop,
    onAccept,
    onKeepManual,
    onToggleHit,
}: Props) {
    const [isReviewOpen, setIsReviewOpen] = useState(false);
    const generationUnavailable = modelAvailability !== 'ready';
    const isStreaming = isGenerating && (suggestion?.status === 'starting' || suggestion?.status === 'streaming');
    const isAdopting = suggestion?.status === 'adopting';
    const canGenerate = hasWrittenText && !isReadOnly && !isAnyGenerating && !isAdopting && !generationUnavailable && suggestion?.status !== 'save-failed';
    const hasCandidate = suggestion?.status === 'candidate';
    const canAccept = hasCandidate && isCurrent && !isReadOnly && !isGenerating;

    return (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <Sparkles size={14} className="text-brand-500" />
                    Chapter summary suggestion
                </div>
                {isStreaming ? (
                    <Button variant="secondary" size="sm" onClick={() => onStop(chapterId)} icon={<X size={14} />}>Stop</Button>
                ) : (
                    <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canGenerate}
                        onClick={() => { onGenerate(chapterId); }}
                        icon={modelAvailability === 'checking' ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        title={generationUnavailable ? modelNotice ?? undefined : undefined}
                    >
                        {suggestion ? 'Regenerate suggestion' : 'Generate suggestion'}
                    </Button>
                )}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                Creates a third-person summary of about 200–250 Chinese characters. Generated text stays a suggestion until accepted.
            </p>
            {!hasWrittenText && <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">Add readable chapter text before generating. Manual summary editing remains available.</p>}
            {isReadOnly && <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-300">This book is locked. You can review the summary, but generation and acceptance are disabled.</p>}
            {modelNotice && <p role="status" className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{modelNotice}</p>}

            {suggestion && (
                <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                    {suggestion.sourceSnapshot && <p className="mb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Primary source: {volumeTitle} / {chapterTitle} · chapter v{suggestion.sourceSnapshot.chapterDatabaseVersion ?? 'unversioned'}
                    </p>}
                    <p role="status" className={`text-xs leading-5 ${suggestion.status === 'invalid' || suggestion.status === 'failed' || suggestion.status === 'stale' || suggestion.status === 'save-failed'
                            ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}>
                        {statusText(suggestion, isCurrent)}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                        {hasCandidate && (
                            <Button size="sm" disabled={!canAccept} onClick={() => { onAccept(chapterId); }} icon={<Check size={14} />}>
                                Accept
                            </Button>
                        )}
                        {suggestion.status !== 'adopting' && (
                            <Button variant="secondary" size="sm" disabled={isGenerating} onClick={() => onKeepManual(chapterId)}>
                                Keep manual
                            </Button>
                        )}
                        {(suggestion.suggestedSummary || suggestion.rawText) && (
                            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setIsReviewOpen(open => !open)} icon={<Eye size={14} />}>
                                {isReviewOpen ? 'Hide review' : 'Review'}
                            </Button>
                        )}
                    </div>
                    {suggestion.errorMessage && <p role="alert" className="mt-2 text-xs leading-5 text-rose-700 dark:text-rose-300">{suggestion.errorMessage}</p>}
                    {suggestion.status === 'streaming' && suggestion.rawText && (
                        <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">{suggestion.rawText}</pre>
                    )}
                    {suggestion.lastAttempt && (
                        <details className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs dark:border-amber-900/60 dark:bg-amber-950/20">
                            <summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">Review the latest unsuccessful attempt</summary>
                            <p className="mt-2 leading-5 text-amber-800 dark:text-amber-200">{suggestion.lastAttempt.errorMessage}</p>
                            {suggestion.lastAttempt.rawText && <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded border border-amber-200 bg-white p-2 text-xs leading-5 text-slate-700 dark:border-amber-900/60 dark:bg-slate-950 dark:text-slate-200">{suggestion.lastAttempt.rawText}</pre>}
                        </details>
                    )}
                    {isReviewOpen && (
                        <div className="mt-3 grid grid-cols-1 gap-3">
                            <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Current summary</h4>
                                <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{suggestion.previousSummary || 'No existing summary.'}</p>
                            </div>
                            <div className="rounded-lg border border-brand-200 bg-white p-3 dark:border-brand-900/60 dark:bg-slate-900">
                                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-300">Suggested summary</h4>
                                <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{suggestion.suggestedSummary ?? suggestion.rawText ?? 'Waiting for model output…'}</p>
                            </div>
                            <div>
                                <RetrievalContextPanel
                                    context={suggestion.retrievalContext}
                                    notice={suggestion.retrievalNotice}
                                    excludedHitIds={suggestion.retrievalContext?.excludedHitIds ?? []}
                                    onToggleHit={hitId => onToggleHit(chapterId, hitId)}
                                    disabled={isGenerating || isReadOnly}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
