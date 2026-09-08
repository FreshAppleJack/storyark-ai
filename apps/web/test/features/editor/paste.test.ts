import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CustomFontFamily, FontSize, PasteAutoFormat, transformPastedHtml } from '../../../features/editor/extensions';

// jsdom does not implement ClipboardEvent, but EditorView.pasteHTML builds one.
// A minimal Event subclass is enough because the paste pipeline only needs
// the event object to exist; the HTML payload is passed separately.
beforeAll(() => {
    if (typeof globalThis.ClipboardEvent === 'undefined') {
        class ClipboardEventPolyfill extends Event {
            clipboardData: unknown;
            constructor(type: string, init?: { clipboardData?: unknown }) {
                super(type);
                this.clipboardData = init?.clipboardData ?? null;
            }
        }
        (globalThis as Record<string, unknown>).ClipboardEvent = ClipboardEventPolyfill;
    }
});

let editor: Editor | undefined;

function createEditor(content: string) {
    editor = new Editor({
        extensions: [StarterKit, TextStyle, CustomFontFamily, FontSize, PasteAutoFormat],
        content,
    });
    return editor;
}

interface JsonNode {
    type?: string;
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    content?: JsonNode[];
}

function collectTextNodes(node: JsonNode, out: JsonNode[] = []): JsonNode[] {
    if (node.type === 'text') out.push(node);
    node.content?.forEach(child => collectTextNodes(child, out));
    return out;
}

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

describe('transformPastedHtml', () => {
    it('converts a non-zero text-indent into two leading full-width spaces', () => {
        expect(transformPastedHtml('<p style="text-indent: 2em">Hello</p>')).toBe('<p>　　Hello</p>');
    });

    it('ignores zero text-indent but still strips the style attribute', () => {
        expect(transformPastedHtml('<p style="text-indent: 0">Hello</p>')).toBe('<p>Hello</p>');
        expect(transformPastedHtml('<p style="text-indent: 0px">Hello</p>')).toBe('<p>Hello</p>');
    });

    it('does not double-indent text that already starts with a full-width space', () => {
        expect(transformPastedHtml('<p style="text-indent: 2em">　Hello</p>')).toBe('<p>　Hello</p>');
    });

    it('removes inline styles from all elements', () => {
        expect(transformPastedHtml('<p style="color: red">a<span style="font-weight: bold">b</span></p>'))
            .toBe('<p>a<span>b</span></p>');
    });

    it('indents headings and divs the same way as paragraphs', () => {
        expect(transformPastedHtml('<h2 style="text-indent: 24px">T</h2>')).toBe('<h2>　　T</h2>');
        expect(transformPastedHtml('<div style="text-indent: 2em">D</div>')).toBe('<div>　　D</div>');
    });

    it('keeps unrelated content untouched', () => {
        expect(transformPastedHtml('<p>one</p><p>two</p>')).toBe('<p>one</p><p>two</p>');
    });
});

describe('PasteAutoFormat', () => {
    it('makes pasted plain text adopt the font size and family at the cursor', () => {
        const instance = createEditor('<p><span style="font-family: Arial; font-size: 18px">ab</span></p>');
        instance.commands.setTextSelection(2);
        instance.view.pasteHTML('<p>xy</p>');

        // Once the pasted text carries the same textStyle mark as its
        // neighbours, ProseMirror joins adjacent text into a single node.
        const merged = collectTextNodes(instance.getJSON()).find(n => n.text === 'axyb');
        expect(merged?.marks).toEqual([
            { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '18px' } },
        ]);
    });

    it('replaces the clipboard’s own font styles with the current ones', () => {
        const instance = createEditor('<p><span style="font-family: Arial; font-size: 18px">ab</span></p>');
        instance.commands.setTextSelection(2);
        instance.view.pasteHTML('<p><span style="font-size: 30px">xy</span></p>');

        const merged = collectTextNodes(instance.getJSON()).find(n => n.text === 'axyb');
        expect(merged?.marks).toEqual([
            { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '18px' } },
        ]);
        expect(instance.getHTML()).not.toContain('30px');
    });

    it('keeps non-textStyle marks like bold while applying the current font', () => {
        const instance = createEditor('<p><span style="font-family: Arial; font-size: 18px">ab</span></p>');
        instance.commands.setTextSelection(2);
        instance.view.pasteHTML('<p><strong>xy</strong></p>');

        const pasted = collectTextNodes(instance.getJSON()).find(n => n.text === 'xy');
        expect(pasted?.marks).toEqual(expect.arrayContaining([
            { type: 'bold' },
            { type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '18px' } },
        ]));
    });

    it('strips pasted font styles when no font is active at the cursor', () => {
        const instance = createEditor('<p>ab</p>');
        instance.commands.setTextSelection(2);
        instance.view.pasteHTML('<p><span style="font-size: 30px">xy</span></p>');

        const pasted = collectTextNodes(instance.getJSON()).find(n => n.text === 'xy');
        expect(pasted?.marks ?? []).toEqual([]);
    });

    it('keeps the paragraph structure of multi-block pastes', () => {
        const instance = createEditor('<p>ab</p>');
        instance.commands.setTextSelection(2);
        instance.view.pasteHTML('<p>xy</p><p>zz</p>');

        // Tiptap v3 getText() defaults to a double-newline block separator.
        expect(instance.getText({ blockSeparator: '\n' })).toBe('axy\nzzb');
    });
});
