const INVISIBLE_TEXT = /[\u200B-\u200D\u2060\uFEFF]/g;
const ENGLISH_WORDS = /[a-zA-Z0-9]+(?:['’-][a-zA-Z0-9]+)*/g;
const CJK_UNITS = /[\p{Script=Han}\uff00-\uffef\u2000-\u206f\u3001-\u303f]/gu;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Preserve the writing convention: each Han character or full-width punctuation
 * counts once, while English words, contractions and hyphenated terms count once.
 * Whitespace separates words; invisible mention placeholders never add units.
 */
export const calculateMixedWordCount = (text: string): number => {
    if (!text) return 0;
    const cleanText = text.replace(INVISIBLE_TEXT, '').replace(/\s/g, ' ');
    const englishCount = cleanText.match(ENGLISH_WORDS)?.length ?? 0;
    // Remove complete English tokens first so a curly apostrophe stays inside
    // its contraction instead of also counting as Chinese punctuation.
    const cjkText = cleanText.replace(ENGLISH_WORDS, ' ');
    return englishCount + (cjkText.match(CJK_UNITS)?.length ?? 0);
};

/** Count visible graphemes, including punctuation, without whitespace. */
export const calculateCharacterCount = (text: string): number => {
    let count = 0;
    // Keep joiners inside emoji sequences; standalone invisible segments are ignored.
    for (const { segment } of graphemes.segment(text)) {
        if (segment.replace(INVISIBLE_TEXT, '').trim()) count += 1;
    }
    return count;
};
