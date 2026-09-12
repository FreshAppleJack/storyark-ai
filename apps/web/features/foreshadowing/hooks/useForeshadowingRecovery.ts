import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { Book } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { foreshadowingCardKey, type ForeshadowingCardData } from '../foreshadowingSelectors';
export function useForeshadowingRecovery(book: Book | undefined) {
    const { updateChapterContent } = useBooks();
    const [recoveringId, setRecoveringId] = useState<string | null>(null);
    // Keep a retry target because failed optimistic writes already change the card.
    const [failedRecovery, setFailedRecovery] = useState<{ cardId: string; isRecovered: boolean } | null>(null);
    const busy = useRef(false);
    const mounted = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const markRecovered = async (card: ForeshadowingCardData) => {
        if (!book || card.note.isRecovered || recoveringId) return;
        await setForeshadowingRecovered(card, true);
    };

    const undoRecovered = async (card: ForeshadowingCardData) => {
        if (!book || !card.note.isRecovered || recoveringId) return;
        await setForeshadowingRecovered(card, false);
    };

    const setForeshadowingRecovered = async (card: ForeshadowingCardData, isRecovered: boolean) => {
        if (!book || busy.current) return;
        const volume = book.volumes.find(item => item.id === card.volumeId);
        const chapter = volume?.chapters.find(item => item.id === card.chapterId);
        if (!chapter) return;

        busy.current = true;
        setRecoveringId(foreshadowingCardKey(card));
        const now = Date.now();
        const nextForeshadowings = (chapter.foreshadowings || []).map(note => (
            note.id === card.id
                ? { ...note, isRecovered, updatedAt: now }
                : note
        ));

        try {
            const ok = await updateChapterContent(
                book.id,
                card.volumeId,
                card.chapterId,
                chapter.title,
                chapter.content || '',
                chapter.wordCount,
                nextForeshadowings
            );
            if (!mounted.current) return;
            if (ok) {
                setFailedRecovery(prev => (prev?.cardId === foreshadowingCardKey(card) ? null : prev));
            } else {
                setFailedRecovery({ cardId: foreshadowingCardKey(card), isRecovered });
                toast.error(isRecovered
                    ? 'Failed to mark as recovered. Your change was not saved.'
                    : 'Failed to undo recovery. Your change was not saved.');
            }
        } finally {
            busy.current = false;
            if (mounted.current) setRecoveringId(null);
        }
    };

    return { recoveringId, failedRecovery, markRecovered, undoRecovered, setForeshadowingRecovered };
}
export type ForeshadowingRecovery = ReturnType<typeof useForeshadowingRecovery>;
