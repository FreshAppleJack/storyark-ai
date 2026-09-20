import type { RetrievalChunk, RetrievalChunkLocator } from './contracts';

export interface CurrentRetrievalChunkCandidate {
    textHash: string;
    locator: RetrievalChunkLocator;
}

export interface CurrentChapterRetrievalState {
    chapterId: string;
    sourceVersion: number;
    chunks: CurrentRetrievalChunkCandidate[];
}

export type RetrievalLocatorResolution =
    | {
        status: 'resolved';
        matchedBy: 'version' | 'text-hash';
        chapterId: string;
        locator: RetrievalChunkLocator;
    }
    | {
        status: 'source-changed';
        reason: 'wrong-chapter' | 'hash-not-unique';
        message: string;
    };

export function resolveRetrievalChunkLocator(
    chunk: RetrievalChunk,
    current: CurrentChapterRetrievalState,
): RetrievalLocatorResolution {
    if (chunk.locator.chapterId !== current.chapterId) {
        return {
            status: 'source-changed',
            reason: 'wrong-chapter',
            message: 'The source belongs to another chapter. Keep the evidence and choose its chapter explicitly.',
        };
    }

    if (chunk.locator.chapterSourceVersion === current.sourceVersion) {
        return {
            status: 'resolved',
            matchedBy: 'version',
            chapterId: current.chapterId,
            locator: chunk.locator,
        };
    }

    const matches = current.chunks.filter(candidate => candidate.textHash === chunk.textHash);
    if (matches.length === 1) {
        return {
            status: 'resolved',
            matchedBy: 'text-hash',
            chapterId: current.chapterId,
            locator: matches[0].locator,
        };
    }
    return {
        status: 'source-changed',
        reason: 'hash-not-unique',
        message: 'The source changed and could not be located uniquely. Refresh the retrieval index before opening it.',
    };
}
