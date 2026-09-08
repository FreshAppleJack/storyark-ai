import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft,
    AlertTriangle,
    BrainCircuit,
    BookOpen,
    CheckCircle2,
    FileText,
    Layers3,
    Link2,
    Loader2,
    Plus,
    Save,
    Search,
    Trash2,
    X
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useApp } from '../InteractionContent/AppContext';
import { ChapterSummary, PlotSetting, StoryPlanning } from '../types';
import { getFuzzyScore } from '../utils/search';

interface ChapterOption {
    id: string;
    title: string;
    volumeId: string;
    volumeTitle: string;
    summary: string;
}

const EMPTY_PLANNING: StoryPlanning = {
    storySummary: '',
    storyBackground: '',
    chapterSummaries: [],
    plotSettings: [],
};

const createPlotSetting = (): PlotSetting => ({
    id: `plot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'New Plot Setting',
    details: '',
    chapterIds: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
});

const StoryOutline: React.FC = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getBook, fetchStoryPlanning, saveStoryPlanning } = useApp();
    const book = getBook(bookId || '');

    const [planning, setPlanning] = useState<StoryPlanning>(EMPTY_PLANNING);
    const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
    const [chapterSearchQuery, setChapterSearchQuery] = useState('');
    const [plotSearchQuery, setPlotSearchQuery] = useState('');
    const [linkedChapterSearchQuery, setLinkedChapterSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [focusedChapterId, setFocusedChapterId] = useState<string | null>(null);
    const lastFocusedChapterIdRef = useRef<string | null>(null);

    useEffect(() => {
        lastFocusedChapterIdRef.current = null;
        setFocusedChapterId(null);
    }, [bookId]);

    useEffect(() => {
        let isMounted = true;
        const loadPlanning = async () => {
            if (!bookId) return;
            setIsLoading(true);
            const loadedPlanning = await fetchStoryPlanning(bookId);
            if (!isMounted) return;
            setPlanning(loadedPlanning);
            setSelectedPlotId(loadedPlanning.plotSettings[0]?.id || null);
            setSaveState('idle');
            setIsLoading(false);
        };

        void loadPlanning();
        return () => { isMounted = false; };
    }, [bookId]);

    const chapterOptions = useMemo<ChapterOption[]>(() => {
        if (!book) return [];
        const summaryMap = new Map(planning.chapterSummaries.map(item => [item.chapterId, item.summary]));

        return book.volumes.flatMap(volume => (
            volume.chapters.map(chapter => ({
                id: chapter.id,
                title: chapter.title,
                volumeId: volume.id,
                volumeTitle: volume.title,
                summary: summaryMap.get(chapter.id) || '',
            }))
        ));
    }, [book, planning.chapterSummaries]);

    const selectedPlot = planning.plotSettings.find(plot => plot.id === selectedPlotId) || null;
    const chapterById = useMemo(() => new Map(chapterOptions.map(chapter => [chapter.id, chapter])), [chapterOptions]);

    useEffect(() => {
        setLinkedChapterSearchQuery('');
    }, [selectedPlotId]);

    useEffect(() => {
        const targetChapterId = searchParams.get('chapterId');
        if (
            !targetChapterId ||
            isLoading ||
            lastFocusedChapterIdRef.current === targetChapterId ||
            !chapterOptions.some(chapter => chapter.id === targetChapterId)
        ) {
            return;
        }

        lastFocusedChapterIdRef.current = targetChapterId;
        setChapterSearchQuery('');
        setFocusedChapterId(targetChapterId);

        window.setTimeout(() => {
            document.getElementById(`outline-chapter-${targetChapterId}`)?.scrollIntoView({
                block: 'center',
                behavior: 'smooth',
            });
            const textarea = document.getElementById(`outline-summary-${targetChapterId}`) as HTMLTextAreaElement | null;
            textarea?.focus({ preventScroll: true });
        }, 120);

        const highlightTimer = window.setTimeout(() => {
            setFocusedChapterId(prev => prev === targetChapterId ? null : prev);
        }, 2600);

        return () => window.clearTimeout(highlightTimer);
    }, [searchParams, isLoading, chapterOptions]);

    const filteredChapters = useMemo(() => {
        const query = chapterSearchQuery.trim();
        if (!query) return chapterOptions;

        return chapterOptions
            .map(chapter => {
                const fields = [
                    { value: chapter.title, weight: 0 },
                    { value: chapter.summary, weight: 0 },
                    { value: chapter.volumeTitle, weight: 8 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { ...chapter, score: bestScore };
            })
            .filter((chapter): chapter is ChapterOption & { score: number } => Boolean(chapter))
            .sort((a, b) => a.score - b.score);
    }, [chapterOptions, chapterSearchQuery]);

    const filteredPlots = useMemo(() => {
        const query = plotSearchQuery.trim();
        if (!query) return planning.plotSettings;

        return planning.plotSettings
            .map(plot => {
                const relatedChapterNames = plot.chapterIds
                    .map(chapterId => chapterById.get(chapterId)?.title || '')
                    .join(' ');
                const fields = [
                    { value: plot.title, weight: 0 },
                    { value: plot.details, weight: 0 },
                    { value: relatedChapterNames, weight: 8 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { ...plot, score: bestScore };
            })
            .filter((plot): plot is PlotSetting & { score: number } => Boolean(plot))
            .sort((a, b) => a.score - b.score);
    }, [planning.plotSettings, plotSearchQuery, chapterById]);

    const filteredLinkedChapters = useMemo(() => {
        const query = linkedChapterSearchQuery.trim();
        if (!query) return chapterOptions;

        return chapterOptions
            .map(chapter => {
                const fields = [
                    { value: chapter.title, weight: 0 },
                    { value: chapter.volumeTitle, weight: 5 },
                    { value: chapter.summary, weight: 12 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { ...chapter, score: bestScore };
            })
            .filter((chapter): chapter is ChapterOption & { score: number } => Boolean(chapter))
            .sort((a, b) => a.score - b.score);
    }, [chapterOptions, linkedChapterSearchQuery]);

    const markDirty = () => {
        setSaveState('dirty');
    };

    const updatePlanningField = (field: 'storySummary' | 'storyBackground', value: string) => {
        setPlanning(prev => ({ ...prev, [field]: value }));
        markDirty();
    };

    const updateChapterSummary = (chapterId: string, summary: string) => {
        setPlanning(prev => {
            const now = Date.now();
            const existing = prev.chapterSummaries.find(item => item.chapterId === chapterId);
            const nextSummaries: ChapterSummary[] = existing
                ? prev.chapterSummaries.map(item => item.chapterId === chapterId ? { ...item, summary, updatedAt: now } : item)
                : [...prev.chapterSummaries, { chapterId, summary, updatedAt: now }];
            return { ...prev, chapterSummaries: nextSummaries };
        });
        markDirty();
    };

    const updateSelectedPlot = (patch: Partial<PlotSetting>) => {
        if (!selectedPlotId) return;
        setPlanning(prev => ({
            ...prev,
            plotSettings: prev.plotSettings.map(plot => (
                plot.id === selectedPlotId ? { ...plot, ...patch, updatedAt: Date.now() } : plot
            )),
        }));
        markDirty();
    };

    const addPlotSetting = () => {
        const newPlot = createPlotSetting();
        setPlanning(prev => ({ ...prev, plotSettings: [newPlot, ...prev.plotSettings] }));
        setSelectedPlotId(newPlot.id);
        markDirty();
    };

    const confirmDeleteSelectedPlot = () => {
        if (!selectedPlotId) return;
        setPlanning(prev => {
            const nextPlots = prev.plotSettings.filter(plot => plot.id !== selectedPlotId);
            setSelectedPlotId(nextPlots[0]?.id || null);
            return { ...prev, plotSettings: nextPlots };
        });
        setShowDeleteModal(false);
        markDirty();
    };

    const togglePlotChapter = (chapterId: string) => {
        if (!selectedPlot) return;
        const chapterSet = new Set(selectedPlot.chapterIds);
        if (chapterSet.has(chapterId)) {
            chapterSet.delete(chapterId);
        } else {
            chapterSet.add(chapterId);
        }
        updateSelectedPlot({ chapterIds: Array.from(chapterSet) });
    };

    const handleSave = async () => {
        if (!bookId) return;
        setIsSaving(true);
        const validChapterIds = new Set(chapterOptions.map(chapter => chapter.id));
        const sanitizedPlanning: StoryPlanning = {
            storySummary: planning.storySummary,
            storyBackground: planning.storyBackground,
            chapterSummaries: planning.chapterSummaries
                .filter(item => validChapterIds.has(item.chapterId) && item.summary.trim())
                .map(item => ({ ...item, summary: item.summary.trim() })),
            plotSettings: planning.plotSettings.map(plot => ({
                ...plot,
                title: plot.title.trim() || 'Untitled Plot',
                details: plot.details,
                chapterIds: plot.chapterIds.filter(chapterId => validChapterIds.has(chapterId)),
            })),
        };

        const ok = await saveStoryPlanning(bookId, sanitizedPlanning);
        if (ok) {
            setPlanning(sanitizedPlanning);
            setSaveState('saved');
            window.setTimeout(() => setSaveState('idle'), 1800);
        }
        setIsSaving(false);
    };

    const openAiBrainstorm = () => {
        const targetChapterId = searchParams.get('chapterId');
        navigate(`/books/${bookId}/ai-brainstorm${targetChapterId ? `?chapterId=${targetChapterId}` : ''}`);
    };

    if (!book) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Book not found</div>;
    }

    return (
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 flex-shrink-0">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={() => navigate(`/books/${bookId}/settings`)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="font-bold text-lg text-slate-900 dark:text-white truncate">Story Outline & Plot Setting</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{book.title}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {saveState === 'dirty' && <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Unsaved changes</span>}
                    {saveState === 'saved' && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-300">
                            <CheckCircle2 size={14} />
                            Saved
                        </span>
                    )}
                    <Button onClick={handleSave} disabled={isSaving || isLoading} icon={isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}>
                        {isSaving ? 'Saving...' : 'Save Planning'}
                    </Button>
                    <Button variant="secondary" onClick={openAiBrainstorm} icon={<BrainCircuit size={16} />}>
                        AI Brainstorm
                    </Button>
                </div>
            </header>

            {isLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                    <Loader2 size={22} className="animate-spin mr-2" />
                    Loading planning workspace...
                </div>
            ) : (
                <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[340px_minmax(420px,1fr)_380px] overflow-hidden">
                    <aside className="min-h-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <BookOpen size={15} />
                                Chapter Summaries
                            </div>
                            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-950 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                                <Search size={15} className="flex-shrink-0 text-slate-400" />
                                <input
                                    value={chapterSearchQuery}
                                    onChange={(event) => setChapterSearchQuery(event.target.value)}
                                    placeholder="Search chapters or summaries"
                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                />
                                {chapterSearchQuery && (
                                    <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setChapterSearchQuery('')}>
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                            {chapterSearchQuery.trim() && (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {filteredChapters.length === 1 ? '1 chapter found' : `${filteredChapters.length} chapters found`}
                                </p>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {filteredChapters.length === 0 ? (
                                <div className="py-12 text-center text-sm text-slate-400">No matching chapters found.</div>
                            ) : filteredChapters.map(chapter => (
                                <section
                                    id={`outline-chapter-${chapter.id}`}
                                    key={chapter.id}
                                    className={`rounded-lg border bg-white p-3 shadow-sm transition ${
                                        focusedChapterId === chapter.id
                                            ? 'border-brand-300 ring-2 ring-brand-100 dark:border-brand-700 dark:ring-brand-900/40'
                                            : 'border-slate-200 dark:border-slate-800'
                                    } dark:bg-slate-950`}
                                >
                                    <div className="mb-2">
                                        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">{chapter.volumeTitle}</p>
                                        <h3 className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-white">{chapter.title}</h3>
                                    </div>
                                    <textarea
                                        id={`outline-summary-${chapter.id}`}
                                        value={chapter.summary}
                                        onChange={(event) => updateChapterSummary(chapter.id, event.target.value)}
                                        placeholder="Chapter plot summary..."
                                        className="h-28 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                                    />
                                </section>
                            ))}
                        </div>
                    </aside>

                    <main className="min-h-0 overflow-y-auto p-6">
                        <div className="mx-auto max-w-4xl space-y-5">
                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <div className="mb-4 flex items-start justify-between gap-4">
                                    <div>
                                        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-300">
                                            <FileText size={14} />
                                            Whole Book
                                        </div>
                                        <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Story Synopsis</h2>
                                    </div>
                                </div>
                                <textarea
                                    value={planning.storySummary}
                                    onChange={(event) => updatePlanningField('storySummary', event.target.value)}
                                    placeholder="Write the high-level story arc, main conflict, turning points, and ending direction..."
                                    className="min-h-56 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500"
                                />
                            </section>

                            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <div className="mb-4">
                                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                                        <Layers3 size={14} />
                                        Setting
                                    </div>
                                    <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Story Background</h2>
                                </div>
                                <textarea
                                    value={planning.storyBackground}
                                    onChange={(event) => updatePlanningField('storyBackground', event.target.value)}
                                    placeholder="Write the world background, timeline, factions, rules, locations, and hidden context..."
                                    className="min-h-64 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500"
                                />
                            </section>
                        </div>
                    </main>

                    <aside className="min-h-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    <Link2 size={15} />
                                    Plot Settings
                                </div>
                                <button
                                    onClick={addPlotSetting}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700"
                                    title="Add plot setting"
                                >
                                    <Plus size={16} />
                                </button>
                            </div>
                            <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-950 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                                <Search size={15} className="flex-shrink-0 text-slate-400" />
                                <input
                                    value={plotSearchQuery}
                                    onChange={(event) => setPlotSearchQuery(event.target.value)}
                                    placeholder="Search plot settings"
                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                />
                                {plotSearchQuery && (
                                    <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setPlotSearchQuery('')}>
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                            {plotSearchQuery.trim() && (
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {filteredPlots.length === 1 ? '1 plot found' : `${filteredPlots.length} plots found`}
                                </p>
                            )}
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                            {planning.plotSettings.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
                                    <Link2 size={28} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No plot settings yet</p>
                                    <Button size="sm" className="mt-4" onClick={addPlotSetting}>Create Plot Setting</Button>
                                </div>
                            ) : filteredPlots.length === 0 ? (
                                <div className="py-12 text-center text-sm text-slate-400">No matching plot settings found.</div>
                            ) : (
                                <div className="space-y-2">
                                    {filteredPlots.map(plot => (
                                        <button
                                            key={plot.id}
                                            onClick={() => setSelectedPlotId(plot.id)}
                                            className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                                                selectedPlotId === plot.id
                                                    ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-slate-800'
                                                    : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800'
                                            }`}
                                        >
                                            <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{plot.title || 'Untitled Plot'}</div>
                                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{plot.chapterIds.length} linked chapters</div>
                                        </button>
                                    ))}
                                </div>
                            )}

                            {selectedPlot && (
                                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                                    <div className="mb-4 flex items-center justify-between gap-3">
                                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Selected Plot</h3>
                                        <Button variant="danger" size="sm" onClick={() => setShowDeleteModal(true)} icon={<Trash2 size={14} />}>Delete</Button>
                                    </div>
                                    <div className="space-y-4">
                                        <div>
                                            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Title</label>
                                            <input
                                                value={selectedPlot.title}
                                                onChange={(event) => updateSelectedPlot({ title: event.target.value })}
                                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Details</label>
                                            <textarea
                                                value={selectedPlot.details}
                                                onChange={(event) => updateSelectedPlot({ details: event.target.value })}
                                                placeholder="Conflict, motivation, action beats, expected result..."
                                                className="h-36 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="mb-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">Linked Chapters</label>
                                            <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                                                <Search size={14} className="flex-shrink-0 text-slate-400" />
                                                <input
                                                    value={linkedChapterSearchQuery}
                                                    onChange={(event) => setLinkedChapterSearchQuery(event.target.value)}
                                                    placeholder="Search linked chapters"
                                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                                />
                                                {linkedChapterSearchQuery && (
                                                    <button
                                                        type="button"
                                                        className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                                        onClick={() => setLinkedChapterSearchQuery('')}
                                                    >
                                                        <X size={13} />
                                                    </button>
                                                )}
                                            </div>
                                            {linkedChapterSearchQuery.trim() && (
                                                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                                                    {filteredLinkedChapters.length === 1 ? '1 chapter found' : `${filteredLinkedChapters.length} chapters found`}
                                                </p>
                                            )}
                                            <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                                                {filteredLinkedChapters.length === 0 ? (
                                                    <div className="px-3 py-8 text-center text-xs text-slate-400">No matching chapters found.</div>
                                                ) : filteredLinkedChapters.map(chapter => {
                                                    const isChecked = selectedPlot.chapterIds.includes(chapter.id);
                                                    return (
                                                        <button
                                                            key={chapter.id}
                                                            type="button"
                                                            onClick={() => togglePlotChapter(chapter.id)}
                                                            className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-xs transition last:border-b-0 dark:border-slate-800 ${
                                                                isChecked ? 'bg-brand-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                                                            }`}
                                                        >
                                                            <span className={`flex h-4 w-4 items-center justify-center rounded border ${
                                                                isChecked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-700'
                                                            }`}>
                                                                {isChecked && <CheckCircle2 size={12} />}
                                                            </span>
                                                            <span className="min-w-0">
                                                                <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{chapter.title}</span>
                                                                <span className="block truncate text-slate-400">{chapter.volumeTitle}</span>
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            )}
                        </div>
                    </aside>
                </div>
            )}

            {showDeleteModal && selectedPlot && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4 text-rose-600">
                            <div className="p-2 bg-rose-100 dark:bg-rose-950/60 rounded-full">
                                <AlertTriangle size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Plot Setting?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                            Are you sure you want to delete <span className="font-bold text-slate-800 dark:text-white">{selectedPlot.title || 'Untitled Plot'}</span>?<br />
                            This plot setting and its chapter links will be removed from the planning board.
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
                            <Button
                                variant="primary"
                                className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200 dark:shadow-none"
                                onClick={confirmDeleteSelectedPlot}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StoryOutline;
