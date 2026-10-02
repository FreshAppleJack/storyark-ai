import type { Book, Chapter, StoryPlanning, PlotSetting } from '../../types';
import {
    assessChapterSummaryFreshness,
    createCurrentAllowedSourceVersions,
    type ChapterSummaryFreshness,
    type ChapterSummaryProvenance,
} from '../../domain/chapterSummarySource';
import { getEditorPlainText } from '../../domain/chapterContent';
import { getFuzzyScore } from '../../utils/search';

export interface ChapterOption {
    id: string;
    title: string;
    volumeId: string;
    volumeTitle: string;
    summary: string;
    hasWrittenText: boolean;
    isReadOnly: boolean;
    sourceChanged?: boolean;
    summaryProvenance?: ChapterSummaryProvenance;
    summaryFreshness?: ChapterSummaryFreshness;
}

const chapterTextCache = new WeakMap<Chapter, { content: string; hasText: boolean }>();

function hasChapterText(chapter: Chapter): boolean {
    const cached = chapterTextCache.get(chapter);
    if (cached?.content === chapter.content) return cached.hasText;
    const hasText = Boolean(getEditorPlainText(chapter.content).trim());
    chapterTextCache.set(chapter, { content: chapter.content, hasText });
    return hasText;
}

export function getPlanningChapters(book: Book, planning: StoryPlanning): ChapterOption[] {
    if (!book) return [];
    const summaryMap = new Map(planning.chapterSummaries.map(item => [item.chapterId, item]));
    const currentAllowedSourceVersions = createCurrentAllowedSourceVersions({
        bookId: book.id,
        planningDatabaseVersion: planning.databaseVersion,
        characters: book.characters,
        chapters: book.volumes.flatMap(volume => volume.chapters),
    });

    return book.volumes.flatMap(volume => (
        volume.chapters.map(chapter => {
            const summary = summaryMap.get(chapter.id);
            const summaryFreshness = assessChapterSummaryFreshness(summary, chapter, currentAllowedSourceVersions);
            return {
                id: chapter.id,
                title: chapter.title,
                volumeId: volume.id,
                volumeTitle: volume.title,
                summary: summary?.summary ?? '',
                hasWrittenText: hasChapterText(chapter),
                isReadOnly: Boolean(chapter.isReadOnly),
                summaryProvenance: summary?.provenance,
                summaryFreshness,
                sourceChanged: summaryFreshness.status === 'possibly-stale' || summaryFreshness.status === 'needs-review',
            };
        })
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
