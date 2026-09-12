import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Book } from '../types';
import { localBookOptions, projectBook } from '../data/local/repository';
import { localPlanningOptions, type LocalPlanning } from '../data/local/planningRepository';
import { useLocalPlanningPersistence } from '../features/planning/hooks/useLocalPlanningPersistence';
import type { PlanningPersistence } from '../features/planning/hooks/useStoryPlanning';
import { PlanningSaveGuard } from '../features/planning/components/PlanningSaveGuard';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BrainCircuit, CheckCircle2, Loader2, Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useBooks } from '../InteractionContent/BooksContext';
import { useStoryPlanning } from '../features/planning/hooks/useStoryPlanning';
import { ChapterSummariesPanel } from '../features/planning/components/ChapterSummariesPanel';
import { StoryOverviewPanel } from '../features/planning/components/StoryOverviewPanel';
import { PlotSettingsPanel } from '../features/planning/components/PlotSettingsPanel';

function StoryOutlineContent({ bookId, localBook, persistence }: { bookId: string; localBook?: Book; persistence?: PlanningPersistence }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getBook } = useBooks();
    const book = localBook ?? getBook(bookId);
    const editor = useStoryPlanning(bookId, book, persistence);
    const { isLoading, loadError, isSaving, saveState, handleSave } = editor;
    const openAiBrainstorm = () => {
        const chapterId = searchParams.get('chapterId');
        navigate(`/books/${bookId}/ai-brainstorm${chapterId ? `?chapterId=${chapterId}` : ''}`);
    };
    if (!book) return <div className="min-h-screen flex items-center justify-center text-slate-400">Book not found</div>;
    return (
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            {persistence && <PlanningSaveGuard isDirty={editor.isDirty} flush={editor.flush} />}
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
                    <Button onClick={handleSave} disabled={isSaving || isLoading || loadError} icon={isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}>
                        {isSaving ? 'Saving...' : 'Save Planning'}
                    </Button>
                    <Button variant="secondary" onClick={openAiBrainstorm} icon={<BrainCircuit size={16} />}>
                        AI Brainstorm
                    </Button>
                </div>
            </header>
            {editor.saveError && <p role="alert" className="px-4 py-2 text-sm text-rose-600">{editor.saveError} Retry with Save Planning.</p>}
            {loadError ? (
                <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
                    <p>Could not load this workspace. Retry before making changes.</p>
                    <Button onClick={editor.retry}>Retry</Button>
                </div>
            ) : isLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                    <Loader2 size={22} className="animate-spin mr-2" />Loading planning workspace...
                </div>
            ) : (
                <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[340px_minmax(420px,1fr)_380px] overflow-hidden">
                    <ChapterSummariesPanel chapterOptions={editor.chapterOptions} targetChapterId={searchParams.get('chapterId')}
                        updateChapterSummary={editor.updateChapterSummary} />
                    <StoryOverviewPanel planning={editor.planning} updatePlanningField={editor.updatePlanningField} />
                    <PlotSettingsPanel planning={editor.planning} selectedPlot={editor.selectedPlot} selectedPlotId={editor.selectedPlotId}
                        setSelectedPlotId={editor.setSelectedPlotId} chapterOptions={editor.chapterOptions} addPlotSetting={editor.addPlotSetting}
                        updateSelectedPlot={editor.updateSelectedPlot} deleteSelectedPlot={editor.deleteSelectedPlot} togglePlotChapter={editor.togglePlotChapter} />
                </div>
            )}
        </div>
    );
}
export default function StoryOutline() {
    const { bookId = '' } = useParams();
    const { storageMode } = useBooks();
    return storageMode === 'local' ? <LocalOutline key={bookId} bookId={bookId} /> : <StoryOutlineContent key={bookId} bookId={bookId} />;
}

function LoadedLocalOutline({ book, initial }: { book: Book; initial: LocalPlanning }) {
    const persistence = useLocalPlanningPersistence(initial);
    return <StoryOutlineContent bookId={book.id} localBook={book} persistence={persistence} />;
}
function LocalOutline({ bookId }: { bookId: string }) {
    const detail = useQuery({ ...localBookOptions(bookId), refetchOnMount: 'always' });
    const planning = useQuery(localPlanningOptions(bookId));
    const book = useMemo(() => detail.data ? projectBook(detail.data.book, detail.data) : undefined, [detail.data]);
    const error = detail.error ?? planning.error;
    if (error || !book || !planning.data || detail.isFetching || planning.isFetching) return <main className="p-8">
        <p role={error ? 'alert' : 'status'}>{error?.message ?? 'Loading planning workspace...'}</p>
        {error && <Button onClick={() => { void detail.refetch(); void planning.refetch(); }}>Retry</Button>}
    </main>;
    return <LoadedLocalOutline book={book} initial={planning.data} />;
}
