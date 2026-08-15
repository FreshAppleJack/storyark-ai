import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../InteractionContent/AppContext';
import { Button } from '../components/ui/Button';
import { Plus, Book as BookIcon, Clock, LogOut, MoreVertical, Pencil, Trash2, CheckCircle2, AlertTriangle, PenTool, Settings, Search, X, MessageSquareText } from 'lucide-react';
import { Book } from '../types';

interface ContextMenuState {
    x: number;
    y: number;
    bookId: string;
}

interface BookSearchResult {
    book: Book;
    score: number;
}

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const getUnrecoveredForeshadowingCount = (book: Book) => (
    book.volumes.reduce((bookTotal, volume) => (
        bookTotal + volume.chapters.reduce((volumeTotal, chapter) => (
            volumeTotal + (chapter.foreshadowings || []).filter(note => !note.isRecovered).length
        ), 0)
    ), 0)
);

const getFuzzyScore = (value: string, query: string) => {
    const target = normalizeSearchText(value);
    const needle = normalizeSearchText(query);
    if (!needle) return null;
    if (!target) return null;

    const exactIndex = target.indexOf(needle);
    if (exactIndex >= 0) {
        return exactIndex + Math.max(0, target.length - needle.length) * 0.01;
    }

    let targetIndex = 0;
    let gapPenalty = 0;
    for (const char of needle) {
        const foundIndex = target.indexOf(char, targetIndex);
        if (foundIndex === -1) return null;
        gapPenalty += foundIndex - targetIndex;
        targetIndex = foundIndex + 1;
    }

    return 100 + gapPenalty + Math.max(0, target.length - needle.length) * 0.02;
};

