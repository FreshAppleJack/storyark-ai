import type { Book, Character, StoryPlanning } from '../../types';
import type {
    ContextSection,
    GenerationTarget,
} from '../../data/local/aiGenerationRepository';
import {
    buildContextSnapshot,
    validateBrainstormSources,
    type BrainstormRelationship,
    type BrainstormSourceVersions,
    type ChapterOption,
} from './brainstormContext';

export const BRAINSTORM_PROMPT_VERSION = 'brainstorm-v1';
export const BRAINSTORM_CONTEXT_MAX_CHARS = 60_000;
export const BRAINSTORM_OUTPUT_CHARS = 12_000;

export interface BrainstormGenerationContext {
    target: GenerationTarget;
    sections: ContextSection[];
    maxChars: number;
    outputChars: number;
    draftRevision: number;
    sourceFingerprint: string;
    sourceSnapshot: Record<string, unknown>;
}

function boundedText(value: string, maxChars: number): string {
    const characters = Array.from(value || '');
    return characters.length <= maxChars ? value : `${characters.slice(0, maxChars).join('')}\n[bounded]`;
}

function jsonSection(value: unknown, maxChars: number): string {
    return boundedText(JSON.stringify(value), maxChars);
}

function sourceVersions(source: BrainstormSourceVersions, selectedChapters: ChapterOption[]) {
    return selectedChapters.map(chapter => ({
        chapterId: chapter.id,
        databaseVersion: chapter.databaseVersion as number,
    }));
}

export function buildBrainstormGenerationContext(
    book: Book,
    planning: StoryPlanning,
    selectedChapters: ChapterOption[],
    mentionedCharacters: Character[],
    relationships: BrainstormRelationship[],
    source: BrainstormSourceVersions,
    draftRevision: number,
): BrainstormGenerationContext {
    const sourceError = validateBrainstormSources(book, planning, selectedChapters, relationships, source);
    if (sourceError) throw new Error(sourceError);

    const target: GenerationTarget = {
        kind: 'brainstorm',
        workspaceDatabaseVersion: source.workspaceDatabaseVersion,
        planningDatabaseVersion: source.planningDatabaseVersion,
        graphDatabaseVersion: source.graphDatabaseVersion,
        sources: sourceVersions(source, selectedChapters),
    };
    const sourceSnapshot = buildContextSnapshot(
        book,
        planning,
        selectedChapters,
        mentionedCharacters,
        relationships,
        source,
    );
    const sections: ContextSection[] = [
        {
            kind: 'authorSetting',
            label: 'Story overview and background',
            text: boundedText(`${planning.storySummary}\n\n${planning.storyBackground}`.trim(), 8_000),
        },
        {
            kind: 'writtenFact',
            label: 'Selected chapter source snapshot',
            text: jsonSection(sourceSnapshot.selectedChapters, 18_000),
        },
        {
            kind: 'writtenFact',
            label: 'Appearing character context',
            text: jsonSection(sourceSnapshot.appearingCharacters, 9_000),
        },
        {
            kind: 'writtenFact',
            label: 'Relationship node instances',
            text: jsonSection(sourceSnapshot.relationships, 6_000),
        },
        {
            kind: 'futurePlan',
            label: 'Existing plot plans',
            text: jsonSection(planning.plotSettings, 7_000),
        },
    ];

    const fingerprint = JSON.stringify({ bookId: book.id, draftRevision, target, sourceSnapshot });
    return {
        target,
        sections,
        maxChars: BRAINSTORM_CONTEXT_MAX_CHARS,
        outputChars: BRAINSTORM_OUTPUT_CHARS,
        draftRevision,
        sourceFingerprint: fingerprint,
        sourceSnapshot,
    };
}
