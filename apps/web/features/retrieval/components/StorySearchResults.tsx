import { AlertCircle, BookOpen, ChevronDown, ChevronUp, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import type {
    EmbeddingStatus,
    RetrievalIndexStatus,
    RetrievalRecallMethod,
    RetrievalSearchFilters,
    RetrievalSearchHit,
    RetrievalSearchResponse,
} from '../../../domain/retrieval/contracts';
import { buildSearchPreview, SEARCH_PREVIEW_MAX_CHARACTERS, splitPreviewHighlight } from '../../../domain/retrieval/searchPreview';
import type { SearchHitFocusAnchor } from '../../../domain/retrieval/searchPreview';
import type { RetrievalIndexProgress, StorySearchChapterOption } from '../hooks/useLocalStorySearch';
import { StorySearchFilters } from './StorySearchFilters';

const MATCH_LABELS: Record<RetrievalRecallMethod, { label: string; description: string }> = {
    semantic: { label: 'Semantic', description: 'Matched by meaning; the wording may differ.' },
    lexical: { label: 'Lexical', description: 'Matched by indexed words or phrases.' },
    adjacent: { label: 'Adjacent', description: 'A nearby passage included for context, not a direct match.' },
    alias: { label: 'Alias', description: 'Matched through a character name or alias.' },
};

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
    onSelectHit: (hit: RetrievalSearchHit, focus: SearchHitFocusAnchor | null) => void | Promise<void>;
    onOpenChapterSummary: (chapterId: string) => void;
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
        case 'ready': return 'Story search is ready';
        case 'queued': return 'Search update is waiting';
        case 'indexing': return 'Preparing story search';
        case 'stale': return 'Story search needs updating';
        case 'partial': return 'Some search material is not ready yet';
        case 'failed': return 'Search could not be updated';
        case 'not_configured': return 'Story search is not ready yet';
        default: return 'Story search is unavailable right now';
    }
}

function resultStatusMessage(response: RetrievalSearchResponse): string {
    if (response.status === 'embedding_unavailable') {
        return 'Meaning-based search is unavailable. Showing keyword matches instead.';
    }
    if (response.status === 'index_not_ready') {
        return 'Story search is still being prepared. Showing keyword matches for now.';
    }
    if (response.status === 'degraded_lexical') {
        return 'Meaning-based search could not finish. Showing keyword matches instead.';
    }
    if (response.degraded) {
        return 'Meaning-based search is unavailable. Showing keyword matches instead.';
    }
    if (response.status === 'budget_exhausted') {
        return 'Matches were found, but their excerpts could not be shown. Try a more specific search.';
    }
    if (response.status === 'stale_only') {
        return 'These matches may be out of date. Refresh search and try again.';
    }
    if (response.status === 'future_plan_only') {
        return 'Only future plans matched. They are not included in story search.';
    }
    if (response.status === 'lexical_no_match' || response.status === 'no_results') {
        return 'No story matches were found in this book.';
    }
    if (response.effectiveMode === 'semantic') {
        return 'Found passages related to your search.';
    }
    if (response.effectiveMode === 'lexical') {
        return 'Found passages matching your keywords.';
    }
    return 'Showing the closest matches first.';
}

function hitTitle(hit: RetrievalSearchHit): string {
    return hit.locator.chapterTitleSnapshot
        || hit.chapterId
        || SOURCE_LABELS[hit.sourceKind];
}

function hitExcerpt(hit: RetrievalSearchHit): string {
    return hit.chunk.sourceText || hit.quote || hit.locator.shortQuote || hit.chunk.shortQuote || 'No excerpt available.';
}

