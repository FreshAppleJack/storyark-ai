import type { LocalBook, LocalChapter, LocalCharacter, LocalVolume } from './contracts';
import type { LocalBrainstorm } from './brainstormRepository';
import type { LocalPlanning } from './planningRepository';
import { call } from './repository';

export interface LocalExportGraphNode {
    nodeKey: string;
    characterId: string;
    positionX: number;
    positionY: number;
    handleConfig: Record<string, string> | null;
    createdAt: number;
    updatedAt: number;
}

export interface LocalExportGraphEdge {
    id: string;
    sourceNodeKey: string;
    targetNodeKey: string;
    sourceHandle: string;
    targetHandle: string;
    label: string;
    createdAt: number;
    updatedAt: number;
}

export interface LocalExportGraph {
    bookId: string;
    databaseVersion: number;
    createdAt: number;
    updatedAt: number;
    nodes: LocalExportGraphNode[];
    edges: LocalExportGraphEdge[];
}

export interface LocalWorkExportSnapshot {
    databaseVersion: number;
    book: LocalBook;
    volumes: LocalVolume[];
    chapters: LocalChapter[];
    characters: LocalCharacter[];
    graph: LocalExportGraph | null;
    planning: LocalPlanning;
    brainstormWorkspace: (LocalBrainstorm & { createdAt: number; updatedAt: number }) | null;
}

/** The desktop command returns one SQLite read-transaction snapshot. */
export const localExportRepository = {
    readSnapshot: (bookId: string) => call<LocalWorkExportSnapshot>('local_read_work_export_snapshot', { bookId }),
};
