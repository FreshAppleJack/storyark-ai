import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { showSaveSuccessToast } from '../../../components/ui/saveToast';
import type { Book, PlotSetting, StoryPlanning } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { createEmptyPlanning, createPlotSetting, sanitizePlanning } from '../../../domain/storyPlanning';
import { getPlanningChapters } from '../planningSelectors';

export interface PlanningPersistence {
    load: () => Promise<StoryPlanning>;
    save: (planning: StoryPlanning, revision: number) => Promise<boolean>;
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
    const mounted = useRef(false);
    const pendingSave = useRef<Promise<boolean> | null>(null);
    const savedRevision = useRef(0);
    const [saveError, setSaveError] = useState<string | null>(null);
    const latest = useRef(planning);
    useLayoutEffect(() => { latest.current = planning; }, [planning]);
    const revision = useRef(0);
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
        setPlanning(update);
        setSaveState('dirty');
    };
    const updatePlanningField = (field: 'storySummary' | 'storyBackground', value: string) => edit(prev => ({ ...prev, [field]: value }));
    const updateChapterSummary = (chapterId: string, summary: string) => {
        const updatedAt = Date.now();
        const sourceChapterVersion = book?.volumes.flatMap(volume => volume.chapters).find(chapter => chapter.id === chapterId)?.databaseVersion;
        const source = sourceChapterVersion ? { sourceChapterVersion } : {};
        edit(prev => ({
            ...prev, chapterSummaries: prev.chapterSummaries.some(item => item.chapterId === chapterId)
                ? prev.chapterSummaries.map(item => item.chapterId === chapterId ? { ...item, ...source, summary, updatedAt } : item)
                : [...prev.chapterSummaries, { chapterId, ...source, summary, updatedAt }]
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
                    const snapshot = adapter.current ? latest.current
                        : sanitizePlanning(latest.current, new Set(chapterOptions.map(chapter => chapter.id)));
                    const ok = adapter.current ? await adapter.current.save(snapshot, snapshotRevision)
                        : await saveStoryPlanning(bookId, snapshot);
                    if (!mounted.current) return false;
                    if (!ok) throw new Error('Failed to save planning. Your draft is still available.');
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
                    const message = error instanceof Error ? error.message : 'Planning save failed.';
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
    const handleSave = async () => { await flush(true); };
    return {
        flush, saveError, isDirty: saveState === 'dirty', planning, selectedPlotId, setSelectedPlotId, selectedPlot, chapterOptions,
        isLoading, loadError, isSaving, saveState, retry: () => setLoadAttempt(attempt => attempt + 1),
        updatePlanningField, updateChapterSummary, updateSelectedPlot, addPlotSetting, deleteSelectedPlot, togglePlotChapter, handleSave
    };
}
export type StoryPlanningEditor = ReturnType<typeof useStoryPlanning>;
