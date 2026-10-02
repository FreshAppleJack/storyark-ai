import type { BrainstormGenerationMetadata, BrainstormOption } from '../../types';
import type { RetrievalContext, RetrievalSearchStatus } from '../../domain/retrieval/contracts';
import { reportError } from '../../data/diagnostics';

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
    lastAttempt?: {
        status: 'invalid' | 'failed' | 'cancelled' | 'stale';
        rawText: string;
        errorMessage: string;
        metadata: BrainstormGenerationMetadata | null;
        retrievalContext: RetrievalContext | null;
        retrievalStatus: RetrievalSearchStatus | null;
        retrievalNotice: string | null;
    };
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
        reportError('brainstorm.parse', error, 'INVALID_AI_RESPONSE');
        return { errorMessage: 'The AI response could not be used. Try generating again.' };
    }

    const optionsValue = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).options
        : undefined;
    if (!Array.isArray(optionsValue)) {
        reportError('brainstorm.parse', 'The JSON response must contain an options array.', 'INVALID_AI_RESPONSE');
        return { errorMessage: 'The AI did not return any usable directions. Try generating again.' };
    }
    if (optionsValue.length !== BRAINSTORM_FIELD_LIMITS.maxOptions) {
        reportError('brainstorm.parse', `Expected ${BRAINSTORM_FIELD_LIMITS.maxOptions} options; received ${optionsValue.length}.`, 'INVALID_AI_RESPONSE');
        return { errorMessage: 'The AI did not return all three directions. Try generating again.' };
    }
    try {
        return { options: optionsValue.map(optionValue) };
    } catch (error) {
        reportError('brainstorm.parse', error, 'INVALID_AI_RESPONSE');
        return { errorMessage: 'Some AI directions are incomplete or too long. Try generating again.' };
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
