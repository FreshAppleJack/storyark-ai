import { AlertCircle, BookOpen, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type {
    EmbeddingStatus,
    RetrievalIndexStatus,
    RetrievalSearchFilters,
    RetrievalSearchHit,
    RetrievalSearchResponse,
} from '../../../domain/retrieval/contracts';
import type { RetrievalIndexProgress, StorySearchChapterOption } from '../hooks/useLocalStorySearch';
import { StorySearchFilters } from './StorySearchFilters';

interface StorySearchResultsProps {
    embeddingStatus: EmbeddingStatus | null;
    indexStatus: RetrievalIndexStatus | null;
    indexProgress: RetrievalIndexProgress | null;
    statusError: string | null;
    isStatusLoading: boolean;
    isIndexing: boolean;
    isSearching: boolean;
    searchError: string | null;
    response: RetrievalSearchResponse | null;
    lastQuery: string;
    filters: RetrievalSearchFilters;
    chapters: StorySearchChapterOption[];
    activeChapterId: string;
    selectionMessage: string;
    onFiltersChange: (patch: Partial<RetrievalSearchFilters>) => void;
    onQueueIndex: () => void;
    onSelectHit: (hit: RetrievalSearchHit) => void | Promise<void>;
}

const SOURCE_LABELS: Record<RetrievalSearchHit['sourceKind'], string> = {
    manuscript: 'Manuscript',
    chapter_summary: 'Chapter summary',
    planning: 'Planning',
    confirmed_setting: 'Confirmed setting',
    character: 'Character',
    relationship: 'Relationship',
    foreshadowing_note: 'Foreshadowing note',
    future_plan: 'Future plan',
};

function statusLabel(status: RetrievalIndexStatus | null): string {
    switch (status) {
        case 'ready': return 'Local story index ready';
        case 'queued': return 'Local story index queued';
        case 'indexing': return 'Building local story index';
        case 'stale': return 'Local story index needs rebuilding';
        case 'partial': return 'Local story index is incomplete';
        case 'failed': return 'Local story index failed';
        case 'not_configured': return 'Local embedding is not ready';
        default: return 'Local semantic search status unavailable';
    }
}

function resultStatusMessage(response: RetrievalSearchResponse): string {
    if (response.status === 'embedding_unavailable') {
        return 'Local embedding is unavailable. Showing lexical matches from this book.';
    }
    if (response.status === 'index_not_ready') {
        return 'The local semantic index is not ready for the selected scope. Showing the available lexical matches.';
    }
    if (response.status === 'degraded_lexical') {
        return 'The local embedding query was unavailable. Showing lexical matches from this book.';
    }
    if (response.degraded) {
        return 'Semantic retrieval was unavailable for the selected scope. Showing lexical matches from this book.';
    }
    if (response.status === 'budget_exhausted') {
        return 'Matches were found, but the context budget was too small to include their excerpts.';
    }
    if (response.status === 'stale_only') {
        return 'Only stale sources matched. Refresh the local index before treating these as current evidence.';
    }
    if (response.status === 'future_plan_only') {
        return 'Only future-plan material matched, and it is excluded from story search.';
    }
    if (response.status === 'lexical_no_match' || response.status === 'no_results') {
        return 'No story matches were found in this book.';
    }
    if (response.effectiveMode === 'semantic') {
        return 'Semantic matches are ready for this scope. Scores are ranking signals, not probabilities.';
    }
    if (response.effectiveMode === 'lexical') {
        return 'Lexical matches are ready for this scope. Scores are ranking signals, not probabilities.';
    }
    return 'Semantic and lexical matches are ranked together. Scores are ranking signals, not probabilities.';
}

function hitTitle(hit: RetrievalSearchHit): string {
    return hit.locator.chapterTitleSnapshot
        || hit.chapterId
        || SOURCE_LABELS[hit.sourceKind];
}

function hitExcerpt(hit: RetrievalSearchHit): string {
    return hit.chunk.sourceText || hit.quote || hit.locator.shortQuote || hit.chunk.shortQuote || 'No excerpt available.';
}

function formatTimestamp(timestamp: number | null): string {
    if (timestamp === null) return 'Not indexed';
    return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

function renderIndexProgress(progress: RetrievalIndexProgress | null): ReactElement | null {
    if (!progress) return null;
    const percent = Math.min(100, Math.max(0, progress.percent));
    return (
        <div className="mt-2 rounded-md bg-slate-100 px-2 py-2 dark:bg-slate-950">
            <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>Approximate source progress</span>
                <span>{progress.totalSources === 0
                    ? 'No indexable sources'
                    : `${progress.completedSources}/${progress.totalSources} sources · ${percent}%`}</span>
            </div>
            <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                role="progressbar"
                aria-label="Approximate local embedding index progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-[10px] leading-4 text-slate-400 dark:text-slate-500">
                One source can contain many chunks, so this is a progress estimate rather than a token counter.
            </p>
        </div>
    );
}

function renderIndexAction(
    embeddingStatus: EmbeddingStatus | null,
    indexStatus: RetrievalIndexStatus | null,
    isIndexing: boolean,
    isStatusLoading: boolean,
    onQueueIndex: () => void,
): ReactElement | null {
    if (!embeddingStatus?.available || !indexStatus) return null;

    const isBusy = isIndexing || indexStatus === 'queued' || indexStatus === 'indexing';
    return (
        <div className="mt-2 flex justify-center">
            <button
                type="button"
                onClick={onQueueIndex}
                disabled={isBusy || isStatusLoading}
                className="inline-flex items-center gap-1.5 rounded-md border border-brand-200 px-2 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950/40"
            >
                {isBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {isBusy ? 'Indexing…' : indexStatus === 'failed' ? 'Retry index' : indexStatus === 'ready' ? 'Rebuild local index' : 'Build local index'}
            </button>
        </div>
    );
}

function SearchHitCard({
    hit,
    expanded,
    onToggleExpanded,
    onSelect,
}: {
    hit: RetrievalSearchHit;
    expanded: boolean;
    onToggleExpanded: () => void;
    onSelect: () => void;
}): ReactElement {
    const excerpt = hitExcerpt(hit);
    const canExpand = excerpt.length > 240;
    const location = [hit.locator.volumeTitleSnapshot, hitTitle(hit)]
        .filter(Boolean)
        .join(' / ');

    return (
        <article className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start gap-1.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                <BookOpen size={12} className="mt-0.5 flex-shrink-0" />
                <span className="min-w-0 flex-1 truncate" title={location}>{location}</span>
                <span className="flex-shrink-0 font-normal text-slate-400">{SOURCE_LABELS[hit.sourceKind]}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-slate-400">
                <span>Source v{hit.sourceVersion}</span>
                <span>Indexed {formatTimestamp(hit.indexUpdatedAt)}</span>
                <span>{hit.freshness}</span>
            </div>
            <p className={`mt-1 text-xs leading-5 text-slate-700 dark:text-slate-300 ${expanded ? '' : 'line-clamp-3'}`}>
                {excerpt}
            </p>
            {canExpand && (
                <button
                    type="button"
                    onClick={onToggleExpanded}
                    className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-brand-700 hover:underline dark:text-brand-300"
                >
                    {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    {expanded ? 'Show less' : 'Show full excerpt'}
                </button>
            )}
            <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                <span>{hit.recallMethods.join(' + ')}</span>
                <span>•</span>
                <span>Evidence object</span>
                {hit.chapterId ? (
                    <button
                        type="button"
                        onClick={onSelect}
                        className="ml-auto font-semibold text-brand-700 hover:underline dark:text-brand-300"
                    >
                        Open and locate
                    </button>
                ) : (
                    <span className="ml-auto">Book-level source</span>
                )}
            </div>
        </article>
    );
}

export function StorySearchResults({
    embeddingStatus,
    indexStatus,
    indexProgress,
    statusError,
    isStatusLoading,
    isIndexing,
    isSearching,
    searchError,
    response,
    lastQuery,
    filters,
    chapters,
    activeChapterId,
    selectionMessage,
    onFiltersChange,
    onQueueIndex,
    onSelectHit,
}: StorySearchResultsProps): ReactElement {
    const [expandedHitIds, setExpandedHitIds] = useState<Set<string>>(() => new Set());
    const showInitialStatus = !response && !isSearching && !searchError;

    return (
        <div className="space-y-2" aria-live="polite">
            <StorySearchFilters
                filters={filters}
                chapters={chapters}
                activeChapterId={activeChapterId}
                onChange={onFiltersChange}
            />

            {isSearching && (
                <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:border-brand-900 dark:bg-brand-950/30 dark:text-brand-300">
                    <Loader2 size={14} className="animate-spin" />
                    <span>Searching this book…</span>
                </div>
            )}

            {searchError && (
                <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{searchError}</span>
                </div>
            )}

            {selectionMessage && (
                <p role="status" className={`rounded-lg border px-3 py-2 text-xs leading-5 ${selectionMessage.startsWith('Opened')
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'}`}>
                    {selectionMessage}
                </p>
            )}

            {showInitialStatus && (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                        <Sparkles size={13} className="text-brand-500" />
                        <span>{isStatusLoading ? 'Checking local semantic search…' : statusLabel(indexStatus)}</span>
                    </div>
                    {statusError && <p role="alert" className="mt-1 text-amber-600 dark:text-amber-300">{statusError}</p>}
                    {!embeddingStatus ? (
                        <p className="mt-1">Semantic search status is unavailable. Title / Chapter search remains available; retry when the desktop storage is ready.</p>
                    ) : !embeddingStatus.available ? (
                        <>
                            <p className="mt-1">Semantic search needs the local embedding model before it can build or query the semantic index. Title / Chapter search remains available.</p>
                            {embeddingStatus.errorMessage && <p className="mt-1 text-amber-600 dark:text-amber-300">{embeddingStatus.errorMessage}</p>}
                        </>
                    ) : indexStatus !== 'ready' ? (
                        <p className="mt-1">Semantic search needs a ready local index. You can build it here without affecting writing or title search.</p>
                    ) : (
                        <p className="mt-1">Searches the current book using local semantic and lexical evidence.</p>
                    )}
                    {renderIndexProgress(indexProgress)}
                    {renderIndexAction(embeddingStatus, indexStatus, isIndexing, isStatusLoading, onQueueIndex)}
                </div>
            )}

            {response && (
                <div className="space-y-2">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                        <div className="font-semibold text-slate-700 dark:text-slate-200">
                            <span>{resultStatusMessage(response)}</span>
                        </div>
                        <p className="mt-1">
                            {response.hits.length > 0
                                ? `${response.hits.length} result${response.hits.length === 1 ? '' : 's'} for “${lastQuery}”.`
                                : 'Try a character name, event, setting, or phrase from the manuscript.'}
                        </p>
                    </div>
                    {response.hits.length > 0 && (
                        <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
                            {response.hits.map(hit => (
                                <SearchHitCard
                                    key={hit.hitId}
                                    hit={hit}
                                    expanded={expandedHitIds.has(hit.hitId)}
                                    onToggleExpanded={() => setExpandedHitIds(previous => {
                                        const next = new Set(previous);
                                        if (next.has(hit.hitId)) next.delete(hit.hitId);
                                        else next.add(hit.hitId);
                                        return next;
                                    })}
                                    onSelect={() => void onSelectHit(hit)}
                                />
                            ))}
                        </div>
                    )}
                    {renderIndexProgress(indexProgress)}
                    {renderIndexAction(embeddingStatus, indexStatus, isIndexing, isStatusLoading, onQueueIndex)}
                </div>
            )}
        </div>
    );
}
