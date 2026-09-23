import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEvent } from '../../../data/local/aiGenerationRepository';
import type { RetrievalContext, RetrievalSearchResponse } from '../../../domain/retrieval/contracts';
import type { Book, StoryPlanning } from '../../../types';
import { useChapterSummarySuggestions } from '../../../features/planning/hooks/useChapterSummarySuggestions';

const native = vi.hoisted(() => ({
    list: vi.fn(),
    prepareContext: vi.fn(),
    start: vi.fn(),
    validateAdoption: vi.fn(),
    cancel: vi.fn(),
    subscribe: vi.fn(),
    search: vi.fn(),
    eventHandler: null as ((event: GenerationEvent) => void) | null,
}));

vi.mock('../../../data/local/aiGenerationRepository', () => ({
    aiGenerationRepository: {
        prepareContext: native.prepareContext,
        start: native.start,
        validateAdoption: native.validateAdoption,
        cancel: native.cancel,
        subscribe: native.subscribe,
    },
}));
vi.mock('../../../data/local/aiSettingsRepository', () => ({
    aiSettingsRepository: { list: native.list },
    aiErrorMessage: () => 'AI request failed.',
}));
vi.mock('../../../data/local/retrievalRepository', () => ({ retrievalRepository: { search: native.search } }));

const bookId = '00000000-0000-4000-8000-000000000010';
const chapterId = '00000000-0000-4000-8000-000000000020';
const characterId = '00000000-0000-4000-8000-000000000030';
const configId = '00000000-0000-4000-8000-000000000040';
const chapter = {
    id: chapterId,
    title: 'Rainy night',
    status: 'draft' as const,
    content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'She opened the archive door.' }] }] }),
    contentFormat: 'tiptap-json' as const,
    contentVersion: 1,
    databaseVersion: 4,
    wordCount: 5,
    isEditable: true,
    foreshadowings: [],
};
const book: Book = {
    id: bookId,
    title: 'Archive',
    author: 'Writer',
    status: 'serializing',
    lastModified: 1,
    volumes: [{ id: 'volume', title: 'Volume 1', chapters: [chapter] }],
    characters: [],
};
const planning: StoryPlanning = {
    storySummary: '',
    storyBackground: '',
    databaseVersion: 2,
    chapterSummaries: [{ chapterId, summary: 'Keep my manual summary.', updatedAt: 10, provenance: 'author' }],
    plotSettings: [{ id: 'plot', title: 'Future', details: 'Later event', chapterIds: [chapterId], createdAt: 1, updatedAt: 1 }],
};
const modelConfig = {
    id: configId,
    configVersion: 3,
    credentialMode: 'session' as const,
    credentialStatus: 'session' as const,
    config: { name: 'Test model', protocol: 'openai-responses' as const, baseUrl: 'https://example.invalid', modelId: 'model-1', timeoutMs: 1000, maxOutputTokens: 1000 },
};

function searchResponse(): RetrievalSearchResponse {
    const scope = {
        bookId,
        allowedSourceKinds: ['character'] as const,
        allowedChapterIds: [chapterId],
        includeFuturePlan: false,
        includeGenerated: false,
        includeStale: false,
    };
    const material = {
        hitId: 'hit-character',
        label: 'character / Alice / source v2',
        sourceKind: 'character' as const,
        entityId: characterId,
        chapterId: null,
        sourceVersion: 2,
        chunkId: 'chunk-character',
        quote: 'Alice keeps the archive keys.',
        freshness: 'fresh' as const,
        recallMethods: ['semantic' as const],
    };
    const context: RetrievalContext = {
        searchId: 'search-summary-1',
        retrievalVersion: 'p1-r1-v1',
        task: 'chapter_summary',
        requestedAt: 50,
        bookId,
        chapterId,
        scope,
        excludedHitIds: [],
        sourceVersions: [{ sourceId: `${bookId}:character:${characterId}`, chapterId: null, sourceVersion: 2, indexVersion: 1 }],
        indexVersion: 1,
        embeddingFingerprint: 'local-e5-fp',
        budget: { charBudget: 6000, tokenBudget: 1500 },
        materials: [material],
        evidence: [{ ...material, text: 'Alice keeps the archive keys.' }],
        text: '[character] Alice keeps the archive keys.',
        charCount: 42,
        tokenEstimate: 12,
        charBudget: 6000,
        tokenBudget: 1500,
        includedHitIds: ['hit-character'],
        omittedHitIds: [],
    };
    return {
        requestedMode: 'hybrid',
        effectiveMode: 'hybrid',
        status: 'ready',
        degraded: false,
        degradationReason: null,
        embeddingAvailable: true,
        retrievalVersion: 'p1-r1-v1',
        scoreSemantics: 'ranking signal',
        lexicalMatchCount: 0,
        semanticMatchCount: 1,
        trace: {
            searchId: context.searchId,
            retrievalVersion: context.retrievalVersion,
            task: 'chapter_summary',
            createdAt: context.requestedAt,
            bookId,
            chapterId,
            scope,
            excludedHitIds: [],
            indexVersion: 1,
            embeddingFingerprint: 'local-e5-fp',
            sourceVersions: context.sourceVersions,
        },
        context,
        hits: [],
    };
}

