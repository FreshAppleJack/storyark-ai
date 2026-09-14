import React from 'react';
import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import TiptapEditor, { TiptapEditorRef } from '../../components/TiptapEditor';
import type { Character } from '../../types';

// Keep character props stable so rerender exercises chapter/lock synchronization on the same editor.
const characters: Character[] = [];
const chapter = (text: string) => JSON.stringify({
  type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

// jsdom has no layout engine; ProseMirror still measures selections while processing input.
beforeAll(() => {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
});

afterAll(() => {
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
});

function focusAtEnd(surface: HTMLElement) {
  // Set a real DOM selection: user-event does not implement End for contenteditable elements.
  surface.focus();
  const range = document.createRange();
  range.selectNodeContents(surface);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function renderEditor() {
  const onUpdate = vi.fn<(content: string, wordCount: number) => void>();
  const props = { contentId: 'chapter-1', content: chapter('已有正文'), characters, onUpdate };
  const result = render(<TiptapEditor {...props} />);
  // Scope to the actual editable surface rather than toolbar text or a mocked editor.
  const surface = result.container.querySelector<HTMLElement>('.tiptap');
  if (!surface) throw new Error('Tiptap did not mount its editing surface');
  return { ...result, surface, props, onUpdate };
}

describe('TiptapEditor', () => {
  it('displays an existing saved chapter without reporting a user edit', () => {
    const { surface, onUpdate } = renderEditor();
    expect(surface).toHaveTextContent('已有正文');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('reports serialized content and a word count after user input', async () => {
    const user = userEvent.setup();
    const { surface, onUpdate } = renderEditor();
    focusAtEnd(surface);
    await user.keyboard(' hello');

    await waitFor(() => expect(surface).toHaveTextContent('已有正文 hello'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const [content, wordCount] = onUpdate.mock.lastCall!;
    expect(JSON.parse(content)).toMatchObject({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '已有正文 hello' }] }],
    });
    expect(wordCount).toBe(5);
  });

  it('serializes bold and italic marks from the mounted toolbar', async () => {
    const user = userEvent.setup();
    const ref = React.createRef<TiptapEditorRef>();
    const onUpdate = vi.fn();
    const result = render(<TiptapEditor ref={ref} contentId="chapter-1" content={chapter('已有正文')} characters={characters} onUpdate={onUpdate} />);
    const editor = ref.current!.editor!;
    const surface = result.container.querySelector<HTMLElement>('.tiptap');
    expect(surface?.style.fontSynthesis).toBe('weight style');

    editor.commands.selectAll();
    await user.click(within(result.container).getByTitle('Bold'));
    await user.click(within(result.container).getByTitle('Italic'));

    const textNode = editor.getJSON().content?.[0]?.content?.[0];
    expect(textNode?.marks).toEqual([{ type: 'bold' }, { type: 'italic' }]);
  });

  it('replaces the previous chapter on contentId change without emitting an edit', () => {
    const { surface, rerender, props, onUpdate } = renderEditor();
    rerender(<TiptapEditor {...props} contentId="chapter-2" content={chapter('第二章正文')} />);

    expect(surface).toBeInTheDocument();
    expect(surface).toHaveTextContent('第二章正文');
    expect(surface).not.toHaveTextContent('已有正文');
    expect(onUpdate).not.toHaveBeenCalled();
  });

    it('registers the underline extension exactly once (StarterKit already provides it)', () => {
    const ref = React.createRef<TiptapEditorRef>();
    const onUpdate = vi.fn();
    render(<TiptapEditor ref={ref} contentId="chapter-1" content={chapter('已有正文')} characters={characters} onUpdate={onUpdate} />);

    const editor = ref.current!.editor;
    const underlineExtensions = editor.extensionManager.extensions.filter((ext: { name: string }) => ext.name === 'underline');
    expect(underlineExtensions).toHaveLength(1);
        expect(editor.schema.marks.underline).toBeDefined();
    });

    it('inserts a candidate as structured content and keeps the edit undoable', () => {
        const ref = React.createRef<TiptapEditorRef>();
        const onUpdate = vi.fn();
        render(<TiptapEditor ref={ref} contentId="chapter-1" content={chapter('已有正文')} characters={characters} onUpdate={onUpdate} />);

        const anchor = ref.current!.captureSelection();
        expect(anchor).not.toBeNull();

        act(() => {
            expect(ref.current!.insertAiCandidateAtAnchor('<safe text>\nsecond line', anchor!)).toBe(true);
        });

        const editor = ref.current!.editor!;
        expect(editor.getText()).toContain('<safe text>');
        expect(editor.getText()).toContain('second line');
        expect(onUpdate).toHaveBeenCalledTimes(1);

        act(() => {
            editor.commands.undo();
        });
        expect(editor.getText()).toBe('已有正文');
    });

    it('applies the current font family and size to every generated paragraph', () => {
        const ref = React.createRef<TiptapEditorRef>();
        const onUpdate = vi.fn();
        render(<TiptapEditor ref={ref} contentId="chapter-1" content={chapter('已有正文')} characters={characters} onUpdate={onUpdate} />);

        const editor = ref.current!.editor!;
        editor.commands.selectAll();
        editor.commands.setFontFamily('Georgia');
        editor.commands.setFontSize('18px');
        editor.commands.setTextSelection(2);
        const anchor = ref.current!.captureSelection();
        expect(anchor).not.toBeNull();

        act(() => {
            expect(ref.current!.insertAiCandidateAtAnchor('first line\nsecond line', anchor!)).toBe(true);
        });

        const generatedNodes = editor.getJSON().content
            ?.filter(node => node.type === 'paragraph')
            .flatMap(node => node.content ?? [])
            .filter(node => node.text === '\u3000\u3000first line' || node.text === '\u3000\u3000second line');
        expect(generatedNodes).toHaveLength(2);
        generatedNodes?.forEach(node => {
            expect(node.marks).toContainEqual({
                type: 'textStyle',
                attrs: { fontFamily: 'Georgia', fontSize: '18px' },
            });
        });
    });

  it('blocks typing while read-only and accepts input again after unlocking', async () => {
    const user = userEvent.setup();
    const { surface, rerender, props, onUpdate } = renderEditor();
    rerender(<TiptapEditor {...props} isEditable={false} />);
    expect(surface).toHaveAttribute('contenteditable', 'false');
    onUpdate.mockClear();
    focusAtEnd(surface);
    await user.keyboard(' blocked');
    expect(surface).toHaveTextContent(/^已有正文$/);
    expect(onUpdate).not.toHaveBeenCalled();

    rerender(<TiptapEditor {...props} isEditable />);
    expect(surface).toHaveAttribute('contenteditable', 'true');
    onUpdate.mockClear();
    focusAtEnd(surface);
    await user.keyboard(' allowed');
    await waitFor(() => expect(surface).toHaveTextContent('已有正文 allowed'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });
});
