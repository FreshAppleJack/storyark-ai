import { Extension } from '@tiptap/core';

export const TabIndent = Extension.create({
    name: 'TabIndent',
    addKeyboardShortcuts() {
        return {
            'Tab': () => {
                this.editor.commands.insertContent('\u3000\u3000');
                return true;
            },
        };
    },
});
