import type { Book, Chapter, Character, StoryPlanning, BrainstormOption } from '../../types';
import { extractContentSignals } from '../../domain/chapterContent';
import { escapeRegex, getCharacterMatchTerms } from '../../domain/characters';
export interface BrainstormRelationship { source: string; target: string; label: string }
export interface ChapterOption {
    id: string;
    title: string;
    volumeTitle: string;
    summary: string;
    content: string;
    databaseVersion?: number;
}

export const getMentionedCharacterIds = (
    content: string,
    allCharacters: Character[],
    autoHighlightCharacters: Character[]
) => {
    const { ids, text } = extractContentSignals(content);

    getCharacterMatchTerms(autoHighlightCharacters).forEach(term => {
        const pattern = new RegExp(escapeRegex(term.text), 'g');
        if (pattern.test(text)) {
            ids.add(term.character.id);
        }
    });

    const validCharacterIds = new Set(allCharacters.map(character => character.id));
    Array.from(ids).forEach(id => {
        if (!validCharacterIds.has(id)) ids.delete(id);
    });

    return ids;
};

export const formatOptionAsEditableText = (option: BrainstormOption) => (
    `${option.title}\n\nConflict / Hook:\n${option.conflict}\n\nCharacter Motivation:\n${option.motivation}\n\nPotential Consequences:\n${option.consequences}\n\nDevelopment Plan:\n${option.development}`
);


export function getBrainstormChapters(book: Book | undefined, planning: StoryPlanning): ChapterOption[] {
    if (!book) return [];
    const summaryMap = new Map(planning.chapterSummaries.map(item => [item.chapterId, item.summary]));
    return book.volumes.flatMap(volume => (
        volume.chapters.map((chapter: Chapter) => ({
            id: chapter.id,
            title: chapter.title,
            volumeTitle: volume.title,
            summary: summaryMap.get(chapter.id) || '',
            content: chapter.content || '',
            databaseVersion: chapter.databaseVersion,
        }))
    ));
}
// Minimal structural shape so both the legacy API DTO and the local graph
// snapshot can feed the panel without mapping.
interface BrainstormGraphSource {
    nodes?: Array<{ id?: unknown; nodeKey?: unknown; characterId?: unknown }>;
    edges?: Array<{ sourceNodeKey?: unknown; targetNodeKey?: unknown; label?: unknown }>;
}
export const buildRelationships = (graphData: BrainstormGraphSource | null, characters: Character[]) => {
    const characterByNodeKey = new Map<string, string>();
    const validCharacterIds = new Set(characters.map(character => character.id));

    (graphData?.nodes || []).forEach((node) => {
        const nodeKey = String(node.nodeKey || node.id || '');
        const characterId = String(node.characterId || node.id || '');
        if (nodeKey && validCharacterIds.has(characterId)) {
            characterByNodeKey.set(nodeKey, characterId);
        }
    });

    return (graphData?.edges || [])
        .map((edge) => {
            const sourceKey = String(edge.sourceNodeKey || '');
            const targetKey = String(edge.targetNodeKey || '');
            return {
                source: characterByNodeKey.get(sourceKey) || sourceKey,
                target: characterByNodeKey.get(targetKey) || targetKey,
                label: typeof edge.label === 'string' ? edge.label : '',
            };
        })
        .filter((edge: { source: string; target: string }) => edge.source && edge.target);
};


/**
 * A saved snapshot is historical: it goes stale when a referenced chapter
 * advanced (its recorded databaseVersion is behind, or was never recorded)
 * or when the chapter summary text no longer matches current planning. Live
 * selections are separate from this snapshot and never marked stale.
 */
export function isContextSnapshotStale(snapshot: Record<string, unknown>, chapterOptions: ChapterOption[]): boolean {
    const saved = snapshot.selectedChapters;
    if (!Array.isArray(saved) || saved.length === 0) return false;
    const current = new Map(chapterOptions.map(option => [option.id, option]));
    return saved.some(entry => {
        if (!entry || typeof entry !== 'object') return true;
        const { id, databaseVersion, summary } = entry as { id?: unknown; databaseVersion?: unknown; summary?: unknown };
        if (typeof id !== 'string') return true;
        const chapter = current.get(id);
        if (!chapter) return false; // Deleted chapters are reported elsewhere.
        if (typeof databaseVersion !== 'number' || chapter.databaseVersion === undefined || databaseVersion !== chapter.databaseVersion) return true;
        return typeof summary === 'string' && summary !== chapter.summary;
    });
}

export function buildContextSnapshot(book: Book, planning: StoryPlanning, selectedChapters: ChapterOption[],
    mentionedCharacters: Character[], relationships: BrainstormRelationship[]) {
    const missingSummaryChapters = selectedChapters.filter(chapter => !chapter.summary.trim());
    const characterNameById = new Map((book.characters).map(character => [character.id, character.name]));
    const selectedCharacterIds = new Set(mentionedCharacters.map(character => character.id));
    const relatedRelationships = relationships.filter(item => (
        selectedCharacterIds.has(item.source) && selectedCharacterIds.has(item.target)
    ));

    return {
        bookTitle: book.title,
        storySummary: planning.storySummary,
        storyBackground: planning.storyBackground,
        selectedChapters: selectedChapters.map(chapter => ({
            id: chapter.id,
            title: chapter.title,
            volumeTitle: chapter.volumeTitle,
            summary: chapter.summary,
            databaseVersion: chapter.databaseVersion,
        })),
        missingSummaryChapterTitles: missingSummaryChapters.map(chapter => chapter.title),
        appearingCharacters: mentionedCharacters.map(character => ({
            id: character.id,
            name: character.name,
            role: character.role,
            tags: character.tags,
            biographyAndNotes: character.description,
        })),
        relationships: relatedRelationships.map(item => ({
            source: characterNameById.get(item.source) || item.source,
            target: characterNameById.get(item.target) || item.target,
            label: item.label,
        })),
        outputGoal: 'Give three moderately detailed alternative next-plot directions with conflict hook, character motivation, potential consequences, and an editable development plan.',
    }
}
