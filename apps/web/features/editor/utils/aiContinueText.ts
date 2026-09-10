/**
 * Formats raw AI continuation text for insertion into the editor: each
 * non-empty line becomes its own paragraph with a two-full-width-space
 * indent. Splitting per line keeps alignment operations per-paragraph
 * instead of one giant block (the previous <br/>-joining bug).
 */
export function formatAiContinueText(aiText: string): string {
    if (!aiText || !aiText.trim()) return '';
    const lines = aiText.split(/\r?\n/).filter((line) => line.trim() !== '');
    return lines.map((line) => `<p>\u3000\u3000${line.trim()}</p>`).join('');
}
