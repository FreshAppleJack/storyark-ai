import type { Character } from '../types';

/** A single text term (name or alias) that refers to a character. */
export interface CharacterMatchTerm {
    text: string;
    character: Character;
}

/** Escapes every regex metacharacter so the value can be embedded into a RegExp literally. */
export const escapeRegex = (value: string): string =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Keeps only characters whose name is a non-blank string. */
export const getValidNamedCharacters = (characters: Character[] = []): Character[] => {
    return characters.filter(character => typeof character.name === 'string' && character.name.trim().length > 0);
};

/**
 * Builds the match terms (names + aliases) for a cast of characters.
 *
 * Rules relied upon by both the editor highlight and the brainstorm context:
 * - every non-blank name becomes a term, then non-blank aliases are added;
 * - an existing term is never overwritten: names beat aliases, and on a
 *   collision between aliases the earlier character in the list wins;
 * - sorted by text length descending so regex alternation prefers the
 *   longest match when one term is a prefix of another.
 */
export const getCharacterMatchTerms = (characters: Character[]): CharacterMatchTerm[] => {
    const terms = new Map<string, Character>();

    characters.forEach(character => {
        const name = character.name.trim();
        if (name) terms.set(name, character);
    });

    characters.forEach(character => {
        (character.aliases || []).forEach(alias => {
            const trimmed = alias.trim();
            if (trimmed && !terms.has(trimmed)) {
                terms.set(trimmed, character);
            }
        });
    });

    return Array.from(terms.entries())
        .map(([text, character]) => ({ text, character }))
        .sort((a, b) => b.text.length - a.text.length);
};

/** Returns the character's display terms: trimmed name followed by trimmed aliases, blanks removed. */
export const getCharacterDisplayTerms = (character: Character): string[] => {
    return [character.name, ...(character.aliases || [])]
        .map(term => term.trim())
        .filter(Boolean);
};
