import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from '../../InteractionContent/AppContext';
import { localKeys, localRepository, projectBook, projectCharacter, type LocalBookDetail } from '../../data/local/repository';
import type { LocalCharacter } from '../../data/local/contracts';
import type { ChapterDraftSnapshot } from '../../features/editor/hooks/useChapterDraft';
import { useChapterDraft } from '../../features/editor/hooks/useChapterDraft';
import { chapterBodyCache } from '../../data/local/chapterBodyCache';
import { directoryChapter } from '../../data/local/repository';

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);
vi.mock('../../services/api', () => ({ default: http }));

const book = { id: 'book-1', title: 'Local book', author: 'Writer', status: 'serializing' as const, coverColor: 'bg-blue-600', position: 0, isReadOnly: false, databaseVersion: 1, createdAt: 1, updatedAt: 1 };
const volume = { ...book, id: 'volume-1', bookId: book.id, title: 'Volume', status: 'draft' as const };
const chapter = { ...volume, id: 'chapter-1', volumeId: volume.id, title: 'Chapter', wordCount: 0, foreshadowings: [],
    body: { format: 'tiptap-json' as const, version: 1 as const, content: '{"type":"doc","content":[{"type":"paragraph"}]}', originalContent: null, originalFormat: null } };
const detail: LocalBookDetail = { book, volumes: [volume], chapters: [chapter] };
const snapshot: ChapterDraftSnapshot = { bookId: book.id, volumeId: volume.id, chapterId: chapter.id, title: 'Saved title', content: chapter.body.content, wordCount: 0, foreshadowings: [], revision: 1 };

function setupHook<T>(useSubject: () => T) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><AppProvider mode="local">{children}</AppProvider></QueryClientProvider>;
    return { ...renderHook(useSubject, { wrapper }), client };
}
function setup() {
    return setupHook(useApp);
}
beforeEach(() => {
    vi.clearAllMocks(); native.isTauri.mockReturnValue(true);
    native.invoke.mockResolvedValue({ ok: true, value: [] });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe('Local books', () => {
    it('renames an inactive directory chapter even when its full body is still cached', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), { ...detail, bodyMode: 'directory', chapters: [directoryChapter(chapter)] });
        chapterBodyCache(client).put(chapter);
        native.invoke.mockResolvedValue({ ok: true, value: { ...chapter, title: 'Renamed', databaseVersion: 2 } });
        await act(async () => {
            expect(await result.current.updateChapterContent(book.id, volume.id, chapter.id, 'Renamed', '', chapter.wordCount, [])).toBe(true);
        });
        expect(native.invoke).toHaveBeenLastCalledWith('local_rename', expect.objectContaining({ input: expect.objectContaining({ title: 'Renamed' }) }));
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters[0].body.content).toBe('');
        expect(chapterBodyCache(client).get(book.id, chapter.id, 2)?.body.content).toBe(chapter.body.content);
    });

    it.each(['', '   '])('persists a blank editor title through desktop IPC with its body intact (%j)', async title => {
        const projectedChapter = projectBook(book, detail).volumes[0].chapters[0];
        const { result, client } = setupHook(() => ({
            app: useApp(),
            draft: useChapterDraft({ bookId: book.id, volumeId: volume.id, chapterId: chapter.id, chapter: projectedChapter }),
        }));
        await waitFor(() => expect(result.current.app.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), detail);
        native.invoke.mockImplementation(async (_command, { input }) => input.title.trim() ? ({ ok: true, value: {
            chapter: { ...chapter, title: input.title, body: { ...chapter.body, content: input.content }, databaseVersion: 2 },
            sessionKey: input.sessionKey, revision: input.revision,
        } }) : ({ ok: false, error: { code: 'INVALID_INPUT', message: 'Invalid storage request' } }));

        act(() => result.current.draft.setTitle(title));
        const draftSnapshot = result.current.draft.getSnapshot();
        await act(async () => {
            expect(await result.current.app.saveLocalSnapshot!(draftSnapshot, result.current.draft.sessionKey)).toBe(true);
        });

        expect(native.invoke).toHaveBeenLastCalledWith('local_save_chapter', expect.objectContaining({
            input: expect.objectContaining({ title: 'Untitled Chapter', content: chapter.body.content }),
        }));
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters[0])
            .toMatchObject({ title: 'Untitled Chapter', body: chapter.body });
    });

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
        const [command, args] = native.invoke.mock.calls.at(-1)!;
        expect(command).toBe('local_create_book');
        expect(args).toMatchObject({ input: { title: 'Local book', author: 'Writer' } });
        expect((args as { input: { coverColor: string } }).input.coverColor).toMatch(/^bg-(blue|emerald|rose|amber|purple)-600$/);
        expect(client.getQueryData(localKeys.book(book.id))).toEqual({ book, volumes: [], chapters: [], bodyMode: 'directory' });
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

