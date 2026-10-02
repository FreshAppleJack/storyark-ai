import { describe, expect, it } from 'vitest';
import {
    assessChapterSummaryFreshness,
    createChapterSummarySourceSnapshot,
    parseChapterSummarySourceSnapshot,
    parseChapterSummaryGenerationMetadata,
    type ChapterSummaryForFreshness,
    type ChapterSummarySourceInput,
} from '../../domain/chapterSummarySource';

const chapterId = '00000000-0000-4000-8000-000000000001';
const characterA = '00000000-0000-4000-8000-000000000002';
const characterB = '00000000-0000-4000-8000-000000000003';
const bookId = '00000000-0000-4000-8000-000000000020';

function document(...paragraphs: unknown[]) {
    return JSON.stringify({ type: 'doc', content: paragraphs });
}

function paragraph(text: string, marks?: unknown[]) {
    return { type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] };
}

function source(content = document(paragraph('她推开门。')), databaseVersion = 1): ChapterSummarySourceInput {
    return { id: chapterId, title: 'The Door', databaseVersion, contentFormat: 'tiptap-json', contentVersion: 1, content };
}

function summaryFor(chapter: ChapterSummarySourceInput): ChapterSummaryForFreshness {
    const sourceSnapshot = createChapterSummarySourceSnapshot(chapter, 100);
    return {
        chapterId,
        summary: '她进入房间。',
        sourceChapterVersion: sourceSnapshot.chapterDatabaseVersion ?? undefined,
        provenance: 'author',
        sourceSnapshot,
    };
}

const generationMetadata = {
    providerId: 'provider-a',
    configId: '00000000-0000-4000-8000-000000000010',
    protocol: 'openai-compatible',
    modelId: 'model-a',
    generatedAt: 101,
    promptVersion: 'chapter-summary-v1',
    source: {
        bookId,
        chapterId,
        chapterDatabaseVersion: 1,
        sourceBodyFingerprint: '0123456789abcdef',
        planningDatabaseVersion: 2,
        allowedSources: [{
            sourceId: `${bookId}:character:${characterA}`,
            entityId: characterA,
            sourceKind: 'character',
            sourceVersion: 4,
            indexVersion: null,
        }],
        retrievalTrace: {
            searchId: 'search-1',
            retrievalVersion: 'p1-r1-v1',
            task: 'chapter_summary',
            requestedAt: 100,
            scope: {
                bookId,
                allowedSourceKinds: ['character'],
                allowedChapterIds: [chapterId],
                beforeChapterOrder: null,
                beforeAnchor: null,
                includeFuturePlan: false,
                includeGenerated: false,
                includeStale: false,
                timeRange: null,
            },
            excludedHitIds: [],
            sourceVersions: [{ sourceId: `${bookId}:character:${characterA}`, chapterId: null, sourceVersion: 4, indexVersion: 1 }],
            includedHitIds: ['hit-1'],
            omittedHitIds: [],
            budget: { charBudget: 1000, tokenBudget: 500 },
            indexVersion: 1,
            embeddingFingerprint: 'local-e5-fingerprint',
        },
        includesFuturePlan: false,
    },
};

