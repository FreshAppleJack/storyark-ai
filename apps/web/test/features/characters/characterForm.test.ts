import { describe, expect, it } from 'vitest';
import { truncateCharacterName } from '../../../features/characters/characterForm';

describe('truncateCharacterName', () => {
    it('keeps names within twelve English-letter widths untouched', () => {
        expect(truncateCharacterName('Alice')).toBe('Alice');
        expect(truncateCharacterName('ABCDEFGHIJKL')).toBe('ABCDEFGHIJKL');
        expect(truncateCharacterName('')).toBe('');
    });

    it('truncates long ASCII names with an ellipsis', () => {
        expect(truncateCharacterName('ABCDEFGHIJKLM')).toBe('ABCDEFGHIJKL...');
        expect(truncateCharacterName('New Character and asdf wfsedfewf')).toBe('New Characte...');
    });

    it('counts non-ASCII characters as double width', () => {
        expect(truncateCharacterName('林晚晚')).toBe('林晚晚');
        expect(truncateCharacterName('林晚晚晚晚晚晚')).toBe('林晚晚晚晚晚...');
        expect(truncateCharacterName('林晚abcdef')).toBe('林晚abcdef');
        expect(truncateCharacterName('林晚abcdefgh')).toBe('林晚abcdefgh');
        expect(truncateCharacterName('林晚abcdefghi')).toBe('林晚abcdefgh...');
    });

    it('handles mixed content and astral characters without splitting them', () => {
        expect(truncateCharacterName('ab林cd')).toBe('ab林cd');
        expect(truncateCharacterName('ab林cd😀😀😀😀')).toBe('ab林cd😀😀😀...');
    });

    it('respects a custom width', () => {
        expect(truncateCharacterName('Alice', 3)).toBe('Ali...');
        expect(truncateCharacterName('Al', 3)).toBe('Al');
    });
});
