import { getEditorPlainText } from '../../domain/chapterContent';
import {
    createChapterSummarySourceSnapshot,
    type ChapterSummaryAllowedSourceKind,
    type ChapterSummaryGenerationMetadata,
    type ChapterSummarySourceSnapshot,
} from '../../domain/chapterSummarySource';
import type { RetrievalContext } from '../../domain/retrieval/contracts';
import type { Book, Chapter, StoryPlanning } from '../../types';
import type { AiConfigRecord } from '../../data/local/aiSettingsRepository';
import type { ContextSection, GenerationTarget } from '../../data/local/aiGenerationRepository';

export const CHAPTER_SUMMARY_PROMPT_VERSION = 'chapter-summary-v2';
export const CHAPTER_SUMMARY_CONTEXT_MAX_CHARS = 60_000;
export const CHAPTER_SUMMARY_OUTPUT_CHARS = 250;
export const CHAPTER_SUMMARY_MAX_TEXT_CHARS = 52_000;
export const CHAPTER_SUMMARY_RETRIEVAL_QUERY_CHARS = 4_000;

type SummaryRetrievalSourceKind = Extract<ChapterSummaryAllowedSourceKind, 'confirmed_setting' | 'character'>;
const SUMMARY_SOURCE_KINDS = new Set<SummaryRetrievalSourceKind>([
    'confirmed_setting', 'character',
]);

export interface ChapterSummaryGenerationContext {
    bookId: string;
    target: GenerationTarget & { kind: 'chapterSummary' };
    sections: ContextSection[];
    maxChars: number;
    outputChars: number;
    draftRevision: number;
    sourceFingerprint: string;
    sourceSnapshot: ChapterSummarySourceSnapshot;
    sourcePreview: string;
    previousSummary: string;
    retrievalScope: {
        bookId: string;
        allowedSourceKinds: SummaryRetrievalSourceKind[];
        allowedChapterIds: string[];
        includeFuturePlan: false;
        includeGenerated: false;
        includeStale: false;
    };
    retrievalQuery: string;
}

function boundedText(value: string, maxChars: number): string {
    return Array.from(value).slice(0, maxChars).join('');
}

function chapterBody(chapter: Chapter): string {
    return getEditorPlainText(chapter.content).trim();
}

export function buildChapterSummaryGenerationContext(
    book: Book,
    planning: StoryPlanning,
    chapter: Chapter,
    draftRevision: number,
): ChapterSummaryGenerationContext {
    const chapterDatabaseVersion = chapter.databaseVersion;
    if (!Number.isSafeInteger(chapterDatabaseVersion) || (chapterDatabaseVersion ?? 0) < 1) {
        throw new Error('The chapter version is unavailable. Reload the book before generating a summary.');
    }
    if (chapter.isReadOnly) throw new Error('This chapter is locked. Unlock it before requesting a summary suggestion.');
    const bodyText = chapterBody(chapter);
    if (!bodyText) throw new Error('This chapter has no readable text to summarize. You can still write and save a manual summary.');
    if (Array.from(bodyText).length > CHAPTER_SUMMARY_MAX_TEXT_CHARS) {
        throw new Error(`This chapter exceeds the ${CHAPTER_SUMMARY_MAX_TEXT_CHARS.toLocaleString()}-character summary context limit. The existing summary is unchanged.`);
    }

    const volume = book.volumes.find(item => item.chapters.some(candidate => candidate.id === chapter.id));
    const sourceSnapshot = createChapterSummarySourceSnapshot(chapter);
    const target: ChapterSummaryGenerationContext['target'] = {
        kind: 'chapterSummary',
        chapterId: chapter.id,
        databaseVersion: chapterDatabaseVersion as number,
        planningDatabaseVersion: planning.databaseVersion ?? 0,
    };
    const previousSummary = planning.chapterSummaries.find(item => item.chapterId === chapter.id)?.summary ?? '';
    const sections: ContextSection[] = [{
        kind: 'writtenFact',
        label: 'Selected chapter text',
        text: `Volume: ${volume?.title ?? ''}\nChapter: ${chapter.title}\n\n${bodyText}`.trim(),
    }];
    const retrievalQuery = boundedText([
        chapter.title,
        bodyText,
    ].filter(Boolean).join('\n'), CHAPTER_SUMMARY_RETRIEVAL_QUERY_CHARS);
    const sourceFingerprint = JSON.stringify({
        bookId: book.id,
        chapterId: chapter.id,
        chapterDatabaseVersion: chapter.databaseVersion,
        planningDatabaseVersion: planning.databaseVersion ?? 0,
        draftRevision,
        sourceFingerprint: sourceSnapshot.structuredFingerprint,
        bodyFingerprint: sourceSnapshot.bodyFingerprint,
        previousSummary,
    });

    return {
        bookId: book.id,
        target,
        sections,
        maxChars: CHAPTER_SUMMARY_CONTEXT_MAX_CHARS,
        outputChars: CHAPTER_SUMMARY_OUTPUT_CHARS,
        draftRevision,
        sourceFingerprint,
        sourceSnapshot,
        sourcePreview: boundedText(bodyText, 320),
        previousSummary,
        retrievalScope: {
            bookId: book.id,
            allowedSourceKinds: [...SUMMARY_SOURCE_KINDS],
            allowedChapterIds: [chapter.id],
            includeFuturePlan: false,
            includeGenerated: false,
            includeStale: false,
        },
        retrievalQuery,
    };
}

