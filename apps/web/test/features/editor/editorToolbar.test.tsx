import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CustomFontFamily, FontSize } from '../../../features/editor/extensions';
import { EditorToolbar } from '../../../features/editor/components/EditorToolbar';
import { EditorContextMenu } from '../../../features/editor/components/EditorContextMenu';

let editor: Editor | undefined;

function createEditor(content: string = '<p>hello</p>') {
    editor = new Editor({
        extensions: [StarterKit, TextStyle, CustomFontFamily, FontSize],
        content,
    });
    return editor;
}

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

describe('EditorToolbar', () => {
    it('renders nothing without an editor', () => {
        const { container } = render(<EditorToolbar editor={null} isEditable={true} />);

        expect(container).toBeEmptyDOMElement();
    });

    it('toggles bold on the current selection', async () => {
        const user = userEvent.setup();
        const instance = createEditor();
        render(<EditorToolbar editor={instance} isEditable={true} />);

        await user.click(screen.getByTitle('Bold'));

        expect(instance.isActive('bold')).toBe(true);
    });

    it('disables undo when there is no history', () => {
        const instance = createEditor();
        render(<EditorToolbar editor={instance} isEditable={true} />);

        expect(screen.getByTitle('Undo')).toBeDisabled();
    });

    it('applies the chosen font size through the dropdown', () => {
        const instance = createEditor();
        render(<EditorToolbar editor={instance} isEditable={true} />);

        fireEvent.change(screen.getByDisplayValue('Large (20px)'), { target: { value: '18px' } });

        expect(instance.getAttributes('textStyle').fontSize).toBe('18px');
    });

    it('delegates the lock button to onToggleReadOnly', async () => {
        const user = userEvent.setup();
        const onToggleReadOnly = vi.fn();
        const instance = createEditor();
        render(<EditorToolbar editor={instance} isEditable={false} onToggleReadOnly={onToggleReadOnly} />);

        await user.click(screen.getByTitle('Lock (view only)'));

        expect(onToggleReadOnly).toHaveBeenCalledTimes(1);
    });

    it('falls back to toggling editor editable state without a handler', async () => {
        const user = userEvent.setup();
        const instance = createEditor();
        render(<EditorToolbar editor={instance} isEditable={true} />);

        await user.click(screen.getByTitle('Unlock (Editable)'));

        expect(instance.isEditable).toBe(false);
    });
});

describe('EditorContextMenu', () => {
    it('renders nothing when the menu is closed', () => {
        const { container } = render(
            <EditorContextMenu menu={null} onUnmark={vi.fn()} onAddForeshadowing={vi.fn()} />,
        );

        expect(container).toBeEmptyDOMElement();
    });

    it('offers Unmark for mentions', async () => {
        const user = userEvent.setup();
        const onUnmark = vi.fn();
        render(
            <EditorContextMenu menu={{ type: 'mention', x: 10, y: 20 }} onUnmark={onUnmark} onAddForeshadowing={vi.fn()} />,
        );

        await user.click(screen.getByText('Unmark'));

        expect(onUnmark).toHaveBeenCalledTimes(1);
    });

    it('offers Add Foreshadowing for selections', async () => {
        const user = userEvent.setup();
        const onAddForeshadowing = vi.fn();
        render(
            <EditorContextMenu menu={{ type: 'selection', x: 10, y: 20 }} onUnmark={vi.fn()} onAddForeshadowing={onAddForeshadowing} />,
        );

        await user.click(screen.getByText('Add Foreshadowing'));

        expect(onAddForeshadowing).toHaveBeenCalledTimes(1);
    });
});
