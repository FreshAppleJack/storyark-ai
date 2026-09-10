/* eslint-disable react-refresh/only-export-components -- provider + hook
   pairs stay together by design (same pattern as the legacy AppContext). */
import React, { createContext, useContext, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createChapterWriteQueue } from '../services/chapterWrites';
import {
    Book, Volume, Chapter, Character, Relation, ForeshadowingNote, StoryPlanning, BookStatus,
} from '../types';
import { normalizeCharacterPatch } from '../domain/characterInput';
import { normalizeStoryPlanning } from '../domain/storyPlanning';
import { booksApi } from '../data/booksApi';
import { chaptersApi } from '../data/chaptersApi';
import { charactersApi } from '../data/charactersApi';
import { workspaceApi } from '../data/workspaceApi';
import { calculateMixedWordCount } from '../utils/textUtils';
import { useSession } from './SessionContext';
import type { Node, Edge } from '@xyflow/react';
import type { GraphData } from '../data/dto';

/** Remote writes return true only after persistence; false keeps optimistic drafts.
 * Book/volume/chapter creates return an ID or null; character creation returns a boolean.
 * Remote reads return null on failure, never fake empty data.
 */
interface BooksContextType {
    books: Book[];
    createBook: (title: string) => Promise<string | null>;
    getBook: (id: string) => Book | undefined;

    // Returns true only when the PUT actually succeeded; the optimistic local
    // update alone is NOT proof of persistence.
    updateChapterContent: (bookId: string, volumeId: string, chapterId: string, title: string, content: string, wordCount?: number, foreshadowings?: ForeshadowingNote[]) => Promise<boolean>;
    toggleChapterLock: (bookId: string, volumeId: string, chapterId: string) => Promise<boolean>;

    createVolume: (bookId: string, title: string) => Promise<string | null>;
    updateVolume: (bookId: string, volumeId: string, title: string) => Promise<boolean>;
    deleteVolume: (bookId: string, volumeId: string) => Promise<boolean>;
    createChapter: (bookId: string, volumeId: string, title: string) => Promise<string | null>;
    deleteChapter: (bookId: string, volumeId: string, chapterId: string) => Promise<boolean>;

    reorderVolumes: (bookId: string, newVolumes: Volume[]) => Promise<boolean>;
    reorderChapters: (bookId: string, volumeId: string, newChapters: Chapter[]) => Promise<boolean>;
    reorderCharacters: (bookId: string, newCharacters: Character[]) => Promise<boolean>;

    updateBook: (bookId: string, data: { title?: string, status?: 'serializing' | 'completed' }) => Promise<boolean>;
    deleteBook: (bookId: string) => Promise<boolean>;

    createCharacter: (bookId: string, data: Partial<Character>) => Promise<boolean>;
    updateCharacter: (bookId: string, charId: string, data: Partial<Character>) => Promise<boolean>;
    deleteCharacter: (bookId: string, charId: string) => Promise<boolean>;

    getRelations: (bookId: string) => Promise<Relation[] | null>;
    fetchGraphData: (bookId: string) => Promise<GraphData | null>;
    saveGraphData: (bookId: string, nodes: Node[], edges: Edge[]) => Promise<boolean>;
    fetchStoryPlanning: (bookId: string) => Promise<StoryPlanning | null>;
    saveStoryPlanning: (bookId: string, planning: StoryPlanning) => Promise<boolean>;
}

const BooksContext = createContext<BooksContextType | undefined>(undefined);

/**
 * Owns the server-side books data: the query cache is the single source of
 * truth (no double storage in Context). Reads are reactive via useQuery;
 * mutations write optimistic updates into the cache through one shared
 * chapter write queue and report boolean results.
 */
