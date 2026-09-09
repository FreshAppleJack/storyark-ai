import { describe, expect, it } from 'vitest';
import { getEditorPlainText, getForeshadowingExcerptMap } from '../../domain/chapterContent';

const docA = JSON.stringify({
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [
                { type: 'text', text: 'seed ', marks: [{ type: 'foreshadowing', attrs: { id: 'f1' } }] },
                { type: 'text', text: 'plain' },
            ],
        },
        {
            type: 'paragraph',
            content: [
                { type: 'mention', attrs: { id: 'c1', label: 'Alice' }, marks: [{ type: 'foreshadowing', attrs: { id: 'f1' } }] },
            ],
        },
    ],
});

const docB = JSON.stringify({
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [
                { type: 'text', text: 'a', marks: [{ type: 'foreshadowing', attrs: { id: 'f2' } }] },
                { type: 'hardBreak', marks: [{ type: 'foreshadowing', attrs: { id: 'f2' } }] },
                { type: 'text', text: 'b', marks: [{ type: 'foreshadowing', attrs: { id: 'f2' } }] },
            ],
        },
    ],
});

const longText = 'x'.repeat(150);
const docC = JSON.stringify({
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [
                { type: 'text', text: longText, marks: [{ type: 'foreshadowing', attrs: { id: 'f3' } }] },
            ],
        },
    ],
});

describe('getForeshadowingExcerptMap', () => {
    it('collects marked text and joins blocks with a single space', () => {
        const map = getForeshadowingExcerptMap(docA, 120);

        expect(map.get('f1')).toBe('seed Alice');
    });

    it('uses the mention label as excerpt text', () => {
        const map = getForeshadowingExcerptMap(docA, 120);

        expect(map.get('f1')).toContain('Alice');
    });

    it('treats a hard break as a space', () => {
        const map = getForeshadowingExcerptMap(docB, 120);

        expect(map.get('f2')).toBe('a b');
    });

    it('truncates excerpts beyond the caller-provided maxLength', () => {
        const map = getForeshadowingExcerptMap(docC, 120);

        expect(map.get('f3')).toBe(`${'x'.repeat(120)}...`);
    });

    it('keeps longer excerpts when the caller allows a larger maxLength', () => {
        const map = getForeshadowingExcerptMap(docC, 220);

        expect(map.get('f3')).toBe(longText);
    });

    it('ignores foreshadowing marks without an id', () => {
        const doc = JSON.stringify({
            type: 'doc',
            content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'foreshadowing', attrs: {} }] }] },
            ],
        });

        expect(getForeshadowingExcerptMap(doc, 120).size).toBe(0);
    });

    it('returns an empty map for invalid JSON', () => {
        expect(getForeshadowingExcerptMap('not json {', 120).size).toBe(0);
    });
});

describe('getEditorPlainText', () => {
    it('flattens text and mentions, collapsing block newlines', () => {
        expect(getEditorPlainText(docA)).toBe('seed plain Alice');
    });

    it('treats hard breaks as whitespace', () => {
        expect(getEditorPlainText(docB)).toBe('a b');
    });

    it('falls back to stripping HTML tags for non-JSON content', () => {
        expect(getEditorPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });
});
