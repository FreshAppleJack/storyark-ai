import { isTauri } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { retrievalRepository } from '../../../data/local/retrievalRepository';
import type {
    EmbeddingStatus,
    RetrievalIndexStatus,
    RetrievalSearchResponse,
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

export const STORY_SEARCH_LIMIT = 8;
export const STORY_SEARCH_CHAR_BUDGET = 6_000;
export const STORY_SEARCH_TOKEN_BUDGET = 1_500;

const INDEX_POLL_INTERVAL_MS = 1_500;

export interface LocalStorySearchState {
    embeddingStatus: EmbeddingStatus | null;
    indexStatus: RetrievalIndexStatus | null;
    statusError: string | null;
    isStatusLoading: boolean;
    isIndexing: boolean;
    isSearching: boolean;
    searchError: string | null;
    response: RetrievalSearchResponse | null;
    lastQuery: string;
    refreshStatus: () => Promise<void>;
    queueIndex: () => Promise<void>;
    search: (query: string) => Promise<void>;
    clearSearch: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}

function deriveIndexStatus(
    embeddingStatus: EmbeddingStatus,
    sources: RetrievalSource[],
): RetrievalIndexStatus {
    if (!embeddingStatus.available) return 'not_configured';

    const indexableSources = sources.filter(source => (
        source.sourceStatus !== 'discarded' && source.sourceText.trim().length > 0
    ));
    if (indexableSources.length === 0) return 'ready';

    const currentFingerprint = embeddingStatus.fingerprint;
    const hasFingerprintMismatch = indexableSources.some(source => (
        source.indexStatus === 'ready'
        && currentFingerprint !== null
        && source.embeddingFingerprint !== currentFingerprint
    ));
    if (hasFingerprintMismatch) return 'stale';

    const statuses = new Set(indexableSources.map(source => source.indexStatus));
    if (statuses.has('failed')) return 'failed';
    if (statuses.has('indexing')) return 'indexing';
    if (statuses.has('queued')) return 'queued';
    if (statuses.has('stale')) return 'stale';
    if (statuses.has('partial') || statuses.has('not_configured') || indexableSources.some(source => source.sourceStatus === 'pending')) {
        return 'partial';
    }
    return 'ready';
}

export function useLocalStorySearch(bookId: string, enabled: boolean): LocalStorySearchState {
    const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus | null>(null);
    const [indexStatus, setIndexStatus] = useState<RetrievalIndexStatus | null>(null);
    const [statusError, setStatusError] = useState<string | null>(null);
    const [isStatusLoading, setIsStatusLoading] = useState(false);
    const [isIndexing, setIsIndexing] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [response, setResponse] = useState<RetrievalSearchResponse | null>(null);
    const [lastQuery, setLastQuery] = useState('');
    const statusRequestRef = useRef(0);
    const searchRequestRef = useRef(0);

    const refreshStatus = useCallback(async () => {
        if (!enabled || !bookId) return;
        const requestId = ++statusRequestRef.current;
        setIsStatusLoading(true);
        setStatusError(null);

        if (!isTauri()) {
            setEmbeddingStatus(null);
            setIndexStatus(null);
            setStatusError('Semantic search is available in the StoryArk desktop app.');
            setIsStatusLoading(false);
            return;
        }

        try {
            const scope = {
                bookId,
                allowedSourceKinds: STORY_SEARCH_SOURCE_KINDS,
                includeFuturePlan: false,
                includeGenerated: false,
                includeStale: false,
            };
            const [embeddingResult, sourcesResult] = await Promise.allSettled([
                retrievalRepository.embeddingStatus(),
                retrievalRepository.listSources(scope),
            ]);
            if (requestId !== statusRequestRef.current) return;
            if (embeddingResult.status === 'rejected') {
                setEmbeddingStatus(null);
                setIndexStatus('not_configured');
                setStatusError(errorMessage(embeddingResult.reason, 'Local embedding status could not be loaded.'));
                return;
            }

            const nextEmbeddingStatus = embeddingResult.value;
            setEmbeddingStatus(nextEmbeddingStatus);
            if (sourcesResult.status === 'rejected') {
                setIndexStatus(nextEmbeddingStatus.available ? 'partial' : 'not_configured');
                setStatusError(errorMessage(sourcesResult.reason, 'Local story index status could not be loaded.'));
                return;
            }
            setIndexStatus(deriveIndexStatus(nextEmbeddingStatus, sourcesResult.value));
        } catch (error) {
            if (requestId !== statusRequestRef.current) return;
            setStatusError(errorMessage(error, 'Local semantic search status could not be loaded.'));
        } finally {
            if (requestId === statusRequestRef.current) setIsStatusLoading(false);
        }
    }, [bookId, enabled]);

    useEffect(() => {
        if (!enabled) return;
        const timer = window.setTimeout(() => void refreshStatus(), 0);
        return () => window.clearTimeout(timer);
    }, [bookId, enabled, refreshStatus]);

    useEffect(() => {
        if (!enabled || !indexStatus || !['queued', 'indexing'].includes(indexStatus)) return;
        const timer = window.setInterval(() => void refreshStatus(), INDEX_POLL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [enabled, indexStatus, refreshStatus]);

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
                scope: {
                    bookId,
                    allowedSourceKinds: STORY_SEARCH_SOURCE_KINDS,
                    includeFuturePlan: false,
                    includeGenerated: false,
                    includeStale: false,
                },
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
    }, [bookId, embeddingStatus, enabled, indexStatus]);

    const clearSearch = useCallback(() => {
        ++searchRequestRef.current;
        setResponse(null);
        setSearchError(null);
        setLastQuery('');
        setIsSearching(false);
    }, []);

    return {
        embeddingStatus,
        indexStatus,
        statusError,
        isStatusLoading,
        isIndexing,
        isSearching,
        searchError,
        response,
        lastQuery,
        refreshStatus,
        queueIndex,
        search,
        clearSearch,
    };
}
