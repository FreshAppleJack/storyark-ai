import { createRef } from 'react';
import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import TiptapEditor, { type TiptapEditorRef } from '../../../components/TiptapEditor';

it('clears cross-chapter undo history without emitting replacement content as a draft', async () => {
    const ref = createRef<TiptapEditorRef>();
    const onUpdate = vi.fn();
    const view = render(<TiptapEditor ref={ref} contentId="one" content="<p>First</p>" onUpdate={onUpdate} />);
    await act(async () => {});
    const editor = ref.current!.editor!;
    act(() => { editor.commands.insertContent(' edit'); });
    expect(editor.can().undo()).toBe(true);
    onUpdate.mockClear();
    view.rerender(<TiptapEditor ref={ref} contentId="two" content="<p>Second</p>" onUpdate={onUpdate} />);
    await act(async () => {});
    expect(editor.getText()).toBe('Second');
    expect(editor.can().undo()).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
    act(() => { editor.commands.insertContent(' new'); });
    act(() => { editor.commands.undo(); });
    expect(editor.getText()).toBe('Second');
});