function renderIndexProgress(progress: RetrievalIndexProgress | null): ReactElement | null {
    if (!progress) return null;
    const percent = Math.min(100, Math.max(0, progress.percent));
    return (
        <div className="mt-2 rounded-md bg-slate-100 px-2 py-2 dark:bg-slate-950">
            <div className="text-center text-[10px] text-slate-500 dark:text-slate-400">
                <span>{progress.totalSources === 0
                    ? 'No search material yet'
                    : <>{progress.completedSources}/{progress.totalSources} sources · <strong className="font-semibold">{percent}%</strong></>}</span>
            </div>
            <div
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
                role="progressbar"
                aria-label="Search preparation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            >
                <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${percent}%` }} />
            </div>
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
                {isBusy ? 'Preparing search…' : indexStatus === 'failed' ? 'Retry search update' : indexStatus === 'ready' ? 'Refresh search' : 'Prepare search'}
            </button>
        </div>
    );
}

function SearchHitCard({
    hit,
    query,
    expanded,
    onToggleExpanded,
    onSelect,
    onOpenChapterSummary,
}: {
    hit: RetrievalSearchHit;
    query: string;
    expanded: boolean;
    onToggleExpanded: () => void;
    onSelect: (focus: SearchHitFocusAnchor | null) => void;
    onOpenChapterSummary: (chapterId: string) => void;
}): ReactElement {
    const excerpt = hitExcerpt(hit);
    const preview = buildSearchPreview(excerpt, query);
    const isLexicalHit = hit.recallMethods.includes('lexical');
    const highlightedPreview = isLexicalHit ? splitPreviewHighlight(preview) : null;
    const canExpand = Array.from(excerpt).length > SEARCH_PREVIEW_MAX_CHARACTERS;
    const chapterId = hit.chapterId || hit.locator.chapterId;
    const canLocateInManuscript = hit.sourceKind === 'manuscript'
        && Boolean(hit.chunk.sourceText)
        && Boolean(hit.locator.paragraphSpans?.length);
    const actionLabel = hit.sourceKind === 'chapter_summary'
        ? 'Open summary'
        : canLocateInManuscript ? 'Open and locate' : 'Open chapter';
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
            {hit.freshness !== 'fresh' && <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">This match may be out of date. Refresh search to check it.</p>}
            <p className={`mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-300 ${expanded ? '' : 'line-clamp-3'}`}>
                {expanded ? excerpt : highlightedPreview ? <>
                    {highlightedPreview.before}
                    <mark className="rounded-sm bg-amber-200/80 text-slate-950 dark:bg-amber-500/40 dark:text-slate-50">
                        {highlightedPreview.match}
                    </mark>
                    {highlightedPreview.after}
                </> : preview.text}
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
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                <div className="flex flex-wrap gap-1" aria-label="Match types">
                    {hit.recallMethods.map(method => (
                        <span key={method} title={MATCH_LABELS[method].description}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {MATCH_LABELS[method].label}
                        </span>
                    ))}
                </div>
                {chapterId ? (
                    <button
                        type="button"
                        onClick={() => {
                            if (hit.sourceKind === 'chapter_summary') {
                                onOpenChapterSummary(chapterId);
                                return;
                            }
                            onSelect(canLocateInManuscript && highlightedPreview
                                ? { chunkTextOffset: preview.chunkTextOffset, focusTextLength: preview.focusTextLength }
                                : null);
                        }}
                        className="ml-auto font-semibold text-brand-700 hover:underline dark:text-brand-300"
                    >
                        {actionLabel}
                    </button>
                ) : (
                    <span className="ml-auto">Whole book</span>
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
    onOpenChapterSummary,
}: StorySearchResultsProps): ReactElement {
    const [expandedHitIds, setExpandedHitIds] = useState<Set<string>>(() => new Set());
    const showInitialStatus = !response && !isSearching && !searchError;

    return (
        <div className="flex h-full min-h-0 flex-col" aria-live="polite">
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 pb-2" aria-label="Story search results">
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
                        <span>{isStatusLoading ? 'Checking story search…' : statusLabel(indexStatus)}</span>
                    </div>
                    {statusError && <p role="alert" className="mt-1 text-amber-600 dark:text-amber-300">{statusError}</p>}
                    {!embeddingStatus ? (
                        <p className="mt-1">Story search is unavailable right now. You can still use Title / Chapter search.</p>
                    ) : !embeddingStatus.available ? (
                        <>
                            <p className="mt-1">Story search could not start. Try restarting StoryArk. You can still use Title / Chapter search.</p>
                        </>
                    ) : indexStatus !== 'ready' ? (
                        <p className="mt-1">Prepare search to find passages in this book. You can keep writing while it runs.</p>
                    ) : (
                        <p className="mt-1">Find passages by meaning or keywords in this book.</p>
                    )}
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
                        <div className="space-y-1.5">
                            {response.hits.map(hit => (
                                <SearchHitCard
                                    key={hit.hitId}
                                    hit={hit}
                                    query={lastQuery}
                                    expanded={expandedHitIds.has(hit.hitId)}
                                    onToggleExpanded={() => setExpandedHitIds(previous => {
                                        const next = new Set(previous);
                                        if (next.has(hit.hitId)) next.delete(hit.hitId);
                                        else next.add(hit.hitId);
                                        return next;
                                    })}
                                    onSelect={focus => void onSelectHit(hit, focus)}
                                    onOpenChapterSummary={onOpenChapterSummary}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
            </div>
            {(indexProgress || (embeddingStatus?.available && indexStatus)) && (
                <div aria-label="Local story index controls" className="shrink-0 border-t border-slate-200 pt-2 dark:border-slate-800">
                    {renderIndexProgress(indexProgress)}
                    {renderIndexAction(embeddingStatus, indexStatus, isIndexing, isStatusLoading, onQueueIndex)}
                </div>
            )}
        </div>
    );
}
