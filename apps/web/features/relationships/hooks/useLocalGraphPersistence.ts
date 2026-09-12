import { useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Character } from '../../../types';
import { graphRepository, localGraphKey, type LocalGraph } from '../../../data/local/graphRepository';
import { graphSnapshot, projectLocalGraph } from '../localGraphModel';
import type { GraphPersistence } from './useRelationshipGraph';

/** Pin the version to the loaded draft; query refetches cannot resolve conflicts. */
export function useLocalGraphPersistence(initial: LocalGraph, characters: Character[]): GraphPersistence {
    const client = useQueryClient();
    const session = useRef(crypto.randomUUID());
    const version = useRef(initial.databaseVersion);
    const loaded = useRef({ initial, characters });
    return useMemo(() => ({
        load: async () => projectLocalGraph(loaded.current.initial, loaded.current.characters),
        save: async (nodes, edges, revision) => {
            const result = await graphRepository.save({ bookId: loaded.current.initial.bookId,
                expectedDatabaseVersion: version.current, sessionKey: session.current, revision,
                ...graphSnapshot(nodes, edges) });
            if (result.sessionKey !== session.current || result.revision !== revision) {
                throw new Error('Graph acknowledgement did not match the draft. Reload before retrying.');
            }
            version.current = result.graph.databaseVersion;
            client.setQueryData(localGraphKey(result.graph.bookId), result.graph);
            return true;
        },
    }), [client]);
}
