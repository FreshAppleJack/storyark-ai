import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorSaveStatus } from '../components/EditorHeader';
import { ChapterDraftSnapshot } from './useChapterDraft';

interface UseChapterAutosaveOptions {
    chapterId: string;
    revision: number;
    getSnapshot: () => ChapterDraftSnapshot;
    markSaved: (revision: number) => void;
    saveChapter: (snapshot: ChapterDraftSnapshot) => Promise<boolean>;
    debounceMs?: number;
}

interface UseChapterAutosaveResult {
    saveStatus: EditorSaveStatus;
    /** Save immediately (skipping the debounce) through the same serial entry. */
    flush: () => Promise<boolean>;
    /** Re-queue the draft after a failure. */
    retry: () => void;
}

/**
 * Save scheduler for the active chapter draft: debounce, serial saves,
 * save status, flush and retry. It never decides which chapter to load and
 * never starts a parallel request — every save (debounced, flushed or
 * retried) goes through the same `saveNow` entry.
 *
 * Core invariant: `saved` is only shown when the LATEST draft revision of
 * the current chapter has been persisted. A stale success (the draft
 * advanced while the request was in flight) queues a serial follow-up
 * round instead of marking the chapter saved.
 */
export function useChapterAutosave({
    chapterId,
    revision,
    getSnapshot,
    markSaved,
    saveChapter,
    debounceMs = 1000,
}: UseChapterAutosaveOptions): UseChapterAutosaveResult {
    const [saveStatus, setSaveStatus] = useState<EditorSaveStatus>('saved');

    // Latest-value refs keep saveNow (and therefore the debounce timer)
    // stable across renders even though the page passes fresh closures.
    const fnsRef = useRef({ getSnapshot, markSaved, saveChapter });
    const revisionRef = useRef(revision);
    useEffect(() => {
        fnsRef.current = { getSnapshot, markSaved, saveChapter };
        revisionRef.current = revision;
    });

    const inFlightRef = useRef(false);
    const queuedRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Chapter switch resets to a clean status; an edit (revision bump) while
    // saved or failed re-queues the draft. The switch branch must come first
    // so a chapter load (revision reset) is not mistaken for an edit.
    const [prevChapterId, setPrevChapterId] = useState(chapterId);
    const [prevRevision, setPrevRevision] = useState(revision);
    if (prevChapterId !== chapterId) {
        setPrevChapterId(chapterId);
        setPrevRevision(revision);
        setSaveStatus('saved');
    } else if (prevRevision !== revision) {
        setPrevRevision(revision);
        if (saveStatus === 'saved' || saveStatus === 'error') {
            setSaveStatus('unsaved');
        }
    }

    // Drop a queued follow-up belonging to the previous chapter.
    useEffect(() => {
        queuedRef.current = false;
    }, [chapterId]);

    const saveNow = useCallback(async (): Promise<boolean> => {
        if (inFlightRef.current) {
            // One queued follow-up is enough: it snapshots the latest draft.
            queuedRef.current = true;
            return false;
        }
        inFlightRef.current = true;
        setSaveStatus('saving');
        const snapshot = fnsRef.current.getSnapshot();
        const ok = await fnsRef.current.saveChapter(snapshot);
        inFlightRef.current = false;

        if (!ok) {
            setSaveStatus('error');
            return false;
        }
        fnsRef.current.markSaved(snapshot.revision);
        if (queuedRef.current || revisionRef.current !== snapshot.revision) {
            // The draft advanced while saving: serial follow-up round.
            queuedRef.current = false;
            setSaveStatus('unsaved');
        } else {
            setSaveStatus('saved');
        }
        return true;
    }, []);

    // Debounce: every edit (revision bump) restarts the timer; switching
    // chapters or leaving the unsaved state cancels the pending save.
    useEffect(() => {
        if (saveStatus !== 'unsaved') return;
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            void saveNow();
        }, debounceMs);
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [saveStatus, revision, chapterId, debounceMs, saveNow]);

    const flush = useCallback(async (): Promise<boolean> => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        return saveNow();
    }, [saveNow]);

    const retry = useCallback(() => {
        setSaveStatus(current => (current === 'error' ? 'unsaved' : current));
    }, []);

    return { saveStatus, flush, retry };
}
