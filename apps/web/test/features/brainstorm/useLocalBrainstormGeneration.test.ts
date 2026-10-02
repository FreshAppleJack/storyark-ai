import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEvent } from '../../../data/local/aiGenerationRepository';
import { useLocalBrainstormGeneration } from '../../../features/brainstorm/hooks/useLocalBrainstormGeneration';
import type { BrainstormGenerationContext } from '../../../features/brainstorm/brainstormGeneration';

const mocks = vi.hoisted(() => ({
    list: vi.fn(), search: vi.fn(), prepareContext: vi.fn(), start: vi.fn(), cancel: vi.fn(), subscribe: vi.fn(),
}));

vi.mock('../../../data/local/aiGenerationRepository', () => ({
    aiGenerationRepository: {
        prepareContext: mocks.prepareContext,
        start: mocks.start,
        cancel: mocks.cancel,
        subscribe: mocks.subscribe,
    },
}));

vi.mock('../../../data/local/aiSettingsRepository', () => ({
    aiSettingsRepository: { list: mocks.list },
    aiErrorMessage: (error: unknown) => `mapped:${error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'}`,
}));
vi.mock('../../../data/local/retrievalRepository', () => ({
    retrievalRepository: { search: mocks.search },
}));

const retrievalScope = {
    bookId: 'book-1', allowedSourceKinds: ['character'], allowedChapterIds: [],
    includeFuturePlan: false, includeGenerated: false, includeStale: false,
};
const retrievalContext = {
    searchId: 'search-1', retrievalVersion: 'retrieval-v2', task: 'brainstorm', requestedAt: 1234,
    bookId: 'book-1', chapterId: null, scope: retrievalScope, excludedHitIds: [],
    sourceVersions: [{ sourceId: 'book-1:character:character-1', chapterId: null, sourceVersion: 2, indexVersion: 3 }],
    indexVersion: 3, embeddingFingerprint: 'local-e5-fingerprint',
    budget: { charBudget: 8000, tokenBudget: 2000 },
    materials: [{ hitId: 'hit-1', label: 'Character', sourceKind: 'character', entityId: 'character-1', chapterId: null, sourceVersion: 2, chunkId: 'chunk-1', quote: 'A short quote', freshness: 'fresh', recallMethods: ['semantic'] }],
    evidence: [{ hitId: 'hit-1', label: 'Character', sourceKind: 'character', entityId: 'character-1', chapterId: null, sourceVersion: 2, chunkId: 'chunk-1', quote: 'A short quote', freshness: 'fresh', recallMethods: ['semantic'], text: 'Character evidence.' }],
    text: 'Character evidence.', charCount: 20, tokenEstimate: 8, charBudget: 8000, tokenBudget: 2000,
    includedHitIds: ['hit-1'], omittedHitIds: [],
};
const retrievalResponse = {
    requestedMode: 'hybrid', effectiveMode: 'hybrid', status: 'ready', degraded: false,
    degradationReason: null, embeddingAvailable: true, retrievalVersion: 'retrieval-v2',
    scoreSemantics: 'ranking signal', lexicalMatchCount: 1, semanticMatchCount: 1,
    trace: {
        searchId: 'search-1', retrievalVersion: 'retrieval-v2', task: 'brainstorm', createdAt: 1234,
        bookId: 'book-1', chapterId: null, scope: retrievalScope, excludedHitIds: [], indexVersion: 3,
        embeddingFingerprint: 'local-e5-fingerprint', sourceVersions: retrievalContext.sourceVersions,
    },
    context: retrievalContext, hits: [],
} as never;

const context: BrainstormGenerationContext = {
    target: {
        kind: 'brainstorm', workspaceDatabaseVersion: 4, planningDatabaseVersion: 2, graphDatabaseVersion: 3,
        sources: [{ chapterId: 'chapter-1', databaseVersion: 7 }],
    },
    sections: [
        { kind: 'authorSetting', label: 'Story overview and background', text: 'Overview' },
        { kind: 'writtenFact', label: 'Selected chapter source snapshot', text: '{}' },
        { kind: 'futurePlan', label: 'Existing plot plans', text: '[{"title":"Next chapter plan"}]' },
    ],
    maxChars: 1000,
    outputChars: 12000,
    draftRevision: 5,
    sourceFingerprint: 'source-5',
    sourceSnapshot: { bookId: 'book-1' },
    retrievalScope,
    retrievalQuery: 'Story event and characters',
};

