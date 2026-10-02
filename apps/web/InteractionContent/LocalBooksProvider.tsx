import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { BooksContext, type BooksContextType } from './BooksContext';
import { directoryChapter, localBookOptions, localKeys, localRepository, projectBook, projectCharacter, LocalStorageError, type LocalBookDetail } from '../data/local/repository';
import { chapterBodyCache, rememberChapter } from '../data/local/chapterBodyCache';
import type { LocalBook, LocalChapter, LocalCharacter, LocalVolume } from '../data/local/contracts';
import { createChapterWriteQueue } from '../services/chapterWrites';
import { planningKey } from '../data/local/planningRepository';
import { localGraphKey } from '../data/local/graphRepository';
import { brainstormKey } from '../data/local/brainstormRepository';

export function LocalBooksProvider({ children }: { children: React.ReactNode }) {
    const client = useQueryClient();
    const [writes] = useState(createChapterWriteQueue);
    const query = useQuery({ queryKey: localKeys.books, queryFn: localRepository.listBooks, retry: false });
    const fail = (error: unknown) => {
        toast.error(error instanceof LocalStorageError && error.code === 'VERSION_CONFLICT'
            ? 'This book changed in another session. Keep your draft and resolve the conflict before saving again.'
            : error instanceof Error ? error.message : 'Local storage failed.');
    };
    const rememberBook = (book: LocalBook) => client.setQueryData<LocalBook[]>(localKeys.books, previous =>
        previous?.some(item => item.id === book.id)
            ? previous.map(item => item.id === book.id ? book : item)
            : [...(previous ?? []), book]);
    const unavailable = async () => { toast.error('This feature is not available in local mode yet.'); return false; };
    const unavailableRead = async () => { await unavailable(); return null; };
    const value: BooksContextType = {
        storageMode: 'local', books: (query.data ?? []).map(book => projectBook(book)),
        booksLoading: query.isPending, booksError: query.error?.message,
        refreshBooks: async () => { await query.refetch(); },
        getBook: id => {
            const detail = client.getQueryData<LocalBookDetail>(localKeys.book(id));
            if (!detail) return undefined;
            const characters = client.getQueryData<LocalCharacter[]>(localKeys.characters(id));
            return projectBook(detail.book, detail, characters?.map(projectCharacter));
        },
        createBook: async (title, author = '') => {
            try {
                // Same fixed palette the legacy shelf used: one accent per book,
                // chosen at creation.
                const coverColor = `bg-${['blue', 'emerald', 'rose', 'amber', 'purple'][Math.floor(Math.random() * 5)]}-600`;
                const book = await localRepository.createBook(title, author, coverColor);
                await client.cancelQueries({ queryKey: localKeys.books });
                rememberBook(book);
                client.setQueryData<LocalBookDetail>(localKeys.book(book.id), { book, volumes: [], chapters: [], bodyMode: 'directory' });
                return book.id;
            } catch (error) { fail(error); return null; }
        },
        createVolume: (bookId, title) => writes.run(bookId, 'local', async () => {
            try {
                const current = await client.ensureQueryData(localBookOptions(bookId));
                const result = await localRepository.createVolume(bookId, title, current.book.databaseVersion);
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old, book: result.book, volumes: [...old.volumes, result.volume],
                }));
                rememberBook(result.book);
                return result.volume.id;
            } catch (error) { fail(error); return null; }
        }),
        createChapter: (bookId, volumeId, title) => writes.run(bookId, 'local', async () => {
            try {
                const current = await client.ensureQueryData(localBookOptions(bookId));
                const volume = current.volumes.find(item => item.id === volumeId);
                if (!volume) throw new Error('Volume not found. Reopen the book.');
                const result = await localRepository.createChapter(bookId, volumeId, title, volume.databaseVersion);
                rememberChapter(client, result.chapter);
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old, volumes: old.volumes.map(item => item.id === volumeId ? result.volume : item),
                    chapters: [...old.chapters, old.bodyMode === 'directory' ? directoryChapter(result.chapter) : result.chapter],
                }));
                return result.chapter.id;
            } catch (error) { fail(error); return null; }
        }),
        saveLocalSnapshot: (snapshot, sessionKey) => writes.run(snapshot.bookId, 'local', async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(snapshot.bookId));
                const chapter = current?.chapters.find(item => item.id === snapshot.chapterId && item.volumeId === snapshot.volumeId);
                if (!chapter) throw new Error('Chapter not found. The draft remains unsaved.');
                const result = await localRepository.saveChapter({
                    ...snapshot, sessionKey, contentFormat: 'tiptap-json', contentVersion: 1,
                    foreshadowings: snapshot.foreshadowings.map(note => ({ ...note })),
                    expectedDatabaseVersion: chapter.databaseVersion,
                });
                if (result.sessionKey !== sessionKey || result.revision !== snapshot.revision) throw new Error('Unexpected save acknowledgement. Keep your draft.');
                rememberChapter(client, result.chapter);
                client.setQueryData<LocalBookDetail>(localKeys.book(snapshot.bookId), old => old && ({
                    ...old, chapters: old.chapters.map(item => item.id === snapshot.chapterId ? (old.bodyMode === 'directory' ? directoryChapter(result.chapter) : result.chapter) : item),
                }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        // Without an open draft, only a pure title change is persisted; any
        // content divergence is rejected instead of overwriting the chapter.
        updateChapterContent: (bookId, volumeId, chapterId, title, content, wordCount, foreshadowings) => writes.run(bookId, chapterId, async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const chapter = current?.chapters.find(item => item.id === chapterId && item.volumeId === volumeId);
                if (!chapter) throw new Error('Chapter not found. Reopen the book.');
                const body = current?.bodyMode === 'directory'
                    ? chapterBodyCache(client).get(bookId, chapterId, chapter.databaseVersion) : chapter;
                const directoryTitleOnly = current?.bodyMode === 'directory' && content === ''
                    && (foreshadowings === undefined || foreshadowings.length === 0);
                const unchanged = (directoryTitleOnly || ((body?.body.content ?? '') === content
                    && JSON.stringify(body?.foreshadowings ?? []) === JSON.stringify(foreshadowings ?? body?.foreshadowings ?? [])))
                    && (wordCount === undefined || chapter.wordCount === wordCount);
                if (!unchanged) throw new LocalStorageError('UNSUPPORTED', 'Only the title can change for a chapter without an open draft.');
                if (chapter.title === title) return true;
                const record = await localRepository.rename<LocalChapter>({ kind: 'chapter', bookId, volumeId, chapterId, expectedDatabaseVersion: chapter.databaseVersion, title });
                rememberChapter(client, record);
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old, chapters: old.chapters.map(item => item.id === chapterId ? (old.bodyMode === 'directory' ? directoryChapter(record) : record) : item),
                }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        toggleChapterLock: (bookId, volumeId, chapterId) => writes.run(bookId, chapterId, async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const chapter = current?.chapters.find(item => item.id === chapterId && item.volumeId === volumeId);
                if (!chapter) throw new Error('Chapter not found. Reopen the book.');
                const record = await localRepository.setReadOnly<LocalChapter>({ kind: 'chapter', bookId, volumeId, chapterId, expectedDatabaseVersion: chapter.databaseVersion, isReadOnly: !chapter.isReadOnly });
                rememberChapter(client, record);
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old, chapters: old.chapters.map(item => item.id === chapterId ? (old.bodyMode === 'directory' ? directoryChapter(record) : record) : item),
                }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        updateVolume: (bookId, volumeId, title) => writes.run(bookId, volumeId, async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const volume = current?.volumes.find(item => item.id === volumeId);
                if (!volume) throw new Error('Volume not found. Reopen the book.');
                if (volume.title === title) return true;
                const record = await localRepository.rename<LocalVolume>({ kind: 'volume', bookId, volumeId, expectedDatabaseVersion: volume.databaseVersion, title });
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old, volumes: old.volumes.map(item => item.id === volumeId ? record : item),
                }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        deleteChapter: (bookId, volumeId, chapterId) => writes.run(bookId, chapterId, async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const volume = current?.volumes.find(item => item.id === volumeId);
                const chapter = current?.chapters.find(item => item.id === chapterId && item.volumeId === volumeId);
                if (!volume || !chapter) throw new Error('Chapter not found. Reopen the book.');
                const result = await localRepository.delete<LocalVolume>({ kind: 'chapter', bookId, volumeId, chapterId, expectedDatabaseVersion: chapter.databaseVersion, expectedParentVersion: volume.databaseVersion });
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old,
                    volumes: old.volumes.map(item => item.id === volumeId ? (result.parent ?? item) : item),
                    chapters: old.chapters.filter(item => item.id !== chapterId),
                }));
                chapterBodyCache(client).clearBook(bookId);
                void client.invalidateQueries({ queryKey: planningKey(bookId) });
                return true;
            } catch (error) { fail(error); return false; }
        }),
        deleteVolume: (bookId, volumeId) => writes.run(bookId, volumeId, async () => {
            try {
                // Drain each known chapter queue first so a committed save is
                // never deleted while still in flight.
                const before = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                await Promise.all((before?.chapters ?? [])
                    .filter(item => item.volumeId === volumeId)
                    .map(item => writes.drain(bookId, item.id)));
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const volume = current?.volumes.find(item => item.id === volumeId);
                if (!current || !volume) throw new Error('Volume not found. Reopen the book.');
                const result = await localRepository.delete<LocalBook>({ kind: 'volume', bookId, volumeId, expectedDatabaseVersion: volume.databaseVersion, expectedParentVersion: current.book.databaseVersion });
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old,
                    book: result.parent ?? old.book,
                    volumes: old.volumes.filter(item => item.id !== volumeId),
                    chapters: old.chapters.filter(item => item.volumeId !== volumeId),
                }));
                if (result.parent) rememberBook(result.parent);
                chapterBodyCache(client).clearBook(bookId);
                void client.invalidateQueries({ queryKey: planningKey(bookId) });
                return true;
            } catch (error) { fail(error); return false; }
        }),
        reorderVolumes: (bookId, newVolumes) => writes.run(bookId, 'local', async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                if (!current) throw new Error('Book not loaded. Reopen the book.');
                const items = newVolumes.map(volume => {
                    const stored = current.volumes.find(item => item.id === volume.id);
                    if (!stored) throw new Error('Volume not found. Reopen the book.');
                    return { kind: 'volume' as const, bookId, volumeId: volume.id, expectedDatabaseVersion: stored.databaseVersion, expectedPosition: stored.position };
                });
                const records = await localRepository.reorder<LocalVolume>({ parent: { kind: 'book', bookId, expectedDatabaseVersion: current.book.databaseVersion }, items });
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({ ...old, volumes: records }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        reorderChapters: (bookId, volumeId, newChapters) => writes.run(bookId, volumeId, async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const volume = current?.volumes.find(item => item.id === volumeId);
                if (!current || !volume) throw new Error('Volume not found. Reopen the book.');
                const items = newChapters.map(chapter => {
                    const stored = current.chapters.find(item => item.id === chapter.id && item.volumeId === volumeId);
                    if (!stored) throw new Error('Chapter not found. Reopen the book.');
                    return { kind: 'chapter' as const, bookId, volumeId, chapterId: chapter.id, expectedDatabaseVersion: stored.databaseVersion, expectedPosition: stored.position };
                });
                const records = await localRepository.reorder<LocalChapter>({ parent: { kind: 'volume', bookId, volumeId, expectedDatabaseVersion: volume.databaseVersion }, items }, current.bodyMode === 'directory');
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old,
                    chapters: [...old.chapters.filter(item => item.volumeId !== volumeId), ...records.map(chapter => old.bodyMode === 'directory' ? directoryChapter(chapter) : chapter)],
                }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        createCharacter: (bookId, data) => writes.run(bookId, 'characters', async () => {
            try {
                const current = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                if (!current) throw new Error('Book not loaded. Reopen the book.');
                const result = await localRepository.createCharacter({
                    bookId,
                    name: data.name?.trim() ?? '',
                    role: data.role ?? 'supporting',
                    aliases: data.aliases ?? [],
                    description: data.description ?? '',
                    color: data.color ?? '#3b82f6',
                    tags: data.tags ?? [],
                    avatar: data.avatar ?? null,
                    handleConfig: data.handleConfig ?? null,
                    expectedBookVersion: current.book.databaseVersion,
                });
                client.setQueryData<LocalCharacter[]>(localKeys.characters(bookId), old => [...(old ?? []), result.character]);
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({ ...old, book: result.book }));
                rememberBook(result.book);
                return true;
            } catch (error) { fail(error); return false; }
        }),
        updateCharacter: (bookId, charId, data) => writes.run(bookId, 'characters', async () => {
            try {
                const characters = client.getQueryData<LocalCharacter[]>(localKeys.characters(bookId));
                const stored = characters?.find(item => item.id === charId);
                if (!stored) throw new Error('Character not found. Reopen the book.');
                const record = await localRepository.updateCharacter({
                    bookId, characterId: charId, expectedDatabaseVersion: stored.databaseVersion,
                    name: data.name?.trim() ?? stored.name,
                    role: data.role ?? stored.role,
                    aliases: data.aliases ?? stored.aliases,
                    description: data.description ?? stored.description,
                    color: data.color ?? stored.color,
                    tags: data.tags ?? stored.tags,
                    avatar: data.avatar !== undefined ? (data.avatar ?? null) : stored.avatar,
                    handleConfig: data.handleConfig !== undefined ? (data.handleConfig ?? null) : stored.handleConfig,
                });
                client.setQueryData<LocalCharacter[]>(localKeys.characters(bookId), old =>
                    old?.map(item => item.id === charId ? record : item) ?? old);
                return true;
            } catch (error) { fail(error); return false; }
        }),
        // Deletion is archival: mentions, text and graph references stay.
        deleteCharacter: (bookId, charId) => writes.run(bookId, 'characters', async () => {
            try {
                const characters = client.getQueryData<LocalCharacter[]>(localKeys.characters(bookId));
                const stored = characters?.find(item => item.id === charId);
                if (!stored) throw new Error('Character not found. Reopen the book.');
                const record = await localRepository.archiveCharacter({
                    bookId, characterId: charId, expectedDatabaseVersion: stored.databaseVersion, isArchived: true,
                });
                client.setQueryData<LocalCharacter[]>(localKeys.characters(bookId), old =>
                    old?.map(item => item.id === charId ? record : item) ?? old);
                return true;
            } catch (error) { fail(error); return false; }
        }),
        // Bookshelf management commits through IPC first, then updates caches.
        updateBook: async (bookId, data) => {
            try {
                const current = (query.data ?? []).find(book => book.id === bookId)
                    ?? client.getQueryData<LocalBookDetail>(localKeys.book(bookId))?.book;
                if (!current) throw new LocalStorageError('NOT_FOUND', 'Book not found.');
                const updated = await localRepository.updateBook({
                    bookId, expectedDatabaseVersion: current.databaseVersion, ...data,
                });
                await client.cancelQueries({ queryKey: localKeys.books });
                rememberBook(updated);
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({ ...old, book: updated }));
                return true;
            } catch (error) { fail(error); return false; }
        },
        deleteBook: async (bookId) => {
            try {
                const current = (query.data ?? []).find(book => book.id === bookId)
                    ?? client.getQueryData<LocalBookDetail>(localKeys.book(bookId))?.book;
                if (!current) throw new LocalStorageError('NOT_FOUND', 'Book not found.');
                // One transaction cascades volumes, chapters, characters, the
                // graph, planning and the brainstorm workspace; locks refuse.
                await localRepository.delete({ kind: 'book', bookId, expectedDatabaseVersion: current.databaseVersion });
                chapterBodyCache(client).clearBook(bookId);
                client.setQueryData<LocalBook[]>(localKeys.books, previous => previous?.filter(book => book.id !== bookId));
                for (const key of [localKeys.book(bookId), localKeys.fullBook(bookId), localKeys.characters(bookId), planningKey(bookId), localGraphKey(bookId), brainstormKey(bookId)]) {
                    client.removeQueries({ queryKey: key });
                }
                return true;
            } catch (error) { fail(error); return false; }
        },
        // Unimplemented actions cannot reach HTTP, optimistic cache writes, or fake success.
        reorderCharacters: (bookId, ordered) => writes.run(bookId, 'characters', async () => {
            try {
                const detail = client.getQueryData<LocalBookDetail>(localKeys.book(bookId));
                const stored = client.getQueryData<LocalCharacter[]>(localKeys.characters(bookId));
                if (!detail || !stored) throw new Error('Characters not loaded. Reopen the book.');
                const items = ordered.map(character => {
                    const record = stored.find(item => item.id === character.id);
                    if (!record) throw new Error('Character not found. Reopen the book.');
                    return { characterId: record.id, expectedDatabaseVersion: record.databaseVersion, expectedPosition: record.position };
                });
                const records = await localRepository.reorderCharacters({ bookId, expectedBookVersion: detail.book.databaseVersion, items });
                client.setQueryData(localKeys.characters(bookId), records);
                return true;
            } catch (error) { fail(error); return false; }
        }),
        getRelations: unavailableRead, fetchGraphData: unavailableRead, saveGraphData: unavailable,
        fetchStoryPlanning: unavailableRead, saveStoryPlanning: unavailable,
    };
    return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}
