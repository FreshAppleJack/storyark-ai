import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, FileText, Loader2, MessageSquareText, Search, X } from 'lucide-react';
import { useApp } from '../InteractionContent/AppContext';
import { Button } from '../components/ui/Button';
import { ForeshadowingNote } from '../types';

interface ForeshadowingCard {
    id: string;
    note: ForeshadowingNote;
    excerpt: string;
    chapterId: string;
    chapterTitle: string;
    volumeId: string;
    volumeTitle: string;
    score?: number;
}

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, '');

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

const getForeshadowingExcerptMap = (content: string) => {
    const excerpts = new Map<string, string[]>();
    const getForeshadowingIds = (node: any) => {
        if (!Array.isArray(node?.marks)) return [];
        return node.marks
            .filter((mark: any) => mark.type === 'foreshadowing' && mark.attrs?.id)
            .map((mark: any) => mark.attrs.id as string);
    };

    const appendText = (id: string, text: string) => {
        if (!text) return;
        const existing = excerpts.get(id) || [];
        existing.push(text);
        excerpts.set(id, existing);
    };

    const visit = (node: any) => {
        const ids = getForeshadowingIds(node);
        if (ids.length > 0) {
            const text = node.type === 'mention'
                ? (node.attrs?.label || node.attrs?.id || '')
                : node.type === 'text'
                    ? (node.text || '')
                    : node.type === 'hardBreak'
                        ? ' '
                        : '';
            ids.forEach(id => appendText(id, text));
        }

        if (Array.isArray(node.content)) {
            node.content.forEach(visit);
            if (['paragraph', 'heading', 'blockquote'].includes(node.type)) {
                const idsInBlock = new Set<string>();
                const collectIds = (child: any) => {
                    getForeshadowingIds(child).forEach((id: string) => idsInBlock.add(id));
                    if (Array.isArray(child.content)) child.content.forEach(collectIds);
                };
                node.content.forEach(collectIds);
                idsInBlock.forEach(id => appendText(id, ' '));
            }
        }
    };

    try {
        visit(JSON.parse(content));
    } catch (error) {
        return new Map<string, string>();
    }

    const normalized = new Map<string, string>();
    excerpts.forEach((parts, id) => {
        const text = parts.join('').replace(/[\s\u3000]+/g, ' ').trim();
        if (text) normalized.set(id, text.length > 220 ? `${text.slice(0, 220)}...` : text);
    });
    return normalized;
};

