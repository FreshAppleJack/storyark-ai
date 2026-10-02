import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { AiContinueAnchor } from '../types/aiContinue';

const RETRIEVAL_BLOCK_TYPES = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock']);

interface RetrievalBlockPosition {
    node: ProseMirrorNode;
    start: number;
    ordinal: number;
}

function retrievalBlocks(doc: ProseMirrorNode): RetrievalBlockPosition[] {
    const blocks: RetrievalBlockPosition[] = [];
    const visit = (node: ProseMirrorNode, start: number) => {
        if (RETRIEVAL_BLOCK_TYPES.has(node.type.name)) {
            blocks.push({ node, start, ordinal: blocks.length });
            // This intentionally matches the Rust chunker: a blockquote is a
            // single retrieval block even when it contains nested paragraphs.
            return;
        }
        node.forEach((child, offset) => visit(child, start + 1 + offset));
    };
    visit(doc, -1);
    return blocks;
}

function textOffsetBefore(node: ProseMirrorNode, nodeStart: number, position: number): number {
    let text = '';
    const visit = (parent: ProseMirrorNode, contentStart: number) => {
        parent.forEach((child, offset) => {
            const childStart = contentStart + offset;
            if (child.isText) {
                const includedUtf16Units = Math.max(0, Math.min(child.nodeSize, position - childStart));
                if (includedUtf16Units > 0) text += child.text?.slice(0, includedUtf16Units) ?? '';
            } else if (child.type.name === 'mention') {
                if (position >= childStart + child.nodeSize) {
                    const label = child.attrs.label || child.attrs.id;
                    if (typeof label === 'string') text += label;
                }
            } else if (child.type.name === 'hardBreak') {
                if (position >= childStart + child.nodeSize) text += '\n';
            } else if (child.content.size > 0) {
                visit(child, childStart + 1);
            }
        });
    };
    visit(node, nodeStart + 1);
    // The indexed locator uses Unicode scalar offsets, whereas ProseMirror
    // positions count UTF-16 code units.
    return Array.from(text).length;
}

export function captureAiContinueAnchor(editor: Editor): AiContinueAnchor | null {
    if (editor.isDestroyed) return null;
    const { selection, doc } = editor.state;
    const blocks = retrievalBlocks(doc);
    const containing = blocks.find(block => (
        selection.from >= block.start + 1
        && selection.from <= block.start + block.node.nodeSize - 1
    ));
    const preceding = [...blocks].reverse().find(block => block.start + block.node.nodeSize - 1 < selection.from);
    const target = containing ?? preceding ?? blocks[0];
    if (!target) return null;
    const position = containing
        ? selection.from
        : preceding
            ? target.start + target.node.nodeSize - 1
            : target.start + 1;

    return {
        from: selection.from,
        to: selection.to,
        docSize: doc.content.size,
        selectedText: doc.textBetween(selection.from, selection.to, '\n', '\n'),
        retrievalAnchor: {
            paragraphOrdinal: target.ordinal,
            textOffset: textOffsetBefore(target.node, target.start, position),
        },
    };
}

export function textBeforeAiContinueAnchor(editor: Editor, anchor: AiContinueAnchor): string {
    if (editor.isDestroyed || editor.state.doc.content.size !== anchor.docSize) return '';
    return editor.state.doc.textBetween(0, anchor.from, '\n', node => {
        if (node.type.name === 'mention') {
            const label = node.attrs.label || node.attrs.id;
            return typeof label === 'string' ? label : '';
        }
        return '\n';
    });
}
