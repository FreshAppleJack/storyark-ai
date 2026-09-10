import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../services/api';
import { AppProvider, useApp } from '../../InteractionContent/AppContext';

vi.mock('../../services/api', () => ({
    default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const api = apiClient as unknown as {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
};

// The apiClient response interceptor unwraps response.data in production,
// so mocks resolve with the unwrapped shape (a bare array here).
const booksResponse = [{
    id: 1, title: 'Book A', status: 1,
    volumes: [{
        id: 2, title: 'Volume A',
        chapters: [{ id: 3, title: 'Chapter A', content: 'stored body', wordCount: 2, status: 'draft', isEditable: true, foreshadowings: '[]' }],
    }],
    characters: [], relations: [],
}];

function createWrapper() {
    // Fresh client per test so cached books never bleed between cases.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return function wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={client}><AppProvider>{children}</AppProvider></QueryClientProvider>;
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url: string) => Promise.resolve(url.startsWith('/books') ? booksResponse : {}));
    api.put.mockResolvedValue({});
    // jsdom in this setup exposes no usable Storage (same as the page harness).
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('state ownership and identity isolation', () => {
    it('never leaks books across accounts', async () => {
        const { result } = renderHook(() => useApp(), { wrapper: createWrapper() });

        // Sign in as account 1: books load automatically once user is set.
        api.post.mockResolvedValueOnce({ id: 1, username: 'alice', nickname: 'Alice' });
        await act(async () => { await result.current.login('alice', 'pw'); });
        await waitFor(() => expect(result.current.getBook('1')).toBeDefined());

        // Logout wipes the whole cache.
        act(() => result.current.logout());
        expect(result.current.books).toEqual([]);

        // Sign in as account 2: the mock now serves different books.
        api.post.mockResolvedValueOnce({ id: 2, username: 'bob', nickname: 'Bob' });
        api.get.mockImplementation((url: string) => Promise.resolve(
            url.startsWith('/books')
                ? [{ id: 9, title: 'Book B', status: 1, volumes: [], characters: [], relations: [] }]
                : {},
        ));
        await act(async () => { await result.current.login('bob', 'pw'); });

        await waitFor(() => expect(result.current.getBook('9')).toBeDefined());
        expect(result.current.getBook('1')).toBeUndefined();
        expect(result.current.books.map(b => b.id)).toEqual(['9']);
    });

    it('loads server preferences when the identity changes', async () => {
        api.get.mockImplementation((url: string) => Promise.resolve(
            url.startsWith('/books') ? booksResponse
                : url === '/user-settings/me'
                    ? { darkMode: true }
                    : {},
        ));
        const { result } = renderHook(() => useApp(), { wrapper: createWrapper() });
        expect(result.current.isDarkMode).toBe(false);

        api.post.mockResolvedValueOnce({ id: 1, username: 'alice', nickname: 'Alice' });
        await act(async () => { await result.current.login('alice', 'pw'); });

        await waitFor(() => expect(result.current.isDarkMode).toBe(true));
        expect(api.get).toHaveBeenCalledWith('/user-settings/me');
    });

    it('updates book authors when the nickname changes', async () => {
        const { result } = renderHook(() => useApp(), { wrapper: createWrapper() });
        api.post.mockResolvedValueOnce({ id: 1, username: 'alice', nickname: 'Alice' });
        await act(async () => { await result.current.login('alice', 'pw'); });
        await waitFor(() => expect(result.current.getBook('1')).toBeDefined());

        api.put.mockResolvedValueOnce({ nickname: 'Alicia' });
        let ok = false;
        await act(async () => { ok = await result.current.updateNickname(' Alicia '); });

        expect(ok).toBe(true);
        expect(result.current.user?.nickname).toBe('Alicia');
        await waitFor(() => expect(result.current.getBook('1')?.author).toBe('Alicia'));
    });

    it('rolls back the nickname and book authors when the update fails', async () => {
        const { result } = renderHook(() => useApp(), { wrapper: createWrapper() });
        api.post.mockResolvedValueOnce({ id: 1, username: 'alice', nickname: 'Alice' });
        await act(async () => { await result.current.login('alice', 'pw'); });
        await waitFor(() => expect(result.current.getBook('1')).toBeDefined());

        api.put.mockRejectedValueOnce(new Error('server down'));
        let ok = true;
        await act(async () => { ok = await result.current.updateNickname('Alicia'); });

        expect(ok).toBe(false);
        expect(result.current.user?.nickname).toBe('Alice');
        await waitFor(() => expect(result.current.getBook('1')?.author).toBe('Alice'));
    });
});
