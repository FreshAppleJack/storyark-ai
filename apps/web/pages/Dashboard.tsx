import React, { useCallback, useRef, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../InteractionContent/SessionContext';
import { useBooks } from '../InteractionContent/BooksContext';
import { useBookshelfActions } from '../features/books/hooks/useBookshelfActions';
import { BookCard } from '../features/books/components/BookCard';
import { BookActionsMenu } from '../features/books/components/BookActionsMenu';
import { WorkImportPreflightDialog } from '../features/books/components/WorkImportPreflightDialog';
import { useWorkImport } from '../features/books/hooks/useWorkImport';
import { Button } from '../components/ui/Button';
import { FileUp, Plus, LogOut, Settings, Search, X } from 'lucide-react';
import { Book } from '../types';
import { getFuzzyScore } from '../utils/search';
import { localDerivedIndexKey, localKeys } from '../data/local/repository';
import { planningKey } from '../data/local/planningRepository';
import { localGraphKey } from '../data/local/graphRepository';
import { brainstormKey } from '../data/local/brainstormRepository';
import type { WorkImportResult } from '../data/export/importRepository';

interface BookSearchResult {
    book: Book;
    score: number;
}

const Dashboard: React.FC = () => {
    const { user, logout } = useSession();
    const { books, storageMode, booksLoading, booksError, refreshBooks, createBook } = useBooks();
    const isLocal = storageMode === 'local';
    const [showCreate, setShowCreate] = useState(false);
    const [newTitle, setNewTitle] = useState('');
    const [author, setAuthor] = useState('');
    const [creating, setCreating] = useState(false);
    const navigate = useNavigate();

    const [bookSearchQuery, setBookSearchQuery] = useState('');
    const actions = useBookshelfActions();
    const importInputRef = useRef<HTMLInputElement>(null);
    const queryClient = useQueryClient();
    const refreshAfterImport = useCallback(async (result: WorkImportResult) => {
        let refreshFailed = false;
        try {
            await refreshBooks?.();
        } catch {
            refreshFailed = true;
        }
        queryClient.setQueryData(localDerivedIndexKey(result.bookId), { status: result.derivedIndexStatus });
        const refreshResults = await Promise.allSettled([
            queryClient.invalidateQueries({ queryKey: localKeys.book(result.bookId) }),
            queryClient.invalidateQueries({ queryKey: localKeys.characters(result.bookId) }),
            queryClient.invalidateQueries({ queryKey: planningKey(result.bookId) }),
            queryClient.invalidateQueries({ queryKey: localGraphKey(result.bookId) }),
            queryClient.invalidateQueries({ queryKey: brainstormKey(result.bookId) }),
        ]);
        if (refreshFailed || refreshResults.some(item => item.status === 'rejected')) {
            throw new Error('Local Query refresh did not complete.');
        }
    }, [queryClient, refreshBooks]);
    const {
        report: importReport,
        preparation: importPreparation,
        importError,
        importErrorCode,
        phase: importPhase,
        outcome: importOutcome,
        isChecking: isCheckingImport,
        isExecuting: isExecutingImport,
        cancelRequested: cancelRequestedImport,
        nativeFilePickerAvailable,
        inspectBrowserFile,
        openNativeImport,
        executeImport,
        cancelImport,
        closeReport,
    } = useWorkImport({ onImported: refreshAfterImport });
    const bookSearchResults = useMemo<BookSearchResult[]>(() => {
        const query = bookSearchQuery.trim();
        if (!query) {
            return books.map((book, index) => ({ book, score: index }));
        }

        return books
            .map((book) => {
                const volumeTitles = book.volumes.map(volume => volume.title).join(' ');
                const chapterTitles = book.volumes.flatMap(volume => volume.chapters.map(chapter => chapter.title)).join(' ');
                const fields = [
                    { value: book.title, weight: 0 },
                    { value: book.author, weight: 6 },
                    { value: book.status, weight: 10 },
                    { value: volumeTitles, weight: 18 },
                    { value: chapterTitles, weight: 24 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { book, score: bestScore };
            })
            .filter((result): result is BookSearchResult => Boolean(result))
            .sort((a, b) => a.score - b.score);
    }, [books, bookSearchQuery]);

    const filteredBooks = bookSearchResults.map(result => result.book);
    const isSearchingBooks = bookSearchQuery.trim().length > 0;

    const handleCreate = async () => { setBookSearchQuery(''); if (isLocal) setShowCreate(true); else await actions.handleCreate(); };
    const handleImport = async () => {
        if (nativeFilePickerAvailable) {
            await openNativeImport();
            return;
        }
        importInputRef.current?.click();
    };
    const submitCreate = async (event: React.FormEvent) => {
        event.preventDefault();
        if (creating || !newTitle.trim()) return;
        setCreating(true);
        try {
            const id = await createBook(newTitle.trim(), author.trim());
            if (id) { setShowCreate(false); setNewTitle(''); setAuthor(''); }
        } finally { setCreating(false); }
    };
    const handleLogout = () => { logout(); navigate('/login'); };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 relative transition-colors duration-300">
            <nav className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-10 transition-colors duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-serif font-bold">S</div>
                    <span className="font-bold text-xl text-slate-800 dark:text-white tracking-tight">StoryArk</span>
                </div>
                <div className="flex items-center gap-4">
                    {!isLocal && <>
                    <span className="text-sm text-slate-600 dark:text-slate-300">Welcome, <strong>{user?.username}</strong></span>
                    </>}
                    <Link to="/settings">
                        <Button variant="ghost" size="sm" icon={<Settings size={14} />}>
                            Settings
                        </Button>
                    </Link>
                    {!isLocal && <Button variant="secondary" size="sm" onClick={handleLogout} icon={<LogOut size={14} />}>
                        Logout
                    </Button>}
                </div>
            </nav>

            <main className="max-w-6xl mx-auto p-8">
                <div className="flex flex-col gap-5 mb-8 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">My Bookshelf</h1>
                        <p className="text-slate-500 dark:text-slate-400">Enjoy bringing your stories to life.</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="relative w-full sm:w-80">
                            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
                                <Search size={17} className="flex-shrink-0 text-slate-400" />
                                <input
                                    value={bookSearchQuery}
                                    onChange={(event) => setBookSearchQuery(event.target.value)}
                                    placeholder={isLocal ? 'Search titles and authors' : 'Search books'}
                                    className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                />
                                {isSearchingBooks && (
                                    <button
                                        type="button"
                                        onClick={() => setBookSearchQuery('')}
                                        className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                        aria-label="Clear book search"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            {isSearchingBooks && (
                                <p className="absolute left-0 top-full mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    {filteredBooks.length === 1 ? '1 book found' : `${filteredBooks.length} books found`}
                                </p>
                            )}
                        </div>
                        {isLocal && <>
                            <input
                                ref={importInputRef}
                                type="file"
                                accept=".storyark.json,.json,application/json"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = '';
                                    if (file) void inspectBrowserFile(file);
                                }}
                            />
                            <Button variant="secondary" onClick={() => void handleImport()} disabled={!!booksLoading || !!booksError || isCheckingImport} icon={<FileUp size={16} />}>
                                {isCheckingImport ? 'Checking...' : 'Import'}
                            </Button>
                        </>}
                        <Button onClick={handleCreate} disabled={!!booksLoading || !!booksError} icon={<Plus size={16} />}>
                            New Book
                        </Button>
                    </div>
                </div>

                {isLocal && <p className="mb-4 text-sm text-slate-500">Create books, volumes and chapters, then write locally. Configure a model in Settings to use AI Continue.</p>}
                {booksLoading && <p role="status">Loading local books...</p>}
                {booksError && <div role="alert" className="mb-6 rounded border border-rose-300 p-4">
                    <p>{booksError}</p><Button variant="secondary" onClick={() => void refreshBooks?.()}>Retry</Button>
                </div>}
                {showCreate && <form onSubmit={submitCreate} className="mb-6 rounded-xl border border-slate-300 bg-white p-6 space-y-4 dark:bg-slate-900">
                    <h2 className="text-lg font-semibold">Create a local book</h2>
                    <label className="block">Title<input autoFocus required maxLength={512} value={newTitle} onChange={e => setNewTitle(e.target.value)} className="block w-full rounded border bg-transparent p-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40" /></label>
                    <label className="block">Author (optional)<input maxLength={256} value={author} onChange={e => setAuthor(e.target.value)} className="block w-full rounded border bg-transparent p-2 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/40" /></label>
                    <div className="flex gap-3"><Button type="submit" disabled={creating}>{creating ? 'Creating...' : 'Create Book'}</Button>
                        <Button type="button" variant="secondary" disabled={creating} onClick={() => setShowCreate(false)}>Cancel</Button></div>
                </form>}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredBooks.map(book => <BookCard key={book.id} book={book} summaryOnly={isLocal} {...actions} />)}

                    {/* Create Book Button in Empty State */}
                    {!booksLoading && !booksError && books.length === 0 && (
                        <div className="col-span-full py-20 text-center bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                            <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                                <Plus size={32} />
                            </div>
                            <h3 className="text-lg font-medium text-slate-900 dark:text-white">No books yet</h3>
                            <p className="text-slate-500 dark:text-slate-400 mb-6">Start your journey by creating your first book.</p>
                            <Button onClick={handleCreate}>Create Book</Button>
                        </div>
                    )}

                    {books.length > 0 && filteredBooks.length === 0 && (
                        <div className="col-span-full py-16 text-center bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                            <div className="w-14 h-14 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                                <Search size={26} />
                            </div>
                            <h3 className="text-lg font-medium text-slate-900 dark:text-white">No matching books found</h3>
                            <p className="text-slate-500 dark:text-slate-400 mb-6">Try a title, author, status, volume, or chapter name.</p>
                            <Button variant="secondary" onClick={() => setBookSearchQuery('')}>Clear Search</Button>
                        </div>
                    )}
                </div>
            </main>

            <BookActionsMenu {...actions} />
            {importReport && <WorkImportPreflightDialog
                report={importReport}
                preparation={importPreparation}
                importError={importError}
                importErrorCode={importErrorCode}
                phase={importPhase}
                outcome={importOutcome}
                isExecuting={isExecutingImport}
                cancelRequested={cancelRequestedImport}
                onClose={() => { void (isExecutingImport ? cancelImport() : closeReport()); }}
                onImport={() => void executeImport('import')}
                onReplace={() => void executeImport('replace')}
                onCreateCopy={() => void executeImport('copy')}
            />}
        </div>
    );
};

export default Dashboard;
