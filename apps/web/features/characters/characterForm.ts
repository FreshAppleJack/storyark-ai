import type { Character } from '../../types';
import { normalizeCharacterAliases } from '../../domain/characterInput';
export const COLORS = [
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Amber', value: '#f59e0b' },
    { name: 'Green', value: '#10b981' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Slate', value: '#64748b' },
];

export const getCharacterDisplayName = (name?: string) => {
    const trimmedName = name?.trim();
    return trimmedName || 'Unnamed';
};

/**
 * Clamp a display name to a fixed width: ASCII letters count 1, every other
 * character counts 2 (so 12 means "twelve English letters' width"). Overflow
 * is marked with a trailing ellipsis; the full name stays available via the
 * element title at the call site.
 */
export const truncateCharacterName = (name: string, maxWidth = 12) => {
    let width = 0;
    let end = 0;
    for (const char of name) {
        width += char.charCodeAt(0) < 128 ? 1 : 2;
        if (width > maxWidth) break;
        end += char.length;
    }
    return end < name.length ? `${name.slice(0, end)}...` : name;
};

const toAliasInputs = (aliases?: string[]) => {
    const values = Array.isArray(aliases) ? aliases.slice(0, 3) : [];
    return [...values, '', '', ''].slice(0, 3);
};


export interface CharacterFormData {
    name: string; role: Character['role']; description: string; color: string;
    tags: string; aliases: string[];
}
export const emptyCharacterForm = (): CharacterFormData => ({
    name: '', role: 'supporting', description: '', color: '#3b82f6', tags: '', aliases: ['', '', ''],
});
export const toCharacterForm = (character: Character): CharacterFormData => ({
    name: character.name || '', role: character.role, description: character.description,
    color: character.color, tags: character.tags.join(' '), aliases: toAliasInputs(character.aliases),
});
export function toCharacterPatch(form: CharacterFormData): Partial<Character> | null {
    const name = form.name.trim();
    if (!name) return null;
    return {
        ...form, name, description: form.description.trim(),
        tags: form.tags.split(' ').map(tag => tag.trim()).filter(Boolean),
        aliases: normalizeCharacterAliases(form.aliases, name)
    };
}
