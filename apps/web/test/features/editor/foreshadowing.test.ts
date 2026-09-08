import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import { ForeshadowingMark } from '../../../features/editor/extensions/foreshadowing/ForeshadowingMark';

let editor: Editor | undefined;

function createEditor(content: string) {
    editor = new Editor({
        extensions: [StarterKit, ForeshadowingMark],
        content,
    });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

describe('ForeshadowingMark', () => {
    it('parses legacy saved chapters that store the mark as span[data-foreshadowing-id]', () => {
        const instance = createEditor('<p><span data-foreshadowing-id="fs-1">a planted clue</span></p>');

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{
                    marks: [{ type: 'foreshadowing', attrs: { id: 'fs-1' } }],
                    text: 'a planted clue',
                }],
            }],
        });
    });

    it('serializes the mark back to the legacy span format', () => {
        const instance = createEditor('<p><span data-foreshadowing-id="fs-1">a planted clue</span></p>');
        const html = instance.getHTML();

        expect(html).toContain('data-foreshadowing-id="fs-1"');
        expect(html).toContain('foreshadowing-mark');
    });

    it('can be applied through the generic setMark command', () => {
        const instance = createEditor('<p>some text</p>');
        instance.chain().setTextSelection({ from: 1, to: 5 }).setMark('foreshadowing', { id: 'fs-2' }).run();

        expect(instance.getHTML()).toContain('data-foreshadowing-id="fs-2"');
    });

    it('does not extend the mark when typing right after a marked passage', () => {
        const instance = createEditor('<p><span data-foreshadowing-id="fs-1">mark</span></p>');
        // Cursor right after the four marked characters, at the paragraph end.
        instance.commands.setTextSelection(5);
        instance.commands.insertContent('ed');

        const texts = instance.getJSON().content?.[0]?.content ?? [];
        expect(texts).toHaveLength(2);
        expect(texts[1]).toEqual({ type: 'text', text: 'ed' });
    });

    it('omits the data attribute when the mark has no id', () => {
        const instance = createEditor('<p>plain</p>');
        instance.chain().setTextSelection({ from: 1, to: 6 }).setMark('foreshadowing').run();

        expect(instance.getHTML()).not.toContain('data-foreshadowing-id');
    });
});