export function BooksProvider({ children }: { children: React.ReactNode }): React.ReactElement {
    const { user } = useSession();
    const queryClient = useQueryClient();
    const booksQueryKey = ['books', user?.id ?? 'anonymous'] as const;
    const { data: books = [] } = useQuery({
        queryKey: booksQueryKey,
        queryFn: () => booksApi.list(user!.id, user!.nickname || 'Unknown'),
        enabled: !!user,
    });
    const setBooksCache = (updater: (prev: Book[]) => Book[]) => {
        queryClient.setQueryData<Book[]>(booksQueryKey, (prev = []) => updater(prev));
    };
    // Mutations read the render-closure `books` (not getQueryData): callers
    // may fire several mutations in one tick and later calls must still see
    // the same committed snapshot (e.g. volume deletion drains the chapters
    // visible before a same-tick chapter deletion).
    const [chapterWrites] = useState(createChapterWriteQueue);

    const createBook = async (title: string): Promise<string | null> => {
        if (!user) return null;
        const userId = user.id;
        try {
            const newBookId = await booksApi.create(userId, title,
                `bg-${['blue', 'emerald', 'rose', 'amber', 'purple'][Math.floor(Math.random() * 5)]}-600`);
            // The created ID confirms creation even if this refresh fails.
            await queryClient.invalidateQueries({ queryKey: booksQueryKey });
            return newBookId;
        } catch (error) {
            console.error("Failed to create book:", error);
            return null;
        }
    };

    const updateBook = async (
        bookId: string,
        data: {
            title?: string,
            status?: BookStatus;
        },
    ) => {
        const currentBook = books.find(book => book.id === bookId);
        if (!currentBook) return false;

        const newUiStatus: BookStatus =
            data.status ?? currentBook.status;

        const newTitle = data.title ?? currentBook.title;

        setBooksCache(prev => prev.map(book =>
            book.id === bookId
                ? {
                    ...book,
                    title: newTitle,
                    status: newUiStatus,
                    lastModified: Date.now(),
                }
                : book,
        ));

        try {
            await booksApi.update({ ...currentBook, title: newTitle, status: newUiStatus });
            return true;
        } catch (error) {
            console.error("Failed to update book:", error);
            return false;
        }
    };

    const deleteBook = async (bookId: string) => {
        setBooksCache(prev => prev.filter(b => b.id !== bookId));
        try {
            await booksApi.remove(bookId);
            return true;
        } catch (error) {
            console.error("Failed to delete book:", error);
            return false;
        }
    };

    const getBook = (id: string) => {
        const book = books.find(b => b.id === id);
        if (book && !book.characters) {
            return { ...book, characters: [] };
        }
        return book;
    };

    const updateChapterContent = async (bookId: string, volumeId: string, chapterId: string, title: string, content: string, wordCount?: number, foreshadowings?: ForeshadowingNote[]) => {
        const finalWordCount = wordCount !== undefined ? wordCount : calculateMixedWordCount(content);

        const book = books.find(b => b.id === bookId);
        const volume = book?.volumes.find(v => v.id === volumeId);
        const chapter = volume?.chapters.find(c => c.id === chapterId);
        const currentEditable = chapter?.isEditable ?? true;
        const currentForeshadowings = foreshadowings ?? chapter?.foreshadowings ?? [];

        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                lastModified: Date.now(),
                volumes: b.volumes.map(v => {
                    if (v.id !== volumeId) return v;
                    return {
                        ...v,
                        chapters: v.chapters.map(ch => {
                            if (ch.id !== chapterId) return ch;
                            return {
                                ...ch,
                                title: title,
                                content: content,
                                wordCount: finalWordCount,
                                lastModified: Date.now(),
                                isEditable: currentEditable,
                                foreshadowings: currentForeshadowings
                            };
                        })
                    };
                })
            };
        }));

        try {
            await chapterWrites.run(bookId, chapterId, () => chaptersApi.updateChapter(bookId, volumeId, chapterId, {
                title: title,
                content: content,
                wordCount: finalWordCount,
                status: 'draft',
                isEditable: currentEditable,
                foreshadowings: currentForeshadowings
            }));
            return true;
        } catch (error) {
            console.error("Failed to save chapter:", error);
            return false;
        }
    };

    const toggleChapterLock = async (bookId: string, volumeId: string, chapterId: string) => {
        const book = books.find(b => b.id === bookId);
        const volume = book?.volumes.find(v => v.id === volumeId);
        const chapter = volume?.chapters.find(c => c.id === chapterId);

        if (!chapter) return false;

        const newStatus = !chapter.isEditable;

        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                volumes: b.volumes.map(v => {
                    if (v.id !== volumeId) return v;
                    return {
                        ...v,
                        chapters: v.chapters.map(ch => {
                            if (ch.id !== chapterId) return ch;
                            return { ...ch, isEditable: newStatus };
                        })
                    };
                })
            };
        }));

        try {
            await chapterWrites.run(bookId, chapterId, () => chaptersApi.updateChapter(bookId, volumeId, chapterId, {
                title: chapter.title,
                content: chapter.content,
                wordCount: chapter.wordCount,
                status: chapter.status,
                isEditable: newStatus,
                foreshadowings: chapter.foreshadowings || []
            }));
            return true;
        } catch (error) {
            console.error("Failed to toggle chapter lock:", error);
            return false;
        }
    };

    const updateVolume = async (bookId: string, volumeId: string, title: string) => {
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                lastModified: Date.now(),
                volumes: b.volumes.map(v => {
                    if (v.id !== volumeId) return v;
                    return { ...v, title: title };
                })
            };
        }));

        try {
            await chaptersApi.updateVolume(bookId, volumeId, title);
            return true;
        } catch (error) {
            console.error("Failed to update volume:", error);
            return false;
        }
    };

    const deleteVolume = async (bookId: string, volumeId: string) => {
        const chapterIds = books.find(book => book.id === bookId)?.volumes.find(volume => volume.id === volumeId)?.chapters.map(chapter => chapter.id) ?? [];
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                volumes: b.volumes.filter(v => v.id !== volumeId)
            };
        }));

        try {
            await Promise.all(chapterIds.map(id => chapterWrites.drain(bookId, id)));
            await chaptersApi.deleteVolume(bookId, volumeId);
            return true;
        } catch (error) {
            console.error("Failed to delete volume:", error);
            return false;
        }
    };

    const deleteChapter = async (bookId: string, volumeId: string, chapterId: string) => {
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                lastModified: Date.now(),
                volumes: b.volumes.map(v => {
                    if (v.id !== volumeId) return v;
                    return {
                        ...v,
                        chapters: v.chapters.filter(c => c.id !== chapterId)
                    };
                })
            };
        }));

        try {
            await chapterWrites.run(bookId, chapterId, () => chaptersApi.deleteChapter(bookId, chapterId));
            return true;
        } catch (error) {
            console.error("Failed to delete chapter:", error);
            return false;
        }
    };

    const createVolume = async (
        bookId: string,
        title: string,
    ): Promise<string | null> => {
        try {
            const newVolume = await chaptersApi.createVolume(bookId, title);

            setBooksCache(prev => prev.map(book => {
                if (book.id !== bookId) return book;
                return {
                    ...book,
                    lastModified: Date.now(),
                    volumes: [...book.volumes, newVolume],
                };
            }));

            return newVolume.id;
        } catch (error) {
            console.error("Failed to create volume:", error);
            return null;
        }
    };

    const createChapter = async (bookId: string, volumeId: string, title: string): Promise<string | null> => {
        try {
            const newChapter = await chaptersApi.createChapter(bookId, volumeId, title);

            setBooksCache(prev => prev.map(b => {
                if (b.id !== bookId) return b;
                return {
                    ...b,
                    lastModified: Date.now(),
                    volumes: b.volumes.map(v => {
                        if (v.id !== volumeId) return v;
                        return {
                            ...v,
                            chapters: [...v.chapters, newChapter],
                        };
                    })
                };
            }));

            return newChapter.id;
        } catch (error) {
            console.error("Failed to create chapter:", error);
            return null;
        }
    };

    const reorderVolumes = async (bookId: string, newVolumes: Volume[]) => {
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                volumes: newVolumes,
                lastModified: Date.now()
            };
        }));

        try {
            await chaptersApi.reorderVolumes(bookId, newVolumes.map(item => item.id));
            return true;
        } catch (error) {
            console.error("Failed to reorder volumes:", error);
            return false;
        }
    };

    const reorderChapters = async (bookId: string, volumeId: string, newChapters: Chapter[]) => {
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                lastModified: Date.now(),
                volumes: b.volumes.map(v => {
                    if (v.id !== volumeId) return v;
                    return { ...v, chapters: newChapters };
                })
            };
        }));

        try {
            await chaptersApi.reorderChapters(bookId, newChapters.map(item => item.id));
            return true;
        } catch (error) {
            console.error("Failed to reorder chapters:", error);
            return false;
        }
    };

    const createCharacter = async (bookId: string, data: Partial<Character>) => {
        try {
            const newChar = await charactersApi.create(bookId, data);

            setBooksCache(prev => prev.map(b => {
                if (b.id !== bookId) return b;
                return {
                    ...b,
                    characters: [...(b.characters || []), newChar]
                };
            }));
            return true;
        } catch (error) {
            console.error("Failed to create character:", error);
            return false;
        }
    };

    const updateCharacter = async (bookId: string, charId: string, data: Partial<Character>) => {
        const sanitizedData = normalizeCharacterPatch(data);
        if (!sanitizedData) {
            console.error("Failed to update character: character name cannot be empty");
            return false;
        }

        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                characters: (b.characters || []).map(c => c.id === charId ? { ...c, ...sanitizedData } : c)
            };
        }));

        try {
            await charactersApi.update(bookId, charId, sanitizedData);
            return true;
        } catch (error) {
            console.error("Failed to update character:", error);
            return false;
        }
    };

    const deleteCharacter = async (bookId: string, charId: string) => {
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                characters: (b.characters || []).filter(c => c.id !== charId)
            };
        }));

        try {
            await charactersApi.remove(bookId, charId);
            return true;
        } catch (error) {
            console.error("Failed to delete character:", error);
            return false;
        }
    };

    const reorderCharacters = async (bookId: string, newCharacters: Character[]) => {
        setBooksCache(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                characters: newCharacters
            };
        }));

        try {
            await charactersApi.reorder(bookId, newCharacters.map(item => item.id));
            return true;
        } catch (error) {
            console.error("Failed to reorder characters:", error);
            return false;
        }
    };

    // this method for compatibility, but mainly use fetchGraphData to get relations
    const getRelations = async (bookId: string): Promise<Relation[] | null> => {
        try {
            return await workspaceApi.getRelations(bookId);
        } catch (error) {
            console.error("Failed to fetch relations:", error);
            return null;
        }
    };

    // --- Get complete graph data (Nodes + Edges) ---
    const fetchGraphData = async (bookId: string): Promise<GraphData | null> => {
        try {
            return await workspaceApi.getGraph(bookId);
        } catch (error) {
            console.error("Failed to fetch graph data:", error);
            return null;
        }
    };

    // --- Save complete graph data (Support multiple instance nodes) ---
    const saveGraphData = async (bookId: string, nodes: Node[], edges: Edge[]): Promise<boolean> => {
        try {
            await workspaceApi.saveGraph(bookId, nodes, edges);
            return true;

        } catch (error) {
            console.error("Failed to save graph data:", error);
            return false;
        }
    };

    const fetchStoryPlanning = async (bookId: string): Promise<StoryPlanning | null> => {
        try {
            const planning = await workspaceApi.getPlanning(bookId);

            setBooksCache(prev => prev.map(book => (
                book.id === bookId ? { ...book, storyPlanning: planning } : book
            )));

            return planning;
        } catch (error) {
            console.error("Failed to fetch story planning:", error);
            return null;
        }
    };

    const saveStoryPlanning = async (bookId: string, planning: StoryPlanning): Promise<boolean> => {
        const normalizedPlanning = normalizeStoryPlanning(planning, Date.now());
        try {
            await workspaceApi.savePlanning(bookId, normalizedPlanning);
            setBooksCache(prev => prev.map(book => (
                book.id === bookId ? { ...book, storyPlanning: normalizedPlanning } : book
            )));
            return true;
        } catch (error) {
            console.error("Failed to save story planning:", error);
            return false;
        }
    };

    return (
        <BooksContext.Provider value={{
            books, getBook, createBook, updateBook, deleteBook,
            updateChapterContent, toggleChapterLock,
            createVolume, updateVolume, deleteVolume, createChapter, deleteChapter,
            reorderVolumes, reorderChapters, reorderCharacters,
            createCharacter, updateCharacter, deleteCharacter,
            getRelations, fetchGraphData, saveGraphData, fetchStoryPlanning, saveStoryPlanning,
        }}>
            {children}
        </BooksContext.Provider>
    );
}

export const useBooks = () => {
    const context = useContext(BooksContext);
    if (!context) throw new Error('useBooks must be used within BooksProvider');
    return context;
};
