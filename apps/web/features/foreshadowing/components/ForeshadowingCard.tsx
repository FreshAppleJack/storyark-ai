import React from 'react';
import { BookOpen, CheckCircle2, ChevronRight, FileText, Loader2, MessageSquareText, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { ForeshadowingCardData } from '../foreshadowingSelectors';
import type { ForeshadowingRecovery } from '../hooks/useForeshadowingRecovery';
type Props = ForeshadowingRecovery & { card: ForeshadowingCardData; openChapter: (card: ForeshadowingCardData) => void };
export function ForeshadowingCard({ card, openChapter, recoveringId, failedRecovery, markRecovered, undoRecovered, setForeshadowingRecovered }: Props) {
    return (
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
                {failedRecovery?.cardId === card.id && (
                    <div className="flex items-center justify-end gap-2 text-xs text-rose-600 dark:text-rose-300">
                        <span>Save failed.</span>
                        <button
                            type="button"
                            onClick={() => setForeshadowingRecovered(card, failedRecovery.isRecovered)}
                            disabled={recoveringId === card.id}
                            className="font-semibold underline underline-offset-2 transition hover:text-rose-700 dark:hover:text-rose-200"
                        >
                            Retry
                        </button>
                    </div>
                )}
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
    );
}
