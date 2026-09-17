import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book, BrainstormOption, BrainstormWorkspace, StoryPlanning } from '../../../types';
import { showSaveSuccessToast } from '../../../components/ui/saveToast';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { usePreferences } from '../../../InteractionContent/PreferencesContext';
import { createEmptyPlanning } from '../../../domain/storyPlanning';
import { createEmptyBrainstorm } from '../../../data/brainstormMapping';
import { brainstormApi } from '../../../data/brainstormApi';
import {
    EMPTY_BRAINSTORM_CANDIDATE,
    candidateFromOptions,
    type BrainstormCandidate,
} from '../brainstormCandidate';
import { buildBrainstormGenerationContext } from '../brainstormGeneration';
import { useLocalBrainstormGeneration } from './useLocalBrainstormGeneration';
import {
    buildContextSnapshot, buildRelationships, formatOptionAsEditableText, getBrainstormChapters,
    getMentionedCharacterIds, isContextSnapshotStale, type BrainstormRelationship, type BrainstormSourceVersions,
} from '../brainstormContext';
import { registerWorkDraftFlush } from '../../../services/workDraftFlushRegistry';

/** Persistence stays independent from the optional configured-model generator. */
export interface BrainstormPersistence {
    load: () => Promise<BrainstormWorkspace>;
    save: (workspace: BrainstormWorkspace, revision: number) => Promise<boolean>;
    getDatabaseVersion?: () => number;
}
export type BrainstormGenerationSource = BrainstormSourceVersions | (() => BrainstormSourceVersions);
export interface BrainstormSources {
    planning: StoryPlanning;
    relationships: BrainstormRelationship[];
    persistence: BrainstormPersistence;
    generation?: BrainstormGenerationSource;
}

