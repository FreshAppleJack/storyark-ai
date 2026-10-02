import { call } from './repository';

export interface IndexScheduleStatus {
    enabled: boolean;
    databaseVersion: number;
    pendingSources: number;
    lastCompletedAt: number | null;
    lastError: string | null;
}

const options = { failureMessage: 'Search settings could not be updated. Try again. You can keep writing.' };
export const indexScheduleRepository = {
    read: (bookId: string | null = null) => call<IndexScheduleStatus>('local_index_schedule_status', { input: { bookId } }, options),
    save: (enabled: boolean, expectedDatabaseVersion: number) => call<IndexScheduleStatus>('local_save_index_preferences', { input: { enabled, expectedDatabaseVersion } }, options),
};
