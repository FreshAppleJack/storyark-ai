const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, div';
const ZERO_TEXT_INDENT_PATTERN = /text-indent:\s*0(pt|px|cm|in|em)?\s*(;|$)/;

/**
 * Sanitizes pasted HTML before ProseMirror parses it into a slice.
 *
 * Two jobs, in order:
 * 1. Block elements with a non-zero `text-indent` get two leading
 *    full-width spaces (the project's CJK paragraph-indent convention),
 *    unless their text already starts with a full-width space.
 * 2. Every inline `style` attribute is removed so foreign formatting
 *    does not leak into saved chapters.
 */
export const transformPastedHtml = (html: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    doc.body.querySelectorAll(BLOCK_SELECTOR).forEach(node => {
        const style = node.getAttribute('style') || '';
        if (style.includes('text-indent') && !style.match(ZERO_TEXT_INDENT_PATTERN)) {
            if (node.textContent && !node.textContent.startsWith('　')) {
                node.innerHTML = '　　' + node.innerHTML;
            }
        }
    });
    doc.body.querySelectorAll('[style]').forEach(node => {
        node.removeAttribute('style');
    });
    return doc.body.innerHTML;
};
