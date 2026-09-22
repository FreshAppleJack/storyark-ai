import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    aiGenerationRepository,
    type GenerationEvent,
    type GenerationRequest,
} from '../../../data/local/aiGenerationRepository';
import { retrievalRepository } from '../../../data/local/retrievalRepository';
import { aiErrorMessage, aiSettingsRepository, type AiConfigRecord } from '../../../data/local/aiSettingsRepository';
import { continueRetrievalScope, type RetrievalContext, type RetrievalSearchStatus } from '../../../domain/retrieval/contracts';
import { generationRetrievalTrace, retrievalContextSection, retrievalStatusNotice } from '../../retrieval/retrievalContext';
import type { AiContinueAnchor } from '../types/aiContinue';

export type AiContinueCandidateStatus =
    | 'idle'
    | 'starting'
    | 'streaming'
    | 'completed'
    | 'cancelled'
    | 'failed'
    | 'stale'
    | 'adopted';

export interface AiContinueSource {
    bookId: string;
    chapterId: string;
    sessionId: string;
    draftRevision: number;
    databaseVersion: number;
    contextSource: 'current-in-memory-draft';
    contextText: string;
    outputChars: number;
    anchor: AiContinueAnchor;
    lockWasValid: boolean;
    retrievalContext: RetrievalContext | null;
    retrievalStatus: RetrievalSearchStatus | null;
    retrievalNotice: string | null;
}

export interface AiContinueCandidate {
    status: AiContinueCandidateStatus;
    text: string;
    errorMessage: string | null;
    source: AiContinueSource | null;
}

interface UseLocalAiContinueOptions {
    enabled: boolean;
    bookId: string;
    chapterId: string;
    sessionId: string;
    draftRevision: number;
    databaseVersion: number;
    isReadOnly: boolean;
    contextChars: number;
    outputChars: number;
    chapterOrder?: number;
    getContextText: () => string;
    captureAnchor: () => AiContinueAnchor | null;
    insertCandidateAtAnchor: (candidate: string, anchor: AiContinueAnchor) => boolean;
}

interface UseLocalAiContinueResult {
    isAiLoading: boolean;
    candidate: AiContinueCandidate;
    canAdopt: boolean;
    adoptDisabledReason: string | null;
    continueWriting: () => Promise<void>;
    stop: () => void;
    adoptCandidate: () => void;
    closeCandidate: () => void;
    discardCandidate: () => void;
    regenerate: () => Promise<void>;
    toggleRetrievalHit: (hitId: string) => void;
}

interface ActiveGeneration {
    requestId: string;
    chapterId: string;
    sessionId: string;
    lastSequence: number;
    candidateText: string;
    unlisten?: () => void;
}

interface AiContinueError extends Error {
    code: string;
}

const INITIAL_CANDIDATE: AiContinueCandidate = {
    status: 'idle',
    text: '',
    errorMessage: null,
    source: null,
};

function createError(code: string): AiContinueError {
    const error = new Error(code) as AiContinueError;
    error.code = code;
    return error;
}

function errorCode(error: unknown): string {
    if (!error || typeof error !== 'object' || !('code' in error)) return '';
    return String(error.code);
}

function errorMessage(error: unknown): string {
    switch (errorCode(error)) {
        case 'CONFIGURATION_REQUIRED':
            return 'Choose a default AI model in Settings before generating.';
        case 'EMPTY_RESULT':
            return 'The model returned no continuation. The original draft is unchanged.';
        case 'CONTEXT_CHANGED':
            return 'The generation source changed. Keep the candidate only for review, then regenerate from the current draft.';
        case 'CANCELLED':
            return 'Generation stopped. The original draft is unchanged.';
        default:
            return aiErrorMessage(error);
    }
}

function requestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function activeStatus(status: AiContinueCandidateStatus): boolean {
    return status === 'starting' || status === 'streaming';
}

function takeRecentCharacters(text: string, maxChars: number): string {
    return Array.from(text).slice(-maxChars).join('');
}

function sourceMatchesCurrent(source: AiContinueSource, options: UseLocalAiContinueOptions): boolean {
    return source.bookId === options.bookId
        && source.chapterId === options.chapterId
        && source.sessionId === options.sessionId
        && source.draftRevision === options.draftRevision
        && source.databaseVersion === options.databaseVersion;
}

