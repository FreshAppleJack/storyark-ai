import { describe, expect, it } from 'vitest';
import { mapRetrievalChunkOffset } from '../../domain/retrieval/locator';
import { buildSearchPreview, splitPreviewHighlight } from '../../domain/retrieval/searchPreview';
import type { RetrievalChunkLocator } from '../../domain/retrieval/contracts';

function locator(spans: RetrievalChunkLocator['paragraphSpans']): RetrievalChunkLocator {
    return {
        chapterId: 'chapter-1',
        volumeId: 'volume-1',
        chapterTitleSnapshot: 'Chapter',
        volumeTitleSnapshot: 'Volume',
        chapterSourceVersion: 4,
        chunkOrdinal: 0,
        paragraphOrdinals: spans.map(span => span.paragraphOrdinal),
        tiptapNodePaths: spans.map(span => span.nodePath),
        paragraphSpans: spans,
        textHash: 'fnv1a64-test',
        shortQuote: '',
    };
}

describe('buildSearchPreview', () => {
    it('centers a short preview on an exact query phrase and exposes the same focus offset', () => {
        const source = `${'开头铺垫。'.repeat(40)}目标命中短语${'后续内容。'.repeat(40)}`;
        const result = buildSearchPreview(source, '目标命中短语');

        expect(Array.from(result.text).length).toBeLessThanOrEqual(122);
        expect(result.text).toContain('目标命中短语');
        expect(splitPreviewHighlight(result)?.match).toBe('目标命中短语');
        expect(Array.from(source).slice(result.chunkTextOffset, result.chunkTextOffset + result.focusTextLength).join(''))
            .toBe('目标命中短语');
    });

    it('finds a nearby Chinese and Latin term cluster when the whole query is not contiguous', () => {
        const relevant = 'Kat在走廊里和夏洛蒂讨论计划。';
        const source = `${'无关叙述。'.repeat(40)}${relevant}${'其他故事。'.repeat(40)}`;
        const result = buildSearchPreview(source, 'Kat与夏洛蒂谈话');

        expect(result.text).toContain('Kat');
        expect(result.text).toContain('夏洛蒂');
        expect(result.chunkTextOffset).toBeGreaterThan(Array.from(`${'无关叙述。'.repeat(40)}`).length);
    });

    it('uses a centered chunk excerpt when a semantic hit has no literal query term', () => {
        const source = Array.from({ length: 400 }, (_, index) => String.fromCharCode(0x4e00 + (index % 200))).join('');
        const result = buildSearchPreview(source, '没有出现在正文里的查询');

        expect(result.chunkTextOffset).toBe(200);
        expect(result.text.startsWith('…')).toBe(true);
        expect(result.text.endsWith('…')).toBe(true);
        expect(splitPreviewHighlight(result)).toBeNull();
    });
});

describe('mapRetrievalChunkOffset', () => {
    it('maps a chunk offset across paragraph separators to its exact indexed span', () => {
        const target = locator([
            { paragraphOrdinal: 3, nodePath: [0], startOffset: 8, endOffset: 12 },
            { paragraphOrdinal: 4, nodePath: [1], startOffset: 20, endOffset: 28 },
        ]);

        expect(mapRetrievalChunkOffset(target, 5, 4)).toEqual({
            paragraphOrdinal: 4,
            textOffset: 20,
            textLength: 4,
        });
    });

    it('maps offsets through adjacent pieces of the same paragraph without adding a separator', () => {
        const target = locator([
            { paragraphOrdinal: 3, nodePath: [0], startOffset: 8, endOffset: 12 },
            { paragraphOrdinal: 3, nodePath: [0], startOffset: 12, endOffset: 18 },
        ]);

        expect(mapRetrievalChunkOffset(target, 5, 3)).toEqual({
            paragraphOrdinal: 3,
            textOffset: 13,
            textLength: 3,
        });
    });
});
