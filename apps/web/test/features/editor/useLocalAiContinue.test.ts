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

const anchor: AiContinueAnchor = { from: 4, to: 4, docSize: 18, selectedText: '' };

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

        act(() => { view.result.current.adoptCandidate(); });
        expect(insertCandidateAtAnchor).toHaveBeenCalledWith('first line\nsecond line', anchor);
        expect(view.result.current.candidate.status).toBe('adopted');

        act(() => { view.result.current.closeCandidate(); });
        expect(view.result.current.candidate.status).toBe('idle');
        expect(insertCandidateAtAnchor).toHaveBeenCalledTimes(1);
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

        act(() => { view.result.current.adoptCandidate(); });
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

        act(() => { view.result.current.adoptCandidate(); });
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
        act(() => { readonly.view.result.current.adoptCandidate(); });
        expect(readonly.insertCandidateAtAnchor).not.toHaveBeenCalled();
        expect(readonly.view.result.current.candidate.status).toBe('stale');
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
});
