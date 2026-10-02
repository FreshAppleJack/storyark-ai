import { Editor, Node as TiptapNode } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { captureAiContinueAnchor, textBeforeAiContinueAnchor } from '../../../features/editor/utils/aiContinueAnchor';

let editor: Editor | null = null;

afterEach(() => {
    editor?.destroy();
    editor = null;
});

describe('AI Continue anchor snapshot', () => {
    it('maps ProseMirror UTF-16 positions to the chunker paragraph and Unicode offsets', () => {
        editor = new Editor({
            element: document.createElement('div'),
            extensions: [StarterKit],
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A😀B' }] }] },
        });
        editor.commands.setTextSelection(4);

        const anchor = captureAiContinueAnchor(editor);

        expect(anchor?.retrievalAnchor).toEqual({ paragraphOrdinal: 0, textOffset: 2 });
        expect(anchor && textBeforeAiContinueAnchor(editor!, anchor)).toBe('A😀');
    });

    it('uses the same retrieval block ordinal as Rust for nested blockquotes', () => {
        editor = new Editor({
            element: document.createElement('div'),
            extensions: [StarterKit],
            content: {
                type: 'doc',
                content: [{
                    type: 'blockquote',
                    content: [
                        { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
                        { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
                    ],
                }, { type: 'paragraph', content: [{ type: 'text', text: '丙' }] }],
            },
        });
        let cursorPosition = 0;
        editor.state.doc.descendants((node, position) => {
            if (node.type.name === 'paragraph' && node.textContent === '乙') cursorPosition = position + 2;
        });
        editor.commands.setTextSelection(cursorPosition);

        const anchor = captureAiContinueAnchor(editor);

        expect(anchor?.retrievalAnchor).toEqual({ paragraphOrdinal: 0, textOffset: 2 });
        expect(anchor && textBeforeAiContinueAnchor(editor!, anchor)).toContain('甲');
    });

    it('includes a character Mention label in the prompt prefix and retrieval offset', () => {
        const mention = TiptapNode.create({
            name: 'mention',
            inline: true,
            group: 'inline',
            atom: true,
            addAttributes: () => ({ id: { default: null }, label: { default: null } }),
            renderHTML: () => ['span', { class: 'mention' }],
        });
        editor = new Editor({
            element: document.createElement('div'),
            extensions: [StarterKit, mention],
            content: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [
                    { type: 'text', text: 'A' },
                    { type: 'mention', attrs: { id: 'character-id', label: 'Alice' } },
                    { type: 'text', text: 'B' },
                ] }],
            },
        });
        editor.commands.setTextSelection(3);

        const anchor = captureAiContinueAnchor(editor);

        expect(anchor?.retrievalAnchor).toEqual({ paragraphOrdinal: 0, textOffset: 6 });
        expect(anchor && textBeforeAiContinueAnchor(editor!, anchor)).toBe('AAlice');
    });
});
