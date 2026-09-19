import { call } from '../local/repository';
import type { StoryArkWorkExport } from './exchange';

export type WorkImportMode = 'import' | 'replace' | 'copy';

export interface WorkImportStats {
    volumes: number;
    chapters: number;
    characters: number;
    foreshadowings: number;
    graphNodes: number;
    graphEdges: number;
    planningSummaries: number;
    plotSettings: number;
    brainstormWorkspaces: number;
    brainstormOptions: number;
    assets?: number;
}

export interface WorkImportTarget {
    bookId: string;
    title: string;
    databaseVersion: number;
    updatedAt: number;
    stats: WorkImportStats;
}

export interface WorkImportPreparation {
    status: 'ready' | 'conflict';
    bookId: string;
    title: string;
    importVersion: number;
    importUpdatedAt: number;
    importStats: WorkImportStats;
    target: WorkImportTarget | null;
    nameConflict: boolean;
    copyTitle: string;
}

export interface WorkImportResult {
    mode: WorkImportMode;
    bookId: string;
    book: unknown;
    stats: WorkImportStats;
    backupFileName: string | null;
    derivedIndexStatus: 'pending';
}

export const workImportRepository = {
    prepare: (work: StoryArkWorkExport) =>
        call<WorkImportPreparation>('local_prepare_work_import', { input: { work } }),
    execute: (work: StoryArkWorkExport, mode: WorkImportMode, expectedTargetDatabaseVersion?: number, requestId?: string) =>
        call<WorkImportResult>('local_import_work', {
            input: { work, mode, expectedTargetDatabaseVersion, ...(requestId ? { requestId } : {}) },
        }),
    cancel: (requestId: string) =>
        call<{ cancelled: boolean }>('local_cancel_work_import', { requestId }),
};
