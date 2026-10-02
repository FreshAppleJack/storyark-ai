import { userErrorMessage } from '../../../data/diagnostics';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { aiGenerationRepository, type GenerationEvent, type GenerationRequest } from '../../../data/local/aiGenerationRepository';
import { aiErrorMessage, aiSettingsRepository, type AiConfigRecord } from '../../../data/local/aiSettingsRepository';
import { retrievalRepository } from '../../../data/local/retrievalRepository';
import type { RetrievalContext, RetrievalSearchStatus } from '../../../domain/retrieval/contracts';
import type { Book, Chapter, ChapterSummary, StoryPlanning } from '../../../types';
import { generationRetrievalTrace, retrievalContextSection } from '../../retrieval/retrievalContext';
import {
    buildChapterSummaryGenerationContext,
    buildChapterSummaryGenerationMetadata,
    validateChapterSummaryCandidate,
    type ChapterSummaryGenerationContext,
} from '../chapterSummaryGeneration';
import type { ChapterSummarySuggestion } from '../../../domain/chapterSummarySource';

export type SummaryModelAvailability = 'checking' | 'ready' | 'missing' | 'credential-unavailable' | 'unavailable';

export interface SummaryAdoptionInput {
    chapterId: string;
    summary: string;
    sourceSnapshot: NonNullable<ChapterSummary['sourceSnapshot']>;
    generationMetadata: NonNullable<ChapterSummary['generationMetadata']>;
    expectedDraftRevision: number;
}

interface UseChapterSummarySuggestionsOptions {
    enabled: boolean;
    bookId: string;
    book: Book | undefined;
    planning: StoryPlanning;
    draftRevision: number;
    flushPlanning: () => Promise<boolean>;
    getPlanningSnapshot: () => StoryPlanning;
    getDraftRevision: () => number;
    isReadOnly: boolean;
    updateManualSummary: (chapterId: string, summary: string) => void;
    adoptSummary: (input: SummaryAdoptionInput) => Promise<'saved' | 'stale' | 'save-failed'>;
}

interface UseChapterSummarySuggestionsResult {
    suggestions: Record<string, ChapterSummarySuggestion>;
    activeChapterId: string | null;
    modelAvailability: SummaryModelAvailability;
    modelNotice: string | null;
    isCurrent: (chapterId: string) => boolean;
    generate: (chapterId: string) => Promise<void>;
    stop: (chapterId?: string) => void;
    keepManual: (chapterId: string) => void;
    accept: (chapterId: string) => Promise<void>;
    toggleRetrievalHit: (chapterId: string, hitId: string) => void;
}

interface ActiveSummaryGeneration {
    requestId: string;
    sessionId: string;
    chapterId: string;
    lastSequence: number;
    candidateText: string;
    source: ChapterSummaryGenerationContext;
    config: AiConfigRecord | null;
    previousCandidate: ChapterSummarySuggestion | null;
    retrievalContext: RetrievalContext | null;
    retrievalStatus: RetrievalSearchStatus | null;
    retrievalNotice: string | null;
    unlisten?: () => void;
}

interface GenerationError extends Error { code: string }

function requestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `chapter-summary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sessionId(): string {
    return requestId();
}

function codeOf(error: unknown): string {
    return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function userError(error: unknown): string {
    switch (codeOf(error)) {
        case 'CONFIGURATION_REQUIRED': return 'Choose a default AI model in Settings. You can continue to edit and save summaries manually.';
        case 'EMPTY_RESULT': return 'The model returned an empty summary. The existing summary was not changed.';
        case 'CANCELLED': return 'Generation stopped. The existing summary was not changed.';
        case 'CONTEXT_CHANGED': return 'The chapter or planning changed during generation. Review the preserved suggestion or generate a new one.';
        default: return aiErrorMessage(error);
    }
}

function sameSource(candidate: Pick<ChapterSummarySuggestion, 'sourceFingerprint' | 'draftRevision'>, current: ChapterSummaryGenerationContext): boolean {
    return !!candidate.sourceFingerprint
        && candidate.sourceFingerprint === current.sourceFingerprint
        && candidate.draftRevision === current.draftRevision;
}

function chapterFor(book: Book | undefined, chapterId: string): Chapter | undefined {
    return book?.volumes.flatMap(volume => volume.chapters).find(chapter => chapter.id === chapterId);
}

function noSuggestion(chapterId: string, previousSummary = ''): ChapterSummarySuggestion {
    return {
        status: 'failed',
        chapterId,
        rawText: '',
        suggestedSummary: null,
        errorMessage: null,
        previousSummary,
        sourcePreview: '',
        sourceFingerprint: null,
        draftRevision: null,
        sourceSnapshot: null,
        generationMetadata: null,
        retrievalContext: null,
        retrievalStatus: null,
        retrievalNotice: null,
    };
}

function retrievalNotice(response: Awaited<ReturnType<typeof retrievalRepository.search>>): string | null {
    if (response.context.evidence.length > 0 && response.degraded) {
        return 'Using keyword matches as reference material.';
    }
    if (response.context.evidence.length > 0) return null;
    switch (response.status) {
        case 'embedding_unavailable': return 'No extra reference material was available. The AI will use the selected chapter text.';
        case 'index_not_ready': return 'Search is not ready yet. The AI will use the selected chapter text.';
        case 'stale_only': return 'Out-of-date reference material was left out. The AI will use the selected chapter text.';
        case 'future_plan_only': return 'Future plans were left out of the reference material. The AI will use the selected chapter text.';
        case 'no_results':
        case 'lexical_no_match': return 'No extra reference material matched. The AI will use the selected chapter text.';
        default: return 'No extra reference material was added. The AI will use the selected chapter text.';
    }
}

export function useChapterSummarySuggestions({
    enabled,
    bookId,
    book,
    planning,
    draftRevision,
    flushPlanning,
    getPlanningSnapshot,
    getDraftRevision,
    isReadOnly,
    updateManualSummary,
    adoptSummary,
}: UseChapterSummarySuggestionsOptions): UseChapterSummarySuggestionsResult {
    const [suggestions, setSuggestions] = useState<Record<string, ChapterSummarySuggestion>>({});
    const [activeChapterId, setActiveChapterId] = useState<string | null>(null);
    const [configuredModelAvailability, setModelAvailability] = useState<SummaryModelAvailability>('checking');
    const [configuredModelNotice, setModelNotice] = useState<string | null>(null);
    const modelAvailability = enabled ? configuredModelAvailability : 'unavailable';
    const modelNotice = enabled
        ? configuredModelNotice
        : 'AI suggestions are available in the local desktop workspace. Manual summaries remain available.';
    const suggestionRef = useRef(suggestions);
    const activeRef = useRef<ActiveSummaryGeneration | null>(null);
    const optionsRef = useRef({ enabled, bookId, book, planning, draftRevision, flushPlanning, getPlanningSnapshot, getDraftRevision, isReadOnly, updateManualSummary, adoptSummary });
    const sessionRef = useRef(sessionId());
    const excludedHitIdsRef = useRef(new Map<string, string[]>());

    useLayoutEffect(() => {
        optionsRef.current = { enabled, bookId, book, planning, draftRevision, flushPlanning, getPlanningSnapshot, getDraftRevision, isReadOnly, updateManualSummary, adoptSummary };
    });
    useLayoutEffect(() => { suggestionRef.current = suggestions; }, [suggestions]);

    const updateSuggestion = useCallback((chapterId: string, suggestion: ChapterSummarySuggestion | null) => {
        const next = { ...suggestionRef.current };
        if (suggestion) next[chapterId] = suggestion;
        else delete next[chapterId];
        suggestionRef.current = next;
        setSuggestions(next);
    }, []);

    useEffect(() => {
        let mounted = true;
        if (!enabled) {
            return () => { mounted = false; };
        }
        void aiSettingsRepository.list().then(configs => {
            if (!mounted) return;
            if (!configs.defaultConfigId || !configs.configs.some(item => item.id === configs.defaultConfigId)) {
                setModelAvailability('missing');
                setModelNotice('No default AI model is configured. You can continue to edit and save summaries manually.');
                return;
            }
            const config = configs.configs.find(item => item.id === configs.defaultConfigId);
            if (config?.credentialStatus === 'unavailable') {
                setModelAvailability('credential-unavailable');
                setModelNotice('The default model credential is unavailable. Manual summaries remain available.');
                return;
            }
            setModelAvailability('ready');
            setModelNotice(null);
        }).catch(() => {
            if (!mounted) return;
            setModelAvailability('unavailable');
            setModelNotice('The local AI configuration could not be read. Manual summaries remain available.');
        });
        return () => { mounted = false; };
    }, [enabled]);

    const cleanupActive = useCallback((active: ActiveSummaryGeneration) => {
        active.unlisten?.();
        active.unlisten = undefined;
        if (activeRef.current === active) {
            activeRef.current = null;
            setActiveChapterId(null);
        }
    }, []);

    const isActive = useCallback((active: ActiveSummaryGeneration) => activeRef.current === active, []);

    const getCurrentContext = useCallback((chapterId: string): ChapterSummaryGenerationContext => {
        const current = optionsRef.current;
        const chapter = chapterFor(current.book, chapterId);
        if (!current.book || !chapter) throw new Error('The chapter is no longer available. Reload the planning page.');
        return buildChapterSummaryGenerationContext(current.book, current.getPlanningSnapshot(), chapter, current.getDraftRevision());
    }, []);

    const isCurrent = useCallback((chapterId: string): boolean => {
        const candidate = suggestionRef.current[chapterId];
        if (!candidate?.sourceFingerprint || candidate.draftRevision === null) return false;
        if (candidate.draftRevision !== optionsRef.current.getDraftRevision()) return false;
        try { return sameSource(candidate, getCurrentContext(chapterId)); }
        catch { return false; }
    }, [getCurrentContext]);

    const failedAttempt = useCallback((
        active: ActiveSummaryGeneration,
        status: 'invalid' | 'failed' | 'cancelled' | 'stale',
        rawText: string,
        errorMessage: string,
        metadata: ChapterSummarySuggestion['generationMetadata'],
    ): ChapterSummarySuggestion => {
        const attempt = {
            status,
            rawText,
            errorMessage,
            generationMetadata: metadata,
            retrievalContext: active.retrievalContext,
            retrievalStatus: active.retrievalStatus,
            retrievalNotice: active.retrievalNotice,
        };
        if (active.previousCandidate) {
            return {
                ...active.previousCandidate,
                status: status === 'stale' ? 'stale' : active.previousCandidate.status,
                errorMessage: status === 'stale' ? errorMessage : active.previousCandidate.errorMessage,
                lastAttempt: attempt,
            };
        }
        return {
            ...noSuggestion(active.chapterId, active.source.previousSummary),
            status,
            rawText,
            errorMessage,
            sourcePreview: active.source.sourcePreview,
            sourceFingerprint: active.source.sourceFingerprint,
            draftRevision: active.source.draftRevision,
            sourceSnapshot: active.source.sourceSnapshot,
            generationMetadata: metadata,
            retrievalContext: active.retrievalContext,
            retrievalStatus: active.retrievalStatus,
            retrievalNotice: active.retrievalNotice,
        };
    }, []);

    const handleEvent = useCallback((event: GenerationEvent) => {
        const active = activeRef.current;
        if (!active || event.requestId !== active.requestId || event.sessionId !== active.sessionId
            || event.sequence <= active.lastSequence) return;
        active.lastSequence = event.sequence;
        const previous = suggestionRef.current[active.chapterId] ?? noSuggestion(active.chapterId, active.source.previousSummary);
        const metadata = active.config
            ? buildChapterSummaryGenerationMetadata(active.config, active.source, active.retrievalContext)
            : null;
        switch (event.payload.kind) {
            case 'started':
                updateSuggestion(active.chapterId, { ...previous, status: 'streaming', errorMessage: null });
                return;
            case 'delta':
                active.candidateText += event.payload.text;
                return;
            case 'completed': {
                active.candidateText = event.payload.text;
                let currentSource: ChapterSummaryGenerationContext | null = null;
                try { currentSource = getCurrentContext(active.chapterId); } catch { /* Keep but do not adopt. */ }
                if (!currentSource || !sameSource(active.source, currentSource)) {
                    updateSuggestion(active.chapterId, failedAttempt(active, 'stale', active.candidateText,
                        'The chapter, planning, or current summary changed during generation. This response was kept for review and was not adopted.', metadata));
                } else if (event.payload.finishReason === 'length') {
                    updateSuggestion(active.chapterId, failedAttempt(active, 'failed', active.candidateText,
                        'The response was truncated. The existing summary is unchanged.', metadata));
                } else {
                    const validated = validateChapterSummaryCandidate(active.candidateText);
                    if (validated.error) {
                        updateSuggestion(active.chapterId, failedAttempt(active, 'invalid', active.candidateText, validated.error, metadata));
                    } else {
                        updateSuggestion(active.chapterId, {
                            ...previous,
                            status: 'candidate',
                            rawText: active.candidateText,
                            suggestedSummary: validated.summary,
                            errorMessage: null,
                            previousSummary: active.source.previousSummary,
                            sourcePreview: active.source.sourcePreview,
                            sourceFingerprint: active.source.sourceFingerprint,
                            draftRevision: active.source.draftRevision,
                            sourceSnapshot: active.source.sourceSnapshot,
                            generationMetadata: metadata,
                            retrievalContext: active.retrievalContext,
                            retrievalStatus: active.retrievalStatus,
                            retrievalNotice: active.retrievalNotice,
                        });
                    }
                }
                cleanupActive(active);
                return;
            }
            case 'failed':
                updateSuggestion(active.chapterId, failedAttempt(active, 'failed', active.candidateText, userError(event.payload.error), metadata));
                cleanupActive(active);
                return;
            case 'cancelled':
                updateSuggestion(active.chapterId, failedAttempt(active, 'cancelled', active.candidateText, userError({ code: 'CANCELLED' }), metadata));
                cleanupActive(active);
                return;
            default: return;
        }
    }, [cleanupActive, failedAttempt, getCurrentContext, updateSuggestion]);

    const stop = useCallback((chapterId?: string) => {
        const active = activeRef.current;
        if (!active || (chapterId && active.chapterId !== chapterId)) return;
        cleanupActive(active);
        const metadata = active.config ? buildChapterSummaryGenerationMetadata(active.config, active.source, active.retrievalContext) : null;
        updateSuggestion(active.chapterId, failedAttempt(active, 'cancelled', active.candidateText,
            'Generation stopped. The existing summary is unchanged.', metadata));
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [cleanupActive, failedAttempt, updateSuggestion]);

    const generate = useCallback(async (chapterId: string) => {
        let current = optionsRef.current;
        if (!current.enabled || current.isReadOnly || activeRef.current) return;
        if (!await current.flushPlanning()) {
            const previousSummary = current.getPlanningSnapshot().chapterSummaries.find(item => item.chapterId === chapterId)?.summary ?? '';
            updateSuggestion(chapterId, {
                ...noSuggestion(chapterId, previousSummary),
                errorMessage: 'The planning draft could not be saved. Resolve the save error before requesting a summary suggestion; your draft remains available.',
            });
            return;
        }
        current = optionsRef.current;
        let source: ChapterSummaryGenerationContext;
        try { source = getCurrentContext(chapterId); }
        catch (error) {
            const previousSummary = current.getPlanningSnapshot().chapterSummaries.find(item => item.chapterId === chapterId)?.summary ?? '';
            updateSuggestion(chapterId, { ...noSuggestion(chapterId, previousSummary), errorMessage: userErrorMessage(error, 'The chapter source is unavailable.', 'summary') });
            return;
        }
        const active: ActiveSummaryGeneration = {
            requestId: requestId(),
            sessionId: sessionRef.current,
            chapterId,
            lastSequence: -1,
            candidateText: '',
            source,
            config: null,
            previousCandidate: suggestionRef.current[chapterId]?.status === 'candidate' ? suggestionRef.current[chapterId] : null,
            retrievalContext: null,
            retrievalStatus: null,
            retrievalNotice: null,
        };
        activeRef.current = active;
        setActiveChapterId(chapterId);
        updateSuggestion(chapterId, {
            ...noSuggestion(chapterId, source.previousSummary),
            status: 'starting',
            sourceFingerprint: source.sourceFingerprint,
            draftRevision: source.draftRevision,
            sourceSnapshot: source.sourceSnapshot,
            sourcePreview: source.sourcePreview,
            ...(active.previousCandidate ? { lastAttempt: active.previousCandidate.lastAttempt } : {}),
        });

        try {
            const configs = await aiSettingsRepository.list();
            if (!isActive(active)) return;
            if (!configs.defaultConfigId) throw Object.assign(new Error('CONFIGURATION_REQUIRED'), { code: 'CONFIGURATION_REQUIRED' }) as GenerationError;
            const config = configs.configs.find(item => item.id === configs.defaultConfigId);
            if (!config) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' }) as GenerationError;
            if (config.credentialStatus === 'unavailable') throw Object.assign(new Error('CREDENTIAL_UNAVAILABLE'), { code: 'CREDENTIAL_UNAVAILABLE' }) as GenerationError;
            active.config = config;

            let response: Awaited<ReturnType<typeof retrievalRepository.search>> | null = null;
            let notice: string | null = null;
            try {
                response = await retrievalRepository.search({
                    scope: source.retrievalScope,
                    query: source.retrievalQuery,
                    mode: 'hybrid',
                    limit: 8,
                    excludedHitIds: excludedHitIdsRef.current.get(chapterId) ?? [],
                    charBudget: 6_000,
                    tokenBudget: 1_500,
                    adjacentChunkCount: 0,
                    task: 'chapter_summary',
                    freshnessPolicy: { freshOnly: true, allowLexicalFallback: true, maxWaitMs: 500 },
                });
                notice = retrievalNotice(response);
            } catch {
                notice = 'Local retrieval was unavailable. The selected chapter text remains the only generation source.';
            }
            if (!isActive(active)) return;
            const retrievalContext = response?.context ?? null;
            active.retrievalContext = retrievalContext;
            active.retrievalStatus = response?.status ?? null;
            active.retrievalNotice = notice;
            const retrievalSection = retrievalContext ? retrievalContextSection(retrievalContext) : null;
            const sections = retrievalSection ? [...source.sections, retrievalSection] : source.sections;
            updateSuggestion(chapterId, {
                ...suggestionRef.current[chapterId],
                status: 'starting',
                retrievalContext,
                retrievalStatus: response?.status ?? null,
                retrievalNotice: notice,
            });
            const contextSnapshot = await aiGenerationRepository.prepareContext({
                bookId: current.bookId,
                sessionId: active.sessionId,
                draftRevision: source.draftRevision,
                maxChars: sections.reduce((total, section) => total + Array.from(section.text).length, 0),
                target: source.target,
                sections,
                ...(retrievalContext ? { retrievalContext } : {}),
            });
            if (!isActive(active)) return;
            const unlisten = await aiGenerationRepository.subscribe(handleEvent);
            if (!isActive(active)) { unlisten(); return; }
            active.unlisten = unlisten;
            const request: GenerationRequest = {
                requestId: active.requestId,
                bookId: current.bookId,
                sessionId: active.sessionId,
                draftRevision: source.draftRevision,
                config: { id: config.id, expectedConfigVersion: config.configVersion },
                target: source.target,
                contextSnapshotId: contextSnapshot.contextSnapshotId,
                outputChars: source.outputChars,
                retrievalTrace: response
                    ? generationRetrievalTrace(response, [{ chapterId, databaseVersion: source.target.databaseVersion }])
                    : null,
            };
            await aiGenerationRepository.start(request);
        } catch (error) {
            if (!isActive(active)) return;
            const metadata = active.config ? buildChapterSummaryGenerationMetadata(active.config, active.source, active.retrievalContext) : null;
            updateSuggestion(chapterId, failedAttempt(active, 'failed', active.candidateText, userError(error), metadata));
            cleanupActive(active);
        }
    }, [cleanupActive, failedAttempt, getCurrentContext, handleEvent, isActive, updateSuggestion]);

    const keepManual = useCallback((chapterId: string) => {
        const suggestion = suggestionRef.current[chapterId];
        if (activeRef.current?.chapterId === chapterId) stop(chapterId);
        if (suggestion?.status === 'save-failed') {
            const currentSummary = optionsRef.current.getPlanningSnapshot().chapterSummaries.find(item => item.chapterId === chapterId);
            if (currentSummary?.provenance === 'ai-adopted'
                && currentSummary.summary === suggestion.suggestedSummary
                && currentSummary.generationMetadata?.generatedAt === suggestion.generationMetadata?.generatedAt) {
                optionsRef.current.updateManualSummary(chapterId, suggestion.previousSummary);
            }
        }
        excludedHitIdsRef.current.delete(chapterId);
        updateSuggestion(chapterId, null);
    }, [stop, updateSuggestion]);

    const accept = useCallback(async (chapterId: string) => {
        const suggestion = suggestionRef.current[chapterId];
        if (!suggestion || suggestion.status !== 'candidate' || !suggestion.suggestedSummary
            || !suggestion.sourceSnapshot || !suggestion.generationMetadata) return;
        const current = optionsRef.current;
        if (!current.enabled || current.isReadOnly || !isCurrent(chapterId)) {
            updateSuggestion(chapterId, {
                ...suggestion,
                status: 'stale',
                errorMessage: 'The chapter or planning changed after generation. Keep manual or generate a fresh suggestion.',
            });
            return;
        }
        updateSuggestion(chapterId, { ...suggestion, status: 'adopting', errorMessage: null });
        try {
            await aiGenerationRepository.validateAdoption({
                bookId: current.bookId,
                chapterId,
                databaseVersion: suggestion.generationMetadata.source.chapterDatabaseVersion,
                planningDatabaseVersion: suggestion.generationMetadata.source.planningDatabaseVersion ?? undefined,
                retrievalSourceVersions: suggestion.retrievalContext?.sourceVersions ?? [],
            });
            const result = await current.adoptSummary({
                chapterId,
                summary: suggestion.suggestedSummary,
                sourceSnapshot: suggestion.sourceSnapshot,
                generationMetadata: suggestion.generationMetadata,
                expectedDraftRevision: suggestion.draftRevision ?? -1,
            });
            if (result === 'saved') {
                updateSuggestion(chapterId, null);
            } else if (result === 'save-failed') {
                updateSuggestion(chapterId, {
                    ...suggestion,
                    status: 'save-failed',
                    errorMessage: 'The suggestion was added to the planning draft, but the save failed. Your draft is preserved; resolve the save conflict before retrying.',
                });
            } else {
                updateSuggestion(chapterId, {
                    ...suggestion,
                    status: 'stale',
                    errorMessage: 'A chapter, planning, or retrieval source changed before acceptance. The suggestion is preserved but was not saved.',
                });
            }
        } catch (error) {
            updateSuggestion(chapterId, {
                ...suggestion,
                status: codeOf(error) === 'CONTEXT_CHANGED' ? 'stale' : 'candidate',
                errorMessage: userError(error),
            });
        }
    }, [isCurrent, updateSuggestion]);

    const toggleRetrievalHit = useCallback((chapterId: string, hitId: string) => {
        const excluded = new Set(excludedHitIdsRef.current.get(chapterId) ?? []);
        if (excluded.has(hitId)) excluded.delete(hitId);
        else excluded.add(hitId);
        const excludedIds = [...excluded];
        excludedHitIdsRef.current.set(chapterId, excludedIds);
        const suggestion = suggestionRef.current[chapterId];
        if (suggestion?.retrievalContext) {
            updateSuggestion(chapterId, { ...suggestion, retrievalContext: { ...suggestion.retrievalContext, excludedHitIds: excludedIds } });
        }
    }, [updateSuggestion]);

    useEffect(() => () => {
        const active = activeRef.current;
        if (!active) return;
        cleanupActive(active);
        void aiGenerationRepository.cancel(active.requestId, active.sessionId).catch(() => undefined);
    }, [cleanupActive]);

    return {
        suggestions,
        activeChapterId,
        modelAvailability,
        modelNotice,
        isCurrent,
        generate,
        stop,
        keepManual,
        accept,
        toggleRetrievalHit,
    };
}
