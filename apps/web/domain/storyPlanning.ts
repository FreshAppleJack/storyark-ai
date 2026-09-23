import type { ChapterSummary, StoryPlanning, PlotSetting } from '../types';
import { asRecord, parseJsonSafe } from '../utils/serialization';
import {
    parseChapterSummaryGenerationMetadata,
    parseChapterSummarySourceSnapshot,
} from './chapterSummarySource';

const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const list = (value: unknown): unknown[] => {
    const parsed = parseJsonSafe(value, []);
    return Array.isArray(parsed) ? parsed : [];
};
const timestamp = (value: unknown, now: number) => {
    const result = Number(value || now);
    return Number.isFinite(result) ? result : now;
};

export const createEmptyPlanning = (): StoryPlanning => ({
    storySummary: '', storyBackground: '', chapterSummaries: [], plotSettings: [],
});

export const createPlotSetting = (id: string, now: number): PlotSetting => ({
    id, title: 'New Plot Setting', details: '', chapterIds: [], createdAt: now, updatedAt: now,
});

export function sanitizePlanning(planning: StoryPlanning, validChapterIds: Set<string>): StoryPlanning {
    return {
        storySummary: planning.storySummary, storyBackground: planning.storyBackground,
        chapterSummaries: planning.chapterSummaries.filter(item => validChapterIds.has(item.chapterId) && item.summary.trim())
            .map(item => ({
                ...item,
                provenance: item.provenance ?? (item.generationMetadata ? 'ai-adopted' : 'author'),
                summary: item.summary.trim(),
            })),
        plotSettings: planning.plotSettings.map(plot => ({ ...plot, title: plot.title.trim() || 'Untitled Plot',
            chapterIds: plot.chapterIds.filter(id => validChapterIds.has(id)) })),
    };
}

/** The caller supplies time so identical inputs always produce identical output. */
export function normalizeStoryPlanning(value: unknown, now: number): StoryPlanning {
    const data = asRecord(value);
    const updatedAt = data.updatedAt ? new Date(data.updatedAt as string | number).getTime() : undefined;
    const chapterSummaries = list(data.chapterSummaries).map(asRecord).map((item): ChapterSummary | null => {
        if (!item.chapterId) return null;
        const chapterId = String(item.chapterId);
        const sourceSnapshot = parseChapterSummarySourceSnapshot(item.sourceSnapshot, chapterId);
        const generationMetadata = parseChapterSummaryGenerationMetadata(item.generationMetadata, chapterId);
        return {
            chapterId,
            summary: text(item.summary),
            ...(Number.isSafeInteger(item.sourceChapterVersion) && Number(item.sourceChapterVersion) >= 1
                ? { sourceChapterVersion: Number(item.sourceChapterVersion) }
                : {}),
            provenance: item.provenance === 'ai-adopted'
                || (!item.provenance && item.generationMetadata !== undefined && item.generationMetadata !== null)
                ? 'ai-adopted'
                : 'author',
            ...(sourceSnapshot ? { sourceSnapshot } : {}),
            ...(generationMetadata ? { generationMetadata } : {}),
            updatedAt: timestamp(item.updatedAt, now),
        };
    }).filter((item): item is ChapterSummary => item !== null);
    return {
        storySummary: text(data.storySummary),
        storyBackground: text(data.storyBackground),
        chapterSummaries,
        databaseVersion: Number.isSafeInteger(data.databaseVersion) && Number(data.databaseVersion) >= 0
            ? Number(data.databaseVersion)
            : undefined,
        plotSettings: list(data.plotSettings).map(asRecord).filter(item => item.id).map(item => ({
            id: String(item.id), title: text(item.title) || 'Untitled Plot', details: text(item.details),
            chapterIds: Array.isArray(item.chapterIds) ? item.chapterIds.map(String) : [],
            createdAt: timestamp(item.createdAt, now), updatedAt: timestamp(item.updatedAt, now),
        })),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    };
}
