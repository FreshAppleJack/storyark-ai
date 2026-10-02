import { describe, expect, it } from 'vitest';
import type { Character } from '../../../types';
import { filterEdgesForHandles, toRelationshipGraph } from '../../../features/relationships/graphModel';
import { buildRelationships, getMentionedCharacterIds } from '../../../features/brainstorm/brainstormContext';
import { mapBrainstormResponse, toBrainstormPayload } from '../../../data/brainstormMapping';

const alice: Character = { id: '4', bookId: '1', name: 'Alice', aliases: ['Al'], role: 'protagonist', tags: [], description: '', color: '#fff' };
const bob: Character = { ...alice, id: '9', name: 'Bob', aliases: ['Bobby'] };

describe('shared workspace rules', () => {
    it('preserves graph instance keys and removes only edges made invalid by a port change', () => {
        const raw = {
            nodes: [
                { nodeKey: 'alice-copy', characterId: 4, positionX: 1, positionY: 2, handleConfig: '{"right":"source"}' },
                { nodeKey: 'bob-copy', characterId: 9, positionX: 3, positionY: 4, handleConfig: '{bad' },
            ],
            edges: [{ id: 1, sourceNodeKey: 'alice-copy', targetNodeKey: 'bob-copy', sourceHandle: 'right-source', targetHandle: 'left-target', label: 'friend' }],
        };
        const graph = toRelationshipGraph(raw, [alice, bob]);
        expect(graph.nodes[0]).toMatchObject({ id: 'alice-copy', data: { id: '4' }, position: { x: 1, y: 2 } });
        expect(buildRelationships(raw, [alice, bob])).toEqual([{
            source: '4', target: '9', sourceNodeKey: 'alice-copy', targetNodeKey: 'bob-copy',
            sourceCharacterId: '4', targetCharacterId: '9', label: 'friend',
        }]);
        const unrelated = { id: 'other', source: 'third-copy', target: 'bob-copy' };
        expect(filterEdgesForHandles([...graph.edges, unrelated], 'alice-copy', { top: 'target', right: 'none', bottom: 'source', left: 'target' })).toEqual([unrelated]);
        expect(() => toRelationshipGraph(null, [alice])).toThrow('unavailable');
    });

    it('keeps multiple nodes for one character as separate brainstorm relationship endpoints', () => {
        const graph = {
            nodes: [
                { nodeKey: 'alice-first', characterId: '4' },
                { nodeKey: 'alice-second', characterId: '4' },
                { nodeKey: 'bob', characterId: '9' },
            ],
            edges: [
                { sourceNodeKey: 'alice-first', targetNodeKey: 'bob', label: 'Distrusts' },
                { sourceNodeKey: 'alice-second', targetNodeKey: 'bob', label: 'Protects' },
            ],
        };
        expect(buildRelationships(graph, [alice, bob])).toMatchObject([
            { sourceCharacterId: '4', sourceNodeKey: 'alice-first', label: 'Distrusts' },
            { sourceCharacterId: '4', sourceNodeKey: 'alice-second', label: 'Protects' },
        ]);
    });

    it('keeps explicit mentions and legacy HTML IDs while respecting the automatic matching cast', () => {
        const json = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'mention', attrs: { id: '4', label: 'Alice' } },
            { type: 'text', text: ' meets Bobby' },
            { type: 'mention', attrs: { id: 'deleted-character' } },
        ] }] });
        expect([...getMentionedCharacterIds(json, [alice, bob], [bob])].sort()).toEqual(['4', '9']);
        expect([...getMentionedCharacterIds('<p><span data-id="4">Alice</span> meets Bob</p>', [alice, bob], [])]).toEqual(['4']);
        expect([...getMentionedCharacterIds('Alice meets Bobby', [alice, bob], [bob])]).toEqual(['9']);
    });

    it('normalizes legacy brainstorm fields and serializes each structured field once', () => {
        const workspace = mapBrainstormResponse({ selectedChapterIds: '[3]', contextSnapshot: '{"bookTitle":"Book"}',
            generatedOptions: '[{"id":"option-1","title":"Direction"}]', finalContent: 'Draft' });
        expect(workspace.selectedChapterIds).toEqual(['3']);
        expect(workspace.generatedOptions[0]).toMatchObject({ id: 'option-1', title: 'Direction', conflict: '' });
        const payload = toBrainstormPayload(workspace);
        expect(JSON.parse(payload.contextSnapshot)).toEqual({ bookTitle: 'Book' });
        expect(JSON.parse(payload.generatedOptions)).toEqual(workspace.generatedOptions);
        expect(mapBrainstormResponse({ selectedChapterIds: 'null', generatedOptions: '{bad' })).toMatchObject({ selectedChapterIds: [], generatedOptions: [] });
    });

    it('round-trips brainstorm generation source and retrieval metadata', () => {
        const metadata = {
            configId: 'config-1', modelId: 'model-1', generatedAt: 1234, promptVersion: 'brainstorm-v2',
            includesPlanning: true,
            retrieval: {
                retrievalVersion: 'retrieval-v2', requestedAt: 1200,
                sourceVersions: [{ sourceId: 'book:character:alice', chapterId: null, sourceVersion: 3, indexVersion: 2 }],
                includedHitIds: ['hit-1'], indexVersion: 2, embeddingFingerprint: 'local-fingerprint',
            },
            source: {
                bookId: 'book', workspaceDatabaseVersion: 4, planningDatabaseVersion: 2, graphDatabaseVersion: 3,
                selectedChapters: [{ chapterId: 'chapter', databaseVersion: 7 }],
            },
        };
        const workspace = mapBrainstormResponse({ selectedChapterIds: '[]', contextSnapshot: JSON.stringify({ generationMetadata: metadata }), generatedOptions: '[]' });
        expect(workspace.generationMetadata).toEqual(metadata);
        const payload = toBrainstormPayload(workspace);
        expect(JSON.parse(payload.contextSnapshot).generationMetadata).toEqual(metadata);
    });
});