const response = {
    options: [{
        title: 'A direction', conflict: 'A conflict', motivation: 'A motivation',
        consequences: 'Consequences', development: 'Development',
    }, {
        title: 'Another direction', conflict: 'Another conflict', motivation: 'Another motivation',
        consequences: 'Another consequence', development: 'Another development',
    }, {
        title: 'A third direction', conflict: 'A third conflict', motivation: 'A third motivation',
        consequences: 'A third consequence', development: 'A third development',
    }],
};

function setup(overrides: Record<string, unknown> = {}) {
    const options = {
        enabled: true, bookId: 'book-1', isReadOnly: false, getContext: () => context, ...overrides,
    };
    const view = renderHook((props: typeof options) => useLocalBrainstormGeneration(props), { initialProps: options });
    return { view, options };
}

function emit(view: ReturnType<typeof setup>['view'], payload: GenerationEvent['payload'], sequence: number) {
    const handler = mocks.subscribe.mock.calls.at(-1)?.[0] as ((event: GenerationEvent) => void) | undefined;
    if (!handler) throw new Error('Generation event handler was not registered');
    const request = mocks.start.mock.calls.at(-1)?.[0] as { requestId: string; sessionId: string };
    act(() => handler({ requestId: request.requestId, sessionId: request.sessionId, sequence, payload }));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.search.mockResolvedValue(retrievalResponse);
    mocks.list.mockResolvedValue({
        configs: [{ id: 'config-1', config: { name: 'Test', protocol: 'openai-chat-completions', baseUrl: 'https://example.com', modelId: 'model', timeoutMs: 60000, maxOutputTokens: 100000 }, configVersion: 4, credentialMode: 'session', credentialStatus: 'session' }],
        defaultConfigId: 'config-1', databaseVersion: 1, cleanupPending: false,
    });
    mocks.prepareContext.mockResolvedValue({ ...context, contextSnapshotId: 'snapshot-1', sessionId: 'session', bookId: 'book-1', maxChars: 1000, charCount: 2 });
    mocks.start.mockResolvedValue({ requestId: 'accepted' });
    mocks.cancel.mockResolvedValue({ requestId: 'request', outcome: 'cancelled' });
    mocks.subscribe.mockResolvedValue(vi.fn());
});

