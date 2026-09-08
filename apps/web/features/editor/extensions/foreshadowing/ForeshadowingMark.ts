import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * Marks text passages that plant a story foreshadowing.
 *
 * Contract relied upon by the editor page and the foreshadowing feature:
 * - mark name 'foreshadowing' with an `id` attribute;
 * - legacy saved chapters store it as `<span data-foreshadowing-id="...">`,
 *   so parsing must keep working for previously saved content;
 * - `inclusive: false` keeps newly typed text right after a marked
 *   passage unmarked.
 */
export const ForeshadowingMark = Mark.create({
    name: 'foreshadowing',
    inclusive: false,

    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: element => element.getAttribute('data-foreshadowing-id'),
                renderHTML: attributes => {
                    if (!attributes.id) return {};
                    return { 'data-foreshadowing-id': attributes.id };
                },
            },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-foreshadowing-id]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                class: 'foreshadowing-mark',
                style: 'text-decoration-line: underline; text-decoration-style: dashed; text-decoration-color: #94a3b8; text-underline-offset: 4px; cursor: pointer;',
            }),
            0,
        ];
    },
});
