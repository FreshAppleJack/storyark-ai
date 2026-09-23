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
export type RetrievalSearchMode = 'lexical' | 'semantic' | 'hybrid';
export type RetrievalIndexJobState = 'queued' | 'indexing' | 'paused' | 'cancelled' | 'completed' | 'failed';
export type RetrievalChapterRange = 'all' | 'current' | 'before_current';

export interface RetrievalSearchFilters {
    sourceKinds: RetrievalSourceKind[];
    includePlanning: boolean;
    chapterRange: RetrievalChapterRange;
    updatedAfter: number | null;
    updatedBefore: number | null;
}

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
    timeRange?: {
        updatedAfter?: number;
        updatedBefore?: number;
    };
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
    indexUpdatedAt: number | null;
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

export interface EmbeddingStatus {
    available: boolean;
    providerId: string | null;
    configId: string | null;
    modelId: string | null;
    dimension: number | null;
    maxInputLength: number | null;
    fingerprint: string | null;
    errorCode: string | null;
    errorMessage: string | null;
}

export interface RetrievalRequest {
    freshnessPolicy?: { freshOnly: boolean; allowLexicalFallback: boolean; maxWaitMs: number };
    scope: RetrievalScope;
    query: string;
    mode: RetrievalSearchMode;
    limit: number;
    excludedHitIds: string[];
    charBudget: number;
    tokenBudget?: number;
    adjacentChunkCount: number;
    task: RetrievalTaskStrategy;
    /** Client-observed status is diagnostic only; Rust derives the authoritative status. */
    indexStatus?: RetrievalIndexStatus;
}

/** Backward-compatible name used by the search UI. Generation uses RetrievalRequest. */
export type RetrievalSearchRequest = RetrievalRequest;

export type RetrievalTaskStrategy =
    | 'generic'
    | 'continuation'
    | 'brainstorm'
    | 'consistency_check';

export type RetrievalRecallMethod = 'lexical' | 'alias' | 'semantic' | 'adjacent';
export type RetrievalFreshness = 'fresh' | 'stale' | 'pending' | 'future_plan';
export type RetrievalSearchStatus =
    | 'ready'
    | 'degraded_lexical'
    | 'no_results'
    | 'stale_only'
    | 'future_plan_only'
    | 'embedding_unavailable'
    | 'index_not_ready'
    | 'lexical_no_match'
    | 'budget_exhausted';

export interface RetrievalHit {
    hitId: string;
    bookId: string;
    sourceKind: RetrievalSourceKind;
    entityId: string;
    chapterId: string | null;
    sourceVersion: number;
    sourceUpdatedAt: number;
    indexUpdatedAt: number | null;
    chunkId: string;
    quote: string;
    locator: RetrievalChunkLocator;
    recallMethods: RetrievalRecallMethod[];
    freshness: RetrievalFreshness;
    chunk: RetrievalChunk;
    score: number;
    lexicalScore: number | null;
    semanticScore: number | null;
}

/** Backward-compatible name used by the result list. */
export type RetrievalSearchHit = RetrievalHit;

export interface RetrievalSourceVersionRecord {
    sourceId: string;
    chapterId: string | null;
    sourceVersion: number;
    indexVersion: number;
}

export interface RetrievalTrace {
    searchId: string;
    retrievalVersion: string;
    task: RetrievalTaskStrategy;
    createdAt: number;
    bookId: string;
    chapterId: string | null;
    scope: RetrievalScope;
    excludedHitIds: string[];
    indexVersion: number | null;
    embeddingFingerprint: string | null;
    sourceVersions: RetrievalSourceVersionRecord[];
}

/** Backward-compatible name used by the search response. */
export type RetrievalSearchTrace = RetrievalTrace;

export interface RetrievalContextBudget {
    charBudget: number;
    tokenBudget: number | null;
}

export interface RetrievalContextMaterial {
    hitId: string;
    label: string;
    sourceKind: RetrievalSourceKind;
    entityId: string;
    chapterId: string | null;
    chapterTitleSnapshot?: string | null;
    volumeTitleSnapshot?: string | null;
    sourceVersion: number;
    chunkId: string;
    quote: string;
    freshness: RetrievalFreshness;
    recallMethods: RetrievalRecallMethod[];
}

export interface RetrievalContextEvidence extends RetrievalContextMaterial {
    text: string;
}

export interface RetrievalContext {
    searchId: string;
    retrievalVersion: string;
    task: RetrievalTaskStrategy;
    requestedAt: number;
    bookId: string;
    chapterId: string | null;
    scope: RetrievalScope;
    excludedHitIds: string[];
    sourceVersions: RetrievalSourceVersionRecord[];
    indexVersion: number | null;
    embeddingFingerprint: string | null;
    budget: RetrievalContextBudget;
    materials: RetrievalContextMaterial[];
    evidence: RetrievalContextEvidence[];
    text: string;
    charCount: number;
    tokenEstimate: number;
    charBudget: number;
    tokenBudget: number | null;
    includedHitIds: string[];
    omittedHitIds: string[];
}

export interface RetrievalSearchResponse {
    requestedMode: RetrievalSearchMode;
    effectiveMode: RetrievalSearchMode;
    status: RetrievalSearchStatus;
    degraded: boolean;
    degradationReason: string | null;
    embeddingAvailable: boolean;
    retrievalVersion: string;
    scoreSemantics: string;
    lexicalMatchCount: number;
    semanticMatchCount: number;
    trace: RetrievalSearchTrace;
    context: RetrievalContext;
    hits: RetrievalSearchHit[];
}

export interface RetrievalIndexJob {
    jobId: string;
    bookId: string;
    sourceId: string;
    sourceVersion: number;
    indexVersion: number;
    embeddingFingerprint: string;
    state: RetrievalIndexJobState;
    attempts: number;
    lastError: string | null;
    createdAt: number;
    updatedAt: number;
}

export const continueRetrievalScope = (bookId: string, beforeAnchor: RetrievalAnchor): RetrievalScope => ({
    bookId,
    allowedSourceKinds: [
        'manuscript',
        'chapter_summary',
        'planning',
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
