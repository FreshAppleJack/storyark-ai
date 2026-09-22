import type { BrainstormGenerationMetadata, BrainstormOption } from '../../types';
import type { RetrievalContext, RetrievalSearchStatus } from '../../domain/retrieval/contracts';

export const BRAINSTORM_FIELD_LIMITS = {
    title: { min: 1, max: 240 },
    detail: { min: 1, max: 4000 },
    maxOptions: 3,
} as const;

export type BrainstormCandidateStatus =
    | 'idle'
    | 'starting'
    | 'streaming'
    | 'completed'
    | 'invalid'
    | 'cancelled'
    | 'failed'
    | 'stale'
    | 'adopted';

export interface BrainstormCandidate {
    status: BrainstormCandidateStatus;
    rawText: string;
    options: BrainstormOption[];
    errorMessage: string | null;
    metadata: BrainstormGenerationMetadata | null;
    sourceFingerprint: string | null;
    draftRevision: number | null;
    retrievalContext: RetrievalContext | null;
    retrievalStatus: RetrievalSearchStatus | null;
    retrievalNotice: string | null;
}

export const EMPTY_BRAINSTORM_CANDIDATE: BrainstormCandidate = {
    status: 'idle',
    rawText: '',
    options: [],
    errorMessage: null,
    metadata: null,
    sourceFingerprint: null,
    draftRevision: null,
    retrievalContext: null,
    retrievalStatus: null,
    retrievalNotice: null,
};

function makeId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `brainstorm-option-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function textLength(value: string): number {
    return Array.from(value).length;
}

function parseJsonText(rawText: string): unknown {
    const trimmed = rawText.trim();
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
        return JSON.parse(unfenced);
    } catch {
        const objectStart = unfenced.indexOf('{');
        const objectEnd = unfenced.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) {
            try { return JSON.parse(unfenced.slice(objectStart, objectEnd + 1)); } catch { /* Keep the original validation error. */ }
        }
        const arrayStart = unfenced.indexOf('[');
        const arrayEnd = unfenced.lastIndexOf(']');
        if (arrayStart >= 0 && arrayEnd > arrayStart) {
            try { return JSON.parse(unfenced.slice(arrayStart, arrayEnd + 1)); } catch { /* Keep the original validation error. */ }
        }
        throw new Error('The model response is not valid JSON.');
    }
}

function parseField(value: unknown, field: string, limit: { min: number; max: number }): string {
    if (typeof value !== 'string') throw new Error(`The ${field} field must be text.`);
    const normalized = value.trim();
    const length = textLength(normalized);
    if (length < limit.min || length > limit.max) {
        throw new Error(`The ${field} field must contain ${limit.min}-${limit.max} characters.`);
    }
    return normalized;
}

function optionValue(value: unknown, index: number): BrainstormOption {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`Option ${index + 1} is not an object.`);
    }
    const option = value as Record<string, unknown>;
    return {
        id: makeId(),
        title: parseField(option.title, 'title', BRAINSTORM_FIELD_LIMITS.title),
        conflict: parseField(option.conflict, 'conflict', BRAINSTORM_FIELD_LIMITS.detail),
        motivation: parseField(option.motivation, 'motivation', BRAINSTORM_FIELD_LIMITS.detail),
        consequences: parseField(option.consequences, 'consequences', BRAINSTORM_FIELD_LIMITS.detail),
        development: parseField(option.development, 'development', BRAINSTORM_FIELD_LIMITS.detail),
    };
}

export function parseBrainstormCandidate(rawText: string): { options: BrainstormOption[] } | { errorMessage: string } {
    if (!rawText.trim()) return { errorMessage: 'The model returned no brainstorm options.' };
    let parsed: unknown;
    try {
        parsed = parseJsonText(rawText);
    } catch (error) {
        return { errorMessage: error instanceof Error ? error.message : 'The model response is not valid JSON.' };
    }

    const optionsValue = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>).options
            : undefined;
    if (!Array.isArray(optionsValue)) return { errorMessage: 'The JSON response must contain an options array.' };
    if (optionsValue.length !== BRAINSTORM_FIELD_LIMITS.maxOptions) {
        return { errorMessage: `The response must contain exactly ${BRAINSTORM_FIELD_LIMITS.maxOptions} options.` };
    }
    try {
        return { options: optionsValue.map(optionValue) };
    } catch (error) {
        return { errorMessage: error instanceof Error ? error.message : 'The brainstorm option shape is invalid.' };
    }
}

export function candidateText(options: BrainstormOption[]): string {
    return JSON.stringify({ options: options.map(option => ({
        title: option.title,
        conflict: option.conflict,
        motivation: option.motivation,
        consequences: option.consequences,
        development: option.development,
    })) }, null, 2);
}

export function candidateFromOptions(
    options: BrainstormOption[],
    metadata: BrainstormGenerationMetadata | null,
    sourceFingerprint: string | null,
    draftRevision: number | null,
): BrainstormCandidate {
    return {
        status: 'completed',
        rawText: candidateText(options),
        options,
        errorMessage: null,
        metadata,
        sourceFingerprint,
        draftRevision,
        retrievalContext: null,
        retrievalStatus: null,
        retrievalNotice: null,
    };
}
