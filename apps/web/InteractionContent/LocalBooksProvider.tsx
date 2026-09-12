import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { BooksContext, type BooksContextType } from './BooksContext';
import { localBookOptions, localKeys, localRepository, projectBook, LocalStorageError, type LocalBookDetail } from '../data/local/repository';
import type { LocalBook } from '../data/local/contracts';
import { createChapterWriteQueue } from '../services/chapterWrites';

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
            return detail ? projectBook(detail.book, detail) : undefined;
        },
        createBook: async (title, author = '') => {
            try {
                const book = await localRepository.createBook(title, author);
                await client.cancelQueries({ queryKey: localKeys.books });
                rememberBook(book);
                client.setQueryData<LocalBookDetail>(localKeys.book(book.id), { book, volumes: [], chapters: [] });
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
                client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({
                    ...old, volumes: old.volumes.map(item => item.id === volumeId ? result.volume : item),
                    chapters: [...old.chapters, result.chapter],
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
                client.setQueryData<LocalBookDetail>(localKeys.book(snapshot.bookId), old => old && ({
                    ...old, chapters: old.chapters.map(item => item.id === snapshot.chapterId ? result.chapter : item),
                }));
                return true;
            } catch (error) { fail(error); return false; }
        }),
        // Unimplemented actions cannot reach HTTP, optimistic cache writes, or fake success.
        updateChapterContent: unavailable, toggleChapterLock: unavailable,
        updateVolume: unavailable, deleteVolume: unavailable, deleteChapter: unavailable,
        reorderVolumes: unavailable, reorderChapters: unavailable, reorderCharacters: unavailable,
        updateBook: unavailable, deleteBook: unavailable,
        createCharacter: unavailable, updateCharacter: unavailable, deleteCharacter: unavailable,
        getRelations: unavailableRead, fetchGraphData: unavailableRead, saveGraphData: unavailable,
        fetchStoryPlanning: unavailableRead, saveStoryPlanning: unavailable,
    };
    return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}
