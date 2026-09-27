export interface SearchPreview {
    text: string;
    highlightStart: number;
    highlightLength: number;
    chunkTextOffset: number;
    focusTextLength: number;
}

export type SearchHitFocusAnchor = Pick<SearchPreview, 'chunkTextOffset' | 'focusTextLength'>;

export const SEARCH_PREVIEW_MAX_CHARACTERS = 120;

interface QueryAnchor {
    offset: number;
    length: number;
}

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function codePointOffsetMap(value: string): Map<number, number> {
    const offsets = new Map<number, number>();
    let utf16Offset = 0;
    let codePointOffset = 0;
    for (const character of value) {
        offsets.set(utf16Offset, codePointOffset);
        utf16Offset += character.length;
        codePointOffset += 1;
    }
    offsets.set(utf16Offset, codePointOffset);
    return offsets;
}

function occurrences(text: string, token: string, codePointOffsets: Map<number, number>): number[] {
    const offsets: number[] = [];
    let from = 0;
    while (from <= text.length - token.length) {
        const foundAt = text.indexOf(token, from);
        if (foundAt < 0) break;
        offsets.push(codePointOffsets.get(foundAt) ?? 0);
        const nextCharacter = text.codePointAt(foundAt);
        from = foundAt + (nextCharacter === undefined ? 1 : String.fromCodePoint(nextCharacter).length);
    }
    return offsets;
}

function queryTokens(query: string): string[] {
    const runs = query.toLocaleLowerCase().match(/[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [];
    const tokens = new Set<string>();
    for (const run of runs) {
        const characters = Array.from(run);
        if (!characters.some(character => CJK_CHARACTER.test(character))) {
            tokens.add(run);
            continue;
        }
        if (characters.length <= 12) tokens.add(run);
        if (characters.length === 1) tokens.add(run);
        for (let index = 0; index + 1 < characters.length; index += 1) {
            tokens.add(characters.slice(index, index + 2).join(''));
        }
    }
    const candidates = [...tokens].filter(token => token.length > 0);
    if (candidates.length <= 32) return candidates;
    return Array.from({ length: 32 }, (_, index) => candidates[Math.round(index * (candidates.length - 1) / 31)]);
}

function nearestDistance(positions: number[], target: number): number {
    let low = 0;
    let high = positions.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (positions[middle] < target) low = middle + 1;
        else high = middle;
    }
    const before = low > 0 ? Math.abs(positions[low - 1] - target) : Number.POSITIVE_INFINITY;
    const after = low < positions.length ? Math.abs(positions[low] - target) : Number.POSITIVE_INFINITY;
    return Math.min(before, after);
}

function findQueryAnchor(sourceText: string, query: string, windowSize: number): QueryAnchor | null {
    const trimmedQuery = query.trim().toLocaleLowerCase();
    if (!trimmedQuery) return null;

    const foldedSource = sourceText.toLocaleLowerCase();
    const foldedOffsets = codePointOffsetMap(foldedSource);
    const exactOffset = foldedSource.indexOf(trimmedQuery);
    if (exactOffset >= 0) {
        return {
            offset: foldedOffsets.get(exactOffset) ?? 0,
            length: Array.from(trimmedQuery).length,
        };
    }

    const tokens = queryTokens(trimmedQuery).map(token => ({
        token,
        length: Array.from(token).length,
        positions: occurrences(foldedSource, token, foldedOffsets),
    })).filter(candidate => candidate.positions.length > 0);
    const candidates = tokens.flatMap(candidate => candidate.positions.map(offset => ({
        offset,
        length: candidate.length,
    })));
    if (candidates.length === 0) return null;

    const radius = Math.max(24, Math.floor(windowSize * 0.7));
    let best = candidates[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of candidates) {
        let score = 0;
        for (const token of tokens) {
            const distance = nearestDistance(token.positions, candidate.offset);
            if (distance <= radius) {
                const rarity = 1 / Math.log2(token.positions.length + 2);
                score += Math.min(token.length, 12) * rarity * (1 - distance / (radius + 1));
            }
        }
        if (score > bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

/** Builds a compact excerpt around the closest cluster of literal query terms in a retrieved chunk. */
export function buildSearchPreview(
    sourceText: string,
    query: string,
    maxCharacters = SEARCH_PREVIEW_MAX_CHARACTERS,
): SearchPreview {
    const characters = Array.from(sourceText);
    if (characters.length === 0) {
        return { text: '', highlightStart: 0, highlightLength: 0, chunkTextOffset: 0, focusTextLength: 0 };
    }

    const limit = Math.max(1, Math.floor(maxCharacters));
    const anchor = findQueryAnchor(sourceText, query, limit);
    const chunkTextOffset = anchor?.offset ?? Math.floor(characters.length / 2);
    const focusTextLength = anchor
        ? Math.min(32, anchor.length)
        : Math.min(24, characters.length - chunkTextOffset);
    const visibleAnchorLength = anchor ? Math.min(focusTextLength, anchor.length) : 0;
    const center = chunkTextOffset + (visibleAnchorLength > 0 ? visibleAnchorLength / 2 : 0);
    const start = Math.max(0, Math.min(characters.length - limit, Math.floor(center - limit / 2)));
    const end = Math.min(characters.length, start + limit);
    const snippet = characters.slice(start, end).join('');
    const prefix = start > 0 ? '…' : '';
    const suffix = end < characters.length ? '…' : '';
    const highlightStart = anchor
        ? prefix.length + Math.max(0, chunkTextOffset - start)
        : 0;
    const highlightLength = anchor
        ? Math.max(0, Math.min(end, chunkTextOffset + visibleAnchorLength) - Math.max(start, chunkTextOffset))
        : 0;

    return {
        text: `${prefix}${snippet}${suffix}`,
        highlightStart,
        highlightLength,
        chunkTextOffset,
        focusTextLength,
    };
}

/** Renders the preview with a subtle highlight on the literal term used as the body-location anchor. */
export function splitPreviewHighlight(preview: SearchPreview): { before: string; match: string; after: string } | null {
    if (preview.highlightLength <= 0) return null;
    const characters = Array.from(preview.text);
    const start = Math.min(characters.length, preview.highlightStart);
    const end = Math.min(characters.length, start + preview.highlightLength);
    return {
        before: characters.slice(0, start).join(''),
        match: characters.slice(start, end).join(''),
        after: characters.slice(end).join(''),
    };
}
