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
        return 'Using keyword matches as reference material for this result.';
    }
    if (response.context.evidence.length > 0) return null;
    switch (response.status) {
        case 'embedding_unavailable':
            return 'No extra reference material was available. The AI will use your selected story text.';
        case 'index_not_ready':
            return 'Search is not ready yet. The AI will use your selected story text.';
        case 'stale_only':
            return 'Out-of-date reference material was left out of this result.';
        case 'future_plan_only':
            return 'Future plans were left out of the reference material for this result.';
        case 'no_results':
        case 'lexical_no_match':
            return 'No extra reference material matched. The AI will use your selected story text.';
        default:
            return 'No extra reference material was added. The AI will use your selected story text.';
    }
}
