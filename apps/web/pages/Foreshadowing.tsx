import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquareText, Search, X } from 'lucide-react';
import { useBooks } from '../InteractionContent/BooksContext';
import { collectForeshadowingCards, filterForeshadowingCards, type ForeshadowingCardData } from '../features/foreshadowing/foreshadowingSelectors';
import { ForeshadowingCard } from '../features/foreshadowing/components/ForeshadowingCard';
import { useForeshadowingRecovery } from '../features/foreshadowing/hooks/useForeshadowingRecovery';
import { useQuery } from '@tanstack/react-query';
import { localBookOptions, projectBook, type LocalBookDetail } from '../data/local/repository';
import type { Book } from '../types';
import type { ForeshadowingRecovery } from '../features/foreshadowing/hooks/useForeshadowingRecovery';
import { useLocalNoteDrafts } from '../features/foreshadowing/hooks/useLocalNoteDrafts';
import { foreshadowingCardKey } from '../features/foreshadowing/foreshadowingSelectors';
import { PlanningSaveGuard } from '../features/planning/components/PlanningSaveGuard';
import { Button } from '../components/ui/Button';

function ForeshadowingContent({ bookId, localBook, localNotes }: { bookId: string; localBook?: Book; localNotes?: ReturnType<typeof useLocalNoteDrafts> }): React.ReactElement {
    const navigate = useNavigate();
    const { getBook } = useBooks();
    const book = localBook ?? getBook(bookId || '');
    const [searchQuery, setSearchQuery] = useState('');
    const legacyRecovery = useForeshadowingRecovery(book);
    const recovery: ForeshadowingRecovery = localNotes?.recovery ?? legacyRecovery;
    const allCards = useMemo(() => collectForeshadowingCards(book), [book]);
    const unrecoveredCount = allCards.filter(card => !card.note.isRecovered).length;
    const filteredCards = useMemo(() => filterForeshadowingCards(allCards, searchQuery), [allCards, searchQuery]);

    const openChapter = (card: ForeshadowingCardData) => {
        if (bookId) {
            localStorage.setItem(`lastActiveChapter_${bookId}`, card.chapterId);
            localStorage.setItem(`pendingForeshadowingFocus_${bookId}`, JSON.stringify({
                chapterId: card.chapterId,
                foreshadowingId: card.id,
            }));
            navigate(`/editor/${bookId}`);
        }
    };

    if (!book) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Book not found</div>;
    }

    const isSearching = searchQuery.trim().length > 0;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            {localNotes && <PlanningSaveGuard isDirty={localNotes.isDirty} flush={localNotes.flush} />}
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 sticky top-0 z-10">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={() => navigate(`/editor/${bookId}`)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="font-bold text-lg text-slate-900 dark:text-white truncate">Foreshadowing Board</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{book.title}</p>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto p-8">
                {localNotes?.error && <p role="alert" className="mb-4 text-sm text-rose-600">{localNotes.error} <button className="underline" onClick={() => { void localNotes.flush(); }}>Retry</button></p>}
                <section className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 dark:bg-brand-950/40 px-3 py-1 text-xs font-semibold text-brand-700 dark:text-brand-300 mb-3">
                            <MessageSquareText size={14} />
                            {`${unrecoveredCount} unrecovered / ${allCards.length} total`}
                        </div>
                        <h2 className="text-3xl font-bold text-slate-900 dark:text-white">Story Foreshadowing</h2>
                        <p className="mt-2 text-slate-500 dark:text-slate-400">Track planted clues, future reveals, and unresolved story promises.</p>
                    </div>

                    <div className="relative w-full lg:w-96">
                        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
                            <Search size={17} className="flex-shrink-0 text-slate-400" />
                            <input
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Search foreshadowing"
                                className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                            />
                            {isSearching && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                                    aria-label="Clear foreshadowing search"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                        {isSearching && (
                            <p className="absolute left-0 top-full mt-2 text-xs text-slate-500 dark:text-slate-400">
                                {filteredCards.length === 1 ? '1 note found' : `${filteredCards.length} notes found`}
                            </p>
                        )}
                    </div>
                </section>

                {allCards.length === 0 ? (
                    <div className="py-20 text-center bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                            <MessageSquareText size={30} />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 dark:text-white">No foreshadowing yet</h3>
                        <p className="text-slate-500 dark:text-slate-400 mb-6">Select text in the editor and add a foreshadowing note.</p>
                        <Button onClick={() => navigate(`/editor/${bookId}`)}>Open Editor</Button>
                    </div>
                ) : filteredCards.length === 0 ? (
                    <div className="py-16 text-center bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        <div className="w-14 h-14 bg-slate-50 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-400">
                            <Search size={26} />
                        </div>
                        <h3 className="text-lg font-medium text-slate-900 dark:text-white">No matching notes found</h3>
                        <p className="text-slate-500 dark:text-slate-400 mb-6">Try searching the planted text, note content, volume, or chapter title.</p>
                        <Button variant="secondary" onClick={() => setSearchQuery('')}>Clear Search</Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {filteredCards.map(card => (
                            <ForeshadowingCard key={`${card.chapterId}-${card.id}`} card={card} openChapter={openChapter} {...recovery}
                                noteDraft={localNotes?.drafts[foreshadowingCardKey(card)]?.note} editNote={localNotes?.editNote} saveNote={localNotes?.flush} />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}

export default function Foreshadowing() {
    const { bookId = '' } = useParams();
    const { storageMode } = useBooks();
    return storageMode === 'local' ? <LocalBoard key={bookId} bookId={bookId} /> : <ForeshadowingContent key={bookId} bookId={bookId} />;
}

function LoadedLocalBoard({ detail }: { detail: LocalBookDetail }) {
    const book = useMemo(() => projectBook(detail.book, detail), [detail]);
    const notes = useLocalNoteDrafts(detail);
    return <ForeshadowingContent bookId={book.id} localBook={book} localNotes={notes} />;
}
function LocalBoard({ bookId }: { bookId: string }) {
    const query = useQuery({ ...localBookOptions(bookId), refetchOnMount: 'always' });
    if (query.error || !query.data || query.isFetching) return <main className="p-8">
        <p role={query.error ? 'alert' : 'status'}>{query.error?.message ?? 'Loading foreshadowing...'}</p>
        {query.error && <Button onClick={() => { void query.refetch(); }}>Retry</Button>}
    </main>;
    return <LoadedLocalBoard detail={query.data} />;
}
