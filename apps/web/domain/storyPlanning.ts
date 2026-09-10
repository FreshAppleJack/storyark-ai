import type { StoryPlanning, PlotSetting } from '../types';
import { asRecord, parseJsonSafe } from '../utils/serialization';

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
            .map(item => ({ ...item, summary: item.summary.trim() })),
        plotSettings: planning.plotSettings.map(plot => ({ ...plot, title: plot.title.trim() || 'Untitled Plot',
            chapterIds: plot.chapterIds.filter(id => validChapterIds.has(id)) })),
    };
}

/** The caller supplies time so identical inputs always produce identical output. */
export function normalizeStoryPlanning(value: unknown, now: number): StoryPlanning {
    const data = asRecord(value);
    const updatedAt = data.updatedAt ? new Date(data.updatedAt as string | number).getTime() : undefined;
    return {
        storySummary: text(data.storySummary),
        storyBackground: text(data.storyBackground),
        chapterSummaries: list(data.chapterSummaries).map(asRecord).filter(item => item.chapterId).map(item => ({
            chapterId: String(item.chapterId), summary: text(item.summary), updatedAt: timestamp(item.updatedAt, now),
        })),
        plotSettings: list(data.plotSettings).map(asRecord).filter(item => item.id).map(item => ({
            id: String(item.id), title: text(item.title) || 'Untitled Plot', details: text(item.details),
            chapterIds: Array.isArray(item.chapterIds) ? item.chapterIds.map(String) : [],
            createdAt: timestamp(item.createdAt, now), updatedAt: timestamp(item.updatedAt, now),
        })),
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    };
}
