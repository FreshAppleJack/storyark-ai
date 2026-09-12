import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Book, Character } from '../../../types';
import type { LocalGraph } from '../../../data/local/graphRepository';
import { graphRepository } from '../../../data/local/graphRepository';
import { useLocalGraphPersistence } from '../../../features/relationships/hooks/useLocalGraphPersistence';
import { useRelationshipGraph } from '../../../features/relationships/hooks/useRelationshipGraph';
import { graphSnapshot, projectLocalGraph } from '../../../features/relationships/localGraphModel';

const legacy = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../../../InteractionContent/BooksContext', () => ({ useBooks: () => ({ fetchGraphData: legacy.load, saveGraphData: legacy.save }) }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));
const character: Character = { id: 'character', bookId: 'book', name: 'Alice', role: 'protagonist', aliases: [], tags: [], description: '', color: '#123456', isArchived: true };
const book: Book = { id: 'book', title: 'Book', author: '', status: 'serializing', lastModified: 0, volumes: [], characters: [character] };
const initial: LocalGraph = { bookId: 'book', databaseVersion: 3, nodes: [
    { nodeKey: 'instance-a', characterId: character.id, positionX: 1.5, positionY: 2, handleConfig: null },
    { nodeKey: 'instance-b', characterId: character.id, positionX: 350, positionY: 50, handleConfig: null },
], edges: [{ id: 'edge', sourceNodeKey: 'instance-a', targetNodeKey: 'instance-b', sourceHandle: 'right-source', targetHandle: 'left-target', label: 'History' }] };
function setup(graph = initial) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(() => {
        const persistence = useLocalGraphPersistence(graph, book.characters);
        return useRelationshipGraph(book.id, book, persistence);
    }, { wrapper: ({ children }) => <QueryClientProvider client={client}><ReactFlowProvider>{children}</ReactFlowProvider></QueryClientProvider> });
}
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('preserves multiple instances, archived labels and saved empty maps without legacy calls', async () => {
    const projected = projectLocalGraph(initial, book.characters);
    expect(projected.nodes.map(node => node.id)).toEqual(['instance-a', 'instance-b']);
    expect(projected.nodes.every(node => node.data.isArchived)).toBe(true);
    expect(graphSnapshot(projected.nodes, projected.edges).edges).toEqual(initial.edges);
    const { result } = setup({ ...initial, nodes: [], edges: [] });
    await waitFor(() => expect(result.current.isGraphLoaded).toBe(true));
    expect(result.current.nodes).toEqual([]);
    expect(legacy.load).not.toHaveBeenCalled();
    expect(legacy.save).not.toHaveBeenCalled();
});

it('drains new drags after pending commits using the returned database version', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const save = vi.spyOn(graphRepository, 'save').mockImplementation(async input => {
        if (input.expectedDatabaseVersion === 3) await pending;
        return { graph: { bookId: input.bookId, databaseVersion: input.expectedDatabaseVersion + 1, nodes: input.nodes, edges: input.edges },
            sessionKey: input.sessionKey, revision: input.revision };
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.isGraphLoaded).toBe(true));
    act(() => result.current.onNodesChange([{ type: 'position', id: 'instance-a', position: { x: 10, y: 20 } }]));
    let flushing!: Promise<boolean>;
    act(() => { flushing = result.current.flush(); });
    act(() => result.current.onNodesChange([{ type: 'position', id: 'instance-a', position: { x: 80, y: 90 } }]));
    expect(result.current.isDirty).toBe(true);
    await act(async () => { release(); expect(await flushing).toBe(true); });
    expect(save.mock.calls.map(([input]) => input.expectedDatabaseVersion)).toEqual([3, 4]);
    expect(save.mock.calls[1][0].nodes[0].positionX).toBe(80);
    expect(result.current.isDirty).toBe(false);
});

it('retains layout after conflicts without fetching a new version or calling HTTP', async () => {
    const save = vi.spyOn(graphRepository, 'save').mockRejectedValue(new Error('VERSION_CONFLICT'));
    const read = vi.spyOn(graphRepository, 'read');
    const { result } = setup();
    await waitFor(() => expect(result.current.isGraphLoaded).toBe(true));
    act(() => result.current.onNodesChange([{ type: 'position', id: 'instance-a', position: { x: 777, y: 2 } }]));
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    expect(result.current.nodes[0].position.x).toBe(777);
    expect(result.current.isDirty).toBe(true);
    expect(result.current.saveError).toContain('VERSION_CONFLICT');
    expect(save.mock.calls.map(([input]) => input.expectedDatabaseVersion)).toEqual([3, 3]);
    expect(read).not.toHaveBeenCalled();
    expect(legacy.save).not.toHaveBeenCalled();
});

it('requires confirmation before a port change drops edges; node deletion keeps characters', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = setup();
    await waitFor(() => expect(result.current.isGraphLoaded).toBe(true));
    act(() => result.current.setMenu({ id: 'instance-a', top: 0, left: 0, config: { top: 'target', right: 'source', bottom: 'source', left: 'target' } }));
    act(() => result.current.updateNodeConfig({ top: 'target', right: 'none', bottom: 'source', left: 'target' }));
    expect(confirm).toHaveBeenCalled();
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.onNodesChange([{ type: 'remove', id: 'instance-a' }]));
    expect(result.current.nodes).toHaveLength(1);
    expect(result.current.edges).toHaveLength(0);
    expect(book.characters).toHaveLength(1);
});

it('blocks editing when a referenced character cannot be loaded', async () => {
    const { result } = setup({ ...initial, nodes: [{ ...initial.nodes[0], characterId: 'missing' }] });
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.isGraphLoaded).toBe(false);
    await act(async () => { expect(await result.current.flush()).toBe(false); });
});
