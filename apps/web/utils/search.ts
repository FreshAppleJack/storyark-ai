/**
 * Normalizes search text: lowercases and strips all whitespace
 * (including full-width spaces), so "My Book" matches "mybook".
 */
export const normalizeSearchText = (value: string): string =>
    value.toLowerCase().replace(/\s+/g, '');

/**
 * Fuzzy match scoring: lower score means a better match; null means no match.
 *
 * - Substring hit: hit index + trailing length * 0.01
 * - Non-contiguous hit: 100 + gap penalty + trailing length * 0.02
 *
 * Returns null when the normalized query or target is empty.
 * Search fields, result limits, and click behavior belong to each caller;
 * this module only provides scoring.
 */
export const getFuzzyScore = (value: string, query: string): number | null => {
    const target = normalizeSearchText(value);
    const needle = normalizeSearchText(query);
    if (!needle || !target) return null;

    const exactIndex = target.indexOf(needle);
    if (exactIndex >= 0) {
        return exactIndex + Math.max(0, target.length - needle.length) * 0.01;
    }

    let targetIndex = 0;
    let gapPenalty = 0;
    for (const char of needle) {
        const foundIndex = target.indexOf(char, targetIndex);
        if (foundIndex === -1) return null;
        gapPenalty += foundIndex - targetIndex;
        targetIndex = foundIndex + 1;
    }

    return 100 + gapPenalty + Math.max(0, target.length - needle.length) * 0.02;
};
