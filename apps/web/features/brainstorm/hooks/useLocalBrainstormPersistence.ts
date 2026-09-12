import { useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { brainstormKey, brainstormRepository, type LocalBrainstorm } from '../../../data/local/brainstormRepository';
import type { BrainstormPersistence } from './useBrainstormWorkspace';

/** Pin the version to the loaded workspace; query refetches cannot resolve conflicts. */
export function useLocalBrainstormPersistence(initial: LocalBrainstorm): BrainstormPersistence {
    const client = useQueryClient();
    const loaded = useRef(initial);
    const version = useRef(initial.databaseVersion);
    const session = useRef(crypto.randomUUID());
    return useMemo(() => ({
        load: async () => loaded.current,
        save: async (workspace, revision) => {
            const { selectedChapterIds, contextSnapshot, generatedOptions, selectedOptionId, finalContent } = workspace;
            const response = await brainstormRepository.save({
                selectedChapterIds, contextSnapshot, generatedOptions, selectedOptionId: selectedOptionId ?? null, finalContent,
                bookId: loaded.current.bookId, expectedDatabaseVersion: version.current, revision, sessionKey: session.current,
            });
            if (response.sessionKey !== session.current || response.revision !== revision) throw new Error('Brainstorm acknowledgement mismatch. Keep your draft and reload before retrying.');
            version.current = response.workspace.databaseVersion;
            client.setQueryData(brainstormKey(loaded.current.bookId), response.workspace);
            return true;
        },
    }), [client]);
}