const Dashboard: React.FC = () => {
    const { user, books, createBook, updateBook, deleteBook, logout } = useApp();
    const navigate = useNavigate();

    // State: Context Menu & Delete Modal Logic
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [bookToDelete, setBookToDelete] = useState<string | null>(null);
    const [bookSearchQuery, setBookSearchQuery] = useState('');

    // State: Rename Logic
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renamingValue, setRenamingValue] = useState<string>('');
    const renameInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClick = () => {
            setContextMenu(null);
            // if click outside rename input, submit rename if any
            if (renamingId) submitRename();
        };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [renamingId, renamingValue]); // add renamingId, renamingValue to dependency array

    // Auto focus Input and select all
    useEffect(() => {
        if (renamingId && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingId]);

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

    // --- Create Book (Core Modification) ---
    // Click to create -> Get ID -> Enter Rename Mode
    const handleCreate = async () => {
        setBookSearchQuery('');
        // Create a book with default title
        const defaultTitle = "Untitled Story";
        const newBookId = await createBook(defaultTitle);

        if (newBookId) {
            setRenamingId(newBookId);
            setRenamingValue(defaultTitle);
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleContextMenu = (e: React.MouseEvent, bookId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            bookId
        });
    };

    // --- Rename Logic ---
    const startRename = () => {
        if (!contextMenu) return;
        const book = books.find(b => b.id === contextMenu.bookId);
        if (book) {
            setRenamingId(book.id);
            setRenamingValue(book.title);
        }
        setContextMenu(null);
    };

    const submitRename = async () => {
        if (!renamingId) return;

        // If name is empty, restore original name or keep default title
        const finalTitle = renamingValue.trim() || "Untitled Story";

        // Only call update API when name actually changes
        const book = books.find(b => b.id === renamingId);
        if (book && book.title !== finalTitle) {
            await updateBook(renamingId, { title: finalTitle });
        }

        setRenamingId(null);
        setRenamingValue('');
    };

    const cancelRename = () => {
        setRenamingId(null);
        setRenamingValue('');
    };

    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            submitRename();
        } else if (e.key === 'Escape') {
            cancelRename();
        }
    };

    // --- Toggle Status Logic ---
    const handleToggleStatus = async () => {
        if (!contextMenu) return;
        const book = books.find(b => b.id === contextMenu.bookId);
        if (!book) return;

        const newStatus = book.status === 'completed' ? 'serializing' : 'completed';
        await updateBook(book.id, { status: newStatus });
        setContextMenu(null);
    };

    const handleDeleteClick = () => {
        if (contextMenu) {
            setBookToDelete(contextMenu.bookId);
            setShowDeleteModal(true);
            setContextMenu(null);
        }
    };

    const confirmDelete = async () => {
        if (bookToDelete) {
            await deleteBook(bookToDelete);
        }
        setShowDeleteModal(false);
        setBookToDelete(null);
    };

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
                        <Button variant="ghost" size="sm" icon={<Settings size={14}/>}>
                            Settings
                        </Button>
                    </Link>
                    <Button variant="secondary" size="sm" onClick={handleLogout} icon={<LogOut size={14}/>}>
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
                        <Button onClick={handleCreate} icon={<Plus size={16}/>}>
                            New Book
                        </Button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredBooks.map((book) => {
                        const isRenaming = renamingId === book.id;
                        const unrecoveredForeshadowingCount = getUnrecoveredForeshadowingCount(book);

                        //most Container: If renaming, click should not navigate to
                        const Container = isRenaming ? 'div' : Link as any;
                        const containerProps = isRenaming ? {} : { to: `/editor/${book.id}` };

                        return (
                            <Container
                                key={book.id}
                                {...containerProps}
                                onContextMenu={(e: React.MouseEvent) => handleContextMenu(e, book.id)}
                                className="group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-xl hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-300 flex flex-col h-64 relative cursor-pointer"
                                onClick={(e) => {
                                    if (isRenaming) e.stopPropagation(); // Prevent triggering other logic when renaming
                                }}
                            >
                                <div className={`h-24 ${book.coverColor || 'bg-slate-800'} relative p-4 transition-colors duration-300`}>
                                    <div className={`absolute top-3 right-3 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1
                                        ${book.status === 'completed'
                                        ? 'bg-emerald-500/90 text-white backdrop-blur-sm'
                                        : 'bg-amber-400/90 text-slate-900 backdrop-blur-sm'
                                    }`}>
                                        {book.status === 'completed' ? (
                                            <><CheckCircle2 size={10} /> Completed</>
                                        ) : (
                                            <><PenTool size={10} /> Serializing</>
                                        )}
                                    </div>

                                    <div className="absolute -bottom-6 left-4 w-12 h-16 bg-white dark:bg-slate-800 shadow-md rounded border border-slate-100 dark:border-slate-700 flex items-center justify-center">
                                        <BookIcon className="text-slate-400" size={20} />
                                    </div>
                                </div>

                                <div className="pt-8 p-4 flex-1 flex flex-col">
                                    {isRenaming ? (
                                        <input
                                            ref={renameInputRef}
                                            type="text"
                                            value={renamingValue}
                                            onChange={(e) => setRenamingValue(e.target.value)}
                                            onKeyDown={handleRenameKeyDown}
                                            onBlur={submitRename}
                                            onClick={(e) => e.stopPropagation()}
                                            className="font-bold text-lg text-slate-900 dark:text-white mb-1 border-b-2 border-brand-500 outline-none bg-transparent w-full pb-1"
                                        />
                                    ) : (
                                        <h3 className="font-bold text-lg text-slate-900 dark:text-white mb-1 line-clamp-1 group-hover:text-brand-600 dark:group-hover:text-brand-300 transition-colors">
                                            {book.title}
                                        </h3>
                                    )}

                                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">by {book.author}</p>
                                    <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400 dark:text-slate-500 border-t border-slate-50 dark:border-slate-800 pt-4">
                                        <span className="flex items-center gap-1">
                                            <BookIcon size={12}/> {book.volumes.reduce((acc, v) => acc + v.chapters.length, 0)} Chapters
                                        </span>
                                        <span className={`flex items-center gap-1 ${unrecoveredForeshadowingCount > 0 ? 'text-amber-600 dark:text-amber-300' : ''}`}>
                                            <MessageSquareText size={12}/> {unrecoveredForeshadowingCount} Foreshadowing Unrecovered
                                        </span>
                                        <span className="flex items-center gap-1">
                                            <Clock size={12}/>
                                            {new Date(book.lastModified).toLocaleString(undefined, {
                                                year: 'numeric',
                                                month: 'numeric',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                hour12: false
                                            })}
                                        </span>
                                    </div>
                                </div>
                            </Container>
                        );
                    })}

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

            {contextMenu && (
                <div
                    className="fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-lg py-1 w-48 animate-in fade-in zoom-in duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={startRename}
                        className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                    >
                        <Pencil size={14} className="text-slate-400"/>
                        Rename Book
                    </button>
                    <button
                        onClick={handleToggleStatus}
                        className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                    >
                        {books.find(b => b.id === contextMenu.bookId)?.status !== 'completed' ? (
                            <>
                                <CheckCircle2 size={14} className="text-emerald-500"/>
                                Mark as Completed
                            </>
                        ) : (
                            <>
                                <PenTool size={14} className="text-amber-500"/>
                                Mark as Serializing
                            </>
                        )}
                    </button>
                    <div className="h-px bg-slate-100 dark:bg-slate-800 my-1"></div>
                    <button
                        onClick={handleDeleteClick}
                        className="w-full text-left px-4 py-2.5 text-sm text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-3 transition-colors"
                    >
                        <Trash2 size={14} />
                        Delete Book
                    </button>
                </div>
            )}

            {showDeleteModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4 text-rose-600">
                            <div className="p-2 bg-rose-100 rounded-full">
                                <AlertTriangle size={24} />
                            </div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Book?</h3>
                        </div>

                        <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                            Are you sure you want to delete this book?
                            <br/>
                            <span className="font-semibold text-rose-600">This action cannot be undone</span> and all volumes and chapters will be permanently lost.
                        </p>

                        <div className="flex justify-end gap-3">
                            <Button
                                variant="ghost"
                                onClick={() => { setShowDeleteModal(false); setBookToDelete(null); }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200"
                                onClick={confirmDelete}
                            >
                                Delete Book
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