/** The selected chapters and final result are an editable page draft. */
export function useBrainstormWorkspace(bookId: string, book: Book | undefined, initialChapterId: string | null, sources?: BrainstormSources) {
    const { fetchStoryPlanning, fetchGraphData } = useBooks();
    const { autoHighlightSettings } = usePreferences();
    const loaders = useRef({ fetchStoryPlanning, fetchGraphData, book, initialChapterId, sources });
    useEffect(() => { loaders.current = { fetchStoryPlanning, fetchGraphData, book, initialChapterId, sources }; }, [fetchStoryPlanning, fetchGraphData, book, initialChapterId, sources]);
    const [planning, setPlanning] = useState(createEmptyPlanning);
    const [workspace, setWorkspace] = useState(createEmptyBrainstorm);
    const [relationships, setRelationships] = useState<BrainstormRelationship[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [remoteCandidate, setRemoteCandidate] = useState<BrainstormCandidate>(EMPTY_BRAINSTORM_CANDIDATE);
    const mounted = useRef(false);
    const pendingOperation = useRef(false);
    const revision = useRef(0);
    const savedRevision = useRef(0);
    const pendingSave = useRef<Promise<boolean> | null>(null);
    const latestWorkspace = useRef(workspace);
    useLayoutEffect(() => { latestWorkspace.current = workspace; }, [workspace]);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const hasBook = !!book;
    useEffect(() => {
        if (!hasBook) return;
        let active = true;
        const load = async () => {
            setIsLoading(true);
            setLoadError(false);
            try {
                const injected = loaders.current.sources;
                if (injected) {
                    // A failed read must never fall through to an empty
                    // workspace that a later save would persist.
                    const loadedWorkspace = await injected.persistence.load();
                    if (!active) return;
                    setPlanning(injected.planning);
                    setWorkspace({
                        ...loadedWorkspace, selectedChapterIds: loaders.current.initialChapterId
                            ? [loaders.current.initialChapterId] : loadedWorkspace.selectedChapterIds
                    });
                    setRelationships(injected.relationships);
                } else {
                    const [loadedPlanning, loadedWorkspace, graph] = await Promise.all([
                        loaders.current.fetchStoryPlanning(bookId), brainstormApi.get(bookId), loaders.current.fetchGraphData(bookId),
                    ]);
                    if (!active) return;
                    if (!loadedPlanning || !graph) throw new Error('Planning or graph unavailable');
                    setPlanning(loadedPlanning);
                    setWorkspace({
                        ...loadedWorkspace, selectedChapterIds: loaders.current.initialChapterId
                            ? [loaders.current.initialChapterId] : loadedWorkspace.selectedChapterIds
                    });
                    setRelationships(buildRelationships(graph, loaders.current.book?.characters || []));
                }
                if (active) {
                    revision.current = 0;
                    savedRevision.current = 0;
                    setSaveState('idle');
                }
            } catch {
                if (active) setLoadError(true);
            } finally { if (active) setIsLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [bookId, hasBook, loadAttempt]);

    const chapterOptions = useMemo(() => getBrainstormChapters(book, planning), [book, planning]);
    const selectedChapterIds = workspace.selectedChapterIds;
    const selectedChapters = useMemo(() => chapterOptions.filter(chapter => selectedChapterIds.includes(chapter.id)), [chapterOptions, selectedChapterIds]);
    const mentionedCharacters = useMemo(() => {
        const characters = book?.characters || [];
        const automatic = characters.filter(character => !autoHighlightSettings.disabledRoles.includes(character.role));
        const ids = new Set(selectedChapters.flatMap(chapter => [...getMentionedCharacterIds(chapter.content, characters, automatic)]));
        return characters.filter(character => ids.has(character.id));
    }, [book, selectedChapters, autoHighlightSettings.disabledRoles]);
    const missingSummaryChapters = selectedChapters.filter(chapter => !chapter.summary.trim());
    const isSnapshotStale = useMemo(() => (
        Object.keys(workspace.contextSnapshot).length > 0 && isContextSnapshotStale(workspace.contextSnapshot, chapterOptions)
    ), [workspace.contextSnapshot, chapterOptions]);

    const getGenerationContext = useCallback(() => {
        const configuredSource = loaders.current.sources?.generation;
        const generationSource = typeof configuredSource === 'function' ? configuredSource() : configuredSource;
        if (!book || !generationSource) throw new Error('The local brainstorm source is not ready.');
        if (!selectedChapterIds.length) throw new Error('Select at least one chapter before brainstorming.');
        return buildBrainstormGenerationContext(
            book,
            planning,
            selectedChapters,
            mentionedCharacters,
            relationships,
            generationSource,
            revision.current,
        );
    }, [book, mentionedCharacters, planning, relationships, selectedChapterIds.length, selectedChapters]);
    const localGeneration = useLocalBrainstormGeneration({
        enabled: !!sources?.generation,
        bookId,
        isReadOnly: !!book?.isReadOnly,
        getContext: getGenerationContext,
    });
    const candidate = sources?.generation ? localGeneration.candidate : remoteCandidate;
    const candidateIsUsable = (candidate.status === 'completed' || candidate.status === 'adopted') && candidate.options.length > 0;
    const displayedOptions = candidateIsUsable
        ? candidate.status === 'adopted'
            ? [...candidate.options, ...workspace.generatedOptions.filter(option => !candidate.options.some(item => item.id === option.id))]
            : candidate.options
        : workspace.generatedOptions;
    const hasSelectedDisplayedOption = !!workspace.selectedOptionId
        && displayedOptions.some(option => option.id === workspace.selectedOptionId);
    const visibleOptions = hasSelectedDisplayedOption
        ? displayedOptions.filter(option => option.id === workspace.selectedOptionId) : displayedOptions;
    const edit = (update: (previous: BrainstormWorkspace) => BrainstormWorkspace) => {
        revision.current++;
        setWorkspace(update);
        setSaveState('dirty');
    };
    const toggleChapter = (id: string) => edit(prev => ({
        ...prev, selectedChapterIds: prev.selectedChapterIds.includes(id)
            ? prev.selectedChapterIds.filter(chapterId => chapterId !== id) : [...prev.selectedChapterIds, id]
    }));
    const chooseOption = (option: BrainstormOption) => {
        if (book?.isReadOnly) {
            setErrorMessage('This brainstorm workspace is read-only. The candidate is still available for review.');
            return;
        }
        const isCandidateOption = candidate.options.some(item => item.id === option.id);
        if (isCandidateOption) {
            const accepted = sources?.generation
                ? localGeneration.acceptOption(option.id)
                : candidate.sourceFingerprint === JSON.stringify({ bookId, draftRevision: revision.current, selectedChapterIds })
                    ? true
                    : false;
            if (!accepted) {
                if (!sources?.generation) setRemoteCandidate(previous => ({ ...previous, status: 'stale', errorMessage: 'The selected context changed. Regenerate before choosing this candidate.' }));
                return;
            }
        }
        edit(prev => {
            const generatedOptions = isCandidateOption
                ? [...prev.generatedOptions, ...candidate.options.filter(item => !prev.generatedOptions.some(existing => existing.id === item.id))]
                : prev.generatedOptions;
            return {
                ...prev,
                generatedOptions,
                selectedOptionId: option.id,
                finalContent: formatOptionAsEditableText(option),
                generationMetadata: isCandidateOption ? candidate.metadata ?? prev.generationMetadata : prev.generationMetadata,
            };
        });
        if (isCandidateOption && !sources?.generation) setRemoteCandidate(previous => ({ ...previous, status: 'adopted', errorMessage: null }));
    };
    const showAllOptions = () => {
        if (!hasSelectedDisplayedOption) return;
        edit(prev => ({ ...prev, selectedOptionId: null }));
    };
    const updateFinalContent = (value: string) => {
        if (book?.isReadOnly) {
            setErrorMessage('This brainstorm workspace is read-only.');
            return;
        }
        edit(prev => ({ ...prev, finalContent: value }));
    };

    const handleGenerate = async () => {
        if (!book || isLoading || loadError || isSaving || pendingOperation.current) return;
        if (!selectedChapterIds.length) { setErrorMessage('Select at least one chapter before brainstorming.'); return; }
        if (sources) {
            if (sources.generation) await localGeneration.generate();
            return;
        }
        pendingOperation.current = true;
        setIsGenerating(true);
        setErrorMessage('');
        const snapshotRevision = revision.current;
        const context = buildContextSnapshot(book, planning, selectedChapters, mentionedCharacters, relationships);
        try {
            const generated = await brainstormApi.generate(bookId, selectedChapterIds, context);
            if (!mounted.current) return;
            if (revision.current !== snapshotRevision) {
                setErrorMessage('Your draft changed during generation. Regenerate to use the latest context.');
                return;
            }
            if (!generated.generatedOptions.length) {
                setErrorMessage('The AI response did not contain usable brainstorm options. Existing work is unchanged.');
                return;
            }
            setRemoteCandidate(candidateFromOptions(
                generated.generatedOptions,
                null,
                JSON.stringify({ bookId, draftRevision: snapshotRevision, selectedChapterIds }),
                snapshotRevision,
            ));
        } catch {
            if (mounted.current) setErrorMessage('AI brainstorm failed. Please try again.');
        } finally {
            pendingOperation.current = false;
            if (mounted.current) setIsGenerating(false);
        }
    };

    // One pending save at a time; edits made while it runs are drained by
    // committing the newest draft, and an older acknowledgement can never
    // clear newer input.
    const flush = useCallback((): Promise<boolean> => {
        if (pendingSave.current) return pendingSave.current;
        if (loadError || isLoading) return Promise.resolve(false);
        const persistence = loaders.current.sources?.persistence;
        if (!persistence) return Promise.resolve(false);
        const operation = async (): Promise<boolean> => {
            setIsSaving(true);
            setErrorMessage('');
            try {
                do {
                    const snapshotRevision = revision.current;
                    const draft = latestWorkspace.current;
                    // The snapshot is rebuilt at every save: it records the
                    // sources as of this save, so "stale" always compares the
                    // last save with current chapters and summaries.
                    const snapshot = {
                        ...draft,
                        contextSnapshot: {
                            ...buildContextSnapshot(
                                loaders.current.book!, planning, selectedChapters, mentionedCharacters, relationships,
                                (() => {
                                    const configuredSource = loaders.current.sources?.generation;
                                    return typeof configuredSource === 'function' ? configuredSource() : configuredSource;
                                })(),
                            ),
                            generationMetadata: draft.generationMetadata ?? null,
                        },
                    };
                    const ok = await persistence.save(snapshot, snapshotRevision);
                    if (!mounted.current) return false;
                    if (!ok) throw new Error('Save failed. Please try again.');
                    savedRevision.current = snapshotRevision;
                    if (revision.current === snapshotRevision) {
                        // The indicator persists like the editor's: it only
                        // leaves when the next edit marks the page dirty.
                        setSaveState('saved');
                        showSaveSuccessToast();
                    }
                } while (savedRevision.current !== revision.current);
                return true;
            } catch (error) {
                if (mounted.current) setErrorMessage(error instanceof Error ? error.message : 'Save failed. Please try again.');
                return false;
            } finally {
                pendingSave.current = null;
                if (mounted.current) setIsSaving(false);
            }
        };
        pendingSave.current = operation();
        return pendingSave.current;
    }, [isLoading, loadError, planning, mentionedCharacters, relationships, selectedChapters]);
    useEffect(() => {
        if (!sources) return undefined;
        return registerWorkDraftFlush(bookId, 'brainstorm', flush);
    }, [bookId, flush, sources]);
    const isDirty = saveState === 'dirty';

    // Legacy save path (HTTP), kept for the unreachable legacy provider mode.
    const handleLegacySave = async () => {
        if (!book || isLoading || loadError || pendingOperation.current) return;
        pendingOperation.current = true;
        setIsSaving(true);
        setErrorMessage('');
        const snapshotRevision = revision.current;
        const snapshot = {
            ...workspace, contextSnapshot: Object.keys(workspace.contextSnapshot).length ? workspace.contextSnapshot
                : buildContextSnapshot(book, planning, selectedChapters, mentionedCharacters, relationships)
        };
        try {
            const saved = await brainstormApi.save(bookId, snapshot);
            if (!mounted.current || revision.current !== snapshotRevision) return;
            setWorkspace(saved);
            setSaveState('saved');
        } catch {
            if (mounted.current) setErrorMessage('Save failed. Please try again.');
        } finally {
            pendingOperation.current = false;
            if (mounted.current) setIsSaving(false);
        }
    };
    const handleSave = async () => { if (loaders.current.sources) await flush(); else await handleLegacySave(); };
    return {
        workspace, selectedChapterIds, chapterOptions, mentionedCharacters, missingSummaryChapters, visibleOptions,
        hasSelectedOption: hasSelectedDisplayedOption,
        isSnapshotStale, isLoading, loadError, retry: () => setLoadAttempt(attempt => attempt + 1),
        isGenerating: sources?.generation ? localGeneration.isGenerating : isGenerating,
        isSaving, saveState, isDirty, errorMessage: candidate.errorMessage || errorMessage, flush,
        candidate,
        isReadOnly: !!book?.isReadOnly,
        generationAvailable: !sources || !!sources.generation,
        stopGeneration: sources?.generation ? localGeneration.stop : () => undefined,
        regenerate: sources?.generation ? localGeneration.regenerate : handleGenerate,
        discardCandidate: sources?.generation ? localGeneration.discardCandidate : () => setRemoteCandidate(EMPTY_BRAINSTORM_CANDIDATE),
        closeCandidate: sources?.generation ? localGeneration.closeCandidate : () => setRemoteCandidate(EMPTY_BRAINSTORM_CANDIDATE),
        toggleChapter, chooseOption, showAllOptions, updateFinalContent, handleGenerate, handleSave
    };
}
export type BrainstormEditor = ReturnType<typeof useBrainstormWorkspace>;
