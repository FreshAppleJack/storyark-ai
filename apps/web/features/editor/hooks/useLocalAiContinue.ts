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
    | 'validating'
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
    generatedAnchor: AiContinueAnchor;
    lockWasValid: boolean;
    staleReason?: 'draft' | 'anchor' | 'lock' | 'retrieval' | 'verification';
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
    getContextText: (anchor: AiContinueAnchor) => string;
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
    adoptCandidate: () => Promise<void>;
    closeCandidate: () => void;
    discardCandidate: () => void;
    regenerate: () => Promise<void>;
    reselectInsertionPoint: () => void;
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

function anchorsMatch(left: AiContinueAnchor, right: AiContinueAnchor): boolean {
    return left.from === right.from
        && left.to === right.to
        && left.docSize === right.docSize
        && left.selectedText === right.selectedText
        && left.retrievalAnchor.paragraphOrdinal === right.retrievalAnchor.paragraphOrdinal
        && left.retrievalAnchor.textOffset === right.retrievalAnchor.textOffset;
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
    const adoptionAttemptRef = useRef(0);

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

        if (!Number.isInteger(anchor.retrievalAnchor.paragraphOrdinal)
            || anchor.retrievalAnchor.paragraphOrdinal < 0
            || !Number.isInteger(anchor.retrievalAnchor.textOffset)
            || anchor.retrievalAnchor.textOffset < 0) {
            updateCandidate({ ...INITIAL_CANDIDATE, status: 'failed', errorMessage: 'The editor could not map this position to a story paragraph. Place the cursor in the chapter and try again.' });
            return;
        }

        const contextText = takeRecentCharacters(current.getContextText(anchor), current.contextChars);
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
                generatedAnchor: anchor,
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
                    paragraphOrdinal: anchor.retrievalAnchor.paragraphOrdinal,
                    textOffset: anchor.retrievalAnchor.textOffset,
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
        adoptionAttemptRef.current += 1;
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
        const current = optionsRef.current;
        if (!current.enabled || current.isReadOnly || !current.bookId || !current.chapterId) {
            const snapshot = candidateRef.current;
            if (snapshot.status !== 'idle') {
                updateCandidate({
                    ...snapshot,
                    errorMessage: current.isReadOnly
                        ? 'Unlock the chapter before regenerating. The current candidate is preserved.'
                        : 'The current story context is not ready. The candidate is preserved.',
                });
            }
            return;
        }
        clearCandidate(false);
        await continueWriting();
    }, [clearCandidate, continueWriting, updateCandidate]);

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

    const reselectInsertionPoint = useCallback(() => {
        const current = optionsRef.current;
        const snapshot = candidateRef.current;
        const source = snapshot.source;
        if (snapshot.status !== 'stale' || source?.staleReason !== 'anchor' || !sourceMatchesCurrent(source, current)) return;
        if (current.isReadOnly) {
            updateCandidate({ ...snapshot, errorMessage: 'Unlock the chapter before choosing a new insertion point.' });
            return;
        }
        const anchor = current.captureAnchor();
        if (!anchor) {
            updateCandidate({ ...snapshot, errorMessage: 'Place the cursor or selection in the chapter before choosing a new insertion point.' });
            return;
        }
        updateCandidate({
            ...snapshot,
            status: 'completed',
            errorMessage: 'Insertion point updated. Review the candidate before adopting it.',
            source: { ...source, anchor, staleReason: undefined },
        });
    }, [updateCandidate]);

    const adoptCandidate = useCallback(async () => {
        const current = optionsRef.current;
        const snapshot = candidateRef.current;
        const source = snapshot.source;
        if (snapshot.status !== 'completed' || !source || !snapshot.text.trim()) return;

        if (current.isReadOnly) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'Unlock the chapter before adopting this candidate. The candidate is still available.', source: { ...source, staleReason: 'lock' } });
            return;
        }
        if (!sourceMatchesCurrent(source, current)) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The chapter, session, or draft revision changed. The candidate is preserved; regenerate before adopting.', source: { ...source, staleReason: 'draft' } });
            return;
        }

        const currentAnchor = current.captureAnchor();
        if (!currentAnchor || !anchorsMatch(currentAnchor, source.anchor)) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The insertion position or selection changed. Choose the current insertion point explicitly, or regenerate.', source: { ...source, staleReason: 'anchor' } });
            return;
        }

        const attempt = ++adoptionAttemptRef.current;
        updateCandidate({ ...snapshot, status: 'validating', errorMessage: null });
        try {
            await aiGenerationRepository.validateAdoption({
                bookId: source.bookId,
                chapterId: source.chapterId,
                databaseVersion: source.databaseVersion,
                retrievalSourceVersions: source.retrievalContext?.sourceVersions ?? [],
            });
        } catch (error) {
            if (attempt !== adoptionAttemptRef.current) return;
            const code = errorCode(error);
            const staleReason = code === 'READ_ONLY' ? 'lock'
                : code === 'CONTEXT_CHANGED' || code === 'VERSION_CONFLICT' ? 'retrieval'
                    : 'verification';
            const message = code === 'READ_ONLY'
                ? 'The chapter or one of its parent records is locked. The candidate is preserved.'
                : code === 'CONTEXT_CHANGED' || code === 'VERSION_CONFLICT'
                    ? 'The manuscript or a retrieved source changed. The candidate is preserved; regenerate from current sources.'
                    : 'The local source and lock check failed. The candidate is preserved and was not inserted.';
            updateCandidate({ ...candidateRef.current, status: 'stale', errorMessage: message, source: { ...source, staleReason } });
            return;
        }

        if (attempt !== adoptionAttemptRef.current || candidateRef.current.status !== 'validating') return;
        const latest = optionsRef.current;
        if (latest.isReadOnly) {
            updateCandidate({ ...candidateRef.current, status: 'stale', errorMessage: 'Unlock the chapter before adopting this candidate.', source: { ...source, staleReason: 'lock' } });
            return;
        }
        if (!sourceMatchesCurrent(source, latest)) {
            updateCandidate({ ...candidateRef.current, status: 'stale', errorMessage: 'The draft changed during source validation. Regenerate before adopting.', source: { ...source, staleReason: 'draft' } });
            return;
        }
        const latestAnchor = latest.captureAnchor();
        if (!latestAnchor || !anchorsMatch(latestAnchor, source.anchor)) {
            updateCandidate({ ...candidateRef.current, status: 'stale', errorMessage: 'The insertion position changed during source validation. Choose the current insertion point explicitly, or regenerate.', source: { ...source, staleReason: 'anchor' } });
            return;
        }

        if (!latest.insertCandidateAtAnchor(snapshot.text, source.anchor)) {
            updateCandidate({ ...candidateRef.current, status: 'stale', errorMessage: 'The editor changed before adoption. The candidate is preserved; choose the insertion position again or regenerate.', source: { ...source, staleReason: 'anchor' } });
            return;
        }

        updateCandidate({
            ...candidateRef.current,
            status: 'adopted',
            errorMessage: null,
            source: { ...source, staleReason: undefined },
        });
    }, [updateCandidate]);

    useEffect(() => {
        const active = activeRef.current;
        const source = candidateRef.current.source;
        const chapterOrSessionChanged = (active && (active.chapterId !== options.chapterId || active.sessionId !== options.sessionId))
            || (source && (
                source.bookId !== options.bookId
                || source.chapterId !== options.chapterId
                || source.sessionId !== options.sessionId
            ));
        if (!chapterOrSessionChanged) return;
        adoptionAttemptRef.current += 1;
        if (active) stop();
        updateCandidate(INITIAL_CANDIDATE);
    }, [options.bookId, options.chapterId, options.sessionId, stop, updateCandidate]);

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
        reselectInsertionPoint,
        toggleRetrievalHit,
    };
}
