import { parseJsonSafe } from '../utils/serialization';
import type { Character } from '../types';

export const normalizeCharacterName = (name: unknown, fallback = 'Unknown') => {
    return typeof name === 'string' && name.trim() ? name.trim() : fallback;
};

export const normalizeCharacterAliases = (aliases: unknown, primaryName?: string): string[] => {
    const rawAliases = Array.isArray(aliases) ? aliases : parseJsonSafe(aliases, []);
    if (!Array.isArray(rawAliases)) return [];

    const primary = typeof primaryName === 'string' ? primaryName.trim() : '';
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const alias of rawAliases) {
        if (typeof alias !== 'string') continue;
        const trimmed = alias.trim();
        if (!trimmed || trimmed === primary || seen.has(trimmed)) continue;
        seen.add(trimmed);
        normalized.push(trimmed);
        if (normalized.length >= 3) break;
    }

    return normalized;
};

export function normalizeCharacterPatch(data: Partial<Character>): Partial<Character> | null {
    const patch = { ...data };
    if (typeof patch.name === 'string') {
        patch.name = patch.name.trim();
        if (!patch.name) return null;
    }
    if (Array.isArray(patch.aliases)) {
        patch.aliases = normalizeCharacterAliases(patch.aliases, patch.name);
    }
    return patch;
}
