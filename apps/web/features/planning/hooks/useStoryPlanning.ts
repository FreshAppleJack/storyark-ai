import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import type { Book, PlotSetting, StoryPlanning } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { createEmptyPlanning, createPlotSetting, sanitizePlanning } from '../../../domain/storyPlanning';
import { getPlanningChapters } from '../planningSelectors';

/** Owns a page draft, not a second server cache. Key the page by bookId. */
export function useStoryPlanning(bookId: string, book: Book | undefined) {
    const { fetchStoryPlanning, saveStoryPlanning } = useBooks();
    const loadRef = useRef(fetchStoryPlanning);
    useEffect(() => { loadRef.current = fetchStoryPlanning; }, [fetchStoryPlanning]);
    const [planning, setPlanning] = useState(createEmptyPlanning);
    const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
    const mounted = useRef(false);
    const pendingSave = useRef(false);
    const revision = useRef(0);
    const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; clearTimeout(savedTimer.current); };
    }, []);
    useEffect(() => {
        let active = true;
        const load = async () => {
            setIsLoading(true);
            setLoadError(false);
            try {
                const loaded = await loadRef.current(bookId);
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
        clearTimeout(savedTimer.current);
        setPlanning(update);
        setSaveState('dirty');
    };
    const updatePlanningField = (field: 'storySummary' | 'storyBackground', value: string) => edit(prev => ({ ...prev, [field]: value }));
    const updateChapterSummary = (chapterId: string, summary: string) => {
        const updatedAt = Date.now();
        edit(prev => ({
            ...prev, chapterSummaries: prev.chapterSummaries.some(item => item.chapterId === chapterId)
                ? prev.chapterSummaries.map(item => item.chapterId === chapterId ? { ...item, summary, updatedAt } : item)
                : [...prev.chapterSummaries, { chapterId, summary, updatedAt }]
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
    const handleSave = async () => {
        if (!book || isLoading || loadError || pendingSave.current) return;
        pendingSave.current = true;
        setIsSaving(true);
        const snapshotRevision = revision.current;
        const snapshot = sanitizePlanning(planning, new Set(chapterOptions.map(chapter => chapter.id)));
        try {
            const ok = await saveStoryPlanning(bookId, snapshot);
            if (!mounted.current) return;
            if (!ok) { toast.error('Failed to save planning. Your draft is still available.'); return; }
            // A completed request only confirms the submitted revision.
            if (revision.current !== snapshotRevision) return;
            setPlanning(snapshot);
            setSaveState('saved');
            clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setSaveState('idle'), 1800);
        } finally {
            pendingSave.current = false;
            if (mounted.current) setIsSaving(false);
        }
    };
    return {
        planning, selectedPlotId, setSelectedPlotId, selectedPlot, chapterOptions,
        isLoading, loadError, isSaving, saveState, retry: () => setLoadAttempt(attempt => attempt + 1),
        updatePlanningField, updateChapterSummary, updateSelectedPlot, addPlotSetting, deleteSelectedPlot, togglePlotChapter, handleSave
    };
}
export type StoryPlanningEditor = ReturnType<typeof useStoryPlanning>;