describe('Local book mutations', () => {
    const secondChapter = { ...chapter, id: 'chapter-2', title: 'Second', position: 1 };
    const fullDetail: LocalBookDetail = { book, volumes: [volume], chapters: [chapter, secondChapter] };

    it('renames a volume and advances its cached version', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), fullDetail);
        native.invoke.mockImplementation(async (_command, { input }) => ({
            ok: true, value: { ...volume, title: input.title, databaseVersion: input.expectedDatabaseVersion + 1 },
        }));
        let ok!: boolean;
        await act(async () => { ok = await result.current.updateVolume(book.id, volume.id, 'Renamed'); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_rename', {
            input: { kind: 'volume', bookId: book.id, volumeId: volume.id, expectedDatabaseVersion: 1, title: 'Renamed' },
        });
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.volumes[0])
            .toMatchObject({ title: 'Renamed', databaseVersion: 2 });
    });

    it('persists a chapter title only when the rest of the payload is unchanged', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), fullDetail);
        native.invoke.mockImplementation(async (_command, { input }) => ({
            ok: true, value: { ...chapter, title: input.title, databaseVersion: input.expectedDatabaseVersion + 1 },
        }));
        let renamed!: boolean;
        await act(async () => {
            renamed = await result.current.updateChapterContent(book.id, volume.id, chapter.id, 'New title', chapter.body.content, chapter.wordCount, chapter.foreshadowings);
        });
        expect(renamed).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_rename', expect.objectContaining({
            input: expect.objectContaining({ kind: 'chapter', title: 'New title' }),
        }));
        const callsAfterRename = native.invoke.mock.calls.length;
        let rejected!: boolean;
        await act(async () => {
            rejected = await result.current.updateChapterContent(book.id, volume.id, chapter.id, 'New title', '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"changed"}]}]}', 2, []);
        });
        expect(rejected).toBe(false);
        expect(native.invoke.mock.calls.length).toBe(callsAfterRename);
    });

    it('locks and unlocks a chapter through IPC and mirrors the cached record', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), fullDetail);
        native.invoke.mockImplementation(async (_command, { input }) => ({
            ok: true, value: { ...chapter, isReadOnly: input.isReadOnly, databaseVersion: input.expectedDatabaseVersion + 1 },
        }));
        let locked!: boolean;
        await act(async () => { locked = await result.current.toggleChapterLock(book.id, volume.id, chapter.id); });
        expect(locked).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_set_read_only', {
            input: { kind: 'chapter', bookId: book.id, volumeId: volume.id, chapterId: chapter.id, expectedDatabaseVersion: 1, isReadOnly: true },
        });
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters[0])
            .toMatchObject({ isReadOnly: true, databaseVersion: 2 });
    });

    it('reorders chapters and stores the returned order', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), fullDetail);
        native.invoke.mockImplementation(async (_command, { input }) => ({
            ok: true, value: input.items.map((item: { chapterId: string }, index: number) => ({
                ...(item.chapterId === chapter.id ? chapter : secondChapter), position: index, databaseVersion: 9,
            })),
        }));
        let ok!: boolean;
        await act(async () => {
            ok = await result.current.reorderChapters(book.id, volume.id, [
                { id: secondChapter.id, title: secondChapter.title } as never,
                { id: chapter.id, title: chapter.title } as never,
            ]);
        });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_reorder', {
            input: {
                parent: { kind: 'volume', bookId: book.id, volumeId: volume.id, expectedDatabaseVersion: 1 },
                items: [
                    { kind: 'chapter', bookId: book.id, volumeId: volume.id, chapterId: secondChapter.id, expectedDatabaseVersion: 1, expectedPosition: secondChapter.position },
                    { kind: 'chapter', bookId: book.id, volumeId: volume.id, chapterId: chapter.id, expectedDatabaseVersion: 1, expectedPosition: chapter.position },
                ],
            },
        });
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.chapters.map(item => item.id))
            .toEqual([secondChapter.id, chapter.id]);
    });

    it('deletes a chapter and advances the parent volume', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), fullDetail);
        native.invoke.mockResolvedValue({
            ok: true, value: { deletedId: chapter.id, parent: { ...volume, databaseVersion: 2 } },
        });
        let ok!: boolean;
        await act(async () => { ok = await result.current.deleteChapter(book.id, volume.id, chapter.id); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_delete', {
            input: { kind: 'chapter', bookId: book.id, volumeId: volume.id, chapterId: chapter.id, expectedDatabaseVersion: 1, expectedParentVersion: 1 },
        });
        const cached = client.getQueryData<LocalBookDetail>(localKeys.book(book.id));
        expect(cached?.chapters.map(item => item.id)).toEqual([secondChapter.id]);
        expect(cached?.volumes[0].databaseVersion).toBe(2);
    });

    it('waits for a queued save before deleting its volume', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), fullDetail);
        const order: string[] = [];
        let releaseSave!: (value: unknown) => void;
        native.invoke.mockImplementation(async (command, { input }) => {
            if (command === 'local_save_chapter') {
                order.push('save-start');
                return new Promise(resolve => { releaseSave = resolve; });
            }
            order.push(command);
            return { ok: true, value: command === 'local_delete'
                ? { deletedId: input.volumeId, parent: { ...book, databaseVersion: 2 } }
                : { ...chapter, databaseVersion: 2 } };
        });
        let saveDone!: Promise<boolean>;
        let deleteDone!: Promise<boolean>;
        act(() => {
            saveDone = result.current.saveLocalSnapshot!({ ...snapshot, bookId: book.id, volumeId: volume.id, chapterId: chapter.id }, 'session-1');
        });
        await act(async () => {
            deleteDone = result.current.deleteVolume(book.id, volume.id);
            await Promise.resolve();
        });
        // The delete is queued behind the in-flight save; resolve the save and
        // both must complete with the delete strictly after the save finished.
        await act(async () => {
            releaseSave({ ok: true, value: { chapter: { ...chapter, databaseVersion: 2 }, sessionKey: 'session-1', revision: 1 } });
            expect(await saveDone).toBe(true);
            expect(await deleteDone).toBe(true);
        });
        expect(order).toEqual(['save-start', 'local_delete']);
    });
});