export function validateChapterSummaryCandidate(rawText: string): { summary: string; error: null } | { summary: null; error: string } {
    const summary = rawText.trim();
    if (!summary) return { summary: null, error: 'The model returned an empty summary. The existing summary is unchanged.' };
    if (Array.from(summary).length > CHAPTER_SUMMARY_OUTPUT_CHARS) {
        return { summary: null, error: `The suggestion exceeds ${CHAPTER_SUMMARY_OUTPUT_CHARS} characters. The existing summary is unchanged.` };
    }
    return { summary, error: null };
}

function sourceId(bookId: string, kind: string, entityId: string): string {
    return `${bookId}:${kind}:${entityId}`;
}

export function buildChapterSummaryGenerationMetadata(
    config: AiConfigRecord,
    source: ChapterSummaryGenerationContext,
    retrievalContext: RetrievalContext | null,
): ChapterSummaryGenerationMetadata {
    const retrievalSourceById = new Map((retrievalContext?.sourceVersions ?? []).map(version => [version.sourceId, version]));
    const allowedSources = new Map<string, ChapterSummaryGenerationMetadata['source']['allowedSources'][number]>();
    for (const evidence of retrievalContext?.evidence ?? []) {
        const kind = evidence.sourceKind;
        if (!SUMMARY_SOURCE_KINDS.has(kind as SummaryRetrievalSourceKind)) continue;
        const id = sourceId(source.bookId, kind, evidence.entityId);
        const version = retrievalSourceById.get(id);
        if (!version || version.sourceVersion !== evidence.sourceVersion) continue;
        allowedSources.set(id, {
            sourceId: id,
            entityId: evidence.entityId,
            sourceKind: kind as ChapterSummaryAllowedSourceKind,
            sourceVersion: evidence.sourceVersion,
            indexVersion: version.indexVersion,
        });
    }

    return {
        providerId: (() => {
            try { return new URL(config.config.baseUrl).host.toLowerCase(); }
            catch { return config.config.protocol; }
        })(),
        configId: config.id,
        protocol: config.config.protocol,
        modelId: config.config.modelId,
        generatedAt: Date.now(),
        promptVersion: CHAPTER_SUMMARY_PROMPT_VERSION,
        source: {
            bookId: source.bookId,
            chapterId: source.target.chapterId,
            chapterDatabaseVersion: source.target.databaseVersion,
            sourceBodyFingerprint: source.sourceSnapshot.bodyFingerprint,
            planningDatabaseVersion: source.target.planningDatabaseVersion,
            allowedSources: [...allowedSources.values()],
            retrievalTrace: retrievalContext ? {
                searchId: retrievalContext.searchId,
                retrievalVersion: retrievalContext.retrievalVersion,
                task: 'chapter_summary',
                requestedAt: retrievalContext.requestedAt,
            scope: {
                bookId: retrievalContext.scope.bookId,
                allowedSourceKinds: (retrievalContext.scope.allowedSourceKinds ?? []) as SummaryRetrievalSourceKind[],
                allowedChapterIds: retrievalContext.scope.allowedChapterIds ?? [],
                beforeChapterOrder: retrievalContext.scope.beforeChapterOrder ?? null,
                beforeAnchor: retrievalContext.scope.beforeAnchor
                    ? {
                        chapterId: retrievalContext.scope.beforeAnchor.chapterId,
                        paragraphOrdinal: retrievalContext.scope.beforeAnchor.paragraphOrdinal ?? null,
                        textOffset: retrievalContext.scope.beforeAnchor.textOffset ?? null,
                    }
                    : null,
                includeFuturePlan: false,
                includeGenerated: false,
                includeStale: false,
                timeRange: retrievalContext.scope.timeRange
                    ? {
                        updatedAfter: retrievalContext.scope.timeRange.updatedAfter ?? null,
                        updatedBefore: retrievalContext.scope.timeRange.updatedBefore ?? null,
                    }
                    : null,
            },
                excludedHitIds: [...retrievalContext.excludedHitIds],
                sourceVersions: retrievalContext.sourceVersions.map(version => ({ ...version })),
                includedHitIds: [...retrievalContext.includedHitIds],
                omittedHitIds: [...retrievalContext.omittedHitIds],
                budget: { ...retrievalContext.budget },
                indexVersion: retrievalContext.indexVersion,
                embeddingFingerprint: retrievalContext.embeddingFingerprint,
            } : null,
            includesFuturePlan: false,
        },
    };
}
