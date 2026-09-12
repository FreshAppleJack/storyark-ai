/* eslint-disable react-refresh/only-export-components -- provider + hook
   facade pairs stay together by design (same pattern as the legacy context). */
import React from 'react';
import {
    Book, Volume, Chapter, Character, Relation, ForeshadowingNote, User, StoryPlanning,
    EditorSpacingSettings, AiContinueSettings, AutoHighlightSettings, CharacterRole,
} from '../types';
import type { Node, Edge } from '@xyflow/react';
import type { GraphData } from '../data/dto';
import { SessionProvider, LocalSessionProvider, useSession } from './SessionContext';
import { PreferencesProvider, usePreferences } from './PreferencesContext';
import { BooksProvider, useBooks, type BooksContextType } from './BooksContext';
import { LocalBooksProvider } from './LocalBooksProvider';

/** Remote writes return true only after persistence; false keeps optimistic drafts.
 * Book/volume/chapter creates return an ID or null; character creation returns a boolean.
 * Remote reads return null on failure, never fake empty data.
 */
export interface AppContextType extends Pick<BooksContextType, 'storageMode' | 'booksLoading' | 'booksError' | 'refreshBooks' | 'saveLocalSnapshot'> {
    isDarkMode: boolean;
    user: User | null;
    books: Book[];
    editorSpacingSettings: EditorSpacingSettings;
    aiContinueSettings: AiContinueSettings;
    autoHighlightSettings: AutoHighlightSettings;

    updateNickname: (nickname: string) => Promise<boolean>;

    // Login reports authentication only; the initial settings/books load
    // independently (preferences effect + enabled books query).
    login: (username: string, pass: string) => Promise<boolean>;
    logout: () => void;
    register: (username: string, pass: string, nickname: string) => Promise<boolean>;

    toggleDarkMode: () => void;
    setDarkMode: (enabled: boolean) => void;

    updateEditorSpacingSettings: (settings: Partial<EditorSpacingSettings>) => void;
    updateAiContinueSettings: (settings: Partial<AiContinueSettings>) => void;
    setAutoHighlightRoleEnabled: (role: CharacterRole, enabled: boolean) => void;

    createBook: (title: string, author?: string) => Promise<string | null>;
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

/**
 * Composition root: session, preferences and books ownership live in their
 * own providers (SessionContext / PreferencesContext / BooksContext). The
 * books cache is the single source of truth for server data. useApp stays
 * as a facade so existing consumers keep working unchanged; new code
 * should prefer the focused hooks directly.
 */
export function AppProvider({ children, mode = 'legacy' }: { children: React.ReactNode; mode?: 'legacy' | 'local' }): React.ReactElement {
    if (mode === 'local') return (
        <LocalSessionProvider><PreferencesProvider><LocalBooksProvider>{children}</LocalBooksProvider></PreferencesProvider></LocalSessionProvider>
    );
    return (
        <SessionProvider>
            <PreferencesProvider>
                <BooksProvider>
                    {children}
                </BooksProvider>
            </PreferencesProvider>
        </SessionProvider>
    );
}

export const useApp = (): AppContextType => ({
    ...useSession(),
    ...usePreferences(),
    ...useBooks(),
});
