import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomFontFamily, FontSize, TabIndent } from '../../../features/editor/extensions';

const editors: Editor[] = [];

function createEditor(content = '<p>Existing text</p>') {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, TextStyle, CustomFontFamily, FontSize, TabIndent],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    const element = editor.options.element;
    editor.destroy();
    if (element instanceof HTMLElement) element.remove();
  }
});

describe('formatting extensions', () => {
  it('sets and unsets font size without removing the font family', () => {
    const editor = createEditor();
    editor.commands.selectAll();
    expect(editor.commands.setFontFamily('Georgia')).toBe(true);
    expect(editor.commands.setFontSize('18px')).toBe(true);
    expect(editor.getJSON().content?.[0].content?.[0].marks).toContainEqual({
      type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18px' },
    });
    expect(editor.commands.unsetFontSize()).toBe(true);
    expect(editor.getAttributes('textStyle')).toMatchObject({ fontFamily: 'Georgia', fontSize: null });
    expect(editor.getText()).toBe('Existing text');
  });

  it('sets and unsets font family without removing the font size', () => {
    const editor = createEditor();
    editor.commands.selectAll();
    editor.commands.setFontSize('24px');
    expect(editor.commands.setFontFamily('Georgia')).toBe(true);
    expect(editor.getAttributes('textStyle')).toMatchObject({ fontFamily: 'Georgia', fontSize: '24px' });
    expect(editor.commands.unsetFontFamily()).toBe(true);
    expect(editor.getAttributes('textStyle')).toMatchObject({ fontFamily: null, fontSize: '24px' });
    expect(editor.getText()).toBe('Existing text');
  });

  it('preserves existing font styles through HTML and JSON round trips', () => {
    const editor = createEditor('<p><span style="font-family: Georgia; font-size: 18px">Saved text</span></p>');
    const expectedMarks = [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSize: '18px' } }];
    expect(editor.getJSON().content?.[0].content?.[0].marks).toEqual(expectedMarks);
    const html = editor.getHTML();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('span')?.style.fontFamily).toBe('Georgia');
    expect(parsed.querySelector('span')?.style.fontSize).toBe('18px');
    const restored = createEditor(html);
    expect(restored.getJSON()).toEqual(editor.getJSON());
    restored.commands.setContent(editor.getJSON());
    expect(restored.getJSON()).toEqual(editor.getJSON());
  });

  it('inserts exactly two full-width spaces at the caret when Tab is pressed', () => {
    const editor = createEditor('<p>AB</p>');
    editor.commands.setTextSelection(2);
    // Dispatch through the real EditorView so this protects shortcut registration, not just insertion.
    const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getText()).toBe('A\u3000\u3000B');
    expect(editor.state.selection.from).toBe(4);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe('AB');
  });
});
