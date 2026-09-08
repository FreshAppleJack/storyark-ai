import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { Character } from '../../../types';
import { AutoHighlight, CustomMention, IgnoreAutoHighlight } from '../../../features/editor/extensions';

const alice: Character = {
    id: 'c-alice', bookId: 'b-1', name: 'Alice', aliases: ['Al'],
    role: 'protagonist', description: '', color: '#e11d48', tags: [],
};
const anna: Character = {
    id: 'c-anna', bookId: 'b-1', name: 'Anna Bella', aliases: [],
    role: 'supporting', description: '', color: '#3b82f6', tags: [],
};
const ann: Character = {
    id: 'c-ann', bookId: 'b-1', name: 'Ann', aliases: [],
    role: 'mob', description: '', color: '#64748b', tags: [],
};

let editor: Editor | undefined;

function createEditor(content: string | object, characters: Character[] = [alice]) {
    editor = new Editor({
        extensions: [
            StarterKit,
            CustomMention,
            IgnoreAutoHighlight,
            AutoHighlight.configure({ characters, allCharacters: characters }),
        ],
        content,
    });
    return editor;
}

function forceRefresh(instance: Editor) {
    instance.view.dispatch(instance.state.tr.setMeta('forceRefreshHighlights', true));
}

const mentionJson = (attrs: { id: string; label: string; color: string }) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }],
});

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

describe('AutoHighlight', () => {
    it('converts a character name into a mention node', () => {
        const instance = createEditor('<p>Alice</p>');
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{ type: 'mention', attrs: { id: 'c-alice', label: 'Alice', color: '#e11d48' } }],
            }],
        });
    });

    it('prefers the longest name when one name prefixes another', () => {
        const instance = createEditor('<p>Anna Bella</p>', [ann, anna]);
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{ type: 'mention', attrs: { id: 'c-anna', label: 'Anna Bella' } }],
            }],
        });
    });

    it('converts aliases and keeps the alias as the label', () => {
        const instance = createEditor('<p>Al</p>');
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{ type: 'mention', attrs: { id: 'c-alice', label: 'Al' } }],
            }],
        });
    });

    it('keeps the original marks on matched text', () => {
        const instance = createEditor('<p><strong>Alice</strong></p>');
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{ type: 'mention', marks: [{ type: 'bold' }] }],
            }],
        });
    });

    it('downgrades a mention to plain text when its character was deleted', () => {
        const instance = createEditor(mentionJson({ id: 'gone', label: 'Ghost', color: '#000000' }));
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{ content: [{ type: 'text', text: 'Ghost' }] }],
        });
        expect(instance.getHTML()).not.toContain('data-id');
    });

    it('updates label and color after the character was renamed', () => {
        const instance = createEditor(mentionJson({ id: 'c-alice', label: 'Old Name', color: '#000000' }));
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{ type: 'mention', attrs: { id: 'c-alice', label: 'Alice', color: '#e11d48' } }],
            }],
        });
    });

    it('leaves a mention alone while its label is still a valid display term', () => {
        const instance = createEditor(mentionJson({ id: 'c-alice', label: 'Al', color: '#e11d48' }));
        forceRefresh(instance);

        expect(instance.getJSON()).toMatchObject({
            content: [{
                content: [{ type: 'mention', attrs: { id: 'c-alice', label: 'Al', color: '#e11d48' } }],
            }],
        });
    });

    it('skips text carrying the ignoreAutoHighlight mark', () => {
        const instance = createEditor({
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: 'Alice', marks: [{ type: 'ignoreAutoHighlight' }] }],
            }],
        });
        forceRefresh(instance);

        expect(instance.getHTML()).not.toContain('data-id');
    });
});

describe('IgnoreAutoHighlight', () => {
    it('parses legacy content and does not extend to newly typed text', () => {
        const instance = createEditor('<p><span data-ignore-highlight>skip</span></p>');
        instance.commands.setTextSelection(5);
        instance.commands.insertContent('x');

        const texts = instance.getJSON().content?.[0]?.content ?? [];
        expect(texts).toHaveLength(2);
        expect(texts[0]).toMatchObject({ text: 'skip', marks: [{ type: 'ignoreAutoHighlight' }] });
        expect(texts[1]).toEqual({ type: 'text', text: 'x' });
    });
});

describe('CustomMention', () => {
    it('round-trips mention attributes and marks through HTML without auto-highlighting', () => {
        editor = new Editor({
            extensions: [StarterKit, CustomMention],
            content: {
                type: 'doc',
                content: [{
                    type: 'paragraph',
                    content: [{
                        type: 'mention',
                        attrs: { id: 'c-alice', label: 'Al', color: '#e11d48' },
                        marks: [{ type: 'bold' }],
                    }],
                }],
            },
        });
        const original = editor.getJSON();
        const html = editor.getHTML();

        editor.commands.setContent(html);

        expect(editor.getJSON()).toEqual(original);
        expect(html).toContain('data-type="mention"');
    });

    it('serializes id, label and color as data attributes with the label text', () => {
        const instance = createEditor(mentionJson({ id: 'c-alice', label: 'Alice', color: '#e11d48' }));
        const html = instance.getHTML();

        expect(html).toContain('data-id="c-alice"');
        expect(html).toContain('data-label="Alice"');
        expect(html).toContain('data-color="#e11d48"');
        expect(html).toContain('>Alice</span>');
    });

    it('renders the label as plain text', () => {
        const instance = createEditor(mentionJson({ id: 'c-alice', label: 'Al', color: '#e11d48' }));

        expect(instance.getText()).toBe('Al');
    });
});
