import type { HandleConfig } from '../../types';
import { call, localKeys } from './repository';

export interface LocalGraphNode {
    nodeKey: string;
    characterId: string;
    positionX: number;
    positionY: number;
    handleConfig: HandleConfig | null;
}
export interface LocalGraphEdge {
    id: string;
    sourceNodeKey: string;
    targetNodeKey: string;
    sourceHandle: string;
    targetHandle: string;
    label: string;
}
export interface LocalGraph {
    bookId: string;
    databaseVersion: number;
    nodes: LocalGraphNode[];
    edges: LocalGraphEdge[];
}
export interface SaveGraphInput {
    bookId: string;
    expectedDatabaseVersion: number;
    nodes: LocalGraphNode[];
    edges: LocalGraphEdge[];
    sessionKey: string;
    revision: number;
}
export const graphRepository = {
    read: (bookId: string) => call<LocalGraph | null>('local_read_graph', { bookId }),
    initialize: (bookId: string) => call<LocalGraph>('local_initialize_graph', { bookId }),
    save: (input: SaveGraphInput) => call<{ graph: LocalGraph; sessionKey: string; revision: number }>('local_save_graph', { input }),
};
export const localGraphKey = (bookId: string) => [...localKeys.all, 'graph', bookId] as const;
export const localGraphOptions = (bookId: string) => ({
    queryKey: localGraphKey(bookId), queryFn: () => graphRepository.read(bookId),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
});
