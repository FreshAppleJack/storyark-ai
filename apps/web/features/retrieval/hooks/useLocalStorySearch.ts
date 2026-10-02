import { isTauri } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { retrievalRepository } from '../../../data/local/retrievalRepository';
import { reportError, userErrorMessage } from '../../../data/diagnostics';
import type {
    EmbeddingStatus,
    RetrievalIndexStatus,
    RetrievalSearchResponse,
    RetrievalSearchFilters,
    RetrievalSource,
    RetrievalSourceKind,
} from '../../../domain/retrieval/contracts';

export const STORY_SEARCH_SOURCE_KINDS: RetrievalSourceKind[] = [
    'manuscript',
    'chapter_summary',
    'confirmed_setting',
    'character',
    'relationship',
    'foreshadowing_note',
];

export const STORY_SEARCH_FILTER_SOURCE_KINDS: RetrievalSourceKind[] = [
    ...STORY_SEARCH_SOURCE_KINDS,
    'planning',
];

export interface StorySearchChapterOption {
    id: string;
    title: string;
    volumeTitle: string;
}

export interface LocalStorySearchOptions {
    chapterIds?: string[];
    activeChapterId?: string;
}

export interface RetrievalIndexProgress {
    basis: 'sources';
    completedSources: number;
    totalSources: number;
    activeSources: number;
    failedSources: number;
    percent: number;
}

export const STORY_SEARCH_LIMIT = 8;
export const STORY_SEARCH_CHAR_BUDGET = 6_000;
export const STORY_SEARCH_TOKEN_BUDGET = 1_500;

const INDEX_POLL_INTERVAL_MS = 1_500;
const EMPTY_CHAPTER_IDS: string[] = [];

export interface LocalStorySearchState {
    embeddingStatus: EmbeddingStatus | null;
    indexStatus: RetrievalIndexStatus | null;
    statusError: string | null;
    isStatusLoading: boolean;
    isIndexing: boolean;
    indexProgress: RetrievalIndexProgress | null;
    isSearching: boolean;
    searchError: string | null;
    response: RetrievalSearchResponse | null;
    lastQuery: string;
    filters: RetrievalSearchFilters;
    updateFilters: (patch: Partial<RetrievalSearchFilters>) => void;
    refreshStatus: () => Promise<void>;
    queueIndex: () => Promise<void>;
    search: (query: string) => Promise<void>;
    clearSearch: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
    return userErrorMessage(error, fallback, 'story-search');
}

function deriveIndexStatus(
    embeddingStatus: EmbeddingStatus,
    sources: RetrievalSource[],
): { status: RetrievalIndexStatus; progress: RetrievalIndexProgress } {
    const emptyProgress: RetrievalIndexProgress = {
        basis: 'sources',
        completedSources: 0,
        totalSources: 0,
        activeSources: 0,
        failedSources: 0,
        percent: 100,
    };
    if (!embeddingStatus.available) return { status: 'not_configured', progress: emptyProgress };

    const indexableSources = sources.filter(source => (
        source.sourceStatus !== 'discarded' && source.sourceText.trim().length > 0
    ));

    const currentFingerprint = embeddingStatus.fingerprint;
    const completedSources = indexableSources.filter(source => (
        source.indexStatus === 'ready'
        && currentFingerprint !== null
        && source.embeddingFingerprint === currentFingerprint
    )).length;
    const progress: RetrievalIndexProgress = {
        basis: 'sources',
        completedSources,
        totalSources: indexableSources.length,
        activeSources: indexableSources.filter(source => ['queued', 'indexing'].includes(source.indexStatus)).length,
        failedSources: indexableSources.filter(source => source.indexStatus === 'failed').length,
        percent: indexableSources.length === 0
            ? 100
            : Math.round((completedSources / indexableSources.length) * 100),
    };
    if (indexableSources.length === 0) return { status: 'ready', progress };

    const hasFingerprintMismatch = indexableSources.some(source => (
        source.indexStatus === 'ready'
        && currentFingerprint !== null
        && source.embeddingFingerprint !== currentFingerprint
    ));
    if (hasFingerprintMismatch) return { status: 'stale', progress };

    const statuses = new Set(indexableSources.map(source => source.indexStatus));
    if (statuses.has('failed')) return { status: 'failed', progress };
    if (statuses.has('indexing')) return { status: 'indexing', progress };
    if (statuses.has('queued')) return { status: 'queued', progress };
    if (statuses.has('stale')) return { status: 'stale', progress };
    if (statuses.has('partial') || statuses.has('not_configured') || indexableSources.some(source => source.sourceStatus === 'pending')) {
        return { status: 'partial', progress };
    }
    return { status: 'ready', progress };
}

