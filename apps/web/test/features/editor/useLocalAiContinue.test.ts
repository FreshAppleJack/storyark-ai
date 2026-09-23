import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalAiContinue } from '../../../features/editor/hooks/useLocalAiContinue';
import type { GenerationEvent } from '../../../data/local/aiGenerationRepository';
import type { AiContinueAnchor } from '../../../features/editor/types/aiContinue';

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    prepareContext: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    subscribe: vi.fn(),
    search: vi.fn(),
    validateAdoption: vi.fn(),
}));

vi.mock('../../../data/local/aiGenerationRepository', () => ({
    aiGenerationRepository: {
        prepareContext: mocks.prepareContext,
        start: mocks.start,
        cancel: mocks.cancel,
        subscribe: mocks.subscribe,
        validateAdoption: mocks.validateAdoption,
    },
}));

vi.mock('../../../data/local/aiSettingsRepository', () => ({
    aiSettingsRepository: { list: mocks.list },
    aiErrorMessage: (error: unknown) => `mapped:${error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'}`,
}));
vi.mock('../../../data/local/retrievalRepository', () => ({
    retrievalRepository: { search: mocks.search },
}));

const anchor: AiContinueAnchor = {
    from: 4,
    to: 4,
    docSize: 18,
    selectedText: '',
    retrievalAnchor: { paragraphOrdinal: 0, textOffset: 3 },
};

function setup(overrides: Record<string, unknown> = {}) {
    const insertCandidateAtAnchor = vi.fn().mockReturnValue(true);
    const options = {
        enabled: true,
        bookId: 'book-1',
        chapterId: 'chapter-1',
        sessionId: 'chapter-session:1',
        draftRevision: 3,
        databaseVersion: 7,
        isReadOnly: false,
        contextChars: 20,
        outputChars: 300,
        getContextText: () => 'current in-memory draft text',
        captureAnchor: () => anchor,
        insertCandidateAtAnchor,
        ...overrides,
    };
    const view = renderHook((props: typeof options) => useLocalAiContinue(props), { initialProps: options });
    return { view, insertCandidateAtAnchor };
}

function emit(view: ReturnType<typeof setup>['view'], payload: GenerationEvent['payload'], sequence: number) {
    const handler = mocks.subscribe.mock.calls.at(-1)?.[0] as ((event: GenerationEvent) => void) | undefined;
    if (!handler) throw new Error('Generation event handler was not registered');
    const request = mocks.start.mock.calls.at(-1)?.[0] as { requestId: string; sessionId: string } | undefined;
    if (!request) throw new Error('Generation request was not started');
    act(() => {
        handler({ requestId: request.requestId, sessionId: request.sessionId, sequence, payload });
    });
    return view;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({
        configs: [{
            id: 'config-1',
            config: { name: 'Test', protocol: 'openai-chat-completions', baseUrl: 'https://example.com', modelId: 'model', timeoutMs: 1000, maxOutputTokens: 200 },
            configVersion: 4,
            credentialMode: 'session',
            credentialStatus: 'session',
        }],
        defaultConfigId: 'config-1',
        databaseVersion: 2,
        cleanupPending: false,
    });
    mocks.prepareContext.mockResolvedValue({
        contextSnapshotId: 'context-1',
        bookId: 'book-1',
        sessionId: 'chapter-session:1',
        draftRevision: 3,
        maxChars: 20,
        sections: [{ kind: 'currentDraft', label: 'Current in-memory draft', text: 'current in-memory draft text' }],
        charCount: 28,
    });
    mocks.start.mockResolvedValue({ requestId: 'accepted-request' });
    mocks.cancel.mockResolvedValue({ requestId: 'request', outcome: 'cancelled' });
    mocks.subscribe.mockResolvedValue(vi.fn());
    mocks.search.mockRejectedValue(new Error('retrieval unavailable'));
    mocks.validateAdoption.mockResolvedValue({ validated: true });
});