describe('useLocalBrainstormGeneration', () => {
    it('keeps streamed output in a candidate and records safe source metadata only after valid completion', async () => {
        const { view } = setup();
        await act(async () => { await view.result.current.generate(); });
        expect(mocks.prepareContext).toHaveBeenCalledWith(expect.objectContaining({
            bookId: 'book-1', draftRevision: 5, target: context.target,
            retrievalContext,
            sections: expect.arrayContaining([expect.objectContaining({ kind: 'retrievalEvidence', text: retrievalContext.text })]),
        }));
        emit(view, { kind: 'delta', text: '{"options":[' }, 0);
        expect(view.result.current.candidate.status).toBe('streaming');
        expect(view.result.current.candidate.rawText).toBe('');
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, finishReason: 'stop' }, 1);
        expect(view.result.current.candidate.status).toBe('completed');
        expect(view.result.current.candidate.options).toHaveLength(3);
        expect(view.result.current.candidate.metadata).toMatchObject({
            configId: 'config-1', modelId: 'model', promptVersion: 'brainstorm-v2', includesPlanning: true,
            retrieval: {
                retrievalVersion: 'retrieval-v2', requestedAt: 1234,
                sourceVersions: retrievalContext.sourceVersions, includedHitIds: ['hit-1'],
                indexVersion: 3, embeddingFingerprint: 'local-e5-fingerprint',
            },
        });
        expect(view.result.current.candidate.metadata).not.toHaveProperty('key');
        expect(mocks.start.mock.calls.at(-1)?.[0]).toMatchObject({
            retrievalTrace: expect.objectContaining({ retrievalSourceVersions: retrievalContext.sourceVersions, includedHitIds: ['hit-1'] }),
        });
    });

    it('uses explicit chapter summaries without retrieving duplicate evidence', async () => {
        const summarizedContext = { ...context, retrievalScope: null, retrievalQuery: '' };
        const { view } = setup({ getContext: () => summarizedContext });
        await act(async () => { await view.result.current.generate(); });

        expect(mocks.search).not.toHaveBeenCalled();
        expect(mocks.prepareContext).toHaveBeenCalledWith(expect.objectContaining({
            sections: summarizedContext.sections,
        }));
        expect(mocks.start.mock.calls[0][0].retrievalTrace).toBeNull();
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, finishReason: 'stop' }, 0);
        expect(view.result.current.candidate.options).toHaveLength(3);
        expect(view.result.current.candidate.metadata?.retrieval).toBeNull();
        expect(view.result.current.candidate.retrievalContext).toBeNull();
    });

    it('keeps invalid generated text viewable without producing options', async () => {
        const { view } = setup();
        await act(async () => { await view.result.current.generate(); });
        emit(view, { kind: 'completed', text: 'The previous chapter is excellent.', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        expect(view.result.current.candidate.status).toBe('invalid');
        expect(view.result.current.candidate.rawText).toContain('previous chapter');
        expect(view.result.current.candidate.options).toEqual([]);
    });

    it('retains the prior valid candidate and keeps a failed regeneration response separate', async () => {
        const { view } = setup();
        await act(async () => { await view.result.current.generate(); });
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        const previousOptions = view.result.current.candidate.options;
        const previousRaw = view.result.current.candidate.rawText;

        await act(async () => { await view.result.current.regenerate(); });
        const invalidResponse = 'The story should go in a different direction.';
        emit(view, { kind: 'completed', text: invalidResponse, usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);

        expect(view.result.current.candidate.status).toBe('completed');
        expect(view.result.current.candidate.options).toEqual(previousOptions);
        expect(view.result.current.candidate.rawText).toBe(previousRaw);
        expect(view.result.current.candidate.lastAttempt).toMatchObject({
            status: 'invalid', rawText: invalidResponse, metadata: { configId: 'config-1' },
            retrievalContext: expect.objectContaining({ includedHitIds: ['hit-1'] }),
        });
        expect(view.result.current.acceptOption(previousOptions[0].id)).toBe(true);
    });

    it('marks a response stale when selected source versions change while generation is running', async () => {
        let current = context;
        const { view } = setup({ getContext: () => current });
        await act(async () => { await view.result.current.generate(); });
        current = { ...context, sourceFingerprint: 'changed-source', draftRevision: 6 };
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        expect(view.result.current.candidate.status).toBe('stale');
        expect(view.result.current.candidate.options).toEqual([]);
        expect(view.result.current.candidate.rawText).toContain('A direction');
    });

    it('does not start generation without a configured local model', async () => {
        mocks.list.mockResolvedValueOnce({ configs: [], defaultConfigId: null, databaseVersion: 1, cleanupPending: false });
        const { view } = setup();
        await act(async () => { await view.result.current.generate(); });
        expect(view.result.current.candidate.errorMessage).toContain('Choose a default AI model');
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('does not accept a candidate after the frozen source changes', async () => {
        let current = context;
        const { view } = setup({ getContext: () => current });
        await act(async () => { await view.result.current.generate(); });
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        current = { ...context, sourceFingerprint: 'source-6', draftRevision: 6 };
        const optionId = view.result.current.candidate.options[0].id;
        let accepted = true;
        act(() => { accepted = view.result.current.acceptOption(optionId); });
        expect(accepted).toBe(false);
        expect(view.result.current.candidate.status).toBe('stale');
        expect(view.result.current.candidate.rawText).toContain('A direction');
    });

    it('allows switching between options after the candidate has already been adopted', async () => {
        let current = context;
        const { view } = setup({ getContext: () => current });
        await act(async () => { await view.result.current.generate(); });
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        const [first, second] = view.result.current.candidate.options;
        let firstAccepted = false;
        act(() => { firstAccepted = view.result.current.acceptOption(first.id); });
        expect(firstAccepted).toBe(true);
        current = { ...context, sourceFingerprint: 'workspace-edited-by-first-choice', draftRevision: 6 };
        let secondAccepted = false;
        act(() => { secondAccepted = view.result.current.acceptOption(second.id); });
        expect(secondAccepted).toBe(true);
        expect(view.result.current.candidate.status).toBe('adopted');
    });

    it('does not accept a candidate in a read-only workspace', async () => {
        const { view } = setup({ isReadOnly: true });
        await act(async () => { await view.result.current.generate(); });
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        const optionId = view.result.current.candidate.options[0].id;
        let accepted = true;
        act(() => { accepted = view.result.current.acceptOption(optionId); });
        expect(accepted).toBe(false);
        expect(view.result.current.candidate.status).toBe('stale');
    });
});
