import type { BrainstormWorkspace } from '../../types';
import { call, localKeys } from './repository';

export interface LocalBrainstorm extends BrainstormWorkspace { bookId: string; databaseVersion: number }
export const brainstormKey = (bookId: string) => [...localKeys.all, 'brainstorm', bookId] as const;
export const brainstormRepository = {
    read: (bookId: string) => call<LocalBrainstorm>('local_read_brainstorm', { bookId }),
    save: (input: BrainstormWorkspace & { bookId: string; expectedDatabaseVersion: number; sessionKey: string; revision: number }) =>
        call<{ workspace: LocalBrainstorm; sessionKey: string; revision: number }>('local_save_brainstorm', { input }),
};
export const localBrainstormOptions = (bookId: string) => ({
    queryKey: brainstormKey(bookId), queryFn: () => brainstormRepository.read(bookId),
    staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false,
});
