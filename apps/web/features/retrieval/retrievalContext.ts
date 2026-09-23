import type {
    RetrievalContext,
    RetrievalSearchResponse,
} from '../../domain/retrieval/contracts';
import type {
    ContextSection,
    GenerationRetrievalTrace,
    SourceVersion,
} from '../../data/local/aiGenerationRepository';

export function retrievalContextSection(context: RetrievalContext): ContextSection | null {
    if (!context.text.trim() || context.evidence.length === 0) return null;
    return {
        kind: 'retrievalEvidence',
        label: 'Retrieved evidence with source labels',
        text: context.text,
    };
}

export function generationRetrievalTrace(
    response: RetrievalSearchResponse,
    sourceVersions: SourceVersion[],
): GenerationRetrievalTrace {
    return {
        retrievalVersion: response.trace.retrievalVersion,
        sourceVersions,
        retrievalSourceVersions: response.context.sourceVersions,
        searchId: response.trace.searchId,
        task: response.trace.task,
        requestedAt: response.trace.createdAt,
        scope: response.trace.scope,
        excludedHitIds: response.trace.excludedHitIds,
        includedHitIds: response.context.includedHitIds,
        indexVersion: response.trace.indexVersion,
        embeddingFingerprint: response.trace.embeddingFingerprint,
    };
}

export function retrievalStatusNotice(response: RetrievalSearchResponse): string | null {
    if (response.context.evidence.length > 0 && response.degraded) {
        return 'Retrieved evidence used the explicitly allowed lexical fallback; semantic status was recorded with this candidate.';
    }
    if (response.context.evidence.length > 0) return null;
    switch (response.status) {
        case 'embedding_unavailable':
            return 'Local retrieval was unavailable. The explicit current draft or saved story context remains in use.';
        case 'index_not_ready':
            return 'The local retrieval index is not ready. The explicit current draft or saved story context remains in use.';
        case 'stale_only':
            return 'Only stale retrieval material was found, so it was excluded from this generation.';
        case 'future_plan_only':
            return 'Only future-plan material matched, so it was excluded from this generation.';
        case 'no_results':
        case 'lexical_no_match':
            return 'No retrieval evidence matched this request. The explicit story context remains in use.';
        default:
            return 'No retrieval evidence was attached. The explicit story context remains in use.';
    }
}
