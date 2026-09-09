import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChapterAutosave } from '../../../features/editor/hooks/useChapterAutosave';
import { ChapterDraftSnapshot } from '../../../features/editor/hooks/useChapterDraft';

function makeSnapshot(chapterId: string, revision: number, content: string): ChapterDraftSnapshot {
    return { chapterId, revision, title: 't', content, wordCount: 1, foreshadowings: [] };
}

interface Deferred {
    resolve: (ok: boolean) => void;
}

function setup() {
    const state = {
        chapterId: 'c1',
        revision: 0,
        snapshot: makeSnapshot('c1', 0, 'v0'),
    };
    const saveChapter = vi.fn<(snapshot: ChapterDraftSnapshot) => Promise<boolean>>().mockResolvedValue(true);
    const markSaved = vi.fn();
    const view = renderHook(() => useChapterAutosave({
        chapterId: state.chapterId,
        revision: state.revision,
        getSnapshot: () => state.snapshot,
        markSaved,
        saveChapter,
        debounceMs: 1000,
    }));

    const edit = (content: string) => {
        state.revision += 1;
        state.snapshot = makeSnapshot(state.chapterId, state.revision, content);
        view.rerender();
    };

    const switchChapter = (chapterId: string) => {
        state.chapterId = chapterId;
        state.revision = 0;
        state.snapshot = makeSnapshot(chapterId, 0, `${chapterId} body`);
        view.rerender();
    };

    return { state, saveChapter, markSaved, view, edit, switchChapter };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('useChapterAutosave', () => {
    it('saves the draft after the debounce and confirms via markSaved', async () => {
        const { view, edit, saveChapter, markSaved } = setup();

        act(() => edit('v1'));
        expect(view.result.current.saveStatus).toBe('unsaved');

        await act(async () => vi.advanceTimersByTimeAsync(999));
        expect(saveChapter).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTimeAsync(1));
        expect(saveChapter).toHaveBeenCalledTimes(1);
        expect(saveChapter).toHaveBeenCalledWith(makeSnapshot('c1', 1, 'v1'));
        expect(markSaved).toHaveBeenCalledWith(1);
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('restarts the debounce on every edit and saves only the latest draft', async () => {
        const { view, edit, saveChapter } = setup();

        act(() => edit('v1'));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        act(() => edit('v2'));
        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(saveChapter).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTimeAsync(500));
        expect(saveChapter).toHaveBeenCalledTimes(1);
        expect(saveChapter).toHaveBeenCalledWith(makeSnapshot('c1', 2, 'v2'));
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('serializes a follow-up round when the draft advances during a save', async () => {
        const { view, edit, saveChapter, markSaved } = setup();
        const deferreds: Deferred[] = [];
        saveChapter.mockImplementation(() => new Promise<boolean>(resolve => {
            deferreds.push({ resolve });
        }));

        act(() => edit('v1'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(saveChapter).toHaveBeenCalledTimes(1);
        expect(view.result.current.saveStatus).toBe('saving');

        // Edit while the first request is in flight.
        act(() => edit('v2'));
        await act(async () => { deferreds[0].resolve(true); });

        // Stale success must not mark the chapter saved; a serial round follows.
        expect(markSaved).toHaveBeenCalledWith(1);
        expect(view.result.current.saveStatus).toBe('unsaved');
        expect(saveChapter).toHaveBeenCalledTimes(1);

        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(saveChapter).toHaveBeenCalledTimes(2);
        expect(saveChapter).toHaveBeenLastCalledWith(makeSnapshot('c1', 2, 'v2'));

        await act(async () => { deferreds[1].resolve(true); });
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('enters the error state on failure and re-saves on retry', async () => {
        const { view, edit, saveChapter } = setup();
        saveChapter.mockResolvedValue(false);

        act(() => edit('v1'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(view.result.current.saveStatus).toBe('error');

        saveChapter.mockResolvedValue(true);
        act(() => view.result.current.retry());
        expect(view.result.current.saveStatus).toBe('unsaved');

        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(saveChapter).toHaveBeenCalledTimes(2);
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('re-queues automatically when the user edits after a failure', async () => {
        const { view, edit, saveChapter } = setup();
        saveChapter.mockResolvedValue(false);

        act(() => edit('v1'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(view.result.current.saveStatus).toBe('error');

        saveChapter.mockResolvedValue(true);
        act(() => edit('v2'));
        expect(view.result.current.saveStatus).toBe('unsaved');

        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(saveChapter).toHaveBeenLastCalledWith(makeSnapshot('c1', 2, 'v2'));
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('flush saves immediately through the same entry, skipping the debounce', async () => {
        const { view, edit, saveChapter } = setup();

        act(() => edit('v1'));
        let flushResult: boolean | undefined;
        await act(async () => {
            flushResult = await view.result.current.flush();
        });

        expect(saveChapter).toHaveBeenCalledTimes(1);
        expect(saveChapter).toHaveBeenCalledWith(makeSnapshot('c1', 1, 'v1'));
        expect(flushResult).toBe(true);
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('never runs parallel requests even when flush is called during a save', async () => {
        const { view, edit, saveChapter } = setup();
        let inFlight = 0;
        let maxInFlight = 0;
        const deferreds: Deferred[] = [];
        saveChapter.mockImplementation(() => new Promise<boolean>(resolve => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            deferreds.push({ resolve: (ok) => { inFlight -= 1; resolve(ok); } });
        }));

        act(() => edit('v1'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        act(() => edit('v2'));

        await act(async () => { void view.result.current.flush(); });
        expect(saveChapter).toHaveBeenCalledTimes(1);

        await act(async () => { deferreds[0].resolve(true); });
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        expect(saveChapter).toHaveBeenCalledTimes(2);

        await act(async () => { deferreds[1].resolve(true); });
        expect(maxInFlight).toBe(1);
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('flush drains follow-up rounds without waiting for the debounce', async () => {
        const { view, edit, saveChapter } = setup();
        const deferreds: Deferred[] = [];
        saveChapter.mockImplementation(() => new Promise<boolean>(resolve => {
            deferreds.push({ resolve });
        }));

        act(() => edit('v1'));
        await act(async () => vi.advanceTimersByTimeAsync(1000));
        act(() => edit('v2'));

        let flushResult: boolean | undefined;
        const flushPromise = view.result.current.flush().then(result => { flushResult = result; });

        await act(async () => { deferreds[0].resolve(true); });
        // The second round starts inside the flush, not via the debounce timer.
        expect(saveChapter).toHaveBeenCalledTimes(2);
        expect(saveChapter).toHaveBeenLastCalledWith(makeSnapshot('c1', 2, 'v2'));

        await act(async () => { deferreds[1].resolve(true); });
        await act(async () => { await flushPromise; });
        expect(flushResult).toBe(true);
        expect(view.result.current.saveStatus).toBe('saved');
    });

    it('flush resolves false when a round fails mid-drain', async () => {
        const { view, edit, saveChapter } = setup();
        saveChapter.mockResolvedValueOnce(false);

        act(() => edit('v1'));
        let flushResult: boolean | undefined;
        await act(async () => {
            flushResult = await view.result.current.flush();
        });

        expect(flushResult).toBe(false);
        expect(view.result.current.saveStatus).toBe('error');
    });

    it('resets the status and cancels the pending save on chapter switch', async () => {
        const { view, edit, saveChapter, switchChapter } = setup();

        act(() => edit('v1'));
        expect(view.result.current.saveStatus).toBe('unsaved');

        act(() => switchChapter('c2'));
        expect(view.result.current.saveStatus).toBe('saved');

        await act(async () => vi.advanceTimersByTimeAsync(2000));
        expect(saveChapter).not.toHaveBeenCalled();
    });
});
