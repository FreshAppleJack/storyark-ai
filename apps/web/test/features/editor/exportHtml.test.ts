import { describe, expect, it } from 'vitest';
import { buildChapterExportHtml, buildWordExportDocument } from '../../../features/editor/utils/exportHtml';

describe('buildChapterExportHtml', () => {
    it('wraps the editor HTML with a centered title heading', () => {
        const html = buildChapterExportHtml('My Chapter', '<p>story text</p>');

        expect(html).toContain('>My Chapter</h1>');
        expect(html).toContain('<p>story text</p>');
    });
});

describe('buildWordExportDocument', () => {
    it('declares UTF-8 so Word reads CJK text correctly', () => {
        const doc = buildWordExportDocument('My Chapter', '<div>chapter html</div>');

        expect(doc).toContain('<meta charset="utf-8">');
        expect(doc).toContain('<title>My Chapter</title>');
    });

    it('embeds the chapter HTML inside the document body', () => {
        const doc = buildWordExportDocument('My Chapter', '<div>chapter html</div>');

        expect(doc).toContain('<body>');
        expect(doc).toContain('<div>chapter html</div>');
        expect(doc.indexOf('<body>')).toBeLessThan(doc.indexOf('<div>chapter html</div>'));
    });
});
