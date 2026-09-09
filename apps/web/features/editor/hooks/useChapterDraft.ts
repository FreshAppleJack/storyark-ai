import { useCallback, useState } from 'react';
import { Chapter, ForeshadowingNote } from '../../../types';

/**
 * Immutable capture of the draft at save time. `revision` is a local,
 * monotonically increasing number (NOT server-side versioning) used to
 * recognize stale save results.
 */
export interface ChapterDraftSnapshot {
    chapterId: string;
    revision: number;
    title: string;
    content: string;
    wordCount: number;
    foreshadowings: ForeshadowingNote[];
}

interface UseChapterDraftOptions {
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
export function useChapterDraft({ chapterId, chapter }: UseChapterDraftOptions) {
    const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
    const [loaded, setLoaded] = useState<{ id: string; chapter?: Chapter }>({ id: '' });

    // Adjust-during-render: react to chapter switches and same-chapter
    // updates without an effect.
    if (chapter && (loaded.id !== chapterId || loaded.chapter !== chapter)) {
        const isSwitch = loaded.id !== chapterId;
        setLoaded({ id: chapterId, chapter });
        setDraft(current => {
            if (isSwitch) return draftFromChapter(chapter, 0, false);
            if (current.isDirty) return current;
            return draftFromChapter(chapter, current.revision, current.isDirty);
        });
    }

    const setTitle = useCallback((title: string) => {
        setDraft(current => ({ ...current, title, revision: current.revision + 1, isDirty: true }));
    }, []);

    const applyEditorUpdate = useCallback((content: string, wordCount: number) => {
        setDraft(current => {
            if (content === current.content) {
                return wordCount === current.wordCount ? current : { ...current, wordCount };
            }
            return { ...current, content, wordCount, revision: current.revision + 1, isDirty: true };
        });
    }, []);

    const addForeshadowing = useCallback((note: ForeshadowingNote) => {
        setDraft(current => ({
            ...current,
            foreshadowings: [note, ...current.foreshadowings],
            revision: current.revision + 1,
            isDirty: true,
        }));
    }, []);

    // `updatedAt` is passed in by the caller so this hook stays pure.
    const updateForeshadowingNote = useCallback((id: string, noteText: string, updatedAt: number) => {
        setDraft(current => ({
            ...current,
            foreshadowings: current.foreshadowings.map(item => (
                item.id === id ? { ...item, note: noteText, updatedAt } : item
            )),
            revision: current.revision + 1,
            isDirty: true,
        }));
    }, []);

    const removeForeshadowing = useCallback((id: string) => {
        setDraft(current => ({
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
        chapterId,
        revision: draft.revision,
        title: draft.title,
        content: draft.content,
        wordCount: draft.wordCount,
        foreshadowings: draft.foreshadowings,
    }), [chapterId, draft]);

    return {
        ...draft,
        setTitle,
        applyEditorUpdate,
        addForeshadowing,
        updateForeshadowingNote,
        removeForeshadowing,
        setReadOnly,
        markSaved,
        getSnapshot,
    };
}
