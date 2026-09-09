import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
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

function wrapper({ children }: { children: React.ReactNode }) {
    return <AppProvider>{children}</AppProvider>;
}

beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ id: 1, username: 'tester', nickname: 'Tester' });
    api.get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/books') ? booksResponse : {}));
    api.put.mockResolvedValue({});
    // jsdom in this setup exposes no usable Storage (same as the page harness).
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

async function loginAndLoadBooks() {
    const { result } = renderHook(() => useApp(), { wrapper });
    await act(async () => {
        await result.current.login('tester', 'pw');
    });
    return result;
}

describe('AppContext updateChapterContent', () => {
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
        const chapter = result.current.getBook('1')?.volumes[0].chapters[0];
        expect(chapter?.title).toBe('Renamed');
        expect(chapter?.content).toBe('new body');
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
        const chapter = result.current.getBook('1')?.volumes[0].chapters[0];
        expect(chapter?.title).toBe('Renamed');
        expect(chapter?.content).toBe('new body');
    });
});
