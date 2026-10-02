import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ExpectedTarget, LocalBook, LocalChapter, LocalCharacter, LocalRecord, LocalVolume, SaveChapterRequest, StorageResult } from './contracts';
import { normalizeHandleConfig } from '../../domain/relationshipHandles';
import type { Book, Character } from '../../types';
import { reportError, storageErrorMessage } from '../diagnostics';

export interface LocalBookDetail { book: LocalBook; volumes: LocalVolume[]; chapters: LocalChapter[]; bodyMode?: 'directory' }
export const localKeys = {
    all: ['local', 'default-workspace'] as const,
    books: ['local', 'default-workspace', 'books'] as const,
    book: (id: string) => ['local', 'default-workspace', 'book', id] as const,
    fullBook: (id: string) => ['local', 'default-workspace', 'full-book', id] as const,
    chapter: (bookId: string, id: string) => ['local', 'default-workspace', 'chapter', bookId, id] as const,
    characters: (bookId: string) => ['local', 'default-workspace', 'characters', bookId] as const,
};
export const localDerivedIndexKey = (bookId: string) => [...localKeys.all, 'derived-index', bookId] as const;
export class LocalStorageError extends Error {
    readonly userFacing = true;
    constructor(public readonly code: string, message: string) { super(message); }
}

export interface LocalCallOptions {
    failureMessage?: string;
}

export async function call<T>(
    command: string,
    args?: Record<string, unknown>,
    options: LocalCallOptions = {},
): Promise<T> {
    if (!isTauri()) throw new LocalStorageError('DESKTOP_REQUIRED', 'Open the StoryArk desktop app to access your local books. Browser preview cannot save books.');
    let result: StorageResult<T>;
    try { result = await invoke<StorageResult<T>>(command, args); }
    catch (error) {
        reportError(command, error, 'IPC_FAILURE');
        throw new LocalStorageError(
            'IPC_FAILURE',
            options.failureMessage ?? 'StoryArk could not complete this action. Try again or restart the app.',
        );
    }
    if (!result.ok) {
        reportError(command, result.error.message, result.error.code);
        throw new LocalStorageError(result.error.code, storageErrorMessage(result.error.code, command));
    }
    return result.value;
}
export const localRepository = {
    listBooks: () => call<LocalBook[]>('local_list_books'),
    readBook: (bookId: string) => call<LocalBookDetail>('local_read_book', { bookId }),
    readDirectory: (bookId: string) => call<LocalBookDetail>('local_read_book_directory', { bookId }),
    readChapter: (bookId: string, chapterId: string) => call<LocalChapter>('local_read_chapter', { bookId, chapterId }),
    createBook: (title: string, author: string, coverColor: string) => call<LocalBook>('local_create_book', { input: { title, author, coverColor } }),
    updateBook: (input: { bookId: string; expectedDatabaseVersion: number; title?: string; status?: 'serializing' | 'completed' }) =>
        call<LocalBook>('local_update_book', { input }),
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
    reorder: <T extends LocalRecord = LocalRecord>(input: { parent: ExpectedTarget | null; items: Array<ExpectedTarget & { expectedPosition: number }> }, directoryOnly = false) =>
        call<T[]>('local_reorder', directoryOnly ? { input, directoryOnly } : { input }),
    delete: <T extends LocalRecord = LocalRecord>(input: ExpectedTarget & { expectedParentVersion?: number }) =>
        call<{ deletedId: string; parent: T | null }>('local_delete', { input }),
    listCharacters: (bookId: string) => call<LocalCharacter[]>('local_list_characters', { bookId }),
    reorderCharacters: (input: { bookId: string; expectedBookVersion: number; items: { characterId: string; expectedDatabaseVersion: number; expectedPosition: number }[] }) =>
        call<LocalCharacter[]>('local_reorder_characters', { input }),
    createCharacter: (input: LocalCharacterInput & { bookId: string; expectedBookVersion: number }) =>
        call<{ character: LocalCharacter; book: LocalBook }>('local_create_character', { input }),
    updateCharacter: (input: LocalCharacterInput & { bookId: string; characterId: string; expectedDatabaseVersion: number }) =>
        call<LocalCharacter>('local_update_character', { input }),
    archiveCharacter: (input: { bookId: string; characterId: string; expectedDatabaseVersion: number; isArchived: boolean }) =>
        call<LocalCharacter>('local_archive_character', { input }),
};

