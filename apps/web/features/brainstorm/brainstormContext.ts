import type { Book, Chapter, Character, StoryPlanning, BrainstormOption } from '../../types';
import { extractContentSignals, getEditorPlainText } from '../../domain/chapterContent';
import { escapeRegex, getCharacterMatchTerms } from '../../domain/characters';
import { assessChapterSummaryFreshness, createCurrentAllowedSourceVersions } from '../../domain/chapterSummarySource';

export interface BrainstormRelationship {
    /** Display names are resolved only when the context snapshot is built. */
    source: string;
    target: string;
    /** Node instance identities are retained so duplicate character nodes stay distinct. */
    sourceNodeKey: string;
    targetNodeKey: string;
    sourceCharacterId: string;
    targetCharacterId: string;
    label: string;
}

export interface BrainstormSourceVersions {
    bookId: string;
    workspaceBookId: string;
    workspaceDatabaseVersion: number;
    planningBookId: string;
    planningDatabaseVersion: number;
    graphBookId: string;
    graphDatabaseVersion: number;
}

export interface ChapterOption {
    id: string;
    title: string;
    volumeTitle: string;
    summary: string;
    content: string;
    databaseVersion?: number;
    summaryStatus?: 'current' | 'stale' | 'missing';
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
    const summaryMap = new Map(planning.chapterSummaries.map(item => [item.chapterId, item]));
    const currentAllowedSourceVersions = createCurrentAllowedSourceVersions({
        bookId: book.id,
        planningDatabaseVersion: planning.databaseVersion,
        characters: book.characters,
        chapters: book.volumes.flatMap(volume => volume.chapters),
    });
    return book.volumes.flatMap(volume => (
        volume.chapters.map((chapter: Chapter) => {
            const summary = summaryMap.get(chapter.id);
            const freshness = assessChapterSummaryFreshness(summary, chapter, currentAllowedSourceVersions);
            const summaryStatus = freshness.status === 'missing' ? 'missing'
                : freshness.status === 'current' ? 'current' : 'stale';
            return {
                id: chapter.id,
                title: chapter.title,
                volumeTitle: volume.title,
                summary: summaryStatus === 'current' ? summary?.summary || '' : '',
                content: chapter.content || '',
                databaseVersion: chapter.databaseVersion,
                summaryStatus,
            };
        })
    ));
}
// Minimal structural shape so both the legacy API DTO and the local graph
// snapshot can feed the panel without mapping.
interface BrainstormGraphSource {
    nodes?: Array<{ id?: unknown; nodeKey?: unknown; characterId?: unknown }>;
    edges?: Array<{
        sourceNodeKey?: unknown;
        targetNodeKey?: unknown;
        sourceCharId?: unknown;
        targetCharId?: unknown;
        label?: unknown;
    }>;
}
export const buildRelationships = (graphData: BrainstormGraphSource | null, characters: Character[]) => {
    const characterByNodeKey = new Map<string, string>();
    const validCharacterIds = new Set(characters.map(character => character.id));

    (graphData?.nodes || []).forEach((node) => {
        const nodeKey = String(node.nodeKey ?? node.id ?? '');
        const characterId = String(node.characterId ?? '');
        if (nodeKey && validCharacterIds.has(characterId)) {
            characterByNodeKey.set(nodeKey, characterId);
        }
    });

    return (graphData?.edges || [])
        .map((edge) => {
            const sourceKey = String(edge.sourceNodeKey ?? edge.sourceCharId ?? '');
            const targetKey = String(edge.targetNodeKey ?? edge.targetCharId ?? '');
            const sourceCharacterId = characterByNodeKey.get(sourceKey) || String(edge.sourceCharId ?? '');
            const targetCharacterId = characterByNodeKey.get(targetKey) || String(edge.targetCharId ?? '');
            return {
                source: sourceCharacterId,
                target: targetCharacterId,
                sourceNodeKey: sourceKey,
                targetNodeKey: targetKey,
                sourceCharacterId,
                targetCharacterId,
                label: typeof edge.label === 'string' ? edge.label : '',
            };
        })
        .filter((edge: BrainstormRelationship) => (
            edge.sourceNodeKey && edge.targetNodeKey
            && validCharacterIds.has(edge.sourceCharacterId)
            && validCharacterIds.has(edge.targetCharacterId)
        ));
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

export function boundedChapterText(content: string, maxChars: number): string {
    const text = getEditorPlainText(content);
    const characters = Array.from(text);
    if (characters.length <= maxChars) return text;
    return `...${characters.slice(-maxChars).join('')}`;
}

export function validateBrainstormSources(
    book: Book,
    planning: StoryPlanning,
    selectedChapters: ChapterOption[],
    relationships: BrainstormRelationship[],
    source?: BrainstormSourceVersions,
): string | null {
    if (source) {
        if (source.bookId !== book.id || source.workspaceBookId !== book.id || source.planningBookId !== book.id || source.graphBookId !== book.id) {
            return 'The selected brainstorm sources belong to a different book.';
        }
        if (!Number.isSafeInteger(source.workspaceDatabaseVersion) || source.workspaceDatabaseVersion < 0
            || !Number.isSafeInteger(source.planningDatabaseVersion) || source.planningDatabaseVersion < 0
            || !Number.isSafeInteger(source.graphDatabaseVersion) || source.graphDatabaseVersion < 0) {
            return 'The local brainstorm source versions are invalid. Reload the book and try again.';
        }
    }

    const chapterIds = new Set(book.volumes.flatMap(volume => volume.chapters.map(chapter => chapter.id)));
    if (selectedChapters.some(chapter => !chapterIds.has(chapter.id))) {
        return 'A selected chapter no longer belongs to this book. Reload the brainstorm context.';
    }
    if (source && selectedChapters.some(chapter => !Number.isSafeInteger(chapter.databaseVersion) || (chapter.databaseVersion ?? 0) < 1)) {
        return 'A selected chapter has no stable version. Reload the local book before generating.';
    }
    if (planning.chapterSummaries.some(summary => !chapterIds.has(summary.chapterId))) {
        return 'The planning data references a chapter from another book.';
    }
    const characterIds = new Set(book.characters.filter(character => character.bookId === book.id).map(character => character.id));
    if (book.characters.some(character => character.bookId !== book.id)) {
        return 'The character context contains a character from another book.';
    }
    if (relationships.some(relationship => (
        !relationship.sourceNodeKey || !relationship.targetNodeKey
        || !characterIds.has(relationship.sourceCharacterId)
        || !characterIds.has(relationship.targetCharacterId)
    ))) {
        return 'The relationship context contains an invalid node instance.';
    }
    return null;
}

export function buildContextSnapshot(book: Book, planning: StoryPlanning, selectedChapters: ChapterOption[],
    mentionedCharacters: Character[], relationships: BrainstormRelationship[], source?: BrainstormSourceVersions) {
    const missingSummaryChapters = selectedChapters.filter(chapter => !chapter.summary.trim());
    const characterNameById = new Map((book.characters).map(character => [character.id, character.name]));
    const selectedCharacterIds = new Set(mentionedCharacters.map(character => character.id));
    const relatedRelationships = relationships.filter(item => (
        selectedCharacterIds.has(item.sourceCharacterId) && selectedCharacterIds.has(item.targetCharacterId)
    ));

    return {
        bookId: book.id,
        bookTitle: book.title,
        storySummary: planning.storySummary,
        storyBackground: planning.storyBackground,
        sourceVersions: source ? {
            bookId: source.bookId,
            workspaceDatabaseVersion: source.workspaceDatabaseVersion,
            planningDatabaseVersion: source.planningDatabaseVersion,
            graphDatabaseVersion: source.graphDatabaseVersion,
        } : undefined,
        selectedChapters: selectedChapters.map(chapter => ({
            id: chapter.id,
            title: chapter.title,
            volumeTitle: chapter.volumeTitle,
            summary: chapter.summary,
            databaseVersion: chapter.databaseVersion,
            summarySource: chapter.summaryStatus === 'stale'
                ? 'stale-planning-summary'
                : chapter.summary.trim() ? 'stored-planning-summary' : 'missing',
            boundedChapterText: chapter.summary.trim() ? undefined : boundedChapterText(chapter.content, 2000),
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
            source: characterNameById.get(item.sourceCharacterId) || item.sourceCharacterId,
            target: characterNameById.get(item.targetCharacterId) || item.targetCharacterId,
            sourceNodeKey: item.sourceNodeKey,
            targetNodeKey: item.targetNodeKey,
            sourceCharacterId: item.sourceCharacterId,
            targetCharacterId: item.targetCharacterId,
            label: item.label,
        })),
        outputGoal: 'Give three moderately detailed alternative next-plot directions with conflict hook, character motivation, potential consequences, and an editable development plan.',
    }
}