function findDefaultConfig(configs: Awaited<ReturnType<typeof aiSettingsRepository.list>>): AiConfigRecord {
    if (!configs.defaultConfigId) throw createError('CONFIGURATION_REQUIRED');
    const config = configs.configs.find(item => item.id === configs.defaultConfigId);
    if (!config) throw createError('NOT_FOUND');
    if (config.credentialStatus === 'unavailable') throw createError('CREDENTIAL_UNAVAILABLE');
    return config;
}

export function useLocalAiContinue(options: UseLocalAiContinueOptions): UseLocalAiContinueResult {
    const [candidate, setCandidate] = useState<AiContinueCandidate>(INITIAL_CANDIDATE);
    const activeRef = useRef<ActiveGeneration | null>(null);
    const candidateRef = useRef(candidate);
    const optionsRef = useRef(options);
    const excludedHitIdsRef = useRef<string[]>([]);

    useLayoutEffect(() => {
        optionsRef.current = options;
    });
    useLayoutEffect(() => {
        candidateRef.current = candidate;
    }, [candidate]);

    const updateCandidate = useCallback((next: AiContinueCandidate) => {
        candidateRef.current = next;
        setCandidate(next);
    }, []);

    const cleanupActive = useCallback((active: ActiveGeneration) => {
        active.unlisten?.();
        active.unlisten = undefined;
        if (activeRef.current === active) activeRef.current = null;
    }, []);

    const isActive = useCallback((active: ActiveGeneration): boolean => activeRef.current === active, []);

    const handleEvent = useCallback((event: GenerationEvent) => {
        const active = activeRef.current;
        if (!active || event.requestId !== active.requestId || event.sessionId !== active.sessionId) return;
        if (event.sequence <= active.lastSequence) return;
        active.lastSequence = event.sequence;

        switch (event.payload.kind) {
            case 'started':
                updateCandidate({
                    ...candidateRef.current,
                    status: 'streaming',
                    errorMessage: null,
                });
                return;
            case 'delta':
                active.candidateText += event.payload.text;
                updateCandidate({
                    ...candidateRef.current,
                    status: 'streaming',
                    text: active.candidateText,
                    errorMessage: null,
                });
                return;
            case 'completed': {
                active.candidateText = event.payload.text;
                if (event.payload.finishReason === 'length') {
                    updateCandidate({
                        ...candidateRef.current,
                        status: 'failed',
                        text: active.candidateText,
                        errorMessage: errorMessage(createError('TRUNCATED')),
                    });
                } else if (!event.payload.text.trim()) {
                    updateCandidate({
                        ...candidateRef.current,
                        status: 'failed',
                        text: '',
                        errorMessage: errorMessage(createError('EMPTY_RESULT')),
                    });
                } else {
                    updateCandidate({
                        ...candidateRef.current,
                        status: 'completed',
                        text: event.payload.text,
                        errorMessage: null,
                    });
                }
                cleanupActive(active);
                return;
            }
            case 'failed':
                updateCandidate({
                    ...candidateRef.current,
                    status: 'failed',
                    text: active.candidateText,
                    errorMessage: errorMessage(event.payload.error),
                });
                cleanupActive(active);
                return;
            case 'cancelled':
                updateCandidate({
                    ...candidateRef.current,
                    status: 'cancelled',
                    text: active.candidateText,
                    errorMessage: errorMessage(createError('CANCELLED')),
                });
                cleanupActive(active);
                return;
            default:
                return;
        }
    }, [cleanupActive, updateCandidate]);

    const stop = useCallback(() => {
        const active = activeRef.current;
        if (!active) return;
        cleanupActive(active);
        updateCandidate({
            ...candidateRef.current,
            status: 'cancelled',
            text: active.candidateText,
            errorMessage: errorMessage(createError('CANCELLED')),
        });
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [cleanupActive, updateCandidate]);

    const continueWriting = useCallback(async () => {
        const current = optionsRef.current;
        if (!current.enabled || current.isReadOnly || activeRef.current) return;
        const existingCandidate = candidateRef.current;
        if (existingCandidate.status !== 'idle' && existingCandidate.status !== 'adopted' && existingCandidate.text.trim()) return;
        if (!current.chapterId || !current.bookId || !current.databaseVersion) {
            updateCandidate({ ...INITIAL_CANDIDATE, status: 'failed', errorMessage: 'The chapter identity is not ready. Reload the local book and try again.' });
            return;
        }

        const anchor = current.captureAnchor();
        if (!anchor) {
            updateCandidate({ ...INITIAL_CANDIDATE, status: 'failed', errorMessage: 'The editor position is not ready. Place the cursor in the chapter and try again.' });
            return;
        }

        const contextText = takeRecentCharacters(current.getContextText(), current.contextChars);
        if (!contextText.trim()) {
            updateCandidate({ ...INITIAL_CANDIDATE, status: 'failed', errorMessage: 'Write some chapter text before requesting a continuation.' });
            return;
        }

        const active: ActiveGeneration = {
            requestId: requestId(),
            chapterId: current.chapterId,
            sessionId: current.sessionId,
            lastSequence: -1,
            candidateText: '',
        };
        activeRef.current = active;
        updateCandidate({
            status: 'starting',
            text: '',
            errorMessage: null,
            source: {
                bookId: current.bookId,
                chapterId: current.chapterId,
                sessionId: current.sessionId,
                draftRevision: current.draftRevision,
                databaseVersion: current.databaseVersion,
                contextSource: 'current-in-memory-draft',
                contextText,
                outputChars: current.outputChars,
                anchor,
                lockWasValid: !current.isReadOnly,
                retrievalContext: null,
                retrievalStatus: null,
                retrievalNotice: null,
            },
        });

        try {
            const configs = await aiSettingsRepository.list();
            if (!isActive(active)) return;
            const config = findDefaultConfig(configs);
            let retrievalResponse: Awaited<ReturnType<typeof retrievalRepository.search>> | null = null;
            let retrievalNotice: string | null = null;
            try {
                const retrievalScope = continueRetrievalScope(current.bookId, {
                    chapterId: current.chapterId,
                    textOffset: anchor.from,
                });
                retrievalScope.beforeChapterOrder = current.chapterOrder;
                retrievalResponse = await retrievalRepository.search({
                    scope: retrievalScope,
                    query: contextText,
                    mode: 'hybrid',
                    limit: 8,
                    excludedHitIds: excludedHitIdsRef.current,
                    charBudget: 8_000,
                    tokenBudget: 2_000,
                    adjacentChunkCount: 1,
                    task: 'continuation',
                    indexStatus: undefined,
                    freshnessPolicy: { freshOnly: true, allowLexicalFallback: true, maxWaitMs: 500 },
                });
                retrievalNotice = retrievalStatusNotice(retrievalResponse);
            } catch {
                retrievalNotice = 'Retrieval was unavailable. The current in-memory draft remains the generation context.';
            }
            if (!isActive(active)) return;
            const retrievalContext = retrievalResponse?.context ?? null;
            const retrievalSection = retrievalResponse ? retrievalContextSection(retrievalResponse.context) : null;
            const sections = retrievalSection
                ? [{ kind: 'currentDraft' as const, label: 'Current in-memory draft', text: contextText }, retrievalSection]
                : [{ kind: 'currentDraft' as const, label: 'Current in-memory draft', text: contextText }];
            updateCandidate({
                ...candidateRef.current,
                source: candidateRef.current.source
                    ? {
                        ...candidateRef.current.source,
                        retrievalContext,
                        retrievalStatus: retrievalResponse?.status ?? null,
                        retrievalNotice,
                    }
                    : null,
            });
            const contextSnapshot = await aiGenerationRepository.prepareContext({
                bookId: current.bookId,
                sessionId: current.sessionId,
                draftRevision: current.draftRevision,
                maxChars: sections.reduce((total, section) => total + Array.from(section.text).length, 0),
                target: {
                    kind: 'continue',
                    chapterId: current.chapterId,
                    databaseVersion: current.databaseVersion,
                },
                sections,
                ...(retrievalContext ? { retrievalContext } : {}),
            });
            if (!isActive(active)) return;

            const unlisten = await aiGenerationRepository.subscribe(handleEvent);
            if (!isActive(active)) {
                unlisten();
                return;
            }
            active.unlisten = unlisten;

            const input: GenerationRequest = {
                requestId: active.requestId,
                bookId: current.bookId,
                sessionId: current.sessionId,
                draftRevision: current.draftRevision,
                config: {
                    id: config.id,
                    expectedConfigVersion: config.configVersion,
                },
                target: {
                    kind: 'continue',
                    chapterId: current.chapterId,
                    databaseVersion: current.databaseVersion,
                },
                contextSnapshotId: contextSnapshot.contextSnapshotId,
                outputChars: current.outputChars,
                retrievalTrace: retrievalResponse
                    ? generationRetrievalTrace(retrievalResponse, [{
                        chapterId: current.chapterId,
                        databaseVersion: current.databaseVersion,
                    }])
                    : null,
            };
            await aiGenerationRepository.start(input);
        } catch (error) {
            if (!isActive(active)) return;
            updateCandidate({
                ...candidateRef.current,
                status: 'failed',
                errorMessage: errorMessage(error),
            });
            cleanupActive(active);
        }
    }, [cleanupActive, handleEvent, isActive, updateCandidate]);

    const clearCandidate = useCallback((resetExcludedHits: boolean) => {
        if (activeRef.current) stop();
        if (resetExcludedHits) excludedHitIdsRef.current = [];
        updateCandidate(INITIAL_CANDIDATE);
    }, [stop, updateCandidate]);

    const closeCandidate = useCallback(() => {
        clearCandidate(true);
    }, [clearCandidate]);

    const discardCandidate = useCallback(() => {
        closeCandidate();
    }, [closeCandidate]);

    const regenerate = useCallback(async () => {
        clearCandidate(false);
        await continueWriting();
    }, [clearCandidate, continueWriting]);

    const toggleRetrievalHit = useCallback((hitId: string) => {
        const excluded = new Set(excludedHitIdsRef.current);
        if (excluded.has(hitId)) excluded.delete(hitId);
        else excluded.add(hitId);
        excludedHitIdsRef.current = [...excluded];
        const current = candidateRef.current;
        if (current.source?.retrievalContext) {
            updateCandidate({
                ...current,
                source: {
                    ...current.source,
                    retrievalContext: { ...current.source.retrievalContext, excludedHitIds: excludedHitIdsRef.current },
                },
            });
        }
    }, [updateCandidate]);

    const adoptCandidate = useCallback(() => {
        const current = optionsRef.current;
        const snapshot = candidateRef.current;
        const source = snapshot.source;
        if (snapshot.status !== 'completed' || !source || !snapshot.text.trim()) return;

        if (current.isReadOnly) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'Unlock the chapter before adopting this candidate. The candidate is still available.' });
            return;
        }
        if (!sourceMatchesCurrent(source, current)) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The draft changed. Regenerate or return to the original insertion position before adopting.' });
            return;
        }

        const currentAnchor = current.captureAnchor();
        if (
            !currentAnchor
            || currentAnchor.from !== source.anchor.from
            || currentAnchor.to !== source.anchor.to
            || currentAnchor.docSize !== source.anchor.docSize
        ) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The insertion position changed. Place the cursor or selection back at the original position, or regenerate.' });
            return;
        }

        if (!current.insertCandidateAtAnchor(snapshot.text, source.anchor)) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The editor changed before adoption. The candidate is preserved; regenerate or choose the insertion position again.' });
            return;
        }

        updateCandidate({
            ...snapshot,
            status: 'adopted',
            errorMessage: 'Candidate inserted into the draft. The existing save queue will persist it.',
        });
    }, [updateCandidate]);

    useEffect(() => {
        const active = activeRef.current;
        if (active && (active.chapterId !== options.chapterId || active.sessionId !== options.sessionId)) {
            stop();
            updateCandidate(INITIAL_CANDIDATE);
        }
    }, [options.chapterId, options.sessionId, stop, updateCandidate]);

    useEffect(() => () => {
        const active = activeRef.current;
        if (!active) return;
        cleanupActive(active);
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [cleanupActive]);

    const isAiLoading = activeStatus(candidate.status);
    const source = candidate.source;
    const sourceIsCurrent = source ? sourceMatchesCurrent(source, options) : false;
    const canAdopt = candidate.status === 'completed' && !!source && !!candidate.text.trim() && sourceIsCurrent && !options.isReadOnly;
    const adoptDisabledReason = candidate.status !== 'completed'
        ? null
        : options.isReadOnly
            ? 'Unlock the chapter before adopting the candidate.'
            : !sourceIsCurrent
                ? 'The draft changed. Regenerate before adopting this candidate.'
                : null;

    return {
        isAiLoading,
        candidate,
        canAdopt,
        adoptDisabledReason,
        continueWriting,
        stop,
        adoptCandidate,
        closeCandidate,
        discardCandidate,
        regenerate,
        toggleRetrievalHit,
    };
}
