import { useCallback, useRef, useState } from 'react';
import { Chapter, ForeshadowingNote } from '../../../types';

/**
 * Immutable capture of the draft at save time. `revision` is a local,
 * monotonically increasing number (NOT server-side versioning) used to
 * recognize stale save results.
 */
export interface ChapterDraftSnapshot {
    bookId: string;
    volumeId: string;
    chapterId: string;
    revision: number;
    title: string;
    content: string;
    wordCount: number;
    foreshadowings: ForeshadowingNote[];
}

interface UseChapterDraftOptions {
    bookId?: string;
    volumeId?: string;
    chapterId: string;
    chapter?: Chapter;
}

interface DraftState {
    title: string;
    content: string;
    wordCount: number;
    foreshadowings: ForeshadowingNote[];
    isReadOnly: boolean;
    revision: number;
    isDirty: boolean;
}

const EMPTY_DRAFT: DraftState = {
    title: '',
    content: '',
    wordCount: 0,
    foreshadowings: [],
    isReadOnly: false,
    revision: 0,
    isDirty: false,
};

function draftFromChapter(chapter: Chapter, revision: number, isDirty: boolean): DraftState {
    return {
        title: chapter.title || '',
        content: chapter.content || '',
        wordCount: chapter.wordCount || 0,
        foreshadowings: chapter.foreshadowings || [],
        isReadOnly: chapter.isEditable === false,
        revision,
        isDirty,
    };
}

/**
 * Owns the draft of the currently selected chapter: values, edit actions,
 * a local revision counter and dirty tracking. No requests, no debounce,
 * no timers — those belong to the save scheduler.
 *
 * Loading semantics: a chapter SWITCH always loads the stored data; a
 * same-chapter update (e.g. the optimistic echo of a save) only syncs a
 * clean draft — unsaved user input is never overwritten.
 */
export function useChapterDraft({ bookId = '', volumeId = '', chapterId, chapter }: UseChapterDraftOptions) {
    const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
    const editsPaused = useRef(false);
    const pauseEdits = useCallback((paused: boolean) => { editsPaused.current = paused; }, []);
    const identity = JSON.stringify([bookId, volumeId, chapter ? chapterId : '']);
    const [loaded, setLoaded] = useState<{ id: string; chapter?: Chapter; session: number }>({ id: '', session: 0 });

    // Adjust-during-render: react to chapter switches and same-chapter
    // updates without an effect.
    if (loaded.id !== identity || loaded.chapter !== chapter) {
        const isSwitch = loaded.id !== identity;
        setLoaded({ id: identity, chapter, session: loaded.session + (isSwitch ? 1 : 0) });
        setDraft(current => {
            if (!chapter) return EMPTY_DRAFT;
            if (isSwitch) return draftFromChapter(chapter, 0, false);
            if (current.isDirty) return { ...current, isReadOnly: chapter.isEditable === false };
            return draftFromChapter(chapter, current.revision, current.isDirty);
        });
    }

    const setTitle = useCallback((title: string) => {
        if (editsPaused.current) return;
        setDraft(current => current.isReadOnly ? current : ({ ...current, title, revision: current.revision + 1, isDirty: true }));
    }, []);

    const applyEditorUpdate = useCallback((content: string, wordCount: number) => {
        if (editsPaused.current) return;
        setDraft(current => {
            if (current.isReadOnly) return current;
            if (content === current.content) {
                return wordCount === current.wordCount ? current : { ...current, wordCount };
            }
            return { ...current, content, wordCount, revision: current.revision + 1, isDirty: true };
        });
    }, []);

    // Adopt the editor-normalized form of freshly loaded content as the clean
    // baseline (no revision bump, no dirty flag) — it is still the stored
    // chapter, merely reserialized by the schema.
    const adoptLoaded = useCallback((content: string, wordCount: number) => {
        setDraft(current => (current.isDirty ? current : { ...current, content, wordCount }));
    }, []);

    const addForeshadowing = useCallback((note: ForeshadowingNote) => {
        if (editsPaused.current) return;
        setDraft(current => current.isReadOnly ? current : ({
            ...current,
            foreshadowings: [note, ...current.foreshadowings],
            revision: current.revision + 1,
            isDirty: true,
        }));
    }, []);

    // `updatedAt` is passed in by the caller so this hook stays pure.
    const updateForeshadowingNote = useCallback((id: string, noteText: string, updatedAt: number) => {
        if (editsPaused.current) return;
        setDraft(current => current.isReadOnly ? current : ({
            ...current,
            foreshadowings: current.foreshadowings.map(item => (
                item.id === id ? { ...item, note: noteText, updatedAt } : item
            )),
            revision: current.revision + 1,
            isDirty: true,
        }));
    }, []);

    const removeForeshadowing = useCallback((id: string) => {
        if (editsPaused.current) return;
        setDraft(current => current.isReadOnly ? current : ({
            ...current,
            foreshadowings: current.foreshadowings.filter(item => item.id !== id),
            revision: current.revision + 1,
            isDirty: true,
        }));
    }, []);

    const setReadOnly = useCallback((isReadOnly: boolean) => {
        setDraft(current => ({ ...current, isReadOnly }));
    }, []);

    // Clears the dirty flag only when the saved revision is still the latest;
    // a newer edit keeps the draft dirty (stale save results are ignored).
    const markSaved = useCallback((savedRevision: number) => {
        setDraft(current => (current.revision === savedRevision ? { ...current, isDirty: false } : current));
    }, []);

    const getSnapshot = useCallback((): ChapterDraftSnapshot => ({
        bookId,
        volumeId,
        chapterId: chapter ? chapterId : '',
        revision: draft.revision,
        title: draft.title,
        content: draft.content,
        wordCount: draft.wordCount,
        foreshadowings: draft.foreshadowings.map(note => ({ ...note })),
    }), [bookId, volumeId, chapterId, chapter, draft]);

    return {
        ...draft,
        sessionKey: `${identity}:${loaded.session}`,
        setTitle,
        applyEditorUpdate,
        adoptLoaded,
        addForeshadowing,
        updateForeshadowingNote,
        removeForeshadowing,
        setReadOnly,
        pauseEdits,
        markSaved,
        getSnapshot,
    };
}
