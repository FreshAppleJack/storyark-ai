import React, { createContext, useContext, useEffect, useState } from 'react';
import {
    Book,
    User,
    Volume,
    Chapter,
    Character,
    Relation,
    ForeshadowingNote,
    EditorSpacingSettings,
    EDITOR_SPACING_LIMITS,
    AiContinueSettings,
    AI_CONTINUE_LIMITS,
    AutoHighlightSettings,
    CHARACTER_ROLE_OPTIONS,
    CharacterRole,
    StoryPlanning,
    ChapterSummary,
    PlotSetting,
    BookStatus
} from '../types';
import apiClient from '../services/api';
import { calculateMixedWordCount } from '../utils/textUtils';
import type { Node, Edge } from '@xyflow/react';

// Add graph data interface definition
interface GraphData {
    nodes: any[]; // Correspond to the GraphNode in backend
    edges: any[]; // Correspond to the Relation in backend (use nodeKey)
}

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

    updateChapterContent: (bookId: string, volumeId: string, chapterId: string, title: string, content: string, wordCount?: number, foreshadowings?: ForeshadowingNote[]) => Promise<void>;
    toggleChapterLock: (bookId: string, volumeId: string, chapterId: string) => Promise<void>;

    createVolume: (bookId: string, title: string) => Promise<string | null>;
    updateVolume: (bookId: string, volumeId: string, title: string) => Promise<void>;
    deleteVolume: (bookId: string, volumeId: string) => Promise<void>;
    createChapter: (bookId: string, volumeId: string, title: string) => Promise<string | null>;
    deleteChapter: (bookId: string, volumeId: string, chapterId: string) => Promise<void>;

    reorderVolumes: (bookId: string, newVolumes: Volume[]) => Promise<void>;
    reorderChapters: (bookId: string, volumeId: string, newChapters: Chapter[]) => Promise<void>;
    reorderCharacters: (bookId: string, newCharacters: Character[]) => Promise<void>;

    updateBook: (bookId: string, data: { title?: string, status?: 'serializing' | 'completed' }) => Promise<void>;
    deleteBook: (bookId: string) => Promise<void>;

    createCharacter: (bookId: string, data: Partial<Character>) => Promise<void>;
    updateCharacter: (bookId: string, charId: string, data: Partial<Character>) => Promise<void>;
    deleteCharacter: (bookId: string, charId: string) => Promise<void>;

    getRelations: (bookId: string) => Promise<Relation[]>;

    // Add graph data methods methods
    fetchGraphData: (bookId: string) => Promise<GraphData | null>;
    saveGraphData: (bookId: string, nodes: Node[], edges: Edge[]) => Promise<boolean>;
    fetchStoryPlanning: (bookId: string) => Promise<StoryPlanning>;
    saveStoryPlanning: (bookId: string, planning: StoryPlanning) => Promise<boolean>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STATUS_MAP_TO_UI = {
    1: 'serializing',
    2: 'completed'
} as const;

const STATUS_MAP_TO_API: Record<BookStatus, 1 | 2> = {
    'serializing': 1,
    'completed': 2
} as const;

const parseJsonSafe = (jsonStr: any, fallback: any) => {
    if (typeof jsonStr !== 'string') return jsonStr || fallback;
    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        return fallback;
    }
};

const parseTags = (tags: any): string[] => {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') {
        try {
            const parsed = JSON.parse(tags);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            return tags.split(/[,，\s]+/).filter(Boolean);
        }
    }
    return [];
};

const normalizeCharacterName = (name: any, fallback = 'Unknown') => {
    return typeof name === 'string' && name.trim() ? name.trim() : fallback;
};

const normalizeCharacterAliases = (aliases: any, primaryName?: string): string[] => {
    const rawAliases = Array.isArray(aliases) ? aliases : parseJsonSafe(aliases, []);
    if (!Array.isArray(rawAliases)) return [];

    const primary = typeof primaryName === 'string' ? primaryName.trim() : '';
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const alias of rawAliases) {
        if (typeof alias !== 'string') continue;
        const trimmed = alias.trim();
        if (!trimmed || trimmed === primary || seen.has(trimmed)) continue;
        seen.add(trimmed);
        normalized.push(trimmed);
        if (normalized.length >= 3) break;
    }

    return normalized;
};

