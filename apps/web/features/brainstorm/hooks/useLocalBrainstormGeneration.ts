import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    aiGenerationRepository,
    type GenerationEvent,
    type GenerationRequest,
} from '../../../data/local/aiGenerationRepository';
import { aiErrorMessage, aiSettingsRepository, type AiConfigRecord } from '../../../data/local/aiSettingsRepository';
import type { BrainstormGenerationMetadata } from '../../../types';
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
}

interface ActiveGeneration {
    requestId: string;
    sessionId: string;
    lastSequence: number;
    candidateText: string;
    source: BrainstormGenerationContext;
    draftRevision: number;
    config: AiConfigRecord | null;
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

function makeMetadata(config: AiConfigRecord, source: BrainstormGenerationContext): BrainstormGenerationMetadata {
    if (source.target.kind !== 'brainstorm') throw new Error('Brainstorm target is required');
    return {
        configId: config.id,
        modelId: config.config.modelId,
        generatedAt: Date.now(),
        promptVersion: BRAINSTORM_PROMPT_VERSION,
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
    candidate: BrainstormCandidate,
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
                updateCandidate({ ...candidateRef.current, status: 'streaming', rawText: active.candidateText, errorMessage: null });
                return;
            case 'completed': {
                active.candidateText = event.payload.text;
                if (event.payload.finishReason === 'length') {
                    setIsGenerating(false);
                    updateCandidate({ ...candidateRef.current, status: 'failed', rawText: active.candidateText, errorMessage: generationError({ code: 'TRUNCATED' }) });
                } else if (!active.candidateText.trim()) {
                    setIsGenerating(false);
                    updateCandidate({ ...candidateRef.current, status: 'failed', rawText: '', errorMessage: generationError({ code: 'EMPTY_RESULT' }) });
                } else {
                    const parsed = parseBrainstormCandidate(active.candidateText);
                    if ('errorMessage' in parsed) {
                        setIsGenerating(false);
                        updateCandidate({ ...candidateRef.current, status: 'invalid', rawText: active.candidateText, errorMessage: parsed.errorMessage });
                    } else {
                        setIsGenerating(false);
                        updateCandidate({
                            ...candidateRef.current,
                            status: 'completed',
                            rawText: active.candidateText,
                            options: parsed.options,
                            metadata: active.config ? makeMetadata(active.config, active.source) : null,
                            errorMessage: null,
                        });
                    }
                }
                cleanupActive(active);
                return;
            }
            case 'failed':
                setIsGenerating(false);
                updateCandidate({ ...candidateRef.current, status: 'failed', rawText: active.candidateText, errorMessage: generationError(event.payload.error) });
                cleanupActive(active);
                return;
            case 'cancelled':
                setIsGenerating(false);
                updateCandidate({ ...candidateRef.current, status: 'cancelled', rawText: active.candidateText, errorMessage: generationError({ code: 'CANCELLED' }) });
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
        setIsGenerating(false);
        updateCandidate({ ...candidateRef.current, status: 'cancelled', rawText: active.candidateText, errorMessage: generationError({ code: 'CANCELLED' }) });
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [cleanupActive, updateCandidate]);

    const generate = useCallback(async () => {
        const current = optionsRef.current;
        if (!current.enabled || activeRef.current) return;
        let source: BrainstormGenerationContext;
        try {
            source = current.getContext();
        } catch (error) {
            updateCandidate({ ...EMPTY_BRAINSTORM_CANDIDATE, status: 'failed', errorMessage: error instanceof Error ? error.message : 'The brainstorm context is unavailable.' });
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
        };
        activeRef.current = active;
        setIsGenerating(true);
        updateCandidate({
            status: 'starting', rawText: '', options: [], errorMessage: null, metadata: null,
            sourceFingerprint: source.sourceFingerprint, draftRevision,
        });

        try {
            const configs = await aiSettingsRepository.list();
            if (!isActive(active)) return;
            if (!configs.defaultConfigId) throw Object.assign(new Error('CONFIGURATION_REQUIRED'), { code: 'CONFIGURATION_REQUIRED' }) as AiGenerationError;
            const config = configs.configs.find(item => item.id === configs.defaultConfigId);
            if (!config) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }) as AiGenerationError;
            if (config.credentialStatus === 'unavailable') throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }) as AiGenerationError;
            active.config = config;

            const contextSnapshot = await aiGenerationRepository.prepareContext({
                bookId: current.bookId,
                sessionId: active.sessionId,
                draftRevision,
                maxChars: source.maxChars,
                target: source.target,
                sections: source.sections,
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
            };
            await aiGenerationRepository.start(input);
        } catch (error) {
            if (!isActive(active)) return;
            setIsGenerating(false);
            updateCandidate({ ...candidateRef.current, status: 'failed', errorMessage: generationError(error) });
            cleanupActive(active);
        }
    }, [cleanupActive, handleEvent, isActive, updateCandidate]);

    const discardCandidate = useCallback(() => {
        if (activeRef.current) stop();
        updateCandidate(EMPTY_BRAINSTORM_CANDIDATE);
    }, [stop, updateCandidate]);

    const closeCandidate = useCallback(() => { discardCandidate(); }, [discardCandidate]);

    const regenerate = useCallback(async () => {
        discardCandidate();
        await generate();
    }, [discardCandidate, generate]);

    const acceptOption = useCallback((optionId: string): boolean => {
        const snapshot = candidateRef.current;
        if (!snapshot.options.some(option => option.id === optionId)) return false;
        if (optionsRef.current.isReadOnly) {
            updateCandidate({ ...snapshot, status: 'stale', errorMessage: 'This workspace is read-only. The candidate is still available for review.' });
            return false;
        }
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
    };
}
