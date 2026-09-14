import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEvent } from '../../../data/local/aiGenerationRepository';
import { useLocalBrainstormGeneration } from '../../../features/brainstorm/hooks/useLocalBrainstormGeneration';
import type { BrainstormGenerationContext } from '../../../features/brainstorm/brainstormGeneration';

const mocks = vi.hoisted(() => ({
    list: vi.fn(), prepareContext: vi.fn(), start: vi.fn(), cancel: vi.fn(), subscribe: vi.fn(),
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

const context: BrainstormGenerationContext = {
    target: {
        kind: 'brainstorm', workspaceDatabaseVersion: 4, planningDatabaseVersion: 2, graphDatabaseVersion: 3,
        sources: [{ chapterId: 'chapter-1', databaseVersion: 7 }],
    },
    sections: [{ kind: 'writtenFact', label: 'Selected chapter source snapshot', text: '{}' }],
    maxChars: 1000,
    outputChars: 12000,
    draftRevision: 5,
    sourceFingerprint: 'source-5',
    sourceSnapshot: { bookId: 'book-1' },
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
        }));
        emit(view, { kind: 'delta', text: '{"options":[' }, 0);
        expect(view.result.current.candidate.status).toBe('streaming');
        emit(view, { kind: 'completed', text: JSON.stringify(response), usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, finishReason: 'stop' }, 1);
        expect(view.result.current.candidate.status).toBe('completed');
        expect(view.result.current.candidate.options).toHaveLength(3);
        expect(view.result.current.candidate.metadata).toMatchObject({ configId: 'config-1', modelId: 'model', promptVersion: 'brainstorm-v1' });
        expect(view.result.current.candidate.metadata).not.toHaveProperty('key');
    });

    it('keeps invalid generated text viewable without producing options', async () => {
        const { view } = setup();
        await act(async () => { await view.result.current.generate(); });
        emit(view, { kind: 'completed', text: 'The previous chapter is excellent.', usage: { inputTokens: null, outputTokens: null, totalTokens: null }, finishReason: 'stop' }, 0);
        expect(view.result.current.candidate.status).toBe('invalid');
        expect(view.result.current.candidate.rawText).toContain('previous chapter');
        expect(view.result.current.candidate.options).toEqual([]);
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
