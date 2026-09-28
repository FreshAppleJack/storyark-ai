import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    aiGenerationRepository,
    type GenerationEvent,
    type GenerationRequest,
} from '../../../data/local/aiGenerationRepository';
import { retrievalRepository } from '../../../data/local/retrievalRepository';
import { aiErrorMessage, aiSettingsRepository, type AiConfigRecord } from '../../../data/local/aiSettingsRepository';
import { generationRetrievalTrace, retrievalContextSection, retrievalStatusNotice } from '../../retrieval/retrievalContext';
import type { BrainstormGenerationMetadata } from '../../../types';
import type { RetrievalContext, RetrievalSearchStatus } from '../../../domain/retrieval/contracts';
import {
    EMPTY_BRAINSTORM_CANDIDATE,
    parseBrainstormCandidate,
    type BrainstormCandidate,
} from '../brainstormCandidate';
import { BRAINSTORM_PROMPT_VERSION, type BrainstormGenerationContext } from '../brainstormGeneration';

interface UseLocalBrainstormGenerationOptions {
    enabled: boolean;
    bookId: string;
    isReadOnly: boolean;
    getContext: () => BrainstormGenerationContext;
}

interface UseLocalBrainstormGenerationResult {
    isGenerating: boolean;
    candidate: BrainstormCandidate;
    generate: () => Promise<void>;
    stop: () => void;
    regenerate: () => Promise<void>;
    discardCandidate: () => void;
    closeCandidate: () => void;
    acceptOption: (optionId: string) => boolean;
    toggleRetrievalHit: (hitId: string) => void;
}

interface ActiveGeneration {
    requestId: string;
    sessionId: string;
    lastSequence: number;
    candidateText: string;
    source: BrainstormGenerationContext;
    draftRevision: number;
    config: AiConfigRecord | null;
    previousCandidate: BrainstormCandidate | null;
    retrievalContext: RetrievalContext | null;
    retrievalStatus: RetrievalSearchStatus | null;
    retrievalNotice: string | null;
    unlisten?: () => void;
}

interface AiGenerationError extends Error { code: string }

function requestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `brainstorm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sessionId(): string {
    return requestId();
}

function errorCode(error: unknown): string {
    return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function generationError(error: unknown): string {
    switch (errorCode(error)) {
        case 'CONFIGURATION_REQUIRED':
            return 'Choose a default AI model in Settings before generating.';
        case 'EMPTY_RESULT':
            return 'The model returned no brainstorm options. Existing options and manual edits are unchanged.';
        case 'CANCELLED':
            return 'Generation stopped. Existing options and manual edits are unchanged.';
        case 'CONTEXT_CHANGED':
            return 'The brainstorm sources changed. The candidate is preserved; regenerate from the current context.';
        default:
            return aiErrorMessage(error);
    }
}

function makeMetadata(
    config: AiConfigRecord,
    source: BrainstormGenerationContext,
    retrievalContext: RetrievalContext | null,
): BrainstormGenerationMetadata {
    if (source.target.kind !== 'brainstorm') throw new Error('Brainstorm target is required');
    return {
        configId: config.id,
        modelId: config.config.modelId,
        generatedAt: Date.now(),
        promptVersion: BRAINSTORM_PROMPT_VERSION,
        includesPlanning: source.sections.some(section => (
            section.kind === 'authorSetting' || section.kind === 'manualSummary' || section.kind === 'futurePlan'
        )),
        retrieval: retrievalContext ? {
            retrievalVersion: retrievalContext.retrievalVersion,
            requestedAt: retrievalContext.requestedAt,
            sourceVersions: retrievalContext.sourceVersions.map(version => ({ ...version })),
            includedHitIds: [...retrievalContext.includedHitIds],
            indexVersion: retrievalContext.indexVersion,
            embeddingFingerprint: retrievalContext.embeddingFingerprint,
        } : null,
        source: {
            bookId: typeof source.sourceSnapshot.bookId === 'string' ? source.sourceSnapshot.bookId : '',
            workspaceDatabaseVersion: source.target.workspaceDatabaseVersion,
            planningDatabaseVersion: source.target.planningDatabaseVersion,
            graphDatabaseVersion: source.target.graphDatabaseVersion,
            selectedChapters: source.target.sources.map(item => ({
                chapterId: item.chapterId,
                databaseVersion: item.databaseVersion,
            })),
        },
    };
}

function sameSource(
    candidate: Pick<BrainstormCandidate, 'sourceFingerprint' | 'draftRevision'>,
    current: BrainstormGenerationContext,
): boolean {
    return !!candidate.sourceFingerprint
        && candidate.sourceFingerprint === current.sourceFingerprint
        && candidate.draftRevision === current.draftRevision;
}

export function useLocalBrainstormGeneration({
    enabled,
    bookId,
    isReadOnly,
    getContext,
}: UseLocalBrainstormGenerationOptions): UseLocalBrainstormGenerationResult {
    const [candidate, setCandidate] = useState<BrainstormCandidate>(EMPTY_BRAINSTORM_CANDIDATE);
    const [isGenerating, setIsGenerating] = useState(false);
    const activeRef = useRef<ActiveGeneration | null>(null);
    const candidateRef = useRef(candidate);
    const optionsRef = useRef({ enabled, bookId, isReadOnly, getContext });
    const sessionRef = useRef(sessionId());
    const excludedHitIdsRef = useRef<string[]>([]);

    useLayoutEffect(() => {
        optionsRef.current = { enabled, bookId, isReadOnly, getContext };
    });
    useLayoutEffect(() => {
        candidateRef.current = candidate;
    }, [candidate]);

    const updateCandidate = useCallback((next: BrainstormCandidate) => {
        candidateRef.current = next;
        setCandidate(next);
    }, []);

    const candidateAfterFailedAttempt = useCallback((
        active: ActiveGeneration,
        status: 'invalid' | 'failed' | 'cancelled' | 'stale',
        rawText: string,
        errorMessage: string,
    ): BrainstormCandidate => {
        const attempt = {
            status,
            rawText,
            errorMessage,
            metadata: active.config ? makeMetadata(active.config, active.source, active.retrievalContext) : null,
            retrievalContext: active.retrievalContext,
            retrievalStatus: active.retrievalStatus,
            retrievalNotice: active.retrievalNotice,
        };
        const previousCandidate = active.previousCandidate;
        if (previousCandidate) {
            const previousIsCurrent = (() => {
                try {
                    return sameSource(previousCandidate, optionsRef.current.getContext());
                } catch {
                    return false;
                }
            })();
            return {
                ...previousCandidate,
                status: status === 'stale' || !previousIsCurrent ? 'stale' : previousCandidate.status,
                errorMessage: null,
                lastAttempt: attempt,
            };
        }
        return {
            ...EMPTY_BRAINSTORM_CANDIDATE,
            status,
            rawText,
            errorMessage,
            metadata: active.config ? makeMetadata(active.config, active.source, active.retrievalContext) : null,
            sourceFingerprint: active.source.sourceFingerprint,
            draftRevision: active.draftRevision,
            retrievalContext: active.retrievalContext,
            retrievalStatus: active.retrievalStatus,
            retrievalNotice: active.retrievalNotice,
        };
    }, []);

    const cleanupActive = useCallback((active: ActiveGeneration) => {
        active.unlisten?.();
        active.unlisten = undefined;
        if (activeRef.current === active) activeRef.current = null;
    }, []);

    const isActive = useCallback((active: ActiveGeneration) => activeRef.current === active, []);

    const handleEvent = useCallback((event: GenerationEvent) => {
        const active = activeRef.current;
        if (!active || event.requestId !== active.requestId || event.sessionId !== active.sessionId) return;
        if (event.sequence <= active.lastSequence) return;
        active.lastSequence = event.sequence;

        switch (event.payload.kind) {
            case 'started':
                updateCandidate({ ...candidateRef.current, status: 'streaming', errorMessage: null });
                return;
            case 'delta':
                active.candidateText += event.payload.text;
                if (candidateRef.current.status !== 'streaming') {
                    updateCandidate({ ...candidateRef.current, status: 'streaming', errorMessage: null });
                }
                return;
            case 'completed': {
                active.candidateText = event.payload.text;
                let currentSource: BrainstormGenerationContext | null = null;
                try { currentSource = optionsRef.current.getContext(); } catch { /* The frozen response remains inspectable but cannot be adopted. */ }
                if (!currentSource || !sameSource(active.source, currentSource)) {
                    setIsGenerating(false);
                    updateCandidate(candidateAfterFailedAttempt(
                        active,
                        'stale',
                        active.candidateText,
                        'The selected chapters or planning changed during generation. This response was kept for review and was not made selectable.',
                    ));
                    cleanupActive(active);
                    return;
                }
                if (event.payload.finishReason === 'length') {
                    setIsGenerating(false);
                    updateCandidate(candidateAfterFailedAttempt(active, 'failed', active.candidateText, generationError({ code: 'TRUNCATED' })));
                } else if (!active.candidateText.trim()) {
                    setIsGenerating(false);
                    updateCandidate(candidateAfterFailedAttempt(active, 'failed', '', generationError({ code: 'EMPTY_RESULT' })));
                } else {
                    const parsed = parseBrainstormCandidate(active.candidateText);
                    if ('errorMessage' in parsed) {
                        setIsGenerating(false);
                        updateCandidate(candidateAfterFailedAttempt(active, 'invalid', active.candidateText, parsed.errorMessage));
                    } else {
                        setIsGenerating(false);
                        updateCandidate({
                            ...candidateRef.current,
                            status: 'completed',
                            rawText: active.candidateText,
                            options: parsed.options,
                            metadata: active.config ? makeMetadata(active.config, active.source, active.retrievalContext) : null,
                            errorMessage: null,
                        });
                    }
                }
                cleanupActive(active);
                return;
            }
            case 'failed':
                setIsGenerating(false);
                updateCandidate(candidateAfterFailedAttempt(active, 'failed', active.candidateText, generationError(event.payload.error)));
                cleanupActive(active);
                return;
            case 'cancelled':
                setIsGenerating(false);
                updateCandidate(candidateAfterFailedAttempt(active, 'cancelled', active.candidateText, generationError({ code: 'CANCELLED' })));
                cleanupActive(active);
                return;
            default:
                return;
        }
    }, [candidateAfterFailedAttempt, cleanupActive, updateCandidate]);

    const stop = useCallback(() => {
        const active = activeRef.current;
        if (!active) return;
        cleanupActive(active);
        setIsGenerating(false);
        updateCandidate(candidateAfterFailedAttempt(active, 'cancelled', active.candidateText, generationError({ code: 'CANCELLED' })));
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [candidateAfterFailedAttempt, cleanupActive, updateCandidate]);

    const generate = useCallback(async () => {
        const current = optionsRef.current;
        if (!current.enabled || activeRef.current) return;
        let source: BrainstormGenerationContext;
        try {
            source = current.getContext();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'The brainstorm context is unavailable.';
            const previous = candidateRef.current;
            if (previous.status !== 'idle') {
                updateCandidate({
                    ...previous,
                    errorMessage: null,
                    lastAttempt: {
                        status: 'failed',
                        rawText: '',
                        errorMessage,
                        metadata: null,
                        retrievalContext: null,
                        retrievalStatus: null,
                        retrievalNotice: null,
                    },
                });
            } else {
                updateCandidate({ ...EMPTY_BRAINSTORM_CANDIDATE, status: 'failed', errorMessage });
            }
            return;
        }

        const draftRevision = source.draftRevision;
        const active: ActiveGeneration = {
            requestId: requestId(),
            sessionId: sessionRef.current,
            lastSequence: -1,
            candidateText: '',
            source,
            draftRevision,
            config: null,
            previousCandidate: candidateRef.current.status === 'idle' ? null : candidateRef.current,
            retrievalContext: null,
            retrievalStatus: null,
            retrievalNotice: null,
        };
        activeRef.current = active;
        setIsGenerating(true);
        updateCandidate({
            status: 'starting', rawText: '', options: [], errorMessage: null, metadata: null,
            sourceFingerprint: source.sourceFingerprint, draftRevision,
            retrievalContext: null, retrievalStatus: null, retrievalNotice: null,
        });

        try {
            const configs = await aiSettingsRepository.list();
            if (!isActive(active)) return;
            if (!configs.defaultConfigId) throw Object.assign(new Error('CONFIGURATION_REQUIRED'), { code: 'CONFIGURATION_REQUIRED' }) as AiGenerationError;
            const config = configs.configs.find(item => item.id === configs.defaultConfigId);
            if (!config) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }) as AiGenerationError;
            if (config.credentialStatus === 'unavailable') throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }) as AiGenerationError;
            active.config = config;

            let retrievalResponse: Awaited<ReturnType<typeof retrievalRepository.search>> | null = null;
            let retrievalNotice: string | null = null;
            try {
                retrievalResponse = await retrievalRepository.search({
                    scope: source.retrievalScope,
                    query: source.retrievalQuery,
                    mode: 'hybrid',
                    limit: 8,
                    excludedHitIds: excludedHitIdsRef.current,
                    charBudget: 8_000,
                    tokenBudget: 2_000,
                    adjacentChunkCount: 1,
                    task: 'brainstorm',
                    indexStatus: undefined,
                    freshnessPolicy: { freshOnly: true, allowLexicalFallback: true, maxWaitMs: 500 },
                });
                retrievalNotice = retrievalStatusNotice(retrievalResponse);
            } catch {
                retrievalNotice = 'Retrieval was unavailable. The explicit chapter, planning, and character context remains in use.';
            }
            if (!isActive(active)) return;
            const retrievalSection = retrievalResponse ? retrievalContextSection(retrievalResponse.context) : null;
            const sections = retrievalSection ? [...source.sections, retrievalSection] : source.sections;
            const retrievalContext = retrievalResponse?.context ?? null;
            active.retrievalContext = retrievalContext;
            active.retrievalStatus = retrievalResponse?.status ?? null;
            active.retrievalNotice = retrievalNotice;
            const sourceVersions = source.target.kind === 'brainstorm' ? source.target.sources : [];
            updateCandidate({
                ...candidateRef.current,
                retrievalContext,
                retrievalStatus: retrievalResponse?.status ?? null,
                retrievalNotice,
            });

            const contextSnapshot = await aiGenerationRepository.prepareContext({
                bookId: current.bookId,
                sessionId: active.sessionId,
                draftRevision,
                maxChars: sections.reduce((total, section) => total + Array.from(section.text).length, 0),
                target: source.target,
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
                sessionId: active.sessionId,
                draftRevision,
                config: { id: config.id, expectedConfigVersion: config.configVersion },
                target: source.target,
                contextSnapshotId: contextSnapshot.contextSnapshotId,
                outputChars: source.outputChars,
                retrievalTrace: retrievalResponse
                    ? generationRetrievalTrace(retrievalResponse, sourceVersions)
                    : null,
            };
            await aiGenerationRepository.start(input);
        } catch (error) {
            if (!isActive(active)) return;
            setIsGenerating(false);
            updateCandidate(candidateAfterFailedAttempt(active, 'failed', active.candidateText, generationError(error)));
            cleanupActive(active);
        }
    }, [candidateAfterFailedAttempt, cleanupActive, handleEvent, isActive, updateCandidate]);

    const discardCandidate = useCallback(() => {
        if (activeRef.current) stop();
        excludedHitIdsRef.current = [];
        updateCandidate(EMPTY_BRAINSTORM_CANDIDATE);
    }, [stop, updateCandidate]);

    const closeCandidate = useCallback(() => { discardCandidate(); }, [discardCandidate]);

    const regenerate = useCallback(async () => {
        if (activeRef.current) stop();
        await generate();
    }, [generate, stop]);

    const toggleRetrievalHit = useCallback((hitId: string) => {
        const excluded = new Set(excludedHitIdsRef.current);
        if (excluded.has(hitId)) excluded.delete(hitId);
        else excluded.add(hitId);
        excludedHitIdsRef.current = [...excluded];
        const current = candidateRef.current;
        if (current.lastAttempt?.retrievalContext) {
            updateCandidate({
                ...current,
                lastAttempt: {
                    ...current.lastAttempt,
                    retrievalContext: {
                        ...current.lastAttempt.retrievalContext,
                        excludedHitIds: excludedHitIdsRef.current,
                    },
                },
            });
        } else if (current.retrievalContext) {
            updateCandidate({
                ...current,
                retrievalContext: { ...current.retrievalContext, excludedHitIds: excludedHitIdsRef.current },
            });
        }
    }, [updateCandidate]);

    const acceptOption = useCallback((optionId: string): boolean => {
        const snapshot = candidateRef.current;
        if (!snapshot.options.some(option => option.id === optionId)) return false;
        if (optionsRef.current.isReadOnly) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'This workspace is read-only. The candidate is still available for review.' });
            return false;
        }
        // Once accepted, all options have entered the saved-workspace draft.
        // Switching among those already-adopted directions is an ordinary
        // workspace choice, not a second adoption against the old revision.
        if (snapshot.status === 'adopted') return true;
        let current: BrainstormGenerationContext;
        try { current = optionsRef.current.getContext(); } catch {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The brainstorm sources are no longer available. The candidate is preserved.' });
            return false;
        }
        if (!sameSource(snapshot, current)) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'The brainstorm sources changed. Regenerate before choosing this candidate.' });
            return false;
        }
        updateCandidate({ ...snapshot, status: 'adopted', errorMessage: null });
        return true;
    }, [updateCandidate]);

    useEffect(() => () => {
        const active = activeRef.current;
        if (!active) return;
        cleanupActive(active);
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [cleanupActive]);

    return {
        isGenerating,
        candidate,
        generate,
        stop,
        regenerate,
        discardCandidate,
        closeCandidate,
        acceptOption,
        toggleRetrievalHit,
    };
}
