import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Loader2, Save, Wand2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useBooks } from '../InteractionContent/BooksContext';
import { useBrainstormWorkspace } from '../features/brainstorm/hooks/useBrainstormWorkspace';
import { BrainstormChapterPicker } from '../features/brainstorm/components/BrainstormChapterPicker';
import { BrainstormResults } from '../features/brainstorm/components/BrainstormResults';
import { BrainstormContextPanel } from '../features/brainstorm/components/BrainstormContextPanel';
function AiBrainstormContent({ bookId }: { bookId: string }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { getBook } = useBooks();
    const book = getBook(bookId);
    const editor = useBrainstormWorkspace(bookId, book, searchParams.get('chapterId'));
    const { isLoading, loadError, isSaving, isGenerating, saveState, handleSave, handleGenerate } = editor;
    if (!book) return <div className="min-h-screen flex items-center justify-center text-slate-400">Book not found</div>;
    return (
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
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
                        {saveState === 'dirty' && <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Unsaved changes</span>}
                        {saveState === 'saved' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-300">
                                <CheckCircle2 size={14} />
                                Saved
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button onClick={handleSave} disabled={isSaving || isGenerating || isLoading || loadError} icon={isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}>
                            {isSaving ? 'Saving...' : 'Save Result'}
                        </Button>
                        <Button variant="secondary" onClick={handleGenerate} disabled={isGenerating || isSaving || isLoading || loadError} icon={isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}>
                            {isGenerating ? 'Brainstorming...' : 'Regenerate'}
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
                    <BrainstormResults isGenerating={isGenerating} isSaving={isSaving} handleGenerate={handleGenerate}
                        selectedChapterIds={editor.selectedChapterIds} missingSummaryChapters={editor.missingSummaryChapters}
                        errorMessage={editor.errorMessage} visibleOptions={editor.visibleOptions} workspace={editor.workspace}
                        chooseOption={editor.chooseOption} showAllOptions={editor.showAllOptions} updateFinalContent={editor.updateFinalContent} />
                    <BrainstormContextPanel mentionedCharacters={editor.mentionedCharacters} />
                </div>
            )}
        </div>
    );
}
export default function AiBrainstorm() {
    const { bookId = '' } = useParams();
    return <AiBrainstormContent key={bookId} bookId={bookId} />;
}
