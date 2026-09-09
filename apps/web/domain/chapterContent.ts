/**
 * Pure helpers that traverse serialized Tiptap JSON chapter content.
 * Shared by the editor page and the foreshadowing board page.
 */

interface TiptapMarkJson {
    type?: string;
    attrs?: Record<string, unknown>;
}

interface TiptapNodeJson {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    marks?: TiptapMarkJson[];
    content?: TiptapNodeJson[];
}

const getForeshadowingIds = (node: TiptapNodeJson): string[] => {
    const marks = node?.marks;
    if (!Array.isArray(marks)) return [];
    return marks
        .filter((mark) => mark.type === 'foreshadowing' && mark.attrs?.id)
        .map((mark) => mark.attrs?.id as string);
};

/**
 * Builds foreshadowingId -> excerpt text from serialized chapter content.
 * Text sharing a foreshadowing mark is concatenated in document order with a
 * space between block nodes, whitespace-normalized, then truncated to
 * `maxLength` (the caller decides: 120 in the editor panel, 220 on the board).
 */
export function getForeshadowingExcerptMap(content: string, maxLength: number): Map<string, string> {
    const excerpts = new Map<string, string[]>();

    const appendText = (id: string, text: string) => {
        if (!text) return;
        const existing = excerpts.get(id) || [];
        existing.push(text);
        excerpts.set(id, existing);
    };

    const visit = (node: TiptapNodeJson) => {
        const foreshadowingIds = getForeshadowingIds(node);
        if (foreshadowingIds.length > 0) {
            const text = node.type === 'mention'
                ? ((node.attrs?.label as string) || (node.attrs?.id as string) || '')
                : node.type === 'text'
                    ? (node.text || '')
                    : node.type === 'hardBreak'
                        ? ' '
                        : '';
            foreshadowingIds.forEach(id => appendText(id, text));
        }

        if (Array.isArray(node.content)) {
            node.content.forEach(visit);
            if (['paragraph', 'heading', 'blockquote'].includes(node.type || '')) {
                const idsInBlock = new Set<string>();
                const collectIds = (child: TiptapNodeJson) => {
                    getForeshadowingIds(child).forEach((id: string) => idsInBlock.add(id));
                    if (Array.isArray(child.content)) child.content.forEach(collectIds);
                };
                node.content.forEach(collectIds);
                idsInBlock.forEach(id => appendText(id, ' '));
            }
        }
    };

    try {
        const parsed = JSON.parse(content);
        visit(parsed);
    } catch {
        return new Map<string, string>();
    }

    const normalized = new Map<string, string>();
    excerpts.forEach((parts, id) => {
        const text = parts.join('').replace(/[\s\u3000]+/g, ' ').trim();
        if (text) {
            normalized.set(id, text.length > maxLength ? `${text.slice(0, maxLength)}...` : text);
        }
    });
    return normalized;
};

/**
 * Flattens serialized chapter content into plain text (mentions become their
 * label, hard breaks and block nodes become newlines). Falls back to stripping
 * HTML tags when the content is not valid JSON.
 */
export function getEditorPlainText(content: string): string {
    const visit = (node: TiptapNodeJson): string => {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (node.type === 'mention') return (node.attrs?.label as string) || (node.attrs?.id as string) || '';
        if (node.type === 'hardBreak') return '\n';
        if (!Array.isArray(node.content)) return '';
        const text = node.content.map(visit).join('');
        return ['paragraph', 'heading', 'blockquote'].includes(node.type || '') ? `${text}\n` : text;
    };

    try {
        return visit(JSON.parse(content)).replace(/[\s\u3000]+/g, ' ').trim();
    } catch {
        return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
};
