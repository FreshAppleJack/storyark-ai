import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingStatus, RetrievalSearchResponse } from '../../../domain/retrieval/contracts';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    embeddingStatus: vi.fn(),
    listSources: vi.fn(),
    search: vi.fn(),
    queueIndex: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.isTauri }));
vi.mock('../../../data/local/retrievalRepository', () => ({
    retrievalRepository: {
        embeddingStatus: mocks.embeddingStatus,
        listSources: mocks.listSources,
        search: mocks.search,
        queueIndex: mocks.queueIndex,
    },
}));

import { useLocalStorySearch } from '../../../features/retrieval/hooks/useLocalStorySearch';

const unavailableEmbedding: EmbeddingStatus = {
    available: false,
    providerId: 'fastembed-rs',
    configId: 'local-multilingual-e5-small',
    modelId: 'intfloat/multilingual-e5-small',
    dimension: 384,
    maxInputLength: 512,
    fingerprint: null,
    errorCode: 'MODEL_NOT_CONFIGURED',
    errorMessage: 'Local embedding resources are unavailable.',
};

const lexicalFallbackResponse = {
    requestedMode: 'hybrid',
    effectiveMode: 'lexical',
    status: 'degraded_lexical',
    degraded: true,
    degradationReason: 'Local embedding is not configured',
    embeddingAvailable: false,
    retrievalVersion: 'p1-r1-v1',
    scoreSemantics: 'ranking_only',
    lexicalMatchCount: 1,
    semanticMatchCount: 0,
    trace: {
        searchId: 'search-1',
        retrievalVersion: 'p1-r1-v1',
        task: 'generic',
        createdAt: 1,
        bookId: 'book-1',
        chapterId: null,
        scope: { bookId: 'book-1' },
        excludedHitIds: [],
        indexVersion: 1,
        embeddingFingerprint: null,
        sourceVersions: [],
    },
    context: {
        searchId: 'search-1',
        retrievalVersion: 'p1-r1-v1',
        task: 'generic',
        requestedAt: 1,
        bookId: 'book-1',
        chapterId: null,
        scope: { bookId: 'book-1' },
        excludedHitIds: [],
        sourceVersions: [],
        indexVersion: 1,
        embeddingFingerprint: null,
        budget: { charBudget: 6000, tokenBudget: 1500 },
        materials: [],
        evidence: [],
        text: 'A short lexical match.',
        charCount: 24,
        tokenEstimate: 6,
        charBudget: 6000,
        tokenBudget: 1500,
        includedHitIds: [],
        omittedHitIds: [],
    },
    hits: [],
} as RetrievalSearchResponse;

describe('useLocalStorySearch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isTauri.mockReturnValue(true);
        mocks.embeddingStatus.mockResolvedValue(unavailableEmbedding);
        mocks.listSources.mockResolvedValue([]);
        mocks.search.mockResolvedValue(lexicalFallbackResponse);
    });

    it('keeps the local lexical fallback scoped and carries search budgets and status', async () => {
        const { result } = renderHook(() => useLocalStorySearch('book-1', true));

        await waitFor(() => expect(result.current.indexStatus).toBe('not_configured'));
        await result.current.search('the locked door');

        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
            query: 'the locked door',
            mode: 'hybrid',
            limit: 8,
            charBudget: 6000,
            tokenBudget: 1500,
            adjacentChunkCount: 1,
            task: 'generic',
            indexStatus: 'not_configured',
            scope: expect.objectContaining({
                bookId: 'book-1',
                allowedSourceKinds: expect.arrayContaining(['manuscript', 'confirmed_setting', 'character']),
                includeFuturePlan: false,
                includeGenerated: false,
                includeStale: false,
            }),
        }));
        await waitFor(() => expect(result.current.response?.effectiveMode).toBe('lexical'));
    });

    it('sends source, chapter, planning, and time filters to the retrieval contract', async () => {
        const { result } = renderHook(() => useLocalStorySearch('book-1', true, {
            chapterIds: ['chapter-1', 'chapter-2'],
            activeChapterId: 'chapter-2',
        }));

        await waitFor(() => expect(result.current.indexStatus).toBe('not_configured'));
        act(() => result.current.updateFilters({
            sourceKinds: ['manuscript', 'character'],
            includePlanning: true,
            chapterRange: 'before_current',
            updatedAfter: 100,
            updatedBefore: 200,
        }));
        await result.current.search('hidden door');

        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
            scope: {
                bookId: 'book-1',
                allowedSourceKinds: ['manuscript', 'character', 'planning'],
                allowedChapterIds: ['chapter-1', 'chapter-2'],
                includeFuturePlan: false,
                includeGenerated: false,
                includeStale: false,
                timeRange: { updatedAfter: 100, updatedBefore: 200 },
            },
        }));
    });

    it('does not call desktop retrieval when semantic mode is disabled', async () => {
        const { result } = renderHook(() => useLocalStorySearch('book-1', false));

        await result.current.search('ignored');

        expect(mocks.embeddingStatus).not.toHaveBeenCalled();
        expect(mocks.listSources).not.toHaveBeenCalled();
        expect(mocks.search).not.toHaveBeenCalled();
    });

    it('keeps embedding status unknown when the desktop read request fails', async () => {
        mocks.embeddingStatus.mockRejectedValue(new Error('The local retrieval request failed. Writing and saved drafts are unaffected.'));

        const { result } = renderHook(() => useLocalStorySearch('book-1', true));

        await waitFor(() => expect(result.current.statusError).toContain('Writing and saved drafts are unaffected.'));

        expect(result.current.embeddingStatus).toBeNull();
        expect(result.current.indexStatus).toBeNull();
    });

    it('does not claim an index state when the source read request fails', async () => {
        mocks.embeddingStatus.mockResolvedValue({
            ...unavailableEmbedding,
            available: true,
            fingerprint: 'local-fingerprint',
            errorCode: null,
            errorMessage: null,
        });
        mocks.listSources.mockRejectedValue(new Error('The local retrieval request failed. Writing and saved drafts are unaffected.'));

        const { result } = renderHook(() => useLocalStorySearch('book-1', true));

        await waitFor(() => expect(result.current.statusError).toContain('Writing and saved drafts are unaffected.'));

        expect(result.current.embeddingStatus?.available).toBe(true);
        expect(result.current.indexStatus).toBeNull();
    });
});
