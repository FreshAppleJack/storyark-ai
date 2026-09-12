import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from '../../InteractionContent/AppContext';
import { localKeys, localRepository, projectBook, type LocalBookDetail } from '../../data/local/repository';
import type { ChapterDraftSnapshot } from '../../features/editor/hooks/useChapterDraft';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
vi.mock('../../services/api', () => ({ default: http }));

const book = { id: 'book-1', title: 'Local book', author: 'Writer', status: 'serializing' as const, position: 0, isReadOnly: false, databaseVersion: 1, createdAt: 1, updatedAt: 1 };
const volume = { ...book, id: 'volume-1', bookId: book.id, title: 'Volume', status: 'draft' as const };
const chapter = { ...volume, id: 'chapter-1', volumeId: volume.id, title: 'Chapter', wordCount: 0, foreshadowings: [],
    body: { format: 'tiptap-json' as const, version: 1 as const, content: '{"type":"doc","content":[{"type":"paragraph"}]}', originalContent: null, originalFormat: null } };
const detail: LocalBookDetail = { book, volumes: [volume], chapters: [chapter] };
const snapshot: ChapterDraftSnapshot = { bookId: book.id, volumeId: volume.id, chapterId: chapter.id, title: 'Saved title', content: chapter.body.content, wordCount: 0, foreshadowings: [], revision: 1 };

function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppProvider mode="local">{children}</AppProvider></QueryClientProvider>;
    return { ...renderHook(() => useApp(), { wrapper }), client };
}
beforeEach(() => {
    vi.clearAllMocks(); native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue({ ok: true, value: [] });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('Local books', () => {
    it('loads without a session and blocks legacy operations without HTTP', async () => {
        const { result } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        expect(result.current.user).toBeNull();
        expect(native.invoke).toHaveBeenCalledWith('local_list_books', undefined);
        await act(async () => {
            expect(await result.current.login('ignored', 'ignored')).toBe(false);
            expect(await result.current.deleteBook('book-1')).toBe(false);
            expect(await result.current.fetchStoryPlanning('book-1')).toBeNull();
        });
        Object.values(http).forEach(method => expect(method).not.toHaveBeenCalled());
    });

    it('reports a browser storage error instead of pretending the library is empty', async () => {
        native.isTauri.mockReturnValue(false);
        const { result } = setup();
        await waitFor(() => expect(result.current.booksError).toContain('desktop app'));
        expect(native.invoke).not.toHaveBeenCalled();
        await expect(localRepository.createBook('Title', '')).rejects.toMatchObject({ code: 'DESKTOP_REQUIRED' });
    });

    it('publishes a created book only after IPC commits and preserves its author', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        let complete!: (value: unknown) => void;
        native.invoke.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        let create!: Promise<string | null>;
        act(() => { create = result.current.createBook('Local book', 'Writer'); });
        expect(result.current.books).toEqual([]);
        await act(async () => { complete({ ok: true, value: book }); expect(await create).toBe(book.id); });
        await waitFor(() => expect(result.current.books[0]?.author).toBe('Writer'));
        expect(native.invoke).toHaveBeenLastCalledWith('local_create_book', { input: { title: 'Local book', author: 'Writer' } });
        expect(client.getQueryData(localKeys.book(book.id))).toEqual({ book, volumes: [], chapters: [] });
    });

    it('creates volume and chapter using committed parent versions', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), { book, volumes: [], chapters: [] });
        native.invoke.mockResolvedValueOnce({ ok: true, value: { volume, book: { ...book, databaseVersion: 2 } } });
        await act(async () => { expect(await result.current.createVolume(book.id, 'Volume')).toBe(volume.id); });
        native.invoke.mockResolvedValueOnce({ ok: true, value: { chapter, volume: { ...volume, databaseVersion: 2 } } });
        await act(async () => { expect(await result.current.createChapter(book.id, volume.id, 'Chapter')).toBe(chapter.id); });
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters).toEqual([chapter]);
        expect(native.invoke).toHaveBeenLastCalledWith('local_create_chapter', { input: { bookId: book.id, volumeId: volume.id, title: 'Chapter', expectedVolumeVersion: 1 } });
    });

    it('serializes saves and advances database versions without changing draft tokens', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), detail);
        native.invoke.mockImplementation(async (_command, { input }) => ({ ok: true, value: {
            chapter: { ...chapter, title: input.title, databaseVersion: input.expectedDatabaseVersion + 1 },
            sessionKey: input.sessionKey, revision: input.revision,
        } }));
        await act(async () => {
            expect(await Promise.all([
                result.current.saveLocalSnapshot!(snapshot, 'session-1'),
                result.current.saveLocalSnapshot!({ ...snapshot, revision: 2, title: 'Newer title' }, 'session-1'),
            ])).toEqual([true, true]);
        });
        const saves = native.invoke.mock.calls.filter(call => call[0] === 'local_save_chapter');
        expect(saves.map(call => call[1].input.expectedDatabaseVersion)).toEqual([1, 2]);
        expect(saves[1][1].input).toMatchObject({ revision: 2, sessionKey: 'session-1' });
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters[0].databaseVersion).toBe(3);
    });

    it('does not replace cached content or retry with a new version after conflict', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), detail);
        native.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'VERSION_CONFLICT', message: 'Changed', currentDatabaseVersion: 9 } });
        await act(async () => { expect(await result.current.saveLocalSnapshot!(snapshot, 'session-1')).toBe(false); });
        expect(client.getQueryData(localKeys.book(book.id))).toEqual(detail);
        expect(native.invoke.mock.calls.filter(call => call[0] === 'local_save_chapter')).toHaveLength(1);
    });

    it('keeps a stable characters reference across projections', () => {
        // The editor rebuilds its Tiptap instance when the characters prop
        // identity changes; projections after every save must stay referentially
        // stable until character persistence lands.
        expect(projectBook(book).characters).toBe(projectBook(book, detail).characters);
        expect(projectBook(book).characters).toHaveLength(0);
    });
});
