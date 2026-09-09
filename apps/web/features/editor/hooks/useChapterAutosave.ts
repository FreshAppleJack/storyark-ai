import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorSaveStatus } from '../components/EditorHeader';
import { ChapterDraftSnapshot } from './useChapterDraft';

interface UseChapterAutosaveOptions {
    chapterId: string;
    sessionKey?: string;
    revision: number;
    getSnapshot: () => ChapterDraftSnapshot;
    markSaved: (revision: number) => void;
    saveChapter: (snapshot: ChapterDraftSnapshot) => Promise<boolean>;
    debounceMs?: number;
}

interface UseChapterAutosaveResult {
    saveStatus: EditorSaveStatus;
    /**
     * Save immediately through the same serial entry, draining follow-up
     * rounds until the draft stops advancing. Resolves true only when the
     * latest draft is fully persisted; false on failure.
     */
    flush: () => Promise<boolean>;
    /** Re-queue the draft after a failure. */
    retry: () => void;
}

interface SaveRoundResult {
    ok: boolean;
    draftAdvanced: boolean;
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
    sessionKey = chapterId,
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
    useLayoutEffect(() => {
        fnsRef.current = { getSnapshot, markSaved, saveChapter };
        revisionRef.current = revision;
    });

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Chapter switch resets to a clean status; an edit while saved or failed
    // re-queues the draft. The switch branch must come first, and only a
    // revision INCREASE counts as an edit: the revision is monotonic per
    // chapter, so a decrease always means a chapter load/reset (the draft
    // hook's adjustment can lag one render pass behind chapterId).
    const [prevChapterId, setPrevChapterId] = useState(sessionKey);
    const [prevRevision, setPrevRevision] = useState(revision);
    if (prevChapterId !== sessionKey) {
        setPrevChapterId(sessionKey);
        setPrevRevision(revision);
        setSaveStatus('saved');
    } else if (prevRevision !== revision) {
        const wasEdit = revision > prevRevision;
        setPrevRevision(revision);
        if (wasEdit && (saveStatus === 'saved' || saveStatus === 'error')) {
            setSaveStatus('unsaved');
        }
    }

    const inFlightRoundRef = useRef<Promise<SaveRoundResult> | null>(null);
    const epochRef = useRef(0);
    useLayoutEffect(() => {
        epochRef.current += 1;
        inFlightRoundRef.current = null;
        return () => {
            epochRef.current += 1;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = null;
        };
    }, [sessionKey]);

    const saveNow = useCallback((): Promise<SaveRoundResult> => {
        if (inFlightRoundRef.current) {
            // Share the in-flight round; its completion check compares
            // revisions, so a concurrent caller never needs a queued flag.
            return inFlightRoundRef.current;
        }
        const round = (async (): Promise<SaveRoundResult> => {
            const epoch = epochRef.current;
            const snapshot = fnsRef.current.getSnapshot();
            if (!snapshot.chapterId) return { ok: true, draftAdvanced: false };
            setSaveStatus('saving');
            const ok = await fnsRef.current.saveChapter(snapshot).catch(() => false);

            // A different chapter/load or unmount invalidates this response.
            if (epoch !== epochRef.current) return { ok: false, draftAdvanced: false };

            if (!ok) {
                setSaveStatus('error');
                return { ok: false, draftAdvanced: false };
            }
            fnsRef.current.markSaved(snapshot.revision);
            // The draft advanced while saving if the revision moved on:
            // a serial follow-up round is required.
            const draftAdvanced = revisionRef.current !== snapshot.revision;
            setSaveStatus(draftAdvanced ? 'unsaved' : 'saved');
            return { ok: true, draftAdvanced };
        })();
        inFlightRoundRef.current = round;
        round.finally(() => {
            if (inFlightRoundRef.current === round) inFlightRoundRef.current = null;
        });
        return round;
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
    }, [saveStatus, revision, sessionKey, debounceMs, saveNow]);

    const flush = useCallback(async (): Promise<boolean> => {
        const epoch = epochRef.current;
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        // Drain the serial queue: a user editing during the flush requires
        // further rounds, so keep saving until the draft stops advancing.
        for (let rounds = 0; rounds < 10; rounds++) {
            if (epoch !== epochRef.current) return false;
            const { ok, draftAdvanced } = await saveNow();
            if (!ok) return false;
            if (!draftAdvanced) return true;
        }
        return false;
    }, [saveNow]);

    const retry = useCallback(() => {
        setSaveStatus(current => (current === 'error' ? 'unsaved' : current));
    }, []);

    return { saveStatus, flush, retry };
}
