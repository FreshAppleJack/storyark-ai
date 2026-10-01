import React, { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { SaveStatusIndicator } from '../components/ui/SaveStatusIndicator';
import { useBooks } from '../InteractionContent/BooksContext';
import type { Book } from '../types';
import { localBookOptions, localCharactersOptions, projectBook, projectCharacter } from '../data/local/repository';
import { localPlanningOptions, type LocalPlanning } from '../data/local/planningRepository';
import { localBrainstormOptions, type LocalBrainstorm } from '../data/local/brainstormRepository';
import { localGraphOptions } from '../data/local/graphRepository';
import { useBrainstormWorkspace, type BrainstormSources } from '../features/brainstorm/hooks/useBrainstormWorkspace';
import { useLocalBrainstormPersistence } from '../features/brainstorm/hooks/useLocalBrainstormPersistence';
import { buildRelationships } from '../features/brainstorm/brainstormContext';
import { BrainstormChapterPicker } from '../features/brainstorm/components/BrainstormChapterPicker';
import { BrainstormResults } from '../features/brainstorm/components/BrainstormResults';
import { BrainstormContextPanel } from '../features/brainstorm/components/BrainstormContextPanel';
import { PlanningSaveGuard } from '../features/planning/components/PlanningSaveGuard';
function AiBrainstormContent({ bookId, localBook, sources }: { bookId: string; localBook?: Book; sources?: BrainstormSources }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getBook } = useBooks();
    const book = localBook ?? getBook(bookId);
    const editor = useBrainstormWorkspace(bookId, book, searchParams.get('chapterId'), sources);
    const { isLoading, loadError, isSaving, isGenerating, saveState, handleSave } = editor;
    if (!book) return <div className="min-h-screen flex items-center justify-center text-slate-400">Book not found</div>;
    return (
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            {sources && <PlanningSaveGuard isDirty={editor.isDirty} flush={editor.flush} />}
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 flex-shrink-0">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={() => navigate(`/books/${bookId}/story-outline`)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="font-bold text-lg text-slate-900 dark:text-white truncate">AI Brainstorm</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{book.title}</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="flex min-w-28 justify-end">
                        {(saveState !== 'idle' || isSaving) && (
                            <SaveStatusIndicator state={isSaving ? 'saving' : saveState === 'dirty' ? 'unsaved' : 'saved'} />
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button onClick={handleSave} disabled={isSaving || isGenerating || isLoading || loadError} icon={isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}>
                            {isSaving ? 'Saving...' : 'Save Result'}
                        </Button>
                        <Button variant="secondary" onClick={() => navigate(`/editor/${bookId}`)} icon={<ArrowLeft size={16} />}>
                            Back to Editor
                        </Button>
                    </div>
                </div>
            </header>
            {loadError ? (
                <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
                    <p>Could not load this workspace. Retry before making changes.</p>
                    <Button onClick={editor.retry}>Retry</Button>
                </div>
            ) : isLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                    <Loader2 size={22} className="animate-spin mr-2" />Loading brainstorm workspace...
                </div>
            ) : (
                <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[340px_minmax(520px,1fr)_340px] overflow-hidden">
                    <BrainstormChapterPicker chapterOptions={editor.chapterOptions} selectedChapterIds={editor.selectedChapterIds} toggleChapter={editor.toggleChapter} />
                    <BrainstormResults isGenerating={isGenerating} isSaving={isSaving} handleGenerate={editor.handleGenerate} regenerate={editor.regenerate}
                        stopGeneration={editor.stopGeneration} discardCandidate={editor.discardCandidate} candidate={editor.candidate} isReadOnly={editor.isReadOnly}
                        generationAvailable={editor.generationAvailable} isSnapshotStale={editor.isSnapshotStale}
                        selectedChapterIds={editor.selectedChapterIds} missingSummaryChapters={editor.missingSummaryChapters}
                        errorMessage={editor.errorMessage} visibleOptions={editor.visibleOptions} hasSelectedOption={editor.hasSelectedOption} workspace={editor.workspace}
                        chooseOption={editor.chooseOption} showAllOptions={editor.showAllOptions} updateFinalContent={editor.updateFinalContent}
                        toggleRetrievalHit={editor.toggleRetrievalHit} />
                    <BrainstormContextPanel mentionedCharacters={editor.mentionedCharacters} />
                </div>
            )}
        </div>
    );
}
function LoadedLocalBrainstorm({ book, planning, initial }: { book: Book; planning: LocalPlanning; initial: LocalBrainstorm }) {
    const persistence = useLocalBrainstormPersistence(initial);
    const graph = useQuery(localGraphOptions(book.id));
    const sources = useMemo<BrainstormSources>(() => ({
        planning,
        // An uninitialized map is simply "no relationships" here; opening this
        // page must never initialize or reseed graphs.
        relationships: graph.data ? buildRelationships(graph.data, book.characters) : [],
        generation: () => ({
            bookId: book.id,
            workspaceBookId: initial.bookId,
            workspaceDatabaseVersion: persistence.getDatabaseVersion?.() ?? initial.databaseVersion,
            planningBookId: planning.bookId,
            planningDatabaseVersion: planning.databaseVersion,
            graphBookId: graph.data?.bookId ?? book.id,
            graphDatabaseVersion: graph.data?.databaseVersion ?? 0,
        }),
        persistence,
    }), [book.id, book.characters, graph.data, initial.bookId, initial.databaseVersion, planning, persistence]);
    if (graph.isPending || graph.isFetching) return <main className="p-8"><p role="status">Loading brainstorm workspace...</p></main>;
    if (graph.error) return <main className="p-8 space-y-4">
        <p role="alert">{graph.error.message}</p>
        <Button onClick={() => { void graph.refetch(); }}>Retry</Button>
    </main>;
    return <AiBrainstormContent bookId={book.id} localBook={book} sources={sources} />;
}
function LocalBrainstormRoute({ bookId }: { bookId: string }) {
    const detail = useQuery({ ...localBookOptions(bookId), refetchOnMount: 'always' });
    const characters = useQuery(localCharactersOptions(bookId));
    const planning = useQuery(localPlanningOptions(bookId));
    const workspace = useQuery(localBrainstormOptions(bookId));
    const book = useMemo(() => detail.data
        ? projectBook(detail.data.book, detail.data, characters.data?.map(projectCharacter))
        : undefined, [detail.data, characters.data]);
    const error = detail.error ?? characters.error ?? planning.error ?? workspace.error;
    if (error || !book || !planning.data || !workspace.data || detail.isFetching || planning.isFetching || workspace.isFetching) return <main className="p-8 space-y-4">
        <p role={error ? 'alert' : 'status'}>{error?.message ?? 'Loading brainstorm workspace...'}</p>
        {error && <Button onClick={() => { void detail.refetch(); void characters.refetch(); void planning.refetch(); void workspace.refetch(); }}>Retry</Button>}
    </main>;
    return <LoadedLocalBrainstorm book={book} planning={planning.data} initial={workspace.data} />;
}
export default function AiBrainstorm() {
    const { bookId = '' } = useParams();
    const { storageMode } = useBooks();
    return storageMode === 'local'
        ? <LocalBrainstormRoute key={bookId} bookId={bookId} />
        : <AiBrainstormContent key={bookId} bookId={bookId} />;
}
