import type { StoryPlanning } from '../../types';
import type { LocalChapter } from './contracts';
import { call, localKeys } from './repository';

export interface LocalPlanning extends StoryPlanning { bookId: string; databaseVersion: number }
export const planningKey = (bookId: string) => [...localKeys.all, 'planning', bookId] as const;
export const planningRepository = {
    read: (bookId: string) => call<LocalPlanning>('local_read_planning', { bookId }),
    save: (input: StoryPlanning & { bookId: string; expectedDatabaseVersion: number; sessionKey: string; revision: number }) =>
        call<{ planning: LocalPlanning; sessionKey: string; revision: number }>('local_save_planning', { input }),
    updateNote: (input: { bookId: string; chapterId: string; noteId: string; expectedDatabaseVersion: number; note?: string; isRecovered?: boolean }) =>
        call<LocalChapter>('local_update_note', { input }),
};
export const localPlanningOptions = (bookId: string) => ({
    queryKey: planningKey(bookId), queryFn: () => planningRepository.read(bookId),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
});
