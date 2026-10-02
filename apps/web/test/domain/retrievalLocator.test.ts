import { describe, expect, it } from 'vitest';
import type { RetrievalChunkLocator } from '../../domain/retrieval/contracts';
import { resolveRetrievalChunkLocator } from '../../domain/retrieval/locator';

const locator = (overrides: Partial<RetrievalChunkLocator> = {}): RetrievalChunkLocator => ({
    chapterId: 'chapter-1',
    volumeId: 'volume-1',
    chapterTitleSnapshot: 'Chapter',
    volumeTitleSnapshot: 'Volume',
    chapterSourceVersion: 4,
    chunkOrdinal: 0,
    paragraphOrdinals: [2],
    tiptapNodePaths: [[2]],
    paragraphSpans: [{ paragraphOrdinal: 2, nodePath: [2], startOffset: 0, endOffset: 5 }],
    textHash: 'fnv1a64-a',
    shortQuote: 'A quote',
    ...overrides,
});

const chunk = (sourceLocator: RetrievalChunkLocator) => ({
    chunkId: 'source:v4:i1:o0:fnv1a64-a',
    sourceId: 'source',
    bookId: 'book-1',
    sourceVersion: 4,
    indexVersion: 1,
    ordinal: 0,
    sourceText: 'A quote',
    indexText: 'a quote',
    textHash: sourceLocator.textHash,
    shortQuote: sourceLocator.shortQuote,
    locator: sourceLocator,
});

describe('resolveRetrievalChunkLocator', () => {
    it('uses the stored locator only when the chapter version still matches', () => {
        const source = chunk(locator());
        const result = resolveRetrievalChunkLocator(source, {
            chapterId: 'chapter-1',
            sourceVersion: 4,
            chunks: [],
        });
        expect(result).toMatchObject({ status: 'resolved', matchedBy: 'version' });
        if (result.status === 'resolved') expect(result.locator).toEqual(source.locator);
    });

    it('uses a unique same-chapter hash when the chapter version changed', () => {
        const source = chunk(locator({ chapterSourceVersion: 3 }));
        const currentLocator = locator({ chapterSourceVersion: 5, paragraphOrdinals: [7], tiptapNodePaths: [[7]] });
        const result = resolveRetrievalChunkLocator(source, {
            chapterId: 'chapter-1',
            sourceVersion: 5,
            chunks: [{ textHash: source.textHash, locator: currentLocator }],
        });
        expect(result).toMatchObject({ status: 'resolved', matchedBy: 'text-hash' });
        if (result.status === 'resolved') expect(result.locator).toEqual(currentLocator);
    });

    it('keeps evidence visible instead of guessing when a changed source is ambiguous', () => {
        const source = chunk(locator({ chapterSourceVersion: 3 }));
        const result = resolveRetrievalChunkLocator(source, {
            chapterId: 'chapter-1',
            sourceVersion: 5,
            chunks: [
                { textHash: source.textHash, locator: locator({ chapterSourceVersion: 5, paragraphOrdinals: [7] }) },
                { textHash: source.textHash, locator: locator({ chapterSourceVersion: 5, paragraphOrdinals: [9] }) },
            ],
        });
        expect(result).toEqual(expect.objectContaining({ status: 'source-changed', reason: 'hash-not-unique' }));
    });

    it('rejects a result from another chapter without using the current cursor', () => {
        const source = chunk(locator({ chapterId: 'chapter-2' }));
        const result = resolveRetrievalChunkLocator(source, {
            chapterId: 'chapter-1',
            sourceVersion: 4,
            chunks: [],
        });
        expect(result).toEqual(expect.objectContaining({ status: 'source-changed', reason: 'wrong-chapter' }));
    });
});
