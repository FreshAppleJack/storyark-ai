import { describe, expect, it } from 'vitest';
import { mapBooks, mapRelations, toChapterPayload, toGraphPayload, toPlanningPayload } from '../../data/mappers';
import { normalizeStoryPlanning } from '../../domain/storyPlanning';

describe('API data conversion', () => {
    it('normalizes nested IDs and legacy fields without changing the response', () => {
        const response = [{ id: 1, title: 'Book', status: 2, volumes: [{ id: 2, title: 'Volume', chapters: [
            { id: 3, title: 'Chapter', isEditable: false, foreshadowings: 'null' },
        ] }], characters: [{ id: 4, name: ' Alice ', aliases: '["Alice"," A ","A","B","C","D"]', tags: 'one，two three', handleConfig: '{bad' }] }];
        const snapshot = structuredClone(response);
        const [book] = mapBooks(response, 'Author', 100);
        expect(book).toMatchObject({ id: '1', author: 'Author', lastModified: 100, status: 'completed' });
        expect(book.volumes[0]).toMatchObject({ id: '2', chapters: [{ id: '3', content: '', wordCount: 0, status: 'draft', isEditable: false, foreshadowings: [] }] });
        expect(book.characters[0]).toMatchObject({ id: '4', bookId: '1', name: 'Alice', aliases: ['A', 'B', 'C'], tags: ['one', 'two', 'three'], handleConfig: null });
        expect(response).toEqual(snapshot);
    });

    it('normalizes planning deterministically and serializes structured write fields once', () => {
        const value = { chapterSummaries: '[{"chapterId":3,"summary":"Note"},null]', plotSettings: [{ id: 7, chapterIds: [3] }] };
        const planning = normalizeStoryPlanning(value, 100);
        expect(normalizeStoryPlanning(value, 100)).toEqual(planning);
        expect(planning.chapterSummaries).toEqual([{ chapterId: '3', summary: 'Note', updatedAt: 100 }]);
        expect(planning.plotSettings[0]).toMatchObject({ id: '7', chapterIds: ['3'], createdAt: 100, updatedAt: 100 });
        expect(JSON.parse(toPlanningPayload(planning).plotSettings)).toEqual(planning.plotSettings);
        expect(normalizeStoryPlanning({ chapterSummaries: '{bad', plotSettings: 'null' }, 100).plotSettings).toEqual([]);
        const chapter = { title: 'Chapter', content: 'Body', wordCount: 1, status: 'draft' as const, isEditable: false, foreshadowings: [] };
        expect(toChapterPayload('2', chapter)).toEqual({ ...chapter, volumeId: 2, foreshadowings: '[]' });
    });

    it('preserves graph instance keys and supports legacy character relationships', () => {
        expect(mapRelations([
            { id: 1, sourceNodeKey: '4-copy', targetNodeKey: '5-copy', sourceCharId: 4, targetCharId: 5, label: 'friend' },
            { id: 2, sourceCharId: 4, targetCharId: 5, label: 'rival' },
        ])).toEqual([
            { id: '1', sourceCharId: '4-copy', targetCharId: '5-copy', label: 'friend' },
            { id: '2', sourceCharId: '4', targetCharId: '5', label: 'rival' },
        ]);
        expect(toGraphPayload([{ id: '4-copy', position: { x: 10, y: 20 }, data: { id: '4' } }], [
            { id: 'edge', source: '4-copy', target: '5-copy', sourceHandle: 'right', targetHandle: 'left', label: 'friend' },
        ])).toMatchObject({ nodes: [{ id: '4-copy', characterId: 4, x: 10, y: 20 }], edges: [{ source: '4-copy', target: '5-copy', sourceHandle: 'right', targetHandle: 'left' }] });
    });
});
