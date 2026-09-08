import { describe, expect, it } from 'vitest';
import { getFuzzyScore, normalizeSearchText } from '../../utils/search';

describe('normalizeSearchText', () => {
    it('lowercases text and strips all whitespace including full-width spaces', () => {
        expect(normalizeSearchText('  My Book　Title ')).toBe('mybooktitle');
    });
});

describe('getFuzzyScore', () => {
    it('returns null when the query is empty or whitespace-only', () => {
        expect(getFuzzyScore('anything', '')).toBeNull();
        expect(getFuzzyScore('anything', '   ')).toBeNull();
    });

    it('returns null when the target is empty or whitespace-only', () => {
        expect(getFuzzyScore('', 'abc')).toBeNull();
        expect(getFuzzyScore('   ', 'abc')).toBeNull();
    });

    it('returns 0 for a full exact match ignoring case and whitespace', () => {
        expect(getFuzzyScore('My Book', 'mybook')).toBe(0);
    });

    it('scores substring hits by position and trailing length', () => {
        // "chapter" hits "chapterone" at index 0 with 3 trailing chars: 0 + 3 * 0.01
        expect(getFuzzyScore('Chapter One', 'chapter')).toBeCloseTo(0.03, 5);
    });

    it('ranks earlier substring hits better than later ones', () => {
        const early = getFuzzyScore('chapter ab', 'chapter');
        const late = getFuzzyScore('ab chapter', 'chapter');
        expect(early).not.toBeNull();
        expect(late).not.toBeNull();
        expect(early!).toBeLessThan(late!);
    });

    it('scores non-contiguous matches above 100 using gap penalties', () => {
        // "ace" is not a substring of "abcde" but is a subsequence: 100 + 2 + 2 * 0.02
        expect(getFuzzyScore('abcde', 'ace')).toBeCloseTo(102.04, 5);
    });

    it('returns null when query characters are missing or out of order', () => {
        expect(getFuzzyScore('abc', 'xyz')).toBeNull();
        expect(getFuzzyScore('abc', 'cba')).toBeNull();
    });

    it('ranks substring hits better than subsequence-only hits', () => {
        const substring = getFuzzyScore('my story', 'story');
        const subsequence = getFuzzyScore('sXtXoXrXy', 'story');
        expect(substring).not.toBeNull();
        expect(subsequence).not.toBeNull();
        expect(substring!).toBeLessThan(subsequence!);
    });
});
