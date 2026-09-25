import { describe, expect, it } from 'vitest';
import type { RetrievalContext } from '../../../domain/retrieval/contracts';
import type { Book, Chapter, StoryPlanning } from '../../../types';
import { buildChapterSummaryGenerationContext, buildChapterSummaryGenerationMetadata, validateChapterSummaryCandidate } from '../../../features/planning/chapterSummaryGeneration';
import type { AiConfigRecord } from '../../../data/local/aiSettingsRepository';

const bookId = '00000000-0000-4000-8000-000000000010';
const chapterId = '00000000-0000-4000-8000-000000000020';
const characterId = '00000000-0000-4000-8000-000000000030';

function createChapter(content = '她推开档案室的门。') : Chapter {
    return {
        id: chapterId,
        title: '雨夜',
        status: 'draft',
        content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: content }] }],
        }),
        contentFormat: 'tiptap-json',
        contentVersion: 1,
        databaseVersion: 4,
        wordCount: content.length,
        isEditable: true,
        foreshadowings: [],
    };
}

function createBook(chapter = createChapter()): Book {
    return {
        id: bookId,
        title: '雨夜档案',
        author: 'Author',
        status: 'serializing',
        lastModified: 1,
        volumes: [{ id: 'volume-1', title: 'Volume 1', chapters: [chapter] }],
        characters: [{
            id: characterId,
            bookId,
            name: '林岚',
            aliases: [],
            role: 'protagonist',
            description: 'Archivist',
            color: '#123456',
            tags: [],
        }],
    };
}

const planning: StoryPlanning = {
    storySummary: 'The archive has a sealed room.',
    storyBackground: 'Future event not written yet.',
    databaseVersion: 7,
    chapterSummaries: [{ chapterId, summary: 'Manual: she opens the room.', updatedAt: 1, provenance: 'author' }],
    plotSettings: [{ id: 'future', title: 'Later event', details: 'A storm destroys the archive.', chapterIds: [chapterId], createdAt: 1, updatedAt: 1 }],
};

function retrievalContext(): RetrievalContext {
    const scope = {
        bookId,
        allowedSourceKinds: ['character'] as const,
        allowedChapterIds: [chapterId],
        includeFuturePlan: false,
        includeGenerated: false,
        includeStale: false,
    };
    const material = {
        hitId: 'hit-character',
        label: 'character / 林岚 / source v2',
        sourceKind: 'character' as const,
        entityId: characterId,
        chapterId: null,
        chapterTitleSnapshot: null,
        volumeTitleSnapshot: null,
        sourceVersion: 2,
        chunkId: 'chunk-character',
        quote: '林岚是一名档案员。',
        freshness: 'fresh' as const,
        recallMethods: ['semantic' as const],
    };
    return {
        searchId: 'search-1',
        retrievalVersion: 'p1-r1-v1',
        task: 'chapter_summary',
        requestedAt: 100,
        bookId,
        chapterId,
        scope,
        excludedHitIds: [],
        sourceVersions: [{ sourceId: `${bookId}:character:${characterId}`, chapterId: null, sourceVersion: 2, indexVersion: 1 }],
        indexVersion: 1,
        embeddingFingerprint: 'local-e5-fingerprint',
        budget: { charBudget: 6000, tokenBudget: 1500 },
        materials: [material],
        evidence: [{ ...material, text: '林岚是一名档案员。' }],
        text: '[character evidence]\n林岚是一名档案员。',
        charCount: 20,
        tokenEstimate: 10,
        charBudget: 6000,
        tokenBudget: 1500,
        includedHitIds: ['hit-character'],
        omittedHitIds: [],
    };
}

const config: AiConfigRecord = {
    id: '00000000-0000-4000-8000-000000000040',
    configVersion: 1,
    credentialMode: 'session',
    credentialStatus: 'session',
    config: { name: 'Writer model', protocol: 'openai-responses', baseUrl: 'https://example.invalid', modelId: 'model-a', timeoutMs: 1000, maxOutputTokens: 1000 },
};

describe('chapter summary generation context', () => {
    it('freezes one chapter and excludes planning/future facts from the prompt and retrieval scope', () => {
        const context = buildChapterSummaryGenerationContext(createBook(), planning, createChapter(), 3);

        expect(context.target).toEqual({ kind: 'chapterSummary', chapterId, databaseVersion: 4, planningDatabaseVersion: 7 });
        expect(context.sections).toHaveLength(1);
        expect(context.sections[0].text).toContain('她推开档案室的门。');
        expect(context.sections[0].text).not.toContain('Future event not written yet.');
        expect(context.sections[0].text).not.toContain('A storm destroys the archive.');
        expect(context.retrievalScope.allowedChapterIds).toEqual([chapterId]);
        expect(context.retrievalScope.includeFuturePlan).toBe(false);
        expect(context.retrievalScope.allowedSourceKinds).not.toContain('future_plan');
        expect(context.previousSummary).toBe('Manual: she opens the room.');
    });

    it('can summarize chapter text when the book has no character or planning material', () => {
        const book = createBook();
        book.characters = [];
        const sparsePlanning: StoryPlanning = {
            storySummary: '',
            storyBackground: '',
            databaseVersion: 0,
            chapterSummaries: [],
            plotSettings: [],
        };

        const context = buildChapterSummaryGenerationContext(book, sparsePlanning, createChapter(), 0);

        expect(context.sections).toHaveLength(1);
        expect(context.sections[0].text).toContain('她推开档案室的门。');
        expect(context.retrievalScope.allowedChapterIds).toEqual([chapterId]);
    });

    it('records the actual retrieval contract and rejects malformed/oversized candidates without replacing manual text', () => {
        const context = buildChapterSummaryGenerationContext(createBook(), planning, createChapter(), 3);
        const metadata = buildChapterSummaryGenerationMetadata(config, context, retrievalContext());
        expect(metadata).toMatchObject({
            providerId: 'example.invalid',
            configId: config.id,
            modelId: 'model-a',
            promptVersion: 'chapter-summary-v1',
            source: {
                bookId,
                chapterId,
                chapterDatabaseVersion: 4,
                includesFuturePlan: false,
                allowedSources: [{ entityId: characterId, sourceKind: 'character', sourceVersion: 2, indexVersion: 1 }],
                retrievalTrace: { task: 'chapter_summary', includedHitIds: ['hit-character'], scope: { allowedChapterIds: [chapterId], includeFuturePlan: false } },
            },
        });
        expect(validateChapterSummaryCandidate('  她打开了档案室。  ')).toEqual({ summary: '她打开了档案室。', error: null });
        expect(validateChapterSummaryCandidate('  ')).toMatchObject({ summary: null });
        expect(validateChapterSummaryCandidate('超'.repeat(4_001))).toMatchObject({ summary: null });
        expect(planning.chapterSummaries[0].summary).toBe('Manual: she opens the room.');
    });

    it('stops instead of silently summarizing an empty or over-limit chapter body', () => {
        expect(() => buildChapterSummaryGenerationContext(createBook(createChapter('')), planning, createChapter(''), 0)).toThrow('no readable text');
        const longChapter = createChapter('字'.repeat(52_001));
        expect(() => buildChapterSummaryGenerationContext(createBook(longChapter), planning, longChapter, 0)).toThrow('context limit');
    });
});
