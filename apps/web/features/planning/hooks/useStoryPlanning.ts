import { userErrorMessage } from '../../../data/diagnostics';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { showSaveSuccessToast } from '../../../components/ui/saveToast';
import type { Book, PlotSetting, StoryPlanning } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { createEmptyPlanning, createPlotSetting, sanitizePlanning } from '../../../domain/storyPlanning';
import {
    assessChapterSummaryFreshness,
    createChapterSummarySourceSnapshot,
    createCurrentAllowedSourceVersions,
    type ChapterSummarySourceSnapshot,
} from '../../../domain/chapterSummarySource';
import { getPlanningChapters } from '../planningSelectors';
import { registerWorkDraftFlush } from '../../../services/workDraftFlushRegistry';

export interface PlanningPersistence {
    load: () => Promise<StoryPlanning>;
    save: (planning: StoryPlanning, revision: number) => Promise<boolean | { databaseVersion: number }>;
}

/** Owns a page draft, not a second server cache. Key the page by bookId. */
export function useStoryPlanning(bookId: string, book: Book | undefined, persistence?: PlanningPersistence) {
    const { fetchStoryPlanning, saveStoryPlanning } = useBooks();
    const loadRef = useRef(fetchStoryPlanning);
    const adapter = useRef(persistence);
    useEffect(() => { adapter.current = persistence; }, [persistence]);
    useEffect(() => { loadRef.current = fetchStoryPlanning; }, [fetchStoryPlanning]);
    const [planning, setPlanning] = useState(createEmptyPlanning);
    const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
    const [currentDraftRevision, setCurrentDraftRevision] = useState(0);
    const mounted = useRef(false);
    const pendingSave = useRef<Promise<boolean> | null>(null);
    const savedRevision = useRef(0);
    const [saveError, setSaveError] = useState<string | null>(null);
    const latest = useRef(planning);
    useLayoutEffect(() => { latest.current = planning; }, [planning]);
    const revision = useRef(0);
    const summarySourceSnapshots = useRef(new Map<string, {
        title: string;
        content: string;
        databaseVersion?: number;
        contentFormat?: Book['volumes'][number]['chapters'][number]['contentFormat'];
        contentVersion?: number;
        foreshadowings: Book['volumes'][number]['chapters'][number]['foreshadowings'];
        snapshot: ChapterSummarySourceSnapshot;
    }>());
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    useEffect(() => {
        let active = true;
        const load = async () => {
            setIsLoading(true);
            setLoadError(false);
            try {
                const loaded = await (adapter.current ? adapter.current.load() : loadRef.current(bookId));
                if (!active) return;
                if (!loaded) { setLoadError(true); return; }
                setPlanning(loaded);
                setSelectedPlotId(loaded.plotSettings[0]?.id || null);
                setSaveState('idle');
            } catch {
                if (active) setLoadError(true);
            } finally { if (active) setIsLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [bookId, loadAttempt]);

    const chapterOptions = useMemo(() => book ? getPlanningChapters(book, planning) : [], [book, planning]);
    const selectedPlot = planning.plotSettings.find(plot => plot.id === selectedPlotId) || null;
    const edit = (update: (previous: StoryPlanning) => StoryPlanning) => {
        revision.current++;
        setCurrentDraftRevision(revision.current);
        const next = update(latest.current);
        latest.current = next;
        setPlanning(next);
        setSaveState('dirty');
    };
    const updatePlanningField = (field: 'storySummary' | 'storyBackground', value: string) => edit(prev => ({ ...prev, [field]: value }));
    const updateChapterSummary = (chapterId: string, summary: string) => {
        const updatedAt = Date.now();
        const chapter = book?.volumes.flatMap(volume => volume.chapters).find(item => item.id === chapterId);
        let sourceSnapshot: ChapterSummarySourceSnapshot | undefined;
        if (chapter) {
            const cacheKey = `${bookId}:${chapter.id}`;
            const cached = summarySourceSnapshots.current.get(cacheKey);
            sourceSnapshot = cached && cached.title === chapter.title && cached.content === chapter.content
                && cached.databaseVersion === chapter.databaseVersion && cached.contentFormat === chapter.contentFormat
                && cached.contentVersion === chapter.contentVersion && cached.foreshadowings === chapter.foreshadowings
                ? cached.snapshot
                : createChapterSummarySourceSnapshot(chapter, updatedAt);
            summarySourceSnapshots.current.set(cacheKey, {
                title: chapter.title,
                content: chapter.content,
                databaseVersion: chapter.databaseVersion,
                contentFormat: chapter.contentFormat,
                contentVersion: chapter.contentVersion,
                foreshadowings: chapter.foreshadowings,
                snapshot: sourceSnapshot,
            });
        }
        const sourceChapterVersion = sourceSnapshot?.chapterDatabaseVersion;
        const source = {
            ...(sourceChapterVersion !== null && sourceChapterVersion !== undefined ? { sourceChapterVersion } : {}),
            ...(sourceSnapshot ? { sourceSnapshot } : {}),
        };
        edit(prev => ({
            ...prev, chapterSummaries: prev.chapterSummaries.some(item => item.chapterId === chapterId)
                ? prev.chapterSummaries.map(item => item.chapterId === chapterId
                    ? { ...item, ...source, provenance: 'author', generationMetadata: undefined, freshnessAcknowledgement: undefined, summary, updatedAt }
                    : item)
                : [...prev.chapterSummaries, { chapterId, ...source, provenance: 'author', summary, updatedAt }]
        }));
    };
    const acknowledgeChapterSummaryChanges = (chapterId: string) => {
        const chapter = book?.volumes.flatMap(volume => volume.chapters).find(item => item.id === chapterId);
        const summary = latest.current.chapterSummaries.find(item => item.chapterId === chapterId);
        if (!book || !chapter || !summary) return;
        const chapters = book.volumes.flatMap(volume => volume.chapters);
        const allowedSourceVersions = createCurrentAllowedSourceVersions({
            bookId,
            planningDatabaseVersion: latest.current.databaseVersion,
            characters: book.characters,
            chapters,
        });
        if (assessChapterSummaryFreshness(summary, chapter, allowedSourceVersions).status !== 'possibly-stale') return;
        const acknowledgedAt = Date.now();
        const acknowledgedSourceSnapshot = createChapterSummarySourceSnapshot(chapter, acknowledgedAt);
        const generationSources = summary.generationMetadata?.source.allowedSources ?? [];
        const acknowledgedVersions = generationSources.map(source => {
            const currentVersion = allowedSourceVersions.get(source.sourceId);
            // Saving this acknowledgement advances the planning version once.
            if (source.sourceKind === 'planning') return (currentVersion ?? 0) + 1;
            return currentVersion ?? null;
        });
        edit(previous => ({
            ...previous,
            chapterSummaries: previous.chapterSummaries.map(item => item.chapterId === chapterId
                ? {
                    ...item,
                    freshnessAcknowledgement: {
                        acknowledgedSourceSnapshot,
                        allowedSourceVersions: acknowledgedVersions,
                        acknowledgedAt,
                    },
                }
                : item),
        }));
    };
    const updateSelectedPlot = (patch: Partial<PlotSetting>) => {
        if (!selectedPlotId) return;
        const updatedAt = Date.now();
        edit(prev => ({ ...prev, plotSettings: prev.plotSettings.map(plot => plot.id === selectedPlotId ? { ...plot, ...patch, updatedAt } : plot) }));
    };
    const addPlotSetting = () => {
        const plot = createPlotSetting(`plot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, Date.now());
        edit(prev => ({ ...prev, plotSettings: [plot, ...prev.plotSettings] }));
        setSelectedPlotId(plot.id);
    };
    const deleteSelectedPlot = () => {
        if (!selectedPlotId) return;
        const next = planning.plotSettings.filter(plot => plot.id !== selectedPlotId);
        edit(prev => ({ ...prev, plotSettings: next }));
        setSelectedPlotId(next[0]?.id || null);
    };
    const togglePlotChapter = (chapterId: string) => {
        if (!selectedPlot) return;
        const ids = new Set(selectedPlot.chapterIds);
        if (ids.has(chapterId)) ids.delete(chapterId); else ids.add(chapterId);
        updateSelectedPlot({ chapterIds: [...ids] });
    };
    const flush = useCallback((force = false): Promise<boolean> => {
        if (pendingSave.current) return pendingSave.current;
        if (!book || isLoading || loadError) return Promise.resolve(false);
        if (!force && savedRevision.current === revision.current) return Promise.resolve(true);
        const operation = async () => {
            setIsSaving(true);
            setSaveError(null);
            try {
                do {
                    const snapshotRevision = revision.current;
                    const rawSnapshot = adapter.current ? latest.current
                        : sanitizePlanning(latest.current, new Set(chapterOptions.map(chapter => chapter.id)));
                    const snapshot = rawSnapshot;
                    const result = adapter.current ? await adapter.current.save(snapshot, snapshotRevision)
                        : await saveStoryPlanning(bookId, snapshot);
                    if (!mounted.current) return false;
                    if (!result) throw new Error('Failed to save planning. Your draft is still available.');
                    if (typeof result === 'object' && Number.isSafeInteger(result.databaseVersion)) {
                        latest.current = { ...latest.current, databaseVersion: result.databaseVersion };
                        setPlanning(previous => ({ ...previous, databaseVersion: result.databaseVersion }));
                    }
                    savedRevision.current = snapshotRevision;
                    if (revision.current === snapshotRevision) {
                        // The indicator persists like the editor's: it only
                        // leaves when the next edit marks the page dirty.
                        setSaveState('saved');
                        showSaveSuccessToast();
                    }
                    if (!adapter.current) break;
                } while (savedRevision.current !== revision.current);
                return true;
            } catch (error) {
                if (mounted.current) {
                    const message = userErrorMessage(error, 'Planning save failed.', 'planning.save');
                    setSaveError(message);
                    toast.error(message);
                }
                return false;
            } finally {
                pendingSave.current = null;
                if (mounted.current) setIsSaving(false);
            }
        };
        pendingSave.current = operation();
        return pendingSave.current;
    }, [book, bookId, isLoading, loadError, chapterOptions, saveStoryPlanning]);

    const adoptChapterSummarySuggestion = async (input: {
        chapterId: string;
        summary: string;
        sourceSnapshot: ChapterSummarySourceSnapshot;
        generationMetadata: NonNullable<StoryPlanning['chapterSummaries'][number]['generationMetadata']>;
        expectedDraftRevision: number;
    }): Promise<'saved' | 'stale' | 'save-failed'> => {
        if (input.expectedDraftRevision !== revision.current || !input.summary.trim()) return 'stale';
        const chapter = book?.volumes.flatMap(volume => volume.chapters).find(item => item.id === input.chapterId);
        if (!chapter) return 'stale';
        const currentSnapshot = createChapterSummarySourceSnapshot(chapter, input.sourceSnapshot.capturedAt);
        if (input.sourceSnapshot.chapterId !== chapter.id
            || currentSnapshot.bodyFingerprint !== input.sourceSnapshot.bodyFingerprint
            || currentSnapshot.structuredFingerprint !== input.sourceSnapshot.structuredFingerprint
            || input.generationMetadata.source.bookId !== bookId
            || input.generationMetadata.source.chapterId !== chapter.id
            || (input.sourceSnapshot.chapterDatabaseVersion !== null
                && input.generationMetadata.source.chapterDatabaseVersion !== input.sourceSnapshot.chapterDatabaseVersion)
            || input.generationMetadata.source.sourceBodyFingerprint !== input.sourceSnapshot.bodyFingerprint
            || input.generationMetadata.source.includesFuturePlan) return 'stale';
        edit(previous => ({
            ...previous,
            chapterSummaries: previous.chapterSummaries.some(item => item.chapterId === input.chapterId)
                ? previous.chapterSummaries.map(item => item.chapterId === input.chapterId ? {
                    ...item,
                    summary: input.summary.trim(),
                    sourceChapterVersion: input.sourceSnapshot.chapterDatabaseVersion ?? undefined,
                    sourceSnapshot: input.sourceSnapshot,
                    freshnessAcknowledgement: undefined,
                    provenance: 'ai-adopted',
                    generationMetadata: input.generationMetadata,
                    updatedAt: Date.now(),
                } : item)
                : [...previous.chapterSummaries, {
                    chapterId: input.chapterId,
                    summary: input.summary.trim(),
                    sourceChapterVersion: input.sourceSnapshot.chapterDatabaseVersion ?? undefined,
                    sourceSnapshot: input.sourceSnapshot,
                    provenance: 'ai-adopted',
                    generationMetadata: input.generationMetadata,
                    updatedAt: Date.now(),
                }],
        }));
        return await flush(true) ? 'saved' : 'save-failed';
    };
    useEffect(() => {
        if (!persistence) return undefined;
        return registerWorkDraftFlush(bookId, 'planning', flush);
    }, [bookId, flush, persistence]);
    const handleSave = async () => { await flush(true); };
    const getPlanningSnapshot = useCallback(() => latest.current, []);
    const getDraftRevision = useCallback(() => revision.current, []);
    return {
        flush, saveError, isDirty: saveState === 'dirty', planning, draftRevision: currentDraftRevision,
        getPlanningSnapshot, getDraftRevision,
        selectedPlotId, setSelectedPlotId, selectedPlot, chapterOptions,
        isLoading, loadError, isSaving, saveState, retry: () => setLoadAttempt(attempt => attempt + 1),
        updatePlanningField, updateChapterSummary, adoptChapterSummarySuggestion,
        acknowledgeChapterSummaryChanges,
        updateSelectedPlot, addPlotSetting, deleteSelectedPlot, togglePlotChapter, handleSave
    };
}
export type StoryPlanningEditor = ReturnType<typeof useStoryPlanning>;
