import { AlertCircle, BookOpen, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type {
    EmbeddingStatus,
    RetrievalIndexStatus,
    RetrievalSearchHit,
    RetrievalSearchResponse,
} from '../../../domain/retrieval/contracts';

interface StorySearchResultsProps {
    embeddingStatus: EmbeddingStatus | null;
    indexStatus: RetrievalIndexStatus | null;
    statusError: string | null;
    isStatusLoading: boolean;
    isIndexing: boolean;
    isSearching: boolean;
    searchError: string | null;
    response: RetrievalSearchResponse | null;
    lastQuery: string;
    onQueueIndex: () => void;
    onSelectHit: (hit: RetrievalSearchHit) => void;
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
        default: return 'Checking local story index';
    }
}

function resultStatusMessage(response: RetrievalSearchResponse): string {
    if (response.degraded || response.status === 'degraded_lexical' || response.status === 'embedding_unavailable') {
        return 'Semantic search is unavailable or the index is not ready. Showing lexical matches from this book.';
    }
    if (response.status === 'index_not_ready') {
        return 'The local semantic index is not ready. Showing the available lexical matches.';
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
    return 'Semantic and lexical matches are ranked together. Scores are ranking signals, not probabilities.';
}

function hitTitle(hit: RetrievalSearchHit): string {
    return hit.locator.chapterTitleSnapshot
        || hit.chapterId
        || SOURCE_LABELS[hit.sourceKind];
}

function hitQuote(hit: RetrievalSearchHit): string {
    return hit.quote || hit.locator.shortQuote || hit.chunk.shortQuote || 'No excerpt available.';
}

function renderIndexAction(
    embeddingStatus: EmbeddingStatus | null,
    indexStatus: RetrievalIndexStatus | null,
    isIndexing: boolean,
    isStatusLoading: boolean,
    onQueueIndex: () => void,
): React.ReactElement | null {
    if (!embeddingStatus?.available || indexStatus === 'ready' || !indexStatus) return null;

    const isBusy = isIndexing || indexStatus === 'queued' || indexStatus === 'indexing';
    return (
        <button
            type="button"
            onClick={onQueueIndex}
            disabled={isBusy || isStatusLoading}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-brand-200 px-2 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-950/40"
        >
            {isBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {isBusy ? 'Indexing…' : indexStatus === 'failed' ? 'Retry index' : 'Build local index'}
        </button>
    );
}

export function StorySearchResults({
    embeddingStatus,
    indexStatus,
    statusError,
    isStatusLoading,
    isIndexing,
    isSearching,
    searchError,
    response,
    lastQuery,
    onQueueIndex,
    onSelectHit,
}: StorySearchResultsProps): React.ReactElement {
    const showInitialStatus = !response && !isSearching && !searchError;

    return (
        <div className="space-y-2" aria-live="polite">
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

            {showInitialStatus && (
                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                        <Sparkles size={13} className="text-brand-500" />
                        <span>{isStatusLoading ? 'Checking local semantic search…' : statusLabel(indexStatus)}</span>
                    </div>
                    {statusError && <p className="mt-1 text-amber-600 dark:text-amber-300">{statusError}</p>}
                    {!embeddingStatus?.available ? (
                        <p className="mt-1">Semantic search needs local embedding or an index that is still building. Title / Chapter search remains available.</p>
                    ) : indexStatus !== 'ready' ? (
                        <p className="mt-1">Semantic search needs a ready local index. You can build it here without affecting writing or title search.</p>
                    ) : (
                        <p className="mt-1">Searches the current book using local semantic and lexical evidence.</p>
                    )}
                    {renderIndexAction(embeddingStatus, indexStatus, isIndexing, isStatusLoading, onQueueIndex)}
                </div>
            )}

            {response && (
                <div className="space-y-2">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                        <div className="flex items-center gap-2 font-semibold text-slate-700 dark:text-slate-200">
                            <Sparkles size={13} className="text-brand-500" />
                            <span>{resultStatusMessage(response)}</span>
                        </div>
                        <p className="mt-1">
                            {response.hits.length > 0
                                ? `${response.hits.length} result${response.hits.length === 1 ? '' : 's'} for “${lastQuery}”.`
                                : 'Try a character name, event, setting, or phrase from the manuscript.'}
                        </p>
                    </div>
                    {response.hits.length > 0 && (
                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                            {response.hits.map(hit => (
                                <button
                                    key={hit.hitId}
                                    type="button"
                                    onClick={() => onSelectHit(hit)}
                                    disabled={!hit.chapterId}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-brand-300 hover:bg-brand-50 disabled:cursor-default disabled:hover:border-slate-200 disabled:hover:bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-800 dark:hover:bg-brand-950/30 dark:disabled:hover:border-slate-800 dark:disabled:hover:bg-slate-900"
                                >
                                    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                                        <BookOpen size={12} />
                                        <span className="truncate">{hitTitle(hit)}</span>
                                        <span className="ml-auto flex-shrink-0 font-normal text-slate-400">{SOURCE_LABELS[hit.sourceKind]}</span>
                                    </div>
                                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-700 dark:text-slate-300">{hitQuote(hit)}</p>
                                    <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                                        <span>{hit.recallMethods.join(' + ')}</span>
                                        <span>•</span>
                                        <span>{hit.freshness}</span>
                                        {hit.chapterId && <span className="ml-auto">Open source</span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    {renderIndexAction(embeddingStatus, indexStatus, isIndexing, isStatusLoading, onQueueIndex)}
                </div>
            )}
        </div>
    );
}
