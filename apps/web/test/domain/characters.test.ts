import { describe, expect, it } from 'vitest';
import type { Character } from '../../types';
import {
    escapeRegex,
    getCharacterDisplayTerms,
    getCharacterMatchTerms,
    getValidNamedCharacters,
} from '../../domain/characters';

const character = (overrides: Partial<Character>): Character => ({
    id: 'c-1',
    bookId: 'b-1',
    name: 'Alice',
    aliases: [],
    role: 'supporting',
    description: '',
    color: '#000000',
    tags: [],
    ...overrides,
});

describe('escapeRegex', () => {
    it('escapes metacharacters so the pattern matches literally', () => {
        const pattern = new RegExp(`^${escapeRegex('a.b(c)[d]$')}$`);
        expect(pattern.test('a.b(c)[d]$')).toBe(true);
        expect(pattern.test('axb(c)[d]$')).toBe(false);
    });
});

describe('getValidNamedCharacters', () => {
    it('drops characters with blank or non-string names', () => {
        const cast = [
            character({ id: 'ok', name: 'Alice' }),
            character({ id: 'blank', name: '   ' }),
            character({ id: 'missing', name: undefined as unknown as string }),
        ];

        expect(getValidNamedCharacters(cast).map(c => c.id)).toEqual(['ok']);
    });

    it('tolerates a missing list', () => {
        expect(getValidNamedCharacters()).toEqual([]);
    });
});

describe('getCharacterMatchTerms', () => {
    it('produces terms for names and aliases pointing at their character', () => {
        const cast = [character({ id: 'c-1', name: 'Alice', aliases: ['Ali'] })];

        const terms = getCharacterMatchTerms(cast);

        expect(terms).toHaveLength(2);
        expect(terms.find(t => t.text === 'Alice')?.character.id).toBe('c-1');
        expect(terms.find(t => t.text === 'Ali')?.character.id).toBe('c-1');
    });

    it('sorts terms by text length descending so longer names match first', () => {
        const cast = [
            character({ id: 'short', name: 'Ann' }),
            character({ id: 'long', name: 'Anna Bella' }),
        ];

        expect(getCharacterMatchTerms(cast).map(t => t.text)).toEqual(['Anna Bella', 'Ann']);
    });

    it('never lets an alias override an existing name', () => {
        const cast = [
            character({ id: 'named', name: 'Ali' }),
            character({ id: 'aliased', name: 'Alice', aliases: ['Ali'] }),
        ];

        expect(getCharacterMatchTerms(cast).find(t => t.text === 'Ali')?.character.id).toBe('named');
    });

    it('lets the earlier character win when two aliases collide', () => {
        const cast = [
            character({ id: 'first', name: 'Alice', aliases: ['Al'] }),
            character({ id: 'second', name: 'Albert', aliases: ['Al'] }),
        ];

        expect(getCharacterMatchTerms(cast).find(t => t.text === 'Al')?.character.id).toBe('first');
    });

    it('skips blank names and aliases', () => {
        const cast = [character({ id: 'c-1', name: '  ', aliases: ['', '   '] })];

        expect(getCharacterMatchTerms(cast)).toEqual([]);
    });
});

describe('getCharacterDisplayTerms', () => {
    it('returns the trimmed name followed by trimmed aliases without blanks', () => {
        const c = character({ name: ' Alice ', aliases: [' Ali ', '', '   '] });

        expect(getCharacterDisplayTerms(c)).toEqual(['Alice', 'Ali']);
    });
});