function options(draftRevision: number, acceptSummary: ReturnType<typeof vi.fn>) {
    return {
        enabled: true,
        bookId,
        book,
        planning,
        draftRevision,
        flushPlanning: async () => true,
        getPlanningSnapshot: () => planning,
        getDraftRevision: () => draftRevision,
        isReadOnly: false,
        updateManualSummary: vi.fn(),
        adoptSummary: acceptSummary,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    native.eventHandler = null;
    native.list.mockResolvedValue({ configs: [modelConfig], defaultConfigId: configId });
    native.search.mockResolvedValue(searchResponse());
    native.prepareContext.mockImplementation(async input => ({ ...input, contextSnapshotId: 'snapshot-1', charCount: input.maxChars }));
    native.start.mockResolvedValue({ requestId: 'request-1' });
    native.validateAdoption.mockResolvedValue({ validated: true });
    native.cancel.mockResolvedValue({ outcome: 'cancelled' });
    native.subscribe.mockImplementation(async (handler: (event: GenerationEvent) => void) => {
        native.eventHandler = handler;
        return () => { native.eventHandler = null; };
    });
});

describe('local chapter summary suggestion flow', () => {
    it('keeps generated text separate until source-checked acceptance saves it as AI-adopted', async () => {
        const acceptSummary = vi.fn(async () => 'saved' as const);
        const { result } = renderHook(() => useChapterSummarySuggestions(options(6, acceptSummary)));
        await waitFor(() => expect(result.current.modelAvailability).toBe('ready'));

        await act(async () => { await result.current.generate(chapterId); });
        expect(native.search).toHaveBeenCalledWith(expect.objectContaining({
            task: 'chapter_summary',
            scope: expect.objectContaining({ includeFuturePlan: false, allowedChapterIds: [chapterId] }),
        }));
        expect(native.prepareContext).toHaveBeenCalledWith(expect.objectContaining({
            target: { kind: 'chapterSummary', chapterId, databaseVersion: 4, planningDatabaseVersion: 2 },
            sections: expect.arrayContaining([expect.objectContaining({ kind: 'writtenFact', text: expect.stringContaining('She opened the archive door.') })]),
        }));

        const request = native.start.mock.calls[0][0];
        const send = native.eventHandler;
        expect(send).toBeTypeOf('function');
        await act(async () => {
            send?.({ requestId: request.requestId, sessionId: request.sessionId, sequence: 0, payload: { kind: 'started' } });
            send?.({ requestId: request.requestId, sessionId: request.sessionId, sequence: 1, payload: { kind: 'delta', text: 'She entered the archive.' } });
            send?.({ requestId: request.requestId, sessionId: request.sessionId, sequence: 2, payload: {
                kind: 'completed', text: 'She entered the archive.', finishReason: 'stop',
                usage: { inputTokens: 50, outputTokens: 8, totalTokens: 58 },
            } });
        });

        expect(result.current.suggestions[chapterId]).toMatchObject({ status: 'candidate', suggestedSummary: 'She entered the archive.' });
        expect(planning.chapterSummaries[0].summary).toBe('Keep my manual summary.');
        expect(acceptSummary).not.toHaveBeenCalled();

        await act(async () => { await result.current.accept(chapterId); });
        expect(native.validateAdoption).toHaveBeenCalledWith(expect.objectContaining({
            bookId, chapterId, databaseVersion: 4, planningDatabaseVersion: 2,
            retrievalSourceVersions: searchResponse().context.sourceVersions,
        }));
        expect(acceptSummary).toHaveBeenCalledWith(expect.objectContaining({
            chapterId,
            summary: 'She entered the archive.',
            expectedDraftRevision: 6,
            generationMetadata: expect.objectContaining({
                providerId: 'example.invalid',
                promptVersion: 'chapter-summary-v1',
                source: expect.objectContaining({ bookId, chapterId, includesFuturePlan: false }),
            }),
        }));
        expect(result.current.suggestions[chapterId]).toBeUndefined();
    });

    it('keeps a late response as stale when another planning edit changes the captured revision', async () => {
        const acceptSummary = vi.fn(async () => 'saved' as const);
        const { result, rerender } = renderHook(({ revision }) => useChapterSummarySuggestions(options(revision, acceptSummary)), {
            initialProps: { revision: 6 },
        });
        await waitFor(() => expect(result.current.modelAvailability).toBe('ready'));
        await act(async () => { await result.current.generate(chapterId); });
        const request = native.start.mock.calls[0][0];
        const send = native.eventHandler;
        rerender({ revision: 7 });
        await act(async () => {
            send?.({ requestId: request.requestId, sessionId: request.sessionId, sequence: 0, payload: {
                kind: 'completed', text: 'A late stale summary.', finishReason: 'stop',
                usage: { inputTokens: 50, outputTokens: 8, totalTokens: 58 },
            } });
        });
        expect(result.current.suggestions[chapterId]).toMatchObject({ status: 'stale', rawText: 'A late stale summary.' });
        await act(async () => { await result.current.accept(chapterId); });
        expect(acceptSummary).not.toHaveBeenCalled();
        expect(planning.chapterSummaries[0].summary).toBe('Keep my manual summary.');
    });

    it('does not start retrieval or generation when no default model is configured', async () => {
        native.list.mockResolvedValue({ configs: [], defaultConfigId: null });
        const acceptSummary = vi.fn(async () => 'saved' as const);
        const { result } = renderHook(() => useChapterSummarySuggestions(options(0, acceptSummary)));
        await waitFor(() => expect(result.current.modelAvailability).toBe('missing'));
        await act(async () => { await result.current.generate(chapterId); });
        expect(native.search).not.toHaveBeenCalled();
        expect(native.start).not.toHaveBeenCalled();
        expect(result.current.suggestions[chapterId].errorMessage).toContain('default AI model');
        expect(planning.chapterSummaries[0].summary).toBe('Keep my manual summary.');
    });

    it('keeps the accepted candidate and does not retry when the planning save conflicts', async () => {
        const saveConflict = vi.fn(async () => 'save-failed' as const);
        const { result } = renderHook(() => useChapterSummarySuggestions(options(6, saveConflict)));
        await waitFor(() => expect(result.current.modelAvailability).toBe('ready'));
        await act(async () => { await result.current.generate(chapterId); });
        const request = native.start.mock.calls[0][0];
        const send = native.eventHandler;
        await act(async () => {
            send?.({ requestId: request.requestId, sessionId: request.sessionId, sequence: 0, payload: {
                kind: 'completed', text: 'Accepted but not yet saved.', finishReason: 'stop',
                usage: { inputTokens: 50, outputTokens: 8, totalTokens: 58 },
            } });
        });

        await act(async () => { await result.current.accept(chapterId); });
        expect(saveConflict).toHaveBeenCalledTimes(1);
        expect(result.current.suggestions[chapterId]).toMatchObject({
            status: 'save-failed',
            suggestedSummary: 'Accepted but not yet saved.',
        });
        expect(native.validateAdoption).toHaveBeenCalledTimes(1);
    });
});
