import { describe, expect, it } from 'vitest';
import type { Book, Character, StoryPlanning } from '../../../types';
import {
    buildBrainstormGenerationContext,
    BRAINSTORM_PROMPT_VERSION,
} from '../../../features/brainstorm/brainstormGeneration';
import {
    getBrainstormChapters,
    type BrainstormRelationship,
    type BrainstormSourceVersions,
    type ChapterOption,
} from '../../../features/brainstorm/brainstormContext';

const book = {
    id: 'book-1',
    title: 'The Archive',
    characters: [
        { id: 'character-a', bookId: 'book-1', name: 'Ari', role: 'protagonist', tags: [], description: '' },
        { id: 'character-b', bookId: 'book-1', name: 'Bo', role: 'supporting', tags: [], description: '' },
    ],
    volumes: [{ id: 'volume-1', title: 'Volume One', chapters: [
        { id: 'chapter-1', title: 'The Door', databaseVersion: 7, content: '{"type":"doc","content":[]}' },
    ] }],
} as unknown as Book;

const planning = {
    storySummary: 'Ari searches an abandoned archive.',
    storyBackground: 'The city records memories as legal evidence.',
    chapterSummaries: [{ chapterId: 'chapter-1', summary: 'Ari finds a sealed door.', sourceChapterVersion: 7, updatedAt: 100 }],
    plotSettings: [{ id: 'plot-1', title: 'Open the door', details: 'The next chapter may reveal a witness.', chapterIds: ['chapter-1'], createdAt: 1, updatedAt: 2 }],
} as StoryPlanning;

const selectedChapters: ChapterOption[] = [{
    id: 'chapter-1', title: 'The Door', volumeTitle: 'Volume One', summary: 'Ari finds a sealed door.',
    content: '{"type":"doc","content":[]}', databaseVersion: 7,
}];
const characters = book.characters as Character[];
const relationships: BrainstormRelationship[] = [
    { source: 'character-a', target: 'character-b', sourceNodeKey: 'ari-before', targetNodeKey: 'bo-node', sourceCharacterId: 'character-a', targetCharacterId: 'character-b', label: 'Distrusts' },
    { source: 'character-a', target: 'character-b', sourceNodeKey: 'ari-after', targetNodeKey: 'bo-node', sourceCharacterId: 'character-a', targetCharacterId: 'character-b', label: 'Protects' },
];
const versions: BrainstormSourceVersions = {
    bookId: 'book-1', workspaceBookId: 'book-1', workspaceDatabaseVersion: 4,
    planningBookId: 'book-1', planningDatabaseVersion: 5,
    graphBookId: 'book-1', graphDatabaseVersion: 9,
};

describe('RAG Brainstorm context snapshot', () => {
    it('freezes selected source versions and keeps plans explicitly future-facing', () => {
        const context = buildBrainstormGenerationContext(book, planning, selectedChapters, characters, relationships, versions, 12);
        expect(context.target).toEqual({
            kind: 'brainstorm', workspaceDatabaseVersion: 4, planningDatabaseVersion: 5, graphDatabaseVersion: 9,
            sources: [{ chapterId: 'chapter-1', databaseVersion: 7 }],
        });
        expect(context.sections.find(section => section.kind === 'futurePlan')).toMatchObject({
            label: 'Existing plot plans', text: expect.stringContaining('The next chapter may reveal a witness.'),
        });
        expect(context.retrievalScope).toMatchObject({
            bookId: 'book-1', allowedChapterIds: ['chapter-1'], includeFuturePlan: false,
        });
        expect(context.sourceSnapshot.sourceVersions).toMatchObject({
            workspaceDatabaseVersion: 4, planningDatabaseVersion: 5, graphDatabaseVersion: 9,
        });
        expect(context.sourceSnapshot.relationships).toEqual([
            expect.objectContaining({ sourceNodeKey: 'ari-before', label: 'Distrusts' }),
            expect.objectContaining({ sourceNodeKey: 'ari-after', label: 'Protects' }),
        ]);
        expect(BRAINSTORM_PROMPT_VERSION).toBe('brainstorm-v2');
    });

    it('replaces an out-of-date chapter summary with bounded current manuscript text', () => {
        const currentText = '当前正文事实：林岚守住了档案门。';
        const versionedBook = {
            ...book,
            volumes: [{
                ...book.volumes[0],
                chapters: [{
                    ...book.volumes[0].chapters[0],
                    content: JSON.stringify({
                        type: 'doc',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: currentText }] }],
                    }),
                }],
            }],
        } as unknown as Book;
        const stalePlanning: StoryPlanning = {
            ...planning,
            chapterSummaries: [{
                chapterId: 'chapter-1',
                summary: '过期概括：地下室已经停电。',
                sourceChapterVersion: 6,
                updatedAt: 101,
            }],
        };
        const chapters = getBrainstormChapters(versionedBook, stalePlanning);
        expect(chapters[0]).toMatchObject({ summary: '', summaryStatus: 'stale' });
        const context = buildBrainstormGenerationContext(
            versionedBook,
            stalePlanning,
            chapters,
            characters,
            relationships,
            versions,
            13,
        );
        const selectedChapterSection = context.sections.find(section => section.label === 'Selected chapter source snapshot');
        expect(selectedChapterSection?.text).toContain(currentText);
        expect(selectedChapterSection?.text).not.toContain('地下室已经停电');
        expect(context.sourceSnapshot.selectedChapters).toMatchObject([{ summarySource: 'stale-planning-summary' }]);
    });
});