export function createDefaultStorySearchFilters(): RetrievalSearchFilters {
    return {
        sourceKinds: [...STORY_SEARCH_SOURCE_KINDS],
        includePlanning: false,
        chapterRange: 'all',
        updatedAfter: null,
        updatedBefore: null,
    };
}

const DEFAULT_FILTERS = createDefaultStorySearchFilters();

function buildScope(
    bookId: string,
    filters: RetrievalSearchFilters,
    chapterIds: string[],
    activeChapterId?: string,
) {
    const allowedSourceKinds = filters.sourceKinds.filter(kind => (
        filters.includePlanning || kind !== 'planning'
    ));
    if (filters.includePlanning && !allowedSourceKinds.includes('planning')) {
        allowedSourceKinds.push('planning');
    }
    let allowedChapterIds: string[] = [];
    if (filters.chapterRange === 'current' && activeChapterId) {
        allowedChapterIds = [activeChapterId];
    } else if (filters.chapterRange === 'before_current' && activeChapterId) {
        const activeIndex = chapterIds.indexOf(activeChapterId);
        allowedChapterIds = activeIndex >= 0 ? chapterIds.slice(0, activeIndex + 1) : [];
    }
    return {
        bookId,
        allowedSourceKinds,
        allowedChapterIds,
        includeFuturePlan: false,
        includeGenerated: false,
        includeStale: false,
        timeRange: filters.updatedAfter !== null || filters.updatedBefore !== null
            ? {
                updatedAfter: filters.updatedAfter ?? undefined,
                updatedBefore: filters.updatedBefore ?? undefined,
            }
            : undefined,
    };
}

