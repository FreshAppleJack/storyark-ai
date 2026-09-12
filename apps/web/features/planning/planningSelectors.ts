import type { Book, StoryPlanning, PlotSetting } from '../../types';
import { getFuzzyScore } from '../../utils/search';

export interface ChapterOption {
    id: string;
    title: string;
    volumeId: string;
    volumeTitle: string;
    summary: string;
    sourceChanged?: boolean;
}

export function getPlanningChapters(book: Book, planning: StoryPlanning): ChapterOption[] {
    if (!book) return [];
    const summaryMap = new Map(planning.chapterSummaries.map(item => [item.chapterId, item.summary]));

    return book.volumes.flatMap(volume => (
        volume.chapters.map(chapter => ({
            id: chapter.id,
            title: chapter.title,
            volumeId: volume.id,
            volumeTitle: volume.title,
            summary: summaryMap.get(chapter.id) || '',
            sourceChanged: !!summaryMap.get(chapter.id) && chapter.databaseVersion !== undefined
                && planning.chapterSummaries.find(item => item.chapterId === chapter.id)?.sourceChapterVersion !== chapter.databaseVersion,
        }))
    ));
}

export function filterChapters(chapterOptions: ChapterOption[], chapterSearchQuery: string) {

    const query = chapterSearchQuery.trim();
    if (!query) return chapterOptions;

    return chapterOptions
        .map(chapter => {
            const fields = [
                { value: chapter.title, weight: 0 },
                { value: chapter.summary, weight: 0 },
                { value: chapter.volumeTitle, weight: 8 },
            ];
            const bestScore = fields.reduce<number | null>((best, field) => {
                const score = getFuzzyScore(field.value, query);
                if (score === null) return best;
                const weightedScore = score + field.weight;
                return best === null ? weightedScore : Math.min(best, weightedScore);
            }, null);

            return bestScore === null ? null : { ...chapter, score: bestScore };
        })
        .filter((chapter): chapter is ChapterOption & { score: number } => Boolean(chapter))
        .sort((a, b) => a.score - b.score);
}

export function filterPlots(planning: StoryPlanning, chapterById: Map<string, ChapterOption>, plotSearchQuery: string) {

    const query = plotSearchQuery.trim();
    if (!query) return planning.plotSettings;

    return planning.plotSettings
        .map(plot => {
            const relatedChapterNames = plot.chapterIds
                .map(chapterId => chapterById.get(chapterId)?.title || '')
                .join(' ');
            const fields = [
                { value: plot.title, weight: 0 },
                { value: plot.details, weight: 0 },
                { value: relatedChapterNames, weight: 8 },
            ];
            const bestScore = fields.reduce<number | null>((best, field) => {
                const score = getFuzzyScore(field.value, query);
                if (score === null) return best;
                const weightedScore = score + field.weight;
                return best === null ? weightedScore : Math.min(best, weightedScore);
            }, null);

            return bestScore === null ? null : { ...plot, score: bestScore };
        })
        .filter((plot): plot is PlotSetting & { score: number } => Boolean(plot))
        .sort((a, b) => a.score - b.score);
}

export function filterLinkedChapters(chapterOptions: ChapterOption[], linkedChapterSearchQuery: string) {

    const query = linkedChapterSearchQuery.trim();
    if (!query) return chapterOptions;

    return chapterOptions
        .map(chapter => {
            const fields = [
                { value: chapter.title, weight: 0 },
                { value: chapter.volumeTitle, weight: 5 },
                { value: chapter.summary, weight: 12 },
            ];
            const bestScore = fields.reduce<number | null>((best, field) => {
                const score = getFuzzyScore(field.value, query);
                if (score === null) return best;
                const weightedScore = score + field.weight;
                return best === null ? weightedScore : Math.min(best, weightedScore);
            }, null);

            return bestScore === null ? null : { ...chapter, score: bestScore };
        })
        .filter((chapter): chapter is ChapterOption & { score: number } => Boolean(chapter))
        .sort((a, b) => a.score - b.score);
}
