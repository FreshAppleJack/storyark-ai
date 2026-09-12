import { useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { planningKey, planningRepository, type LocalPlanning } from '../../../data/local/planningRepository';
import type { PlanningPersistence } from './useStoryPlanning';

export function useLocalPlanningPersistence(initial: LocalPlanning): PlanningPersistence {
    const client = useQueryClient();
    const loaded = useRef(initial);
    const version = useRef(initial.databaseVersion);
    const session = useRef(crypto.randomUUID());
    return useMemo(() => ({
        load: async () => loaded.current,
        save: async (planning, revision) => {
            const { storySummary, storyBackground, chapterSummaries, plotSettings } = planning;
            const response = await planningRepository.save({ storySummary, storyBackground, chapterSummaries, plotSettings,
                bookId: loaded.current.bookId, expectedDatabaseVersion: version.current, revision, sessionKey: session.current });
            if (response.sessionKey !== session.current || response.revision !== revision) throw new Error('Planning acknowledgement mismatch. Keep your draft and reload before retrying.');
            version.current = response.planning.databaseVersion;
            client.setQueryData(planningKey(loaded.current.bookId), response.planning);
            return true;
        },
    }), [client]);
}