export function useLocalStorySearch(
    bookId: string,
    enabled: boolean,
    options: LocalStorySearchOptions = {},
): LocalStorySearchState {
    const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
    const [indexStatus, setIndexStatus] = useState<RetrievalIndexStatus | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    const [isStatusLoading, setIsStatusLoading] = useState(false);
    const [isIndexing, setIsIndexing] = useState(false);
    const [indexProgress, setIndexProgress] = useState<RetrievalIndexProgress | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [response, setResponse] = useState<RetrievalSearchResponse | null>(null);
    const [lastQuery, setLastQuery] = useState('');
    const [filters, setFilters] = useState<RetrievalSearchFilters>(() => ({
        ...DEFAULT_FILTERS,
        sourceKinds: [...DEFAULT_FILTERS.sourceKinds],
    }));
    const statusRequestRef = useRef(0);
    const statusLoadedRef = useRef(false);
    const searchRequestRef = useRef(0);
    const chapterIds = options.chapterIds ?? EMPTY_CHAPTER_IDS;
    const scope = useMemo(
        () => buildScope(bookId, filters, chapterIds, options.activeChapterId),
        [bookId, chapterIds, filters, options.activeChapterId],
    );

    const refreshStatus = useCallback(async () => {
        if (!enabled || !bookId) return;
        const requestId = ++statusRequestRef.current;
        if (!statusLoadedRef.current) setIsStatusLoading(true);
        setStatusError(null);

        if (!isTauri()) {
            setEmbeddingStatus(null);
            setIndexStatus(null);
            setIndexProgress(null);
            setStatusError('Semantic search is available in the StoryArk desktop app.');
            statusLoadedRef.current = true;
            setIsStatusLoading(false);
            return;
        }

        try {
            const [embeddingResult, sourcesResult] = await Promise.allSettled([
                retrievalRepository.embeddingStatus(),
                retrievalRepository.listSources(scope),
            ]);
            if (requestId !== statusRequestRef.current) return;
            if (embeddingResult.status === 'rejected') {
                setEmbeddingStatus(null);
                setIndexStatus(null);
                setIndexProgress(null);
                setStatusError(errorMessage(embeddingResult.reason, 'Story search could not start. Try restarting StoryArk.'));
                return;
            }

            const nextEmbeddingStatus = embeddingResult.value;
            if (nextEmbeddingStatus.errorMessage) reportError('search.model', nextEmbeddingStatus.errorMessage, 'SEARCH_MODEL_UNAVAILABLE');
            setEmbeddingStatus(nextEmbeddingStatus);
            if (sourcesResult.status === 'rejected') {
                setIndexStatus(null);
                setIndexProgress(null);
                setStatusError(errorMessage(sourcesResult.reason, 'Search status could not be loaded. Try reopening the book.'));
                return;
            }
            const nextIndexState = deriveIndexStatus(nextEmbeddingStatus, sourcesResult.value);
            setIndexStatus(nextIndexState.status);
            setIndexProgress(nextIndexState.progress);
        } catch (error) {
            if (requestId !== statusRequestRef.current) return;
            setStatusError(errorMessage(error, 'Story search is unavailable right now. Try again later.'));
        } finally {
            if (requestId === statusRequestRef.current) {
                statusLoadedRef.current = true;
                setIsStatusLoading(false);
            }
        }
    }, [bookId, enabled, scope]);

    useEffect(() => {
        if (!enabled) return;
        statusLoadedRef.current = false;
        const timer = window.setTimeout(() => void refreshStatus(), 0);
        return () => window.clearTimeout(timer);
    }, [bookId, enabled, refreshStatus]);

    useEffect(() => {
        if (!enabled) return;
        const timer = window.setInterval(() => void refreshStatus(), INDEX_POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [enabled, refreshStatus]);

    const queueIndex = useCallback(async () => {
        if (!enabled || !bookId || !embeddingStatus?.available) return;
        setIsIndexing(true);
        setStatusError(null);
        try {
            await retrievalRepository.queueIndex(bookId);
            await refreshStatus();
        } catch (error) {
            setStatusError(errorMessage(error, 'The local semantic index could not be started.'));
        } finally {
            setIsIndexing(false);
        }
    }, [bookId, embeddingStatus?.available, enabled, refreshStatus]);

    const search = useCallback(async (query: string) => {
        const trimmedQuery = query.trim();
        if (!enabled || !bookId || !trimmedQuery) return;

        const requestId = ++searchRequestRef.current;
        setIsSearching(true);
        setSearchError(null);
        setLastQuery(trimmedQuery);
        try {
            const result = await retrievalRepository.search({
                scope,
                query: trimmedQuery,
                mode: 'hybrid',
                limit: STORY_SEARCH_LIMIT,
                excludedHitIds: [],
                charBudget: STORY_SEARCH_CHAR_BUDGET,
                tokenBudget: STORY_SEARCH_TOKEN_BUDGET,
                adjacentChunkCount: 1,
                task: 'generic',
                indexStatus: indexStatus ?? (embeddingStatus?.available ? 'partial' : 'not_configured'),
            });
            if (requestId === searchRequestRef.current) setResponse(result);
        } catch (error) {
            if (requestId === searchRequestRef.current) {
                setResponse(null);
                setSearchError(errorMessage(error, 'The story search could not be completed.'));
            }
        } finally {
            if (requestId === searchRequestRef.current) setIsSearching(false);
        }
    }, [bookId, embeddingStatus, enabled, indexStatus, scope]);

    const clearSearch = useCallback(() => {
        ++searchRequestRef.current;
        setResponse(null);
        setSearchError(null);
        setLastQuery('');
        setIsSearching(false);
    }, []);

    const updateFilters = useCallback((patch: Partial<RetrievalSearchFilters>) => {
        setFilters(previous => ({ ...previous, ...patch }));
        clearSearch();
    }, [clearSearch]);

    return {
        embeddingStatus,
        indexStatus,
        statusError,
        isStatusLoading,
        isIndexing,
        indexProgress,
        isSearching,
        searchError,
        response,
        lastQuery,
        filters,
        updateFilters,
        refreshStatus,
        queueIndex,
        search,
        clearSearch,
    };
}
