import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { Character } from '../../../../types';

/**
 * Downgrades every mention node in the document to plain text.
 *
 * Used right after injecting chapter content (chapter switch or props
 * sync): the injected JSON may carry stale mention attributes, so all
 * mentions are flattened and AutoHighlight re-creates the valid ones
 * from the resulting plain text. Text falls back to label -> current
 * character name -> id.
 */
export const forceDowngradeMentions = (targetEditor: Editor, currentCharacters: Character[]) => {
    if (!targetEditor || !currentCharacters || currentCharacters.length === 0) return;
    let modified = false;
    const { tr } = targetEditor.state;
    const nodesToDowngrade: { pos: number, node: Node }[] = [];

    targetEditor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'mention') nodesToDowngrade.push({ pos, node });
    });

    if (nodesToDowngrade.length === 0) return;

    for (let i = nodesToDowngrade.length - 1; i >= 0; i--) {
        const { pos, node } = nodesToDowngrade[i];
        const charId = node.attrs.id;
        const updatedChar = currentCharacters.find((c: Character) => c.id === charId);
        const text = node.attrs.label || (updatedChar ? updatedChar.name : node.attrs.id);
        const textNode = targetEditor.state.schema.text(text, node.marks);
        tr.replaceWith(pos, pos + node.nodeSize, textNode);
        modified = true;
    }

    if (modified) targetEditor.view.dispatch(tr);
};
