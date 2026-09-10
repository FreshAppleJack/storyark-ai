import { useEffect, useMemo, useRef, useState } from 'react';
import type { Book, BrainstormOption, BrainstormWorkspace } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { usePreferences } from '../../../InteractionContent/PreferencesContext';
import { createEmptyPlanning } from '../../../domain/storyPlanning';
import { createEmptyBrainstorm } from '../../../data/brainstormMapping';
import { brainstormApi } from '../../../data/brainstormApi';
import {
    buildContextSnapshot, buildRelationships, formatOptionAsEditableText, getBrainstormChapters,
    getMentionedCharacterIds, type BrainstormRelationship
} from '../brainstormContext';

/** The selected chapters and final result are an editable page draft. */
export function useBrainstormWorkspace(bookId: string, book: Book | undefined, initialChapterId: string | null) {
    const { fetchStoryPlanning, fetchGraphData } = useBooks();
    const { autoHighlightSettings } = usePreferences();
    const loaders = useRef({ fetchStoryPlanning, fetchGraphData, book, initialChapterId });
    useEffect(() => { loaders.current = { fetchStoryPlanning, fetchGraphData, book, initialChapterId }; }, [fetchStoryPlanning, fetchGraphData, book, initialChapterId]);
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
    const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
                setSaveState('idle');
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

    const handleGenerate = async () => {
        if (!book || isLoading || loadError || pendingOperation.current) return;
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
    const handleSave = async () => {
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
    return {
        workspace, selectedChapterIds, chapterOptions, mentionedCharacters, missingSummaryChapters, visibleOptions,
        isLoading, loadError, retry: () => setLoadAttempt(attempt => attempt + 1), isGenerating, isSaving, saveState, errorMessage,
        toggleChapter, chooseOption, showAllOptions, updateFinalContent, handleGenerate, handleSave
    };
}
export type BrainstormEditor = ReturnType<typeof useBrainstormWorkspace>;