describe('Local characters', () => {
    const character: LocalCharacter = {
        id: 'char-1', bookId: book.id, name: '林晚', aliases: ['晚晚'], role: 'protagonist',
        description: '主角', color: '#3b82f6', tags: ['主线'], avatar: null, handleConfig: null,
        isArchived: false, position: 0, databaseVersion: 1, createdAt: 1, updatedAt: 1,
    };

    it('creates a character and mirrors the bumped book version', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), detail);
        native.invoke.mockResolvedValue({ ok: true, value: { character, book: { ...book, databaseVersion: 2 } } });
        let ok!: boolean;
        await act(async () => { ok = await result.current.createCharacter(book.id, { name: '林晚', role: 'protagonist', description: '主角', color: '#3b82f6' }); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_create_character', {
            input: expect.objectContaining({ bookId: book.id, name: '林晚', expectedBookVersion: 1 }),
        });
        expect(client.getQueryData<LocalCharacter[]>(localKeys.characters(book.id))).toEqual([character]);
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.book.databaseVersion).toBe(2);
    });

    it('updates a character with merged fields and keeps the form data on failure', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.characters(book.id), [character]);
        native.invoke.mockImplementation(async (_command, { input }) => ({
            ok: true, value: { ...character, name: input.name, databaseVersion: input.expectedDatabaseVersion + 1 },
        }));
        let ok!: boolean;
        await act(async () => { ok = await result.current.updateCharacter(book.id, character.id, { name: '林晚舟' }); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_update_character', {
            input: expect.objectContaining({
                characterId: character.id, expectedDatabaseVersion: 1, name: '林晚舟',
                aliases: ['晚晚'], description: '主角', color: '#3b82f6',
            }),
        });
        expect(client.getQueryData<LocalCharacter[]>(localKeys.characters(book.id))?.[0])
            .toMatchObject({ name: '林晚舟', databaseVersion: 2 });
        // A version conflict leaves the cached record untouched.
        native.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'VERSION_CONFLICT', message: 'Changed', currentDatabaseVersion: 9 } });
        let rejected!: boolean;
        await act(async () => { rejected = await result.current.updateCharacter(book.id, character.id, { name: 'Stale' }); });
        expect(rejected).toBe(false);
        expect(client.getQueryData<LocalCharacter[]>(localKeys.characters(book.id))?.[0].name).toBe('林晚舟');
    });

    it('archives a character instead of deleting it and keeps the record cached', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.characters(book.id), [character]);
        native.invoke.mockResolvedValue({ ok: true, value: { ...character, isArchived: true, databaseVersion: 2 } });
        let ok!: boolean;
        await act(async () => { ok = await result.current.deleteCharacter(book.id, character.id); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_archive_character', {
            input: { bookId: book.id, characterId: character.id, expectedDatabaseVersion: 1, isArchived: true },
        });
        const cached = client.getQueryData<LocalCharacter[]>(localKeys.characters(book.id));
        expect(cached).toHaveLength(1);
        expect(cached?.[0].isArchived).toBe(true);
    });

    it('updates book title and status through IPC and mirrors the committed record', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), detail);
        const committed = { ...book, title: 'Renamed', status: 'completed' as const, databaseVersion: 2, updatedAt: 2 };
        native.invoke.mockImplementation(async (command: string) =>
            ({ ok: true, value: command === 'local_update_book' ? committed : [book] }));
        let ok!: boolean;
        await act(async () => { ok = await result.current.updateBook(book.id, { title: 'Renamed', status: 'completed' }); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_update_book', {
            input: { bookId: book.id, expectedDatabaseVersion: 1, title: 'Renamed', status: 'completed' },
        });
        await waitFor(() => expect(result.current.books[0]).toMatchObject({ title: 'Renamed', status: 'completed' }));
        expect(client.getQueryData<LocalBookDetail>(localKeys.book(book.id))?.book).toEqual(committed);
    });

    it('keeps the book when its update is rejected', async () => {
        native.invoke.mockImplementation(async (command: string) => command === 'local_update_book'
            ? { ok: false, error: { code: 'READ_ONLY', message: 'locked' } }
            : { ok: true, value: [book] });
        const { result } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        let ok!: boolean;
        await act(async () => { ok = await result.current.updateBook(book.id, { status: 'completed' }); });
        expect(ok).toBe(false);
        expect(result.current.books[0]).toMatchObject({ title: 'Local book', status: 'serializing' });
    });

    it('deletes a book through IPC and clears every dependent cache entry', async () => {
        const { result, client } = setup();
        await waitFor(() => expect(result.current.booksLoading).toBe(false));
        client.setQueryData(localKeys.book(book.id), detail);
        client.setQueryData(localKeys.characters(book.id), [character]);
        native.invoke.mockImplementation(async (command: string) =>
            ({ ok: true, value: command === 'local_delete' ? { deletedId: book.id, parent: null } : [book] }));
        let ok!: boolean;
        await act(async () => { ok = await result.current.deleteBook(book.id); });
        expect(ok).toBe(true);
        expect(native.invoke).toHaveBeenLastCalledWith('local_delete', {
            input: { kind: 'book', bookId: book.id, expectedDatabaseVersion: 1 },
        });
        await waitFor(() => expect(result.current.books).toEqual([]));
        expect(client.getQueryData(localKeys.book(book.id))).toBeUndefined();
        expect(client.getQueryData(localKeys.characters(book.id))).toBeUndefined();
    });

    it('projects stored characters for the editor, normalizing handle config', () => {
        const stored: LocalCharacter = { ...character, handleConfig: { top: 'both' }, isArchived: true };
        const projected = projectCharacter(stored);
        expect(projected).toMatchObject({
            id: 'char-1', name: '林晚', aliases: ['晚晚'], isArchived: true,
            handleConfig: { top: 'both' },
        });
        expect(projected.handleConfig?.left).toBeDefined();
        expect(projectCharacter(character).handleConfig).toBeUndefined();
        // The projected book uses the provided characters instead of the empty constant.
        const bookProjection = projectBook(book, detail, [projected]);
        expect(bookProjection.characters).toHaveLength(1);
        expect(projectBook(book, detail).characters).toHaveLength(0);
    });
});
