import type { Character } from '../../types';
import { getFuzzyScore } from '../../utils/search';
export interface CharacterSearchResult { character: Character; score: number }
export function searchCharacters(characters: Character[], queryText: string): CharacterSearchResult[] {
    const query = queryText.trim();
    if (!query) return [];

    return characters
        .map((character) => {
            const fields = [
                { value: character.name, weight: 0 },
                { value: character.role, weight: 5 },
                { value: character.tags.join(' '), weight: 8 },
                { value: character.description, weight: 20 },
            ];
            const bestScore = fields.reduce<number | null>((best, field) => {
                const score = getFuzzyScore(field.value, query);
                if (score === null) return best;
                const weightedScore = score + field.weight;
                return best === null ? weightedScore : Math.min(best, weightedScore);
            }, null);

            return bestScore === null ? null : { character, score: bestScore };
        })
        .filter((result): result is CharacterSearchResult => Boolean(result))
        .sort((a, b) => a.score - b.score)
        .slice(0, 8);
}
