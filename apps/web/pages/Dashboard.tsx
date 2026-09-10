import React, { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../InteractionContent/SessionContext';
import { useBooks } from '../InteractionContent/BooksContext';
import { useBookshelfActions } from '../features/books/hooks/useBookshelfActions';
import { BookCard } from '../features/books/components/BookCard';
import { BookActionsMenu } from '../features/books/components/BookActionsMenu';
import { Button } from '../components/ui/Button';
import { Plus, LogOut, Settings, Search, X } from 'lucide-react';
import { Book } from '../types';
import { getFuzzyScore } from '../utils/search';

interface BookSearchResult {
    book: Book;
    score: number;
}

const Dashboard: React.FC = () => {
    const { user, logout } = useSession();
    const { books } = useBooks();
    const navigate = useNavigate();

    const [bookSearchQuery, setBookSearchQuery] = useState('');
    const actions = useBookshelfActions();
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

    const handleCreate = async () => { setBookSearchQuery(''); await actions.handleCreate(); };
    const handleLogout = () => { logout(); navigate('/login'); };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 relative transition-colors duration-300">
            <nav className="bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-10 transition-colors duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-serif font-bold">S</div>
                    <span className="font-bold text-xl text-slate-800 dark:text-white tracking-tight">StoryArk</span>
                </div>
                <div className="flex items-center gap-4">
                    <span className="text-sm text-slate-600 dark:text-slate-300">Welcome, <strong>{user?.username}</strong></span>
                    <Link to="/settings">
                        <Button variant="ghost" size="sm" icon={<Settings size={14} />}>
                            Settings
                        </Button>
                    </Link>
                    <Button variant="secondary" size="sm" onClick={handleLogout} icon={<LogOut size={14} />}>
                        Logout
                    </Button>
                </div>
            </nav>

            <main className="max-w-6xl mx-auto p-8">
                <div className="flex flex-col gap-5 mb-8 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">My Bookshelf</h1>
                        <p className="text-slate-500 dark:text-slate-400">Manage your stories and worlds.</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="relative w-full sm:w-80">
                            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
                                <Search size={17} className="flex-shrink-0 text-slate-400" />
                                <input
                                    value={bookSearchQuery}
                                    onChange={(event) => setBookSearchQuery(event.target.value)}
                                    placeholder="Search books"
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
                        {/* Call handleCreate, no need for isCreating state now */}
                        <Button onClick={handleCreate} icon={<Plus size={16} />}>
                            New Book
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredBooks.map(book => <BookCard key={book.id} book={book} {...actions} />)}

                    {/* Create Book Button in Empty State */}
                    {books.length === 0 && (
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
        </div>
    );
};

export default Dashboard;
