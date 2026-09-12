import type { Book, ForeshadowingNote } from '../../types';
import { getFuzzyScore } from '../../utils/search';
import { getForeshadowingExcerptMap } from '../../domain/chapterContent';
const EXCERPT_MAX_LENGTH = 220;
export interface ForeshadowingCardData {
    id: string;
    note: ForeshadowingNote;
    excerpt: string;
    chapterId: string;
    chapterTitle: string;
    volumeId: string;
    volumeTitle: string;
    score?: number;
    isLocated?: boolean;
}

export const foreshadowingCardKey = (card: ForeshadowingCardData) => JSON.stringify([card.chapterId, card.id]);

export function collectForeshadowingCards(book: Book | undefined): ForeshadowingCardData[] {
    if (!book) return [];
    return book.volumes.flatMap(volume => (
        volume.chapters.flatMap(chapter => {
            const excerptMap = getForeshadowingExcerptMap(chapter.content || '', EXCERPT_MAX_LENGTH);
            return (chapter.foreshadowings || []).map(note => ({
                id: note.id,
                isLocated: excerptMap.has(note.id),
                note,
                excerpt: excerptMap.get(note.id) || note.excerpt || 'No linked excerpt found.',
                chapterId: chapter.id,
                chapterTitle: chapter.title,
                volumeId: volume.id,
                volumeTitle: volume.title,
            }));
        })
    )).sort((a, b) => b.note.updatedAt - a.note.updatedAt);
}

export function filterForeshadowingCards(allCards: ForeshadowingCardData[], searchQuery: string) {
    const query = searchQuery.trim();
    if (!query) return allCards;

    return allCards
        .map(card => {
            const fields = [
                { value: card.excerpt, weight: 0 },
                { value: card.note.note, weight: 0 },
                { value: card.chapterTitle, weight: 10 },
                { value: card.volumeTitle, weight: 14 },
            ];
            const bestScore = fields.reduce<number | null>((best, field) => {
                const score = getFuzzyScore(field.value, query);
                if (score === null) return best;
                const weightedScore = score + field.weight;
                return best === null ? weightedScore : Math.min(best, weightedScore);
            }, null);

            return bestScore === null ? null : { ...card, score: bestScore };
        })
        .filter((card): card is ForeshadowingCardData & { score: number } => Boolean(card))
        .sort((a, b) => a.score - b.score);
}
