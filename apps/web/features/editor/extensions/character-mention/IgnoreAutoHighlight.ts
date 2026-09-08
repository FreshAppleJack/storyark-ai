import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Marks text that the user manually unhighlighted, preventing the
 * AutoHighlight extension from capturing it again.
 * `inclusive: false` keeps text typed right after the word unmarked.
 */
export const IgnoreAutoHighlight = Mark.create({
    name: 'ignoreAutoHighlight',
    inclusive: false,

    parseHTML() {
        return [{ tag: 'span[data-ignore-highlight]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes, { 'data-ignore-highlight': 'true' }), 0];
    },
});