const DEFAULT_EDITOR_SPACING_SETTINGS: EditorSpacingSettings = {
    editorMarginPx: EDITOR_SPACING_LIMITS.marginPx.default,
    editorLineHeight: EDITOR_SPACING_LIMITS.lineHeight.default,
};

const DEFAULT_AI_CONTINUE_SETTINGS: AiContinueSettings = {
    contextChars: AI_CONTINUE_LIMITS.contextChars.default,
    outputChars: AI_CONTINUE_LIMITS.outputChars.default,
};

const DEFAULT_STORY_PLANNING: StoryPlanning = {
    storySummary: '',
    storyBackground: '',
    chapterSummaries: [],
    plotSettings: [],
};

const VALID_CHARACTER_ROLES = new Set<CharacterRole>(CHARACTER_ROLE_OPTIONS.map(role => role.value));

const normalizeAutoHighlightSettings = (settings?: Partial<AutoHighlightSettings> | null): AutoHighlightSettings => {
    const disabledRoles = Array.isArray(settings?.disabledRoles) ? settings.disabledRoles : [];
    const uniqueDisabledRoles = Array.from(new Set(disabledRoles.filter((role): role is CharacterRole => VALID_CHARACTER_ROLES.has(role as CharacterRole))));

    return {
        disabledRoles: uniqueDisabledRoles,
    };
};

const clampNumber = (value: number, min: number, max: number) => {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
};

const normalizeEditorSpacingSettings = (settings?: Partial<EditorSpacingSettings> | null): EditorSpacingSettings => {
    const rawMargin = Number(settings?.editorMarginPx ?? DEFAULT_EDITOR_SPACING_SETTINGS.editorMarginPx);
    const rawLineHeight = Number(settings?.editorLineHeight ?? DEFAULT_EDITOR_SPACING_SETTINGS.editorLineHeight);

    return {
        editorMarginPx: clampNumber(rawMargin, EDITOR_SPACING_LIMITS.marginPx.min, EDITOR_SPACING_LIMITS.marginPx.max),
        editorLineHeight: Number(clampNumber(rawLineHeight, EDITOR_SPACING_LIMITS.lineHeight.min, EDITOR_SPACING_LIMITS.lineHeight.max).toFixed(2)),
    };
};

const normalizeAiContinueSettings = (settings?: Partial<AiContinueSettings> | null): AiContinueSettings => {
    const rawContextChars = Number(settings?.contextChars ?? DEFAULT_AI_CONTINUE_SETTINGS.contextChars);
    const rawOutputChars = Number(settings?.outputChars ?? DEFAULT_AI_CONTINUE_SETTINGS.outputChars);

    return {
        contextChars: Math.round(clampNumber(rawContextChars, AI_CONTINUE_LIMITS.contextChars.min, AI_CONTINUE_LIMITS.contextChars.max)),
        outputChars: Math.round(clampNumber(rawOutputChars, AI_CONTINUE_LIMITS.outputChars.min, AI_CONTINUE_LIMITS.outputChars.max)),
    };
};

const normalizeChapterSummaries = (value: any): ChapterSummary[] => {
    const summaries = Array.isArray(value) ? value : parseJsonSafe(value, []);
    if (!Array.isArray(summaries)) return [];

    return summaries
        .filter((item: any) => item?.chapterId)
        .map((item: any) => ({
            chapterId: String(item.chapterId),
            summary: item.summary || '',
            updatedAt: Number(item.updatedAt || Date.now()),
        }));
};

const normalizePlotSettings = (value: any): PlotSetting[] => {
    const settings = Array.isArray(value) ? value : parseJsonSafe(value, []);
    if (!Array.isArray(settings)) return [];

    return settings
        .filter((item: any) => item?.id)
        .map((item: any) => ({
            id: String(item.id),
            title: item.title || 'Untitled Plot',
            details: item.details || '',
            chapterIds: Array.isArray(item.chapterIds) ? item.chapterIds.map((id: any) => String(id)) : [],
            createdAt: Number(item.createdAt || Date.now()),
            updatedAt: Number(item.updatedAt || Date.now()),
        }));
};

