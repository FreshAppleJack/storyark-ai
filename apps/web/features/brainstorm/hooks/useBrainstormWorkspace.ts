import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Book, BrainstormOption, BrainstormWorkspace, StoryPlanning } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { usePreferences } from '../../../InteractionContent/PreferencesContext';
import { createEmptyPlanning } from '../../../domain/storyPlanning';
import { createEmptyBrainstorm } from '../../../data/brainstormMapping';
import { brainstormApi } from '../../../data/brainstormApi';
import {
    buildContextSnapshot, buildRelationships, formatOptionAsEditableText, getBrainstormChapters,
    getMentionedCharacterIds, isContextSnapshotStale, type BrainstormRelationship
} from '../brainstormContext';

/** Local persistence adapter; generation is intentionally absent (no model). */
export interface BrainstormPersistence {
    load: () => Promise<BrainstormWorkspace>;
    save: (workspace: BrainstormWorkspace, revision: number) => Promise<boolean>;
}
export interface BrainstormSources {
    planning: StoryPlanning;
    relationships: BrainstormRelationship[];
    persistence: BrainstormPersistence;
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
    const mounted = useRef(false);
    const pendingOperation = useRef(false);
    const revision = useRef(0);
    const savedRevision = useRef(0);
    const pendingSave = useRef<Promise<boolean> | null>(null);
    const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const latestWorkspace = useRef(workspace);
    useLayoutEffect(() => { latestWorkspace.current = workspace; }, [workspace]);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; clearTimeout(savedTimer.current); };
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
    const visibleOptions = workspace.selectedOptionId
        ? workspace.generatedOptions.filter(option => option.id === workspace.selectedOptionId) : workspace.generatedOptions;
    const isSnapshotStale = useMemo(() => (
        Object.keys(workspace.contextSnapshot).length > 0 && isContextSnapshotStale(workspace.contextSnapshot, chapterOptions)
    ), [workspace.contextSnapshot, chapterOptions]);
    const edit = (update: (previous: BrainstormWorkspace) => BrainstormWorkspace) => {
        revision.current++;
        clearTimeout(savedTimer.current);
        setWorkspace(update);
        setSaveState('dirty');
    };
    const toggleChapter = (id: string) => edit(prev => ({
        ...prev, selectedChapterIds: prev.selectedChapterIds.includes(id)
            ? prev.selectedChapterIds.filter(chapterId => chapterId !== id) : [...prev.selectedChapterIds, id]
    }));
    const chooseOption = (option: BrainstormOption) => edit(prev => ({ ...prev, selectedOptionId: option.id, finalContent: formatOptionAsEditableText(option) }));
    const showAllOptions = () => edit(prev => ({ ...prev, selectedOptionId: null }));
    const updateFinalContent = (value: string) => edit(prev => ({ ...prev, finalContent: value }));

    // Legacy only: local mode has no model, so the button stays disabled and
    // this path is never offered there.
    const handleGenerate = async () => {
        if (!book || isLoading || loadError || pendingOperation.current || loaders.current.sources) return;
        if (!selectedChapterIds.length) { setErrorMessage('Select at least one chapter before brainstorming.'); return; }
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
            setWorkspace(generated);
            setSaveState('saved');
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
                        ...draft, contextSnapshot: buildContextSnapshot(
                            loaders.current.book!, planning, selectedChapters, mentionedCharacters, relationships)
                    };
                    const ok = await persistence.save(snapshot, snapshotRevision);
                    if (!mounted.current) return false;
                    if (!ok) throw new Error('Save failed. Please try again.');
                    savedRevision.current = snapshotRevision;
                    if (revision.current === snapshotRevision) {
                        setSaveState('saved');
                        clearTimeout(savedTimer.current);
                        savedTimer.current = setTimeout(() => { if (mounted.current) setSaveState('idle'); }, 1600);
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
            clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setSaveState('idle'), 1600);
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
        isSnapshotStale, isLoading, loadError, retry: () => setLoadAttempt(attempt => attempt + 1),
        isGenerating, isSaving, saveState, isDirty, errorMessage, flush,
        generationAvailable: !sources,
        toggleChapter, chooseOption, showAllOptions, updateFinalContent, handleGenerate, handleSave
    };
}
export type BrainstormEditor = ReturnType<typeof useBrainstormWorkspace>;
