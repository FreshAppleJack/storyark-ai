import React, { createContext, useContext, useEffect, useState } from 'react';
import { createChapterWriteQueue } from '../services/chapterWrites';
import {
    Book,
    User,
    Volume,
    Chapter,
    Character,
    Relation,
    ForeshadowingNote,
    EditorSpacingSettings,
    AiContinueSettings,
    AutoHighlightSettings,
    CharacterRole,
    StoryPlanning,
    BookStatus
} from '../types';
import { normalizeCharacterPatch } from '../domain/characterInput';
import { normalizeStoryPlanning } from '../domain/storyPlanning';
import {
    DEFAULT_EDITOR_SPACING_SETTINGS, DEFAULT_AI_CONTINUE_SETTINGS,
    normalizeEditorSpacingSettings, normalizeAiContinueSettings, normalizeAutoHighlightSettings,
} from '../domain/preferences';
import { accountApi } from '../data/accountApi';
import { booksApi } from '../data/booksApi';
import { chaptersApi } from '../data/chaptersApi';
import { charactersApi } from '../data/charactersApi';
import { workspaceApi } from '../data/workspaceApi';
import { calculateMixedWordCount } from '../utils/textUtils';
import type { Node, Edge } from '@xyflow/react';

import type { GraphData } from '../data/dto';

/** Remote writes return true only after persistence; false keeps optimistic drafts.
 * Book/volume/chapter creates return an ID or null; character creation returns a boolean.
 * Remote reads return null on failure, never fake empty data.
 * Preference setters are local-first; remote preference sync is best effort.
 * Login reports authentication only; initial settings/books load independently.
 */
interface AppContextType {
    user: User | null;
    books: Book[];
    isDarkMode: boolean;
    editorSpacingSettings: EditorSpacingSettings;
    aiContinueSettings: AiContinueSettings;
    autoHighlightSettings: AutoHighlightSettings;
    toggleDarkMode: () => void;
    setDarkMode: (enabled: boolean) => void;
    updateEditorSpacingSettings: (settings: Partial<EditorSpacingSettings>) => void;
    updateAiContinueSettings: (settings: Partial<AiContinueSettings>) => void;
    setAutoHighlightRoleEnabled: (role: CharacterRole, enabled: boolean) => void;
    updateNickname: (nickname: string) => Promise<boolean>;
    login: (username: string, pass: string) => Promise<boolean>;
    logout: () => void;
    register: (username: string, pass: string, nickname: string) => Promise<boolean>;
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

