import type { RetrievalChunk, RetrievalChunkLocator, RetrievalTextFocus } from './contracts';

/** Maps a chunk-local Unicode-scalar offset to the paragraph span recorded by the indexer. */
export function mapRetrievalChunkOffset(
    locator: RetrievalChunkLocator,
    chunkTextOffset: number,
    textLength: number,
): RetrievalTextFocus | null {
    const spans = locator.paragraphSpans;
    if (spans.length === 0 || !Number.isFinite(chunkTextOffset) || !Number.isFinite(textLength)) return null;
    const requestedLength = Math.max(0, Math.floor(textLength));

    let renderedOffset = 0;
    let previousOrdinal: number | null = null;
    for (const span of spans) {
        if (previousOrdinal !== null && previousOrdinal !== span.paragraphOrdinal) renderedOffset += 1;
        const spanLength = Math.max(0, span.endOffset - span.startOffset);
        const spanEnd = renderedOffset + spanLength;
        const isLast = span === spans[spans.length - 1];
        if (chunkTextOffset >= renderedOffset && (chunkTextOffset < spanEnd || (isLast && chunkTextOffset <= spanEnd))) {
            const offsetWithinSpan = Math.max(0, Math.min(spanLength, chunkTextOffset - renderedOffset));
            return {
                paragraphOrdinal: span.paragraphOrdinal,
                textOffset: span.startOffset + offsetWithinSpan,
                textLength: Math.min(requestedLength, spanLength - offsetWithinSpan),
            };
        }
        renderedOffset = spanEnd;
        previousOrdinal = span.paragraphOrdinal;
    }
    return null;
}

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