export interface LocalCharacterInput {
    name: string;
    role: LocalCharacter['role'];
    aliases: string[];
    description: string;
    color: string;
    tags: string[];
    avatar: string | null;
    handleConfig: LocalCharacter['handleConfig'];
}

// Stable reference: a fresh array per projection would retrigger the
// editor's characters effect chain and rebuild the Tiptap instance.
const NO_CHARACTERS: Book['characters'] = [];

export function projectCharacter(record: LocalCharacter): Character {
    return {
        id: record.id, bookId: record.bookId, name: record.name, aliases: record.aliases,
        databaseVersion: record.databaseVersion,
        role: record.role, description: record.description, color: record.color,
        tags: record.tags, avatar: record.avatar ?? undefined,
        handleConfig: record.handleConfig ? normalizeHandleConfig(record.handleConfig) : undefined,
        isArchived: record.isArchived,
    };
}

export function projectBook(book: LocalBook, detail?: LocalBookDetail, characters?: Character[]): Book {
    const chaptersByVolume = new Map<string, LocalChapter[]>();
    for (const chapter of detail?.chapters ?? []) {
        let chapters = chaptersByVolume.get(chapter.volumeId);
        if (!chapters) { chapters = []; chaptersByVolume.set(chapter.volumeId, chapters); }
        chapters.push(chapter);
    }
    return {
        id: book.id, title: book.title, author: book.author, status: book.status,
        isReadOnly: book.isReadOnly,
        coverColor: book.coverColor || undefined,
        lastModified: detail?.chapters.reduce((latest, chapter) => Math.max(latest, chapter.updatedAt), book.updatedAt) ?? book.updatedAt,
        characters: characters ?? NO_CHARACTERS,
        volumes: detail?.volumes.map(volume => ({
            id: volume.id, title: volume.title,
            chapters: (chaptersByVolume.get(volume.id) ?? []).map(ch => ({
                id: ch.id, title: ch.title, status: ch.status, content: ch.body.content, databaseVersion: ch.databaseVersion,
                contentLoaded: detail.bodyMode !== 'directory',
                contentFormat: ch.body.format, contentVersion: ch.body.version,
                wordCount: ch.wordCount, foreshadowings: ch.foreshadowings,
                isReadOnly: book.isReadOnly || volume.isReadOnly || ch.isReadOnly,
                isEditable: !book.isReadOnly && !volume.isReadOnly && !ch.isReadOnly
                    && (ch.body.contentState ?? 'editable') === 'editable'
                    && ch.body.format === 'tiptap-json' && ch.body.version === 1,
                lastModified: ch.updatedAt,
            })),
        })) ?? [],
    };
}

// Never silently refresh the version underneath an unsaved editor draft.
export const localBookOptions = (bookId: string) => ({
    queryKey: localKeys.book(bookId), queryFn: () => localRepository.readDirectory(bookId),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
});

// Analysis workspaces still need complete source snapshots. Release their
// bodies as soon as the workspace closes, independently of the directory.
export const localFullBookOptions = (bookId: string) => ({
    ...localBookOptions(bookId), queryKey: localKeys.fullBook(bookId),
    queryFn: () => localRepository.readBook(bookId), gcTime: 0,
});

export function directoryChapter(chapter: LocalChapter): LocalChapter {
    return { ...chapter, body: { ...chapter.body, content: '', originalContent: null, originalFormat: null }, foreshadowings: [] };
}

// Character queries are independent so character edits never rewrite the
// chapter cache underneath an open draft; the query data reference stays
// stable until a mutation commits.
export const localCharactersOptions = (bookId: string) => ({
    queryKey: localKeys.characters(bookId), queryFn: () => localRepository.listCharacters(bookId),
    staleTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
});