describe('useLocalAiContinue', () => {
    it('streams only into the candidate and adopts through the captured anchor', async () => {
        const { view, insertCandidateAtAnchor } = setup();

        await act(async () => { await view.result.current.continueWriting(); });
        expect(mocks.prepareContext).toHaveBeenCalledWith({
            bookId: 'book-1',
            sessionId: 'chapter-session:1',
            draftRevision: 3,
            maxChars: 20,
            target: { kind: 'continue', chapterId: 'chapter-1', databaseVersion: 7 },
            sections: [{ kind: 'currentDraft', label: 'Current in-memory draft', text: 'in-memory draft text' }],
        });
        expect(mocks.search).toHaveBeenCalledWith(expect.objectContaining({
            query: 'in-memory draft text',
            scope: expect.objectContaining({
                beforeAnchor: {
                    chapterId: 'chapter-1',
                    paragraphOrdinal: 0,
                    textOffset: 3,
                },
                includeFuturePlan: false,
                includeGenerated: false,
            }),
        }));
        expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
            bookId: 'book-1',
            sessionId: 'chapter-session:1',
            draftRevision: 3,
            target: { kind: 'continue', chapterId: 'chapter-1', databaseVersion: 7 },
            config: { id: 'config-1', expectedConfigVersion: 4 },
            contextSnapshotId: 'context-1',
            outputChars: 300,
        }));

        emit(view, { kind: 'started' }, 0);
        emit(view, { kind: 'delta', text: 'first ' }, 1);
        expect(view.result.current.candidate.text).toBe('first ');
        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();

        emit(view, {
            kind: 'completed',
            text: 'first line\nsecond line',
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            finishReason: 'stop',
        }, 2);
        expect(view.result.current.candidate.status).toBe('completed');
        expect(view.result.current.candidate.source?.contextSource).toBe('current-in-memory-draft');
        expect(view.result.current.candidate.source?.outputChars).toBe(300);

        await act(async () => { await view.result.current.adoptCandidate(); });
        expect(mocks.validateAdoption).toHaveBeenCalledWith(expect.objectContaining({
            bookId: 'book-1', chapterId: 'chapter-1', databaseVersion: 7,
        }));
        expect(insertCandidateAtAnchor).toHaveBeenCalledWith('first line\nsecond line', anchor);
        expect(view.result.current.candidate.status).toBe('adopted');

        act(() => { view.result.current.closeCandidate(); });
        expect(view.result.current.candidate.status).toBe('idle');
        expect(insertCandidateAtAnchor).toHaveBeenCalledTimes(1);
    });

    it('shows used retrieval evidence and carries excluded hits into regeneration', async () => {
        const retrievalResponse = {
            status: 'ready',
            degraded: false,
            context: {
                searchId: 'search-1', retrievalVersion: 'p1-r1-v1', task: 'continuation', requestedAt: 1,
                bookId: 'book-1', chapterId: 'chapter-1', scope: { bookId: 'book-1' }, excludedHitIds: [],
                sourceVersions: [{ sourceId: 'book-1:manuscript:chapter-1', chapterId: 'chapter-1', sourceVersion: 7, indexVersion: 1 }], indexVersion: 1, embeddingFingerprint: 'fingerprint',
                budget: { charBudget: 8000, tokenBudget: 2000 }, materials: [{
                    hitId: 'hit-1', label: 'manuscript evidence', sourceKind: 'manuscript', entityId: 'chapter-1',
                    chapterId: 'chapter-1', sourceVersion: 7, chunkId: 'chunk-1', quote: 'A door opened.', freshness: 'fresh', recallMethods: ['semantic'],
                }], evidence: [{
                    hitId: 'hit-1', label: 'manuscript evidence', sourceKind: 'manuscript', entityId: 'chapter-1',
                    chapterId: 'chapter-1', sourceVersion: 7, chunkId: 'chunk-1', quote: 'A door opened.', freshness: 'fresh', recallMethods: ['semantic'], text: 'A door opened.',
                }], text: '[manuscript evidence]\nA door opened.', charCount: 34, tokenEstimate: 8,
                charBudget: 8000, tokenBudget: 2000, includedHitIds: ['hit-1'], omittedHitIds: [],
            },
            trace: {
                searchId: 'search-1', retrievalVersion: 'p1-r1-v1', task: 'continuation', createdAt: 1,
                bookId: 'book-1', chapterId: 'chapter-1', scope: { bookId: 'book-1' }, excludedHitIds: [],
                indexVersion: 1, embeddingFingerprint: 'fingerprint',
                sourceVersions: [{ sourceId: 'book-1:manuscript:chapter-1', chapterId: 'chapter-1', sourceVersion: 7, indexVersion: 1 }],
            },
        };
        mocks.search.mockResolvedValue(retrievalResponse);
        const { view } = setup();

        await act(async () => { await view.result.current.continueWriting(); });
        expect(view.result.current.candidate.source?.retrievalContext?.includedHitIds).toEqual(['hit-1']);
        expect(mocks.prepareContext).toHaveBeenCalledWith(expect.objectContaining({
            retrievalContext: expect.objectContaining({ searchId: 'search-1' }),
            sections: expect.arrayContaining([expect.objectContaining({ kind: 'retrievalEvidence' })]),
        }));

        act(() => { view.result.current.toggleRetrievalHit('hit-1'); });
        expect(view.result.current.candidate.source?.retrievalContext?.excludedHitIds).toEqual(['hit-1']);
        emit(view, { kind: 'completed', text: 'candidate', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        await act(async () => { await view.result.current.regenerate(); });
        expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ excludedHitIds: ['hit-1'] }));
    });

    it('preserves a candidate when the draft revision changes before adoption', async () => {
        const { view, insertCandidateAtAnchor } = setup();
        await act(async () => { await view.result.current.continueWriting(); });
        emit(view, { kind: 'completed', text: 'candidate', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);

        view.rerender({
            enabled: true,
            bookId: 'book-1',
            chapterId: 'chapter-1',
            sessionId: 'chapter-session:1',
            draftRevision: 4,
            databaseVersion: 7,
            isReadOnly: false,
            contextChars: 20,
            outputChars: 300,
            getContextText: () => 'changed draft',
            captureAnchor: () => anchor,
            insertCandidateAtAnchor,
        });
        expect(view.result.current.canAdopt).toBe(false);

        await act(async () => { await view.result.current.adoptCandidate(); });
        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();
        expect(view.result.current.candidate.status).toBe('stale');
        expect(view.result.current.candidate.text).toBe('candidate');
    });

    it('preserves a completed candidate when the insertion anchor moves', async () => {
        const { view, insertCandidateAtAnchor } = setup();
        await act(async () => { await view.result.current.continueWriting(); });
        emit(view, { kind: 'completed', text: 'candidate', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);

        view.rerender({
            enabled: true,
            bookId: 'book-1',
            chapterId: 'chapter-1',
            sessionId: 'chapter-session:1',
            draftRevision: 3,
            databaseVersion: 7,
            isReadOnly: false,
            contextChars: 20,
            outputChars: 300,
            getContextText: () => 'current in-memory draft text',
            captureAnchor: () => ({ ...anchor, from: 5 }),
            insertCandidateAtAnchor,
        });

        await act(async () => { await view.result.current.adoptCandidate(); });
        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();
        expect(view.result.current.candidate.status).toBe('stale');
        expect(view.result.current.candidate.text).toBe('candidate');
    });

    it('does not adopt while read-only and does not change the draft on cancellation', async () => {
        const { view, insertCandidateAtAnchor } = setup();
        await act(async () => { await view.result.current.continueWriting(); });
        act(() => { view.result.current.stop(); });

        expect(mocks.cancel).toHaveBeenCalledTimes(1);
        expect(view.result.current.candidate.status).toBe('cancelled');
        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();

        const readonly = setup();
        await act(async () => { await readonly.view.result.current.continueWriting(); });
        emit(readonly.view, { kind: 'completed', text: 'candidate', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        readonly.view.rerender({
            enabled: true,
            bookId: 'book-1',
            chapterId: 'chapter-1',
            sessionId: 'chapter-session:1',
            draftRevision: 3,
            databaseVersion: 7,
            isReadOnly: true,
            contextChars: 20,
            outputChars: 300,
            getContextText: () => 'current in-memory draft text',
            captureAnchor: () => anchor,
            insertCandidateAtAnchor: readonly.insertCandidateAtAnchor,
        });
        await act(async () => { await readonly.view.result.current.adoptCandidate(); });
        expect(readonly.insertCandidateAtAnchor).not.toHaveBeenCalled();
        expect(readonly.view.result.current.candidate.status).toBe('stale');
        await act(async () => { await readonly.view.result.current.regenerate(); });
        expect(readonly.view.result.current.candidate.status).toBe('stale');
        expect(readonly.view.result.current.candidate.text).toBe('candidate');
    });

    it('keeps the original draft protected for empty and truncated completions', async () => {
        const empty = setup();
        await act(async () => { await empty.view.result.current.continueWriting(); });
        emit(empty.view, { kind: 'completed', text: '', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        expect(empty.view.result.current.candidate.status).toBe('failed');
        expect(empty.view.result.current.candidate.text).toBe('');
        expect(empty.insertCandidateAtAnchor).not.toHaveBeenCalled();

        const truncated = setup();
        await act(async () => { await truncated.view.result.current.continueWriting(); });
        emit(truncated.view, { kind: 'delta', text: 'partial' }, 0);
        emit(truncated.view, { kind: 'completed', text: 'partial', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'length' }, 1);
        expect(truncated.view.result.current.candidate.status).toBe('failed');
        expect(truncated.view.result.current.candidate.text).toBe('partial');
        expect(truncated.insertCandidateAtAnchor).not.toHaveBeenCalled();
    });

    it('preserves a completed candidate when retrieved source versions have changed', async () => {
        mocks.search.mockResolvedValue({
            status: 'ready',
            degraded: false,
            context: {
                searchId: 'search-stale', retrievalVersion: 'p1-r1-v1', task: 'continuation', requestedAt: 1,
                bookId: 'book-1', chapterId: 'chapter-1', scope: { bookId: 'book-1' }, excludedHitIds: [],
                sourceVersions: [{ sourceId: 'book-1:manuscript:chapter-1', chapterId: 'chapter-1', sourceVersion: 2, indexVersion: 1 }],
                indexVersion: 1, embeddingFingerprint: 'fingerprint', budget: { charBudget: 8000, tokenBudget: 2000 },
                materials: [], evidence: [{
                    hitId: 'hit-1', label: 'manuscript evidence', sourceKind: 'manuscript', entityId: 'chapter-1',
                    chapterId: 'chapter-1', sourceVersion: 2, chunkId: 'chunk-1', quote: 'A clue.', freshness: 'fresh',
                    recallMethods: ['semantic'], text: 'A clue.',
                }],
                text: '[source v2]\nA clue.', charCount: 20, tokenEstimate: 5, charBudget: 8000,
                tokenBudget: 2000, includedHitIds: ['hit-1'], omittedHitIds: [],
            },
            trace: {
                searchId: 'search-stale', retrievalVersion: 'p1-r1-v1', task: 'continuation', createdAt: 1,
                bookId: 'book-1', chapterId: 'chapter-1', scope: { bookId: 'book-1' }, excludedHitIds: [],
                indexVersion: 1, embeddingFingerprint: 'fingerprint',
                sourceVersions: [{ sourceId: 'book-1:manuscript:chapter-1', chapterId: 'chapter-1', sourceVersion: 2, indexVersion: 1 }],
            },
        });
        const staleSourceError = Object.assign(new Error('source changed'), { code: 'CONTEXT_CHANGED' });
        mocks.validateAdoption.mockRejectedValueOnce(staleSourceError);
        const { view, insertCandidateAtAnchor } = setup();
        await act(async () => { await view.result.current.continueWriting(); });
        emit(view, { kind: 'completed', text: 'candidate prose', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);

        await act(async () => { await view.result.current.adoptCandidate(); });

        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();
        expect(view.result.current.candidate.status).toBe('stale');
        expect(view.result.current.candidate.text).toBe('candidate prose');
        expect(view.result.current.candidate.errorMessage).toContain('retrieved source changed');
        expect(mocks.validateAdoption).toHaveBeenCalledWith(expect.objectContaining({
            retrievalSourceVersions: [{ sourceId: 'book-1:manuscript:chapter-1', chapterId: 'chapter-1', sourceVersion: 2, indexVersion: 1 }],
        }));
    });

    it('ignores a pending adoption check after switching chapters', async () => {
        let resolveValidation: ((value: { validated: boolean }) => void) | undefined;
        mocks.validateAdoption.mockReturnValueOnce(new Promise(resolve => { resolveValidation = resolve; }));
        const { view, insertCandidateAtAnchor } = setup();
        await act(async () => { await view.result.current.continueWriting(); });
        emit(view, { kind: 'completed', text: 'candidate prose', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);

        let adoption: Promise<void> | undefined;
        act(() => { adoption = view.result.current.adoptCandidate(); });
        expect(view.result.current.candidate.status).toBe('validating');

        view.rerender({
            enabled: true,
            bookId: 'book-1',
            chapterId: 'chapter-2',
            sessionId: 'chapter-session:2',
            draftRevision: 0,
            databaseVersion: 1,
            isReadOnly: false,
            contextChars: 20,
            outputChars: 300,
            getContextText: () => 'new chapter',
            captureAnchor: () => anchor,
            insertCandidateAtAnchor,
        });
        expect(view.result.current.candidate.status).toBe('idle');

        await act(async () => {
            resolveValidation?.({ validated: true });
            await adoption;
        });
        expect(view.result.current.candidate.status).toBe('idle');
        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();
    });

    it('ignores late generation events after switching chapter sessions', async () => {
        const { view, insertCandidateAtAnchor } = setup();
        await act(async () => { await view.result.current.continueWriting(); });
        const handler = mocks.subscribe.mock.calls.at(-1)?.[0] as ((event: GenerationEvent) => void) | undefined;
        const request = mocks.start.mock.calls.at(-1)?.[0] as { requestId: string; sessionId: string };
        expect(handler).toBeDefined();

        view.rerender({
            enabled: true,
            bookId: 'book-1',
            chapterId: 'chapter-2',
            sessionId: 'chapter-session:2',
            draftRevision: 0,
            databaseVersion: 1,
            isReadOnly: false,
            contextChars: 20,
            outputChars: 300,
            getContextText: () => 'new chapter',
            captureAnchor: () => anchor,
            insertCandidateAtAnchor,
        });

        act(() => {
            handler?.({
                requestId: request.requestId,
                sessionId: request.sessionId,
                sequence: 0,
                payload: {
                    kind: 'completed',
                    text: 'old chapter candidate',
                    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
                    finishReason: 'stop',
                },
            });
        });

        expect(view.result.current.candidate.status).toBe('idle');
        expect(view.result.current.candidate.text).toBe('');
        expect(insertCandidateAtAnchor).not.toHaveBeenCalled();
    });
});