const normalizeStoryPlanning = (data?: any): StoryPlanning => ({
    storySummary: data?.storySummary || '',
    storyBackground: data?.storyBackground || '',
    chapterSummaries: normalizeChapterSummaries(data?.chapterSummaries),
    plotSettings: normalizePlotSettings(data?.plotSettings),
    updatedAt: data?.updatedAt ? new Date(data.updatedAt).getTime() : undefined,
});

const loadEditorSpacingSettingsFromStorage = (): EditorSpacingSettings => {
    try {
        return normalizeEditorSpacingSettings(JSON.parse(localStorage.getItem('storyark_editor_spacing') || 'null'));
    } catch (e) {
        return DEFAULT_EDITOR_SPACING_SETTINGS;
    }
};

const loadAutoHighlightSettingsFromStorage = (): AutoHighlightSettings => {
    try {
        return normalizeAutoHighlightSettings(JSON.parse(localStorage.getItem('storyark_auto_highlight') || 'null'));
    } catch (e) {
        return { disabledRoles: [] };
    }
};

const loadAiContinueSettingsFromStorage = (): AiContinueSettings => {
    try {
        return normalizeAiContinueSettings(JSON.parse(localStorage.getItem('storyark_ai_continue') || 'null'));
    } catch (e) {
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
            const settings = await apiClient.get('/user-settings/me') as any;
            if (typeof settings.darkMode === 'boolean') {
                setIsDarkMode(settings.darkMode);
            }
            setEditorSpacingSettings(normalizeEditorSpacingSettings({
                editorMarginPx: settings.editorMarginPx,
                editorLineHeight: settings.editorLineHeight,
            }));
            setAiContinueSettings(normalizeAiContinueSettings({
                contextChars: settings.aiContinueContextChars,
                outputChars: settings.aiContinueOutputChars,
            }));
            setAutoHighlightSettings(normalizeAutoHighlightSettings({
                disabledRoles: parseJsonSafe(settings.autoHighlightTags, []),
            }));
        } catch (error) {
            console.error("Failed to load user settings:", error);
        }
    };

    const persistDarkModePreference = async (enabled: boolean) => {
        if (!user) return;
        try {
            await apiClient.put('/user-settings/me/dark-mode', { darkMode: enabled });
        } catch (error) {
            console.error("Failed to save dark mode setting:", error);
        }
    };

    const persistEditorSpacingPreference = async (settings: EditorSpacingSettings) => {
        if (!user) return;
        try {
            await apiClient.put('/user-settings/me/editor-spacing', settings);
        } catch (error) {
            console.error("Failed to save editor spacing settings:", error);
        }
    };

    const persistAiContinuePreference = async (settings: AiContinueSettings) => {
        if (!user) return;
        try {
            await apiClient.put('/user-settings/me/ai-continue', {
                aiContinueContextChars: settings.contextChars,
                aiContinueOutputChars: settings.outputChars,
            });
        } catch (error) {
            console.error("Failed to save AI continue settings:", error);
        }
    };

    const persistAutoHighlightPreference = async (settings: AutoHighlightSettings) => {
        if (!user) return;
        try {
            await apiClient.put('/user-settings/me/auto-highlight', settings);
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
            const response = await apiClient.put('/auth/me/nickname', { nickname: normalizedNickname }) as any;
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
            const response = await apiClient.post('/auth/login', { username, password: pass });
            const userData = response as any;
            const appUser: User = {
                id: userData.id,
                username: userData.username,
                nickname: userData.nickname,
                isAuthenticated: true
            };
            setUser(appUser);
            await loadUserSettingsPreference();
            await fetchBooks(userData.id, userData.nickname);
            return true;
        } catch (error) {
            console.error("Login failed:", error);
            return false;
        }
    };

    const register = async (username: string, pass: string, nickname: string) => {
        try {
            await apiClient.post('/auth/register', { username, password: pass, nickname });
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

    const fetchBooks = async (userId: number, currentNickname?: string) => {
        try {
            const response = await apiClient.get(`/books?userId=${userId}`);
            const bookList = response as unknown as any[];
            const authorName = currentNickname || user?.nickname || 'Unknown';

            const frontendBooks: Book[] = bookList.map((b: any) => {
                const timeStr = b.updatedAt || b.createdAt;
                return {
                    id: b.id.toString(),
                    title: b.title,
                    author: authorName,
                    coverColor: b.coverColor || 'bg-blue-600',
                    lastModified: timeStr ? new Date(timeStr).getTime() : Date.now(),
                    status: STATUS_MAP_TO_UI[b.status as 1 | 2] || 'serializing',
                    volumes: b.volumes ? b.volumes.map((v: any) => ({
                        id: v.id.toString(),
                        title: v.title,
                        chapters: v.chapters ? v.chapters.map((c: any) => ({
                            id: c.id.toString(),
                            title: c.title,
                            content: c.content || '',
                            wordCount: c.wordCount || 0,
                            status: c.status || 'draft',
                            isEditable: c.isEditable !== false,
                            foreshadowings: parseJsonSafe(c.foreshadowings, [])
                        })) : []
                    })) : [],
                    characters: Array.isArray(b.characters) ? b.characters.map((c: any) => ({
                        id: c.id.toString(),
                        bookId: b.id.toString(),
                        name: normalizeCharacterName(c.name),
                        aliases: normalizeCharacterAliases(c.aliases, c.name),
                        role: c.role || 'supporting',
                        description: c.description || '',
                        avatar: c.avatar,
                        color: c.color || '#3b82f6',
                        tags: parseTags(c.tags),
                        handleConfig: parseJsonSafe(c.handleConfig, null),
                        // Compatibility with old fields in backend
                        positionX: c.positionX,
                        positionY: c.positionY
                    })) : []
                };
            });

            setBooks(frontendBooks);
        } catch (error) {
            console.error("Failed to fetch books:", error);
        }
    };

    // ... (createBook, updateBook, deleteBook, getBook, updateChapterContent, etc. unchanged)
    const createBook = async (title: string): Promise<string | null> => {
        const userId = 1;
        try {
            const response = await apiClient.post('/books', {
                userId: userId,
                title: title,
                coverColor: `bg-${['blue', 'emerald', 'rose', 'amber', 'purple'][Math.floor(Math.random() * 5)]}-600`,
                status: 1
            });
            const newBook = response as any;
            await fetchBooks(userId, user?.nickname);
            return newBook.id.toString();
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
        if (!currentBook) return;

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

        const payload = {
            id: Number(bookId),
            title: newTitle,
            status: STATUS_MAP_TO_API[newUiStatus],
            coverColor: currentBook.coverColor,
            userId: user?.username === currentBook.author ? 0 : 0
        };
        try {
            await apiClient.put(`/books/${bookId}`, payload);
        } catch (error) {
            console.error("Failed to update book:", error);
        }
    };

    const deleteBook = async (bookId: string) => {
        setBooks(prev => prev.filter(b => b.id !== bookId));
        try {
            await apiClient.delete(`/books/${bookId}`);
        } catch (error) {
            console.error("Failed to delete book:", error);
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
            await apiClient.put(`/story/chapters/${chapterId}?bookId=${bookId}`, {
                title: title,
                content: content,
                wordCount: finalWordCount,
                status: 'draft',
                volumeId: Number(volumeId),
                isEditable: currentEditable,
                foreshadowings: JSON.stringify(currentForeshadowings)
            });
        } catch (error) {
            console.error("Failed to save chapter:", error);
        }
    };

    const toggleChapterLock = async (bookId: string, volumeId: string, chapterId: string) => {
        const book = books.find(b => b.id === bookId);
        const volume = book?.volumes.find(v => v.id === volumeId);
        const chapter = volume?.chapters.find(c => c.id === chapterId);

        if (!chapter) return;

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
            await apiClient.put(`/story/chapters/${chapterId}?bookId=${bookId}`, {
                title: chapter.title,
                content: chapter.content,
                wordCount: chapter.wordCount,
                status: chapter.status,
                volumeId: Number(volumeId),
                isEditable: newStatus,
                foreshadowings: JSON.stringify(chapter.foreshadowings || [])
            });
        } catch (error) {
            console.error("Failed to toggle chapter lock:", error);
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
            await apiClient.put(`/story/volumes/${volumeId}`, {
                id: Number(volumeId),
                title: title,
                bookId: Number(bookId),
                orderIndex: 0
            });
        } catch (error) {
            console.error("Failed to update volume:", error);
        }
    };

    const deleteVolume = async (bookId: string, volumeId: string) => {
        setBooks(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                volumes: b.volumes.filter(v => v.id !== volumeId)
            };
        }));

        try {
            await apiClient.delete(`/story/volumes/${volumeId}?bookId=${bookId}`);
        } catch (error) {
            console.error("Failed to delete volume:", error);
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
            await apiClient.delete(`/story/chapters/${chapterId}?bookId=${bookId}`);
        } catch (error) {
            console.error("Failed to delete chapter:", error);
        }
    };

    const createVolume = async (
        bookId: string, 
        title: string,
    ) : Promise<string | null> => {
        try {
            const response = await apiClient.post('/story/volumes', {
                bookId: Number(bookId),
                title: title,
                orderIndex: 0
            });

            const newVolumeData = response as any;

            const newVolume: Volume = {
                id: newVolumeData.id.toString(),
                title: newVolumeData.title,
                chapters: [],
            };

            setBooks(prev => prev.map(book => {
                if (book.id !== bookId) return book;
                return {
                    ...book,
                    lastModified: Date.now(),
                    volumes: [...book.volumes, newVolume],
                };
            }));

            return newVolumeData.id.toString();
        } catch (error) {
            console.error("Failed to create volume:", error);
            return null;
        }
    };

    const createChapter = async (bookId: string, volumeId: string, title: string): Promise<string | null> => {
        try {
            const response = await apiClient.post(`/story/chapters?bookId=${bookId}`, {
                volumeId: Number(volumeId),
                title: title,
                content: '',
                status: 'draft',
                isEditable: true,
                foreshadowings: '[]'
            });
            const newChapterData = response as any;

            const newChapter: Chapter = {
                id: newChapterData.id.toString(),
                title: newChapterData.title,
                content: '',
                wordCount: 0,
                status: 'draft',
                isEditable: true,
                foreshadowings: []
            };

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

            return newChapterData.id.toString();
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

        const volumeIds = newVolumes.map(v => Number(v.id));
        try {
            await apiClient.post(`/story/volumes/reorder?bookId=${bookId}`, volumeIds);
        } catch (error) {
            console.error("Failed to reorder volumes:", error);
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

        const chapterIds = newChapters.map(c => Number(c.id));
        try {
            await apiClient.post(`/story/chapters/reorder?bookId=${bookId}`, chapterIds);
        } catch (error) {
            console.error("Failed to reorder chapters:", error);
        }
    };

    const createCharacter = async (bookId: string, data: Partial<Character>) => {
        try {
            const payload = {
                name: normalizeCharacterName(data.name, 'New Character'),
                aliases: normalizeCharacterAliases(data.aliases, data.name),
                role: data.role || 'supporting',
                description: data.description || '',
                color: data.color || '#3b82f6',
                tags: data.tags || [],
                avatar: data.avatar
            };

            const response = await apiClient.post(`/books/${bookId}/characters`, payload);
            const createdData = response as any;

            const newChar: Character = {
                id: createdData.id.toString(),
                bookId: bookId,
                name: normalizeCharacterName(createdData.name),
                aliases: normalizeCharacterAliases(createdData.aliases, createdData.name),
                role: createdData.role,
                description: createdData.description,
                color: createdData.color,
                tags: parseTags(createdData.tags),
                avatar: createdData.avatar
            };

            setBooks(prev => prev.map(b => {
                if (b.id !== bookId) return b;
                return {
                    ...b,
                    characters: [...(b.characters || []), newChar]
                };
            }));
        } catch (error) {
            console.error("Failed to create character:", error);
        }
    };

    const updateCharacter = async (bookId: string, charId: string, data: Partial<Character>) => {
        const sanitizedData = { ...data };
        if (typeof sanitizedData.name === 'string') {
            const trimmedName = sanitizedData.name.trim();
            if (!trimmedName) {
                console.error("Failed to update character: character name cannot be empty");
                return;
            }
            sanitizedData.name = trimmedName;
        }
        if (Array.isArray(sanitizedData.aliases)) {
            sanitizedData.aliases = normalizeCharacterAliases(sanitizedData.aliases, sanitizedData.name);
        }

        setBooks(prev => prev.map(b => {
            if (b.id !== bookId) return b;
            return {
                ...b,
                characters: (b.characters || []).map(c => c.id === charId ? { ...c, ...sanitizedData } : c)
            };
        }));

        try {
            await apiClient.put(`/books/${bookId}/characters/${charId}`, sanitizedData);
        } catch (error) {
            console.error("Failed to update character:", error);
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
            await apiClient.delete(`/books/${bookId}/characters/${charId}`);
        } catch (error) {
            console.error("Failed to delete character:", error);
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

        const charIds = newCharacters.map(c => Number(c.id));
        try {
            await apiClient.post(`/books/${bookId}/characters/reorder`, charIds);
        } catch (error) {
            console.error("Failed to reorder characters:", error);
        }
    };

    // this method for compatibility, but mainly use fetchGraphData to get relations
    const getRelations = async (bookId: string): Promise<Relation[]> => {
        try {
            const response = await apiClient.get(`/books/${bookId}/relations`);
            return (response as unknown as any[]).map(r => ({
                id: r.id.toString(),
                sourceCharId: r.sourceNodeKey || r.sourceCharId.toString(), // Compatibility with old fields in backend
                targetCharId: r.targetNodeKey || r.targetCharId.toString(),
                label: r.label
            }));
        } catch (error) {
            console.error("Failed to fetch relations:", error);
            return [];
        }
    };

    // --- Get complete graph data (Nodes + Edges) ---
    const fetchGraphData = async (bookId: string): Promise<GraphData | null> => {
        try {
            const response = await apiClient.get(`/books/${bookId}/graph`);
            return response as unknown as GraphData;
        } catch (error) {
            console.error("Failed to fetch graph data:", error);
            return null;
        }
    };

    // --- Save complete graph data (Support multiple instance nodes) ---
    const saveGraphData = async (bookId: string, nodes: Node[], edges: Edge[]): Promise<boolean> => {
        try {
            // Construct the payload to match the GraphController's payload
            const payload = {
                // Nodes: Save each React Flow node instance data
                nodes: nodes.map(node => ({
                    id: node.id, // React Flow ID (nodeKey)
                    characterId: Number(node.data.id), // Original Character ID
                    x: node.position.x,
                    y: node.position.y,
                    handleConfig: node.data.handleConfig
                })),
                // Edges: Connect React Flow ID (nodeKey)
                // Save sourceHandle and targetHandle
                edges: edges.map(edge => ({
                    source: edge.source,
                    target: edge.target,
                    sourceHandle: edge.sourceHandle, // Save sourceHandle
                    targetHandle: edge.targetHandle, // Save targetHandle
                    label: edge.label || ''
                }))
            };

            await apiClient.post(`/books/${bookId}/graph`, payload);
            return true;

        } catch (error) {
            console.error("Failed to save graph data:", error);
            return false;
        }
    };

    const fetchStoryPlanning = async (bookId: string): Promise<StoryPlanning> => {
        try {
            const response = await apiClient.get(`/books/${bookId}/planning`);
            const planning = normalizeStoryPlanning(response);

            setBooks(prev => prev.map(book => (
                book.id === bookId ? { ...book, storyPlanning: planning } : book
            )));

            return planning;
        } catch (error) {
            console.error("Failed to fetch story planning:", error);
            return DEFAULT_STORY_PLANNING;
        }
    };

    const saveStoryPlanning = async (bookId: string, planning: StoryPlanning): Promise<boolean> => {
        const normalizedPlanning = normalizeStoryPlanning(planning);

        setBooks(prev => prev.map(book => (
            book.id === bookId
                ? { ...book, storyPlanning: normalizedPlanning, lastModified: Date.now() }
                : book
        )));

        try {
            const response = await apiClient.put(`/books/${bookId}/planning`, {
                storySummary: normalizedPlanning.storySummary,
                storyBackground: normalizedPlanning.storyBackground,
                chapterSummaries: JSON.stringify(normalizedPlanning.chapterSummaries),
                plotSettings: JSON.stringify(normalizedPlanning.plotSettings),
            });
            const savedPlanning = normalizeStoryPlanning(response);
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
