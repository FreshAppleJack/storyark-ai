export type RetrievalSourceKind =
    | 'manuscript'
    | 'chapter_summary'
    | 'planning'
    | 'confirmed_setting'
    | 'character'
    | 'relationship'
    | 'foreshadowing_note'
    | 'future_plan';

export type RetrievalSourceStatus = 'active' | 'stale' | 'pending' | 'discarded';
export type RetrievalSourceOrigin = 'author' | 'generated';
export type RetrievalAuthoringStatus = 'author_confirmed' | 'ai_suggestion' | 'discarded';
export type RetrievalIndexStatus = 'not_configured' | 'queued' | 'indexing' | 'ready' | 'partial' | 'stale' | 'failed';

export type RetrievalVisibilityScope =
    | { kind: 'book' }
    | { kind: 'chapter'; chapterId: string; chapterOrder: number }
    | { kind: 'planning'; chapterIds: string[] };

export interface RetrievalAnchor {
    chapterId: string;
    paragraphOrdinal?: number;
    textOffset?: number;
}

export interface RetrievalScope {
    bookId: string;
    allowedSourceKinds?: RetrievalSourceKind[];
    allowedChapterIds?: string[];
    beforeChapterOrder?: number;
    beforeAnchor?: RetrievalAnchor;
    includeFuturePlan?: boolean;
    includeGenerated?: boolean;
    includeStale?: boolean;
}

export interface RetrievalSource {
    sourceId: string;
    bookId: string;
    entityId: string;
    sourceKind: RetrievalSourceKind;
    sourceStatus: RetrievalSourceStatus;
    sourceVersion: number;
    origin: RetrievalSourceOrigin;
    authoringStatus: RetrievalAuthoringStatus;
    visibilityScope: RetrievalVisibilityScope;
    sourceText: string;
    indexText: string;
    updatedAt: number;
    indexStatus: RetrievalIndexStatus;
    indexVersion: number | null;
    embeddingFingerprint: string | null;
    entityMetadata: Record<string, unknown>;
}

export interface RetrievalParagraphSpan {
    paragraphOrdinal: number;
    nodePath: number[];
    startOffset: number;
    endOffset: number;
}

export interface RetrievalChunkLocator {
    chapterId: string | null;
    volumeId: string | null;
    chapterTitleSnapshot: string | null;
    volumeTitleSnapshot: string | null;
    chapterSourceVersion: number | null;
    chunkOrdinal: number;
    paragraphOrdinals: number[];
    tiptapNodePaths: number[][];
    paragraphSpans: RetrievalParagraphSpan[];
    textHash: string;
    shortQuote: string;
}

export interface RetrievalChunk {
    chunkId: string;
    sourceId: string;
    bookId: string;
    sourceVersion: number;
    indexVersion: number;
    ordinal: number;
    sourceText: string;
    indexText: string;
    textHash: string;
    shortQuote: string;
    locator: RetrievalChunkLocator;
}

export const continueRetrievalScope = (bookId: string, beforeAnchor: RetrievalAnchor): RetrievalScope => ({
    bookId,
    allowedSourceKinds: [
        'manuscript',
        'chapter_summary',
        'confirmed_setting',
        'character',
        'relationship',
        'foreshadowing_note',
    ],
    beforeAnchor,
    includeFuturePlan: false,
    includeGenerated: false,
    includeStale: false,
});