describe('chapter summary source snapshots', () => {
    it('keeps a copied summary current without hiding subsequent text, mention, or note edits', () => {
        const original = source(document({ type: 'paragraph', content: [
            { type: 'mention', attrs: { id: characterA, label: 'Alice' } },
            { type: 'text', text: ' opens the door.', marks: [{ type: 'foreshadowing', attrs: { id: 'old-note' } }] },
        ] }), 3);
        original.foreshadowings = [{ id: 'old-note', excerpt: 'door', note: 'Return later' }];
        const originalSummary = summaryFor(original);
        const copied = { ...original, databaseVersion: 1,
            content: original.content.replaceAll(characterA, characterB).replaceAll('old-note', 'new-note'),
            foreshadowings: [{ ...original.foreshadowings[0], id: 'new-note' }],
        };
        const summary = { ...originalSummary, sourceSnapshot: {
            ...originalSummary.sourceSnapshot!,
            mentionedCharacterIds: [characterB], foreshadowingIds: ['new-note'],
            foreshadowingNoteFingerprints: originalSummary.sourceSnapshot!.foreshadowingNoteFingerprints.map(note => ({ ...note, noteId: 'new-note' })),
            copyReferences: {
                characters: [{ id: characterB, fingerprintId: characterA }],
                foreshadowings: [{ id: 'new-note', fingerprintId: 'old-note' }],
            },
        } };
        expect(assessChapterSummaryFreshness(summary, copied).status).toBe('current');
        expect(assessChapterSummaryFreshness(summary, { ...copied, content: copied.content.replace('door.', 'window.') }).changedBlocks).toBe(1);
        expect(assessChapterSummaryFreshness(summary, { ...copied, foreshadowings: [{ ...copied.foreshadowings[0], note: 'Changed' }] }).changedForeshadowingNoteIds).toEqual(['new-note']);
        expect(assessChapterSummaryFreshness(summary, { ...copied, content: copied.content.replace(characterB, characterA) }).reasons).toContain('character-mentions-changed');
        // A new acknowledgement uses the copy's identities rather than the import aliases.
        expect(assessChapterSummaryFreshness({ ...summary, sourceSnapshot: createChapterSummarySourceSnapshot(copied) }, copied).status).toBe('current');
    });

    it('preserves imported source freshness and stops using import versions after an explicit review', () => {
        const chapter = source();
        const sourceId = generationMetadata.source.allowedSources[0].sourceId;
        const summary = { ...summaryFor(chapter), generationMetadata,
            sourceSnapshot: { ...createChapterSummarySourceSnapshot(chapter), copySourceVersions: [{ sourceId, version: 1, matchesBaseline: true }] },
        };
        expect(assessChapterSummaryFreshness(summary, chapter, new Map([[sourceId, 1]])).status).toBe('current');
        expect(assessChapterSummaryFreshness(summary, chapter, new Map([[sourceId, 2]])).status).toBe('possibly-stale');
        summary.sourceSnapshot.copySourceVersions[0].matchesBaseline = false;
        expect(assessChapterSummaryFreshness(summary, chapter, new Map([[sourceId, 1]])).status).toBe('possibly-stale');
        expect(assessChapterSummaryFreshness({ ...summary, freshnessAcknowledgement: {
            acknowledgedSourceSnapshot: createChapterSummarySourceSnapshot(chapter), acknowledgedAt: 200, allowedSourceVersions: [2],
        } }, chapter, new Map([[sourceId, 2]])).status).toBe('current');
    });

    it('rejects malformed copy comparison metadata', () => {
        const snapshot = createChapterSummarySourceSnapshot(source());
        expect(parseChapterSummarySourceSnapshot({ ...snapshot, copyReferences: { characters: 'bad', foreshadowings: [] } }, chapterId)).toBeUndefined();
        expect(parseChapterSummarySourceSnapshot({ ...snapshot, copySourceVersions: [{ sourceId: 'x', version: 1, matchesBaseline: 'true' }] }, chapterId)).toBeUndefined();
    });
    it('does not call formatting-only edits stale, but records that the database version advanced', () => {
        const original = source(document(paragraph('她推开门。')));
        const summary = summaryFor(original);
        const formatted = source(document({
            ...paragraph('她推开门。', [{ type: 'bold' }]),
            attrs: { textAlign: 'center' },
        }), 2);
        const result = assessChapterSummaryFreshness(summary, formatted);

        expect(result.status).toBe('current');
        expect(result.sourceVersionChanged).toBe(true);
        expect(summary.sourceSnapshot?.bodyFingerprint).not.toBe(createChapterSummarySourceSnapshot(formatted).bodyFingerprint);
    });

    it('detects added, removed, and rewritten blocks without a character-count threshold', () => {
        const original = source(document(paragraph('她推开门。'), paragraph('屋里没有灯。')));
        const summary = summaryFor(original);
        const inserted = source(document(paragraph('她推开门。'), paragraph('身后传来脚步声。'), paragraph('屋里没有灯。')), 2);
        const insertedResult = assessChapterSummaryFreshness(summary, inserted);
        expect(insertedResult.status).toBe('possibly-stale');
        expect(insertedResult.addedBlocks).toBe(1);

        const rewritten = source(document(paragraph('她推开门！'), paragraph('屋里没有灯。')), 3);
        const rewrittenResult = assessChapterSummaryFreshness(summary, rewritten);
        expect(rewrittenResult.status).toBe('possibly-stale');
        expect(rewrittenResult.changedBlocks).toBe(1);
        expect(rewrittenResult.addedBlocks).toBe(0);

        const removed = source(document(paragraph('她推开门。')), 4);
        expect(assessChapterSummaryFreshness(summary, removed).removedBlocks).toBe(1);
    });

    it('detects Mention identity and foreshadowing note changes', () => {
        const mentioned = (id: string) => ({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id, label: '阿青' } }] }],
        });
        const original = {
            ...source(JSON.stringify(mentioned(characterA))),
            foreshadowings: [{ id: 'note-1', excerpt: '旧伤', note: '尚未解释', isRecovered: false }],
        };
        const summary = summaryFor(original);
        const updated = {
            ...source(JSON.stringify(mentioned(characterB)), 2),
            foreshadowings: [{ id: 'note-1', excerpt: '旧伤', note: '伤痕来自事故', isRecovered: false }],
        };
        const result = assessChapterSummaryFreshness(summary, updated);
        expect(result.status).toBe('possibly-stale');
        expect(result.addedCharacterIds).toEqual([characterB]);
        expect(result.removedCharacterIds).toEqual([characterA]);
        expect(result.changedForeshadowingNoteIds).toEqual(['note-1']);
    });

    it('requires review for legacy summaries without a verifiable snapshot even if versions match', () => {
        const legacy: ChapterSummaryForFreshness = { chapterId, summary: 'Old summary', sourceChapterVersion: 1 };
        expect(assessChapterSummaryFreshness(legacy, source()).status).toBe('needs-review');
    });

    it('requires review when an AI-adopted summary has lost its generation record', () => {
        const chapter = source();
        const summary: ChapterSummaryForFreshness = {
            ...summaryFor(chapter), provenance: 'ai-adopted', generationMetadata: undefined,
        };
        expect(assessChapterSummaryFreshness(summary, chapter).reasons).toContain('generation-metadata-unavailable');
    });

    it('checks the versions of recorded character and setting sources', () => {
        const chapter = source();
        const snapshot = createChapterSummarySourceSnapshot(chapter, 100);
        const metadata = {
            ...generationMetadata,
            source: { ...generationMetadata.source, sourceBodyFingerprint: snapshot.bodyFingerprint },
        };
        const parsed = parseChapterSummaryGenerationMetadata(metadata, chapterId);
        expect(parsed).toBeDefined();
        const summary: ChapterSummaryForFreshness = { chapterId, summary: 'AI summary', sourceSnapshot: snapshot, generationMetadata: parsed };
        const result = assessChapterSummaryFreshness(summary, chapter, new Map([[`${metadata.source.bookId}:character:${characterA}`, 5]]));
        expect(result.status).toBe('possibly-stale');
        expect(result.changedAllowedSourceIds).toEqual([`${metadata.source.bookId}:character:${characterA}`]);
    });

    it('uses an explicit review acknowledgement as the new freshness baseline and detects later changes', () => {
        const original = source(document(paragraph('她推开门。')));
        const current = source(document(paragraph('她推开门。'), paragraph('门后传来脚步声。')), 2);
        const originalSnapshot = createChapterSummarySourceSnapshot(original, 100);
        const acknowledgedSnapshot = createChapterSummarySourceSnapshot(current, 200);
        const metadata = parseChapterSummaryGenerationMetadata({
            ...generationMetadata,
            source: { ...generationMetadata.source, sourceBodyFingerprint: originalSnapshot.bodyFingerprint },
        }, chapterId);
        const key = `${bookId}:character:${characterA}`;
        const summary: ChapterSummaryForFreshness = {
            chapterId,
            summary: '作者保留的现有概括。',
            provenance: 'ai-adopted',
            sourceSnapshot: originalSnapshot,
            generationMetadata: metadata,
            freshnessAcknowledgement: {
                acknowledgedSourceSnapshot: acknowledgedSnapshot,
                allowedSourceVersions: [5],
                acknowledgedAt: 200,
            },
        };

        expect(assessChapterSummaryFreshness(summary, current, new Map([[key, 5]])).status).toBe('current');
        expect(assessChapterSummaryFreshness(summary, current, new Map([[key, 6]])).status).toBe('possibly-stale');
        expect(assessChapterSummaryFreshness(
            summary,
            source(document(paragraph('她推开门。'), paragraph('门后传来脚步声。'), paragraph('灯亮了。')), 3),
            new Map([[key, 5]]),
        ).status).toBe('possibly-stale');
    });

    it('rejects generation metadata that admits future plans or malformed retrieval traces', () => {
        expect(parseChapterSummaryGenerationMetadata({
            ...generationMetadata,
            source: { ...generationMetadata.source, includesFuturePlan: true },
        }, chapterId)).toBeUndefined();
        expect(parseChapterSummaryGenerationMetadata({
            ...generationMetadata,
            source: { ...generationMetadata.source, retrievalTrace: { ...generationMetadata.source.retrievalTrace, sourceVersions: 'bad' } },
        }, chapterId)).toBeUndefined();
    });
});