    // Add graph data methods methods
    fetchGraphData: (bookId: string) => Promise<GraphData | null>;
    saveGraphData: (bookId: string, nodes: Node[], edges: Edge[]) => Promise<boolean>;
    fetchStoryPlanning: (bookId: string) => Promise<StoryPlanning | null>;
    saveStoryPlanning: (bookId: string, planning: StoryPlanning) => Promise<boolean>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const loadEditorSpacingSettingsFromStorage = (): EditorSpacingSettings => {
    try {
        return normalizeEditorSpacingSettings(JSON.parse(localStorage.getItem('storyark_editor_spacing') || 'null'));
    } catch {
        return DEFAULT_EDITOR_SPACING_SETTINGS;
    }
};

const loadAutoHighlightSettingsFromStorage = (): AutoHighlightSettings => {
    try {
        return normalizeAutoHighlightSettings(JSON.parse(localStorage.getItem('storyark_auto_highlight') || 'null'));
    } catch {
        return { disabledRoles: [] };
    }
};

const loadAiContinueSettingsFromStorage = (): AiContinueSettings => {
    try {
        return normalizeAiContinueSettings(JSON.parse(localStorage.getItem('storyark_ai_continue') || 'null'));
    } catch {
        return DEFAULT_AI_CONTINUE_SETTINGS;
    }
};

interface AppProviderProps {
    children: React.ReactNode;
}

export function AppProvider({
    children,
}: AppProviderProps): React.ReactElement {
    const [user, setUser] = useState<User | null>(null);
    const [books, setBooks] = useState<Book[]>([]);
    const [chapterWrites] = useState(createChapterWriteQueue);
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => localStorage.getItem('storyark_dark_mode') === 'true');
    const [editorSpacingSettings, setEditorSpacingSettings] = useState<EditorSpacingSettings>(loadEditorSpacingSettingsFromStorage);
    const [aiContinueSettings, setAiContinueSettings] = useState<AiContinueSettings>(loadAiContinueSettingsFromStorage);
    const [autoHighlightSettings, setAutoHighlightSettings] = useState<AutoHighlightSettings>(loadAutoHighlightSettingsFromStorage);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', isDarkMode);
        document.body.style.backgroundColor = isDarkMode ? '#0f172a' : '#f8fafc';
        localStorage.setItem('storyark_dark_mode', String(isDarkMode));
    }, [isDarkMode]);

    useEffect(() => {
        localStorage.setItem('storyark_editor_spacing', JSON.stringify(editorSpacingSettings));
    }, [editorSpacingSettings]);

    useEffect(() => {
        localStorage.setItem('storyark_ai_continue', JSON.stringify(aiContinueSettings));
    }, [aiContinueSettings]);

    useEffect(() => {
        localStorage.setItem('storyark_auto_highlight', JSON.stringify(autoHighlightSettings));
    }, [autoHighlightSettings]);

    const loadUserSettingsPreference = async () => {
        try {
            const settings = await accountApi.getPreferences();
            if (typeof settings.darkMode === 'boolean') setIsDarkMode(settings.darkMode);
            setEditorSpacingSettings(settings.spacing);
            setAiContinueSettings(settings.aiContinue);
            setAutoHighlightSettings(settings.autoHighlight);
        } catch (error) {
            console.error("Failed to load user settings:", error);
        }
    };

    const persistDarkModePreference = async (enabled: boolean) => {
        if (!user) return;
        try {
            await accountApi.saveDarkMode(enabled);
        } catch (error) {
            console.error("Failed to save dark mode setting:", error);
        }
    };

    const persistEditorSpacingPreference = async (settings: EditorSpacingSettings) => {
        if (!user) return;
        try {
            await accountApi.saveSpacing(settings);
        } catch (error) {
            console.error("Failed to save editor spacing settings:", error);
        }
    };

    const persistAiContinuePreference = async (settings: AiContinueSettings) => {
        if (!user) return;
        try {
            await accountApi.saveAiContinue(settings);
        } catch (error) {
            console.error("Failed to save AI continue settings:", error);
        }
    };

    const persistAutoHighlightPreference = async (settings: AutoHighlightSettings) => {
        if (!user) return;
        try {
            await accountApi.saveAutoHighlight(settings);
        } catch (error) {
            console.error("Failed to save auto-highlight settings:", error);
        }
    };

    const toggleDarkMode = () => {
        setIsDarkMode(prev => {
            const next = !prev;
            void persistDarkModePreference(next);
            return next;
        });
    };

    const setDarkMode = (enabled: boolean) => {
        setIsDarkMode(enabled);
        void persistDarkModePreference(enabled);
    };

    const updateEditorSpacingSettings = (settings: Partial<EditorSpacingSettings>) => {
        setEditorSpacingSettings(prev => {
            const next = normalizeEditorSpacingSettings({ ...prev, ...settings });
            void persistEditorSpacingPreference(next);
            return next;
        });
    };

    const updateAiContinueSettings = (settings: Partial<AiContinueSettings>) => {
        setAiContinueSettings(prev => {
            const next = normalizeAiContinueSettings({ ...prev, ...settings });
            void persistAiContinuePreference(next);
            return next;
        });
    };

    const setAutoHighlightRoleEnabled = (role: CharacterRole, enabled: boolean) => {
        setAutoHighlightSettings(prev => {
            const disabledRoleSet = new Set(prev.disabledRoles);
            if (enabled) {
                disabledRoleSet.delete(role);
            } else {
                disabledRoleSet.add(role);
            }

            const next = normalizeAutoHighlightSettings({
                disabledRoles: Array.from(disabledRoleSet),
            });
            void persistAutoHighlightPreference(next);
            return next;
        });
    };

    const updateNickname = async (nickname: string): Promise<boolean> => {
        const normalizedNickname = nickname.trim();
        if (!user || !normalizedNickname) return false;

        const previousUser = user;
        const previousBooks = books;

        setUser(prev => prev ? { ...prev, nickname: normalizedNickname } : prev);
        setBooks(prev => prev.map(book => ({ ...book, author: normalizedNickname })));

        try {
            const response = await accountApi.updateNickname(normalizedNickname);
            const updatedNickname = response.nickname || normalizedNickname;
            setUser(prev => prev ? { ...prev, nickname: updatedNickname } : prev);
            setBooks(prev => prev.map(book => ({ ...book, author: updatedNickname })));
            return true;
        } catch (error) {
            console.error("Failed to update nickname:", error);
            setUser(previousUser);
            setBooks(previousBooks);
            return false;
        }
    };

    const login = async (username: string, pass: string) => {
        try {
            const appUser = await accountApi.login(username, pass);
            setUser(appUser);
            await loadUserSettingsPreference();
            await fetchBooks(appUser.id, appUser.nickname);
            return true;
        } catch (error) {
            console.error("Login failed:", error);
            return false;
        }
    };

    const register = async (username: string, pass: string, nickname: string) => {
        try {
            await accountApi.register(username, pass, nickname);
            return true;
        } catch (error) {
            console.error("Registration failed:", error);
            return false;
        }
    };

    const logout = () => {
        setUser(null);
        setBooks([]);
    };

    const fetchBooks = async (userId: string | number, currentNickname?: string) => {
        try {
            const frontendBooks = await booksApi.list(userId, currentNickname || user?.nickname || 'Unknown');
            setBooks(frontendBooks);
        } catch (error) {
            console.error("Failed to fetch books:", error);
        }
    };

    const createBook = async (title: string): Promise<string | null> => {
        if (!user) return null;
        const userId = user.id;
        try {
            const newBookId = await booksApi.create(userId, title,
                `bg-${['blue', 'emerald', 'rose', 'amber', 'purple'][Math.floor(Math.random() * 5)]}-600`);
            await fetchBooks(userId, user?.nickname);
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

        setBooks(prev => prev.map(book =>
            book.id === bookId
                ? { 
                    ...book, 
                    title: newTitle, 
                    status: newUiStatus, 
                    lastModified: Date.now(), 
                }
                : book,
            ),
        );

        try {
            await booksApi.update({ ...currentBook, title: newTitle, status: newUiStatus });
            return true;
        } catch (error) {
            console.error("Failed to update book:", error);
            return false;
        }
    };

    const deleteBook = async (bookId: string) => {
        setBooks(prev => prev.filter(b => b.id !== bookId));
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

        setBooks(prev => prev.map(b => {
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

        setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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
    ) : Promise<string | null> => {
        try {
            const newVolume = await chaptersApi.createVolume(bookId, title);

            setBooks(prev => prev.map(book => {
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

            setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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

            setBooks(prev => prev.map(b => {
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

        setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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
        setBooks(prev => prev.map(b => {
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

            setBooks(prev => prev.map(book => (
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

        setBooks(prev => prev.map(book => (
            book.id === bookId
                ? { ...book, storyPlanning: normalizedPlanning, lastModified: Date.now() }
                : book
        )));

        try {
            const savedPlanning = await workspaceApi.savePlanning(bookId, normalizedPlanning);
            setBooks(prev => prev.map(book => (
                book.id === bookId
                    ? { ...book, storyPlanning: savedPlanning, lastModified: Date.now() }
                    : book
            )));
            return true;
        } catch (error) {
            console.error("Failed to save story planning:", error);
            return false;
        }
    };

    return (
        <AppContext.Provider value={{
            user, books, isDarkMode, editorSpacingSettings, aiContinueSettings, autoHighlightSettings, toggleDarkMode, setDarkMode, updateEditorSpacingSettings, updateAiContinueSettings, setAutoHighlightRoleEnabled, updateNickname, login, logout, register, createBook, getBook,
            updateChapterContent, updateVolume, deleteVolume, deleteChapter,
            createVolume, createChapter, updateBook, deleteBook,
            reorderVolumes, reorderChapters,
            createCharacter, updateCharacter, deleteCharacter, reorderCharacters,
            toggleChapterLock, getRelations, fetchGraphData, saveGraphData,
            fetchStoryPlanning, saveStoryPlanning
        }}>
            {children}
        </AppContext.Provider>
    );
}

export const useApp = () => {
    const context = useContext(AppContext);
    if (!context) throw new Error('useApp must be used within AppProvider');
    return context;
};
