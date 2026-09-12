import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ExpectedTarget, LocalBook, LocalChapter, LocalRecord, LocalVolume, SaveChapterRequest, StorageResult } from './contracts';
import type { Book } from '../../types';

export interface LocalBookDetail { book: LocalBook; volumes: LocalVolume[]; chapters: LocalChapter[] }
export const localKeys = {
    all: ['local', 'default-workspace'] as const,
    books: ['local', 'default-workspace', 'books'] as const,
    book: (id: string) => ['local', 'default-workspace', 'book', id] as const,
};
export class LocalStorageError extends Error {
    constructor(public readonly code: string, message: string) { super(message); }
}
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!isTauri()) throw new LocalStorageError('DESKTOP_REQUIRED', 'Open the StoryArk desktop app to access your local books. Browser preview cannot save books.');
    let result: StorageResult<T>;
    try { result = await invoke<StorageResult<T>>(command, args); }
    catch { throw new LocalStorageError('IPC_FAILURE', 'The desktop storage request failed. Your draft has not been marked saved.'); }
    if (!result.ok) throw new LocalStorageError(result.error.code, result.error.message);
    return result.value;
}
export const localRepository = {
    listBooks: () => call<LocalBook[]>('local_list_books'),
    readBook: (bookId: string) => call<LocalBookDetail>('local_read_book', { bookId }),
    createBook: (title: string, author: string) => call<LocalBook>('local_create_book', { input: { title, author } }),
    createVolume: (bookId: string, title: string, expectedBookVersion: number) =>
        call<{ volume: LocalVolume; book: LocalBook }>('local_create_volume', { input: { bookId, title, expectedBookVersion } }),
    createChapter: (bookId: string, volumeId: string, title: string, expectedVolumeVersion: number) =>
        call<{ chapter: LocalChapter; volume: LocalVolume }>('local_create_chapter', { input: { bookId, volumeId, title, expectedVolumeVersion } }),
    saveChapter: (input: SaveChapterRequest) =>
        call<{ chapter: LocalChapter; sessionKey: string; revision: number }>('local_save_chapter', { input }),
    rename: <T extends LocalRecord = LocalRecord>(input: ExpectedTarget & { title: string }) =>
        call<T>('local_rename', { input }),
    setReadOnly: <T extends LocalRecord = LocalRecord>(input: ExpectedTarget & { isReadOnly: boolean }) =>
        call<T>('local_set_read_only', { input }),
    reorder: <T extends LocalRecord = LocalRecord>(input: { parent: ExpectedTarget | null; items: ExpectedTarget[] }) =>
        call<T[]>('local_reorder', { input }),
    delete: <T extends LocalRecord = LocalRecord>(input: ExpectedTarget & { expectedParentVersion?: number }) =>
        call<{ deletedId: string; parent: T | null }>('local_delete', { input }),
};

// Stable reference: a fresh array per projection would retrigger the
// editor's characters effect chain and rebuild the Tiptap instance.
const NO_CHARACTERS: Book['characters'] = [];

export function projectBook(book: LocalBook, detail?: LocalBookDetail): Book {
    return {
        id: book.id, title: book.title, author: book.author, status: book.status,
        lastModified: Math.max(book.updatedAt, ...(detail?.chapters.map(ch => ch.updatedAt) ?? [])),
        characters: NO_CHARACTERS,
        volumes: detail?.volumes.map(volume => ({
            id: volume.id, title: volume.title,
            chapters: detail.chapters.filter(ch => ch.volumeId === volume.id).map(ch => ({
                id: ch.id, title: ch.title, status: ch.status, content: ch.body.content,
                wordCount: ch.wordCount, foreshadowings: ch.foreshadowings,
                isEditable: !book.isReadOnly && !volume.isReadOnly && !ch.isReadOnly
                    && ch.body.format === 'tiptap-json' && ch.body.version === 1,
                lastModified: ch.updatedAt,
            })),
        })) ?? [],
    };
}

// Never silently refresh the version underneath an unsaved editor draft.
export const localBookOptions = (bookId: string) => ({
    queryKey: localKeys.book(bookId), queryFn: () => localRepository.readBook(bookId),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
});
