import { mergeAttributes } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';

/**
 * Character mention node.
 *
 * Contract relied upon by the editor page and the foreshadowing/brainstorm
 * features:
 * - node name 'mention';
 * - attributes id/label/color serialized as data-id, data-label, data-color;
 * - renders the label text (falling back to the id);
 * - `marks: '_'` allows marks (bold, foreshadowing, ...) on the mention.
 */
export const CustomMention = Mention.extend({
    name: 'mention',
    marks: '_', // Allow Mention node to apply marks (underline etc)

    renderText({ node }) {
        return `${node.attrs.label ?? node.attrs.id}`;
    },

    addAttributes() {
        return {
            ...this.parent?.(),
            id: {
                default: null,
                parseHTML: element => element.getAttribute('data-id'),
                renderHTML: attributes => {
                    if (!attributes.id) return {};
                    return { 'data-id': attributes.id };
                },
            },
            label: {
                default: null,
                parseHTML: element => element.getAttribute('data-label'),
                renderHTML: attributes => {
                    if (!attributes.label) return {};
                    return { 'data-label': attributes.label };
                },
            },
            color: {
                default: null,
                parseHTML: element => element.getAttribute('data-color'),
                renderHTML: attributes => {
                    if (!attributes.color) return {};
                    return {
                        'data-color': attributes.color,
                        style: `color: ${attributes.color}; font-weight: bold; background: rgba(0,0,0,0.03); padding: 0 2px; border-radius: 2px; box-decoration-break: clone; -webkit-box-decoration-break: clone;`,
                    };
                },
            },
        };
    },

    renderHTML({ node, HTMLAttributes }) {
        return [
            'span',
            mergeAttributes({ 'data-type': this.name }, this.options.HTMLAttributes, HTMLAttributes),
            `${node.attrs.label ?? node.attrs.id}`,
        ];
    },
});
