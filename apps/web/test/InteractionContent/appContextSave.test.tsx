import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
}));

vi.mock('../../services/api', () => ({ default: api }));

import { AppProvider, useApp } from '../../InteractionContent/AppContext';

const booksResponse = [
    {
        id: 1,
        title: 'Demo Book',
        status: 1,
        volumes: [
            {
                id: 2,
                title: 'Volume 1',
                chapters: [
                    { id: 3, title: 'Chapter 1', content: 'stored body', wordCount: 2, status: 'draft', isEditable: true, foreshadowings: '[]' },
                ],
            },
        ],
        characters: [],
    },
];

function createWrapper() {
    // Fresh client per test so cached books never bleed between cases.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={client}><AppProvider>{children}</AppProvider></QueryClientProvider>;
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ id: 1, username: 'tester', nickname: 'Tester' });
    api.get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/books') ? booksResponse : {}));
    api.put.mockResolvedValue({});
    api.delete.mockResolvedValue({});
    // jsdom in this setup exposes no usable Storage (same as the page harness).
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function loginAndLoadBooks() {
    const { result } = renderHook(() => useApp(), { wrapper: createWrapper() });
    await act(async () => {
        await result.current.login('tester', 'pw');
    });
    // Login is auth-only; the books query loads asynchronously once user is set.
    await waitFor(() => expect(result.current.getBook('1')).toBeDefined());
    return result;
}

describe('AppContext updateChapterContent', () => {
    it('shares the save queue with lock and delete, then drains it before volume deletion', async () => {
        const result = await loginAndLoadBooks();
        let finish!: () => void;
        api.put.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        let save!: Promise<boolean>;
        let lock!: Promise<boolean>;
        let remove!: Promise<boolean>;
        let removeVolume!: Promise<boolean>;
        await act(async () => { save = result.current.updateChapterContent('1', '2', '3', 'Saved', 'New body', 2); });
        // Query cache updates reach the render-closure books on the next
        // observer notification; wait for it before the lock reads them.
        await waitFor(() => expect(result.current.getBook('1')?.volumes[0].chapters[0].content).toBe('New body'));
        await act(async () => { lock = result.current.toggleChapterLock('1', '2', '3'); });
        // Start both deletions from the same render so volume deletion sees its chapters.
        await act(async () => {
            remove = result.current.deleteChapter('1', '2', '3');
            removeVolume = result.current.deleteVolume('1', '2');
        });
        expect(api.put).toHaveBeenCalledTimes(1);
        expect(api.delete).not.toHaveBeenCalled();
        await act(async () => {
            finish();
            expect(await Promise.all([save, lock, remove, removeVolume])).toEqual([true, true, true, true]);
        });
        expect(api.put).toHaveBeenLastCalledWith('/story/chapters/3?bookId=1', expect.objectContaining({ content: 'New body', isEditable: false }));
        expect(api.delete.mock.calls.map(call => call[0])).toEqual(['/story/chapters/3?bookId=1', '/story/volumes/2?bookId=1']);
        expect(api.put.mock.invocationCallOrder[1]).toBeLessThan(api.delete.mock.invocationCallOrder[0]);
    });

    it('distinguishes failed reads from empty data and reports other failed writes', async () => {
        const result = await loginAndLoadBooks();
        api.get.mockRejectedValue(new Error('network down'));
        api.put.mockRejectedValue(new Error('network down'));
        await act(async () => {
            expect(await result.current.fetchStoryPlanning('1')).toBeNull();
            expect(await result.current.getRelations('1')).toBeNull();
            expect(await result.current.updateVolume('1', '2', 'Unsaved title')).toBe(false);
        });
        expect(result.current.getBook('1')?.storyPlanning).toBeUndefined();
    });

    it('serializes chapter writes across callers and continues after failure', async () => {
        const result = await loginAndLoadBooks();
        let fail!: (error: Error) => void;
        api.put.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        await act(async () => {
            first = result.current.updateChapterContent('1', '2', '3', 'First rename', 'body 1', 1, []);
            second = result.current.updateChapterContent('1', '2', '3', 'Second rename', 'body 2', 2, []);
        });
        expect(api.put).toHaveBeenCalledTimes(1);
        await act(async () => {
            fail(new Error('network down'));
            expect(await first).toBe(false);
            expect(await second).toBe(true);
        });
        expect(api.put).toHaveBeenCalledTimes(2);
        expect(api.put).toHaveBeenLastCalledWith('/story/chapters/3?bookId=1', expect.objectContaining({ title: 'Second rename', content: 'body 2' }));
        expect(result.current.getBook('1')?.volumes[0].chapters[0].title).toBe('Second rename');
    });

    it('returns true and applies the optimistic update when the PUT succeeds', async () => {
        const result = await loginAndLoadBooks();

        let ok: boolean | undefined;
        await act(async () => {
            ok = await result.current.updateChapterContent('1', '2', '3', 'Renamed', 'new body', 5, []);
        });

        expect(ok).toBe(true);
        expect(api.put).toHaveBeenCalledWith('/story/chapters/3?bookId=1', expect.objectContaining({
            title: 'Renamed',
            content: 'new body',
            wordCount: 5,
        }));
        await waitFor(() => {
            const chapter = result.current.getBook('1')?.volumes[0].chapters[0];
            expect(chapter?.title).toBe('Renamed');
            expect(chapter?.content).toBe('new body');
        });
    });

    it('returns false but keeps the optimistic update when the PUT fails', async () => {
        const result = await loginAndLoadBooks();
        api.put.mockRejectedValue(new Error('network down'));

        let ok: boolean | undefined;
        await act(async () => {
            ok = await result.current.updateChapterContent('1', '2', '3', 'Renamed', 'new body', 5, []);
        });

        // The caller decides how to surface the failure; the local draft must
        // not be rolled back silently.
        expect(ok).toBe(false);
        await waitFor(() => {
            const chapter = result.current.getBook('1')?.volumes[0].chapters[0];
            expect(chapter?.title).toBe('Renamed');
            expect(chapter?.content).toBe('new body');
        });
    });
});
