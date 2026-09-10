import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAiContinue } from '../../../features/editor/hooks/useAiContinue';
import { formatAiContinueText } from '../../../features/editor/utils/aiContinueText';

function setup(overrides: Partial<Parameters<typeof useAiContinue>[0]> = {}) {
    const requestContinue = vi.fn().mockResolvedValue('Line one\nLine two');
    const insertResult = vi.fn();
    const onError = vi.fn();
    const view = renderHook(
        (props: { chapterId: string }) => useAiContinue({
            chapterId: props.chapterId,
            isReadOnly: false,
            hasContent: true,
            contextChars: 10,
            outputChars: 100,
            getContextText: () => 'prefix-1234567890',
            requestContinue,
            insertResult,
            onError,
            ...overrides,
        }),
        { initialProps: { chapterId: 'c1' } },
    );
    return { view, requestContinue, insertResult, onError };
}

describe('formatAiContinueText', () => {
    it('wraps each non-empty line in an indented paragraph', () => {
        expect(formatAiContinueText(' alpha \n\nbeta\ngamma ')).toBe(
            '<p>　　alpha</p><p>　　beta</p><p>　　gamma</p>',
        );
    });

    it('returns an empty string for blank input', () => {
        expect(formatAiContinueText('   \n ')).toBe('');
        expect(formatAiContinueText('')).toBe('');
    });
});

describe('useAiContinue', () => {
    it('inserts the formatted result once and toggles loading', async () => {
        const { view, requestContinue, insertResult } = setup();

        let done: Promise<void>;
        act(() => { done = view.result.current.continueWriting(); });
        expect(view.result.current.isAiLoading).toBe(true);
        await act(async () => { await done; });

        expect(requestContinue).toHaveBeenCalledWith({ content: '1234567890', outputLengthChars: 100 });
        expect(insertResult).toHaveBeenCalledTimes(1);
        expect(insertResult).toHaveBeenCalledWith('<p>　　Line one</p><p>　　Line two</p>');
        expect(view.result.current.isAiLoading).toBe(false);
    });

    it('drops the result when the chapter switched during the request', async () => {
        let resolveRequest!: (text: string) => void;
        const requestContinue = vi.fn().mockImplementation(
            () => new Promise<string>(resolve => { resolveRequest = resolve; }),
        );
        const { view, insertResult } = setup({ requestContinue });

        let done: Promise<void>;
        act(() => { done = view.result.current.continueWriting(); });
        view.rerender({ chapterId: 'c2' });
        await act(async () => { resolveRequest('late text'); await done; });

        expect(insertResult).not.toHaveBeenCalled();
        expect(view.result.current.isAiLoading).toBe(false);
    });

    it('drops the result even after switching away and back to the same chapter', async () => {
        let resolveRequest!: (text: string) => void;
        const requestContinue = vi.fn().mockImplementation(
            () => new Promise<string>(resolve => { resolveRequest = resolve; }),
        );
        const { view, insertResult } = setup({ requestContinue });

        let done: Promise<void>;
        act(() => { done = view.result.current.continueWriting(); });
        view.rerender({ chapterId: 'c2' });
        view.rerender({ chapterId: 'c1' });
        await act(async () => { resolveRequest('late text'); await done; });

        expect(insertResult).not.toHaveBeenCalled();
    });

    it('never lets a stale finally clear a newer request loading state', async () => {
        const resolvers: Array<(text: string) => void> = [];
        const requestContinue = vi.fn().mockImplementation(
            () => new Promise<string>(resolve => { resolvers.push(resolve); }),
        );
        const { view, insertResult } = setup({ requestContinue });

        // Request A on c1, then switch and start request B on c2.
        let doneA: Promise<void>;
        act(() => { doneA = view.result.current.continueWriting(); });
        view.rerender({ chapterId: 'c2' });
        let doneB: Promise<void>;
        act(() => { doneB = view.result.current.continueWriting(); });
        expect(view.result.current.isAiLoading).toBe(true);

        // A completes late: dropped, and B is still loading.
        await act(async () => { resolvers[0]('late A'); await doneA; });
        expect(insertResult).not.toHaveBeenCalled();
        expect(view.result.current.isAiLoading).toBe(true);

        // B completes: inserted exactly once, loading cleared.
        await act(async () => { resolvers[1]('fresh B'); await doneB; });
        expect(insertResult).toHaveBeenCalledTimes(1);
        expect(insertResult).toHaveBeenCalledWith('<p>　　fresh B</p>');
        expect(view.result.current.isAiLoading).toBe(false);
    });

    it('does not send a request when read-only or without content', async () => {
        const { view, requestContinue } = setup({ isReadOnly: true });
        await act(async () => { await view.result.current.continueWriting(); });
        expect(requestContinue).not.toHaveBeenCalled();

        const empty = setup({ hasContent: false });
        await act(async () => { await empty.view.result.current.continueWriting(); });
        expect(empty.requestContinue).not.toHaveBeenCalled();
    });

    it('reports failures through onError and clears loading', async () => {
        const failure = new Error('network');
        const { view, insertResult, onError } = setup({
            requestContinue: vi.fn().mockRejectedValue(failure),
        });

        await act(async () => { await view.result.current.continueWriting(); });

        expect(onError).toHaveBeenCalledWith(failure);
        expect(insertResult).not.toHaveBeenCalled();
        expect(view.result.current.isAiLoading).toBe(false);
    });
});
