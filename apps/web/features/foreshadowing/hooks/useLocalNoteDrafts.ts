import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { planningRepository } from '../../../data/local/planningRepository';
import { localKeys, type LocalBookDetail } from '../../../data/local/repository';
import { foreshadowingCardKey, type ForeshadowingCardData } from '../foreshadowingSelectors';
import type { ForeshadowingRecovery } from './useForeshadowingRecovery';

interface Draft { card: ForeshadowingCardData; note?: string; isRecovered?: boolean; revision: number }
export function useLocalNoteDrafts(initial: LocalBookDetail) {
    const client = useQueryClient();
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const latest = useRef(drafts);
    const versions = useRef(new Map(initial.chapters.map(chapter => [chapter.id, chapter.databaseVersion])));
    const bookId = initial.book.id;
    const pending = useRef<Promise<boolean> | null>(null);
    const [recoveringId, setRecoveringId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const stage = (card: ForeshadowingCardData, patch: { note?: string; isRecovered?: boolean }) => {
        const key = foreshadowingCardKey(card);
        const previous = latest.current[key];
        latest.current = { ...latest.current, [key]: { ...previous, card, ...patch, revision: (previous?.revision ?? 0) + 1 } };
        setDrafts(latest.current);
    };
    const flush = useCallback((): Promise<boolean> => {
        if (pending.current) return pending.current;
        const run = async () => {
            setError(null);
            try {
                while (Object.keys(latest.current).length) {
                    const [key, draft] = Object.entries(latest.current)[0];
                    setRecoveringId(key);
                    const version = versions.current.get(draft.card.chapterId);
                    if (version === undefined) throw new Error('Chapter version unavailable. Keep the draft and reload.');
                    const chapter = await planningRepository.updateNote({ bookId, chapterId: draft.card.chapterId,
                        noteId: draft.card.id, expectedDatabaseVersion: version, note: draft.note, isRecovered: draft.isRecovered });
                    versions.current.set(chapter.id, chapter.databaseVersion);
                    client.setQueryData<LocalBookDetail>(localKeys.book(bookId), old => old && ({ ...old,
                        chapters: old.chapters.map(item => item.id === chapter.id ? chapter : item) }));
                    if (latest.current[key]?.revision === draft.revision) {
                        const remaining = { ...latest.current };
                        delete remaining[key];
                        latest.current = remaining;
                        setDrafts(remaining);
                    }
                }
                return true;
            } catch (error) {
                setError(error instanceof Error ? error.message : 'Note save failed. Your draft is retained.');
                return false;
            } finally { pending.current = null; setRecoveringId(null); }
        };
        // Keep even the empty completion asynchronous so the shared promise resets.
        pending.current = Promise.resolve().then(run);
        return pending.current;
    }, [bookId, client]);
    const setForeshadowingRecovered = async (card: ForeshadowingCardData, isRecovered: boolean) => {
        stage(card, { isRecovered });
        await flush();
    };
    const recovery: ForeshadowingRecovery = { recoveringId, failedRecovery: null,
        markRecovered: card => setForeshadowingRecovered(card, true), undoRecovered: card => setForeshadowingRecovered(card, false), setForeshadowingRecovered };
    return { recovery, drafts, error, flush, isDirty: Object.keys(drafts).length > 0,
        editNote: (card: ForeshadowingCardData, note: string) => stage(card, { note }) };
}