const Foreshadowing: React.FC = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const { getBook, updateChapterContent } = useApp();
    const book = getBook(bookId || '');
    const [searchQuery, setSearchQuery] = useState('');
    const [recoveringId, setRecoveringId] = useState<string | null>(null);

    const allCards = useMemo<ForeshadowingCard[]>(() => {
        if (!book) return [];
        return book.volumes.flatMap(volume => (
            volume.chapters.flatMap(chapter => {
                const excerptMap = getForeshadowingExcerptMap(chapter.content || '');
                return (chapter.foreshadowings || []).map(note => ({
                    id: note.id,
                    note,
                    excerpt: excerptMap.get(note.id) || note.excerpt || 'No linked excerpt found.',
                    chapterId: chapter.id,
                    chapterTitle: chapter.title,
                    volumeId: volume.id,
                    volumeTitle: volume.title,
                }));
            })
        )).sort((a, b) => b.note.updatedAt - a.note.updatedAt);
    }, [book]);

    const unrecoveredCount = useMemo(
        () => allCards.filter(card => !card.note.isRecovered).length,
        [allCards]
    );

    const filteredCards = useMemo(() => {
        const query = searchQuery.trim();
        if (!query) return allCards;

        return allCards
            .map(card => {
                const fields = [
                    { value: card.excerpt, weight: 0 },
                    { value: card.note.note, weight: 0 },
                    { value: card.chapterTitle, weight: 10 },
                    { value: card.volumeTitle, weight: 14 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { ...card, score: bestScore };
            })
            .filter((card): card is ForeshadowingCard & { score: number } => Boolean(card))
            .sort((a, b) => a.score - b.score);
    }, [allCards, searchQuery]);

    const openChapter = (card: ForeshadowingCard) => {
        if (bookId) {
            localStorage.setItem(`lastActiveChapter_${bookId}`, card.chapterId);
            localStorage.setItem(`pendingForeshadowingFocus_${bookId}`, JSON.stringify({
                chapterId: card.chapterId,
                foreshadowingId: card.id,
            }));
            navigate(`/editor/${bookId}`);
        }
    };

    const markRecovered = async (card: ForeshadowingCard) => {
        if (!book || card.note.isRecovered || recoveringId) return;
        await setForeshadowingRecovered(card, true);
    };

    const undoRecovered = async (card: ForeshadowingCard) => {
        if (!book || !card.note.isRecovered || recoveringId) return;
        await setForeshadowingRecovered(card, false);
    };

    const setForeshadowingRecovered = async (card: ForeshadowingCard, isRecovered: boolean) => {
        if (!book || recoveringId) return;
        const volume = book.volumes.find(item => item.id === card.volumeId);
        const chapter = volume?.chapters.find(item => item.id === card.chapterId);
        if (!chapter) return;

        setRecoveringId(card.id);
        const now = Date.now();
        const nextForeshadowings = (chapter.foreshadowings || []).map(note => (
            note.id === card.id
                ? { ...note, isRecovered, updatedAt: now }
                : note
        ));

        try {
            await updateChapterContent(
                book.id,
                card.volumeId,
                card.chapterId,
                chapter.title,
                chapter.content || '',
                chapter.wordCount,
                nextForeshadowings
            );
        } finally {
            setRecoveringId(null);
        }
    };

    if (!book) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Book not found</div>;
    }

    const isSearching = searchQuery.trim().length > 0;

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
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
                <Button variant="secondary" size="sm" onClick={() => navigate(`/editor/${bookId}`)}>
                    Back to Editor
                </Button>
            </header>

            <main className="max-w-6xl mx-auto p-8">
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
                            <article
                                key={`${card.chapterId}-${card.id}`}
                                className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition overflow-hidden"
                            >
                                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                            <BookOpen size={13} />
                                            <span className="truncate">{card.volumeTitle}</span>
                                            <ChevronRight size={12} />
                                            <span className="truncate">{card.chapterTitle}</span>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Foreshadowing Note</h3>
                                            {card.note.isRecovered && (
                                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                    <CheckCircle2 size={12} />
                                                    Recovered
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <span className="flex-shrink-0 text-[11px] text-slate-400">{new Date(card.note.updatedAt).toLocaleDateString()}</span>
                                </div>

                                <div className="p-5 space-y-4">
                                    <div>
                                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            <FileText size={14} />
                                            Planted Text
                                        </div>
                                        <p className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 px-3 py-3 text-sm leading-6 text-slate-700 dark:text-slate-200">
                                            "{card.excerpt}"
                                        </p>
                                    </div>
                                    <div>
                                        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                            <MessageSquareText size={14} />
                                            Note
                                        </div>
                                        <p className="min-h-[72px] rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-3 text-sm leading-6 text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                                            {card.note.note || 'No note written yet.'}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap justify-end gap-2">
                                        {!card.note.isRecovered && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => markRecovered(card)}
                                                disabled={recoveringId === card.id}
                                                icon={recoveringId === card.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                            >
                                                {recoveringId === card.id ? 'Marking...' : 'Mark Recovered'}
                                            </Button>
                                        )}
                                        {card.note.isRecovered && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                onClick={() => undoRecovered(card)}
                                                disabled={recoveringId === card.id}
                                                icon={recoveringId === card.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                                            >
                                                {recoveringId === card.id ? 'Undoing...' : 'Undo Recovered'}
                                            </Button>
                                        )}
                                        <Button variant="secondary" size="sm" onClick={() => openChapter(card)}>
                                            Open Chapter
                                        </Button>
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
};

export default Foreshadowing;
