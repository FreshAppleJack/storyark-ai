import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Node as PMNode, Slice } from '@tiptap/pm/model';

/**
 * Makes pasted text adopt the font family/size active at the cursor.
 *
 * Runs on the ProseMirror slice, after transformPastedHtml has cleaned
 * the raw HTML: strips any textStyle/fontFamily marks coming from the
 * clipboard, then applies the cursor's current textStyle attributes to
 * every pasted text node. All other marks (bold, foreshadowing, ...) and
 * the node structure (paragraphs, headings, mentions) are preserved.
 */
export const PasteAutoFormat = Extension.create({
    name: 'pasteAutoFormat',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                props: {
                    transformPasted: (slice: Slice, view) => {
                        const editor = this.editor;
                        if (!editor) return slice;

                        const currentAttrs = editor.getAttributes('textStyle');
                        const currentFontFamily = currentAttrs.fontFamily;
                        const currentFontSize = currentAttrs.fontSize;
                        const { schema } = view.state;

                        const mapFragment = (fragment: Fragment): Fragment => {
                            const newNodes: PMNode[] = [];
                            fragment.forEach((node) => {
                                if (node.isText) {
                                    const newMarks = node.marks.filter(
                                        m => m.type.name !== 'textStyle' && m.type.name !== 'fontFamily'
                                    );
                                    const textStyleAttrs: Record<string, unknown> = {};
                                    if (currentFontFamily) textStyleAttrs.fontFamily = currentFontFamily;
                                    if (currentFontSize) textStyleAttrs.fontSize = currentFontSize;
                                    if (Object.keys(textStyleAttrs).length > 0 && schema.marks.textStyle) {
                                        const newMark = schema.marks.textStyle.create(textStyleAttrs);
                                        newMarks.push(newMark);
                                    }
                                    newNodes.push(node.mark(newMarks));
                                } else {
                                    if (node.content.size > 0) {
                                        newNodes.push(node.copy(mapFragment(node.content)));
                                    } else {
                                        newNodes.push(node);
                                    }
                                }
                            });
                            return Fragment.fromArray(newNodes);
                        };
                        return new Slice(mapFragment(slice.content), slice.openStart, slice.openEnd);
                    },
                },
            }),
        ];
    },
});
