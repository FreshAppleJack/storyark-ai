import React from 'react';
import { Link } from 'react-router-dom';
import { Book as BookIcon, CheckCircle2, Clock, MessageSquareText, PenTool } from 'lucide-react';
import type { Book } from '../../../types';
import type { BookshelfActions } from '../hooks/useBookshelfActions';
const getUnrecoveredForeshadowingCount = (book: Book) => (
    book.volumes.reduce((bookTotal, volume) => (
        bookTotal + volume.chapters.reduce((volumeTotal, chapter) => (
            volumeTotal + (chapter.foreshadowings || []).filter(note => !note.isRecovered).length
        ), 0)
    ), 0)
);


type Props = Pick<BookshelfActions, 'renamingId' | 'renamingValue' | 'setRenamingValue' | 'renameInputRef' |
    'handleRenameKeyDown' | 'submitRename' | 'handleContextMenu'> & { book: Book };
export function BookCard({ book, renamingId, renamingValue, setRenamingValue, renameInputRef,
    handleRenameKeyDown, submitRename, handleContextMenu }: Props) {
    const isRenaming = renamingId === book.id;
    const unrecoveredForeshadowingCount = getUnrecoveredForeshadowingCount(book);
    const content = <>
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
                    <BookIcon size={12} /> {book.volumes.reduce((acc, v) => acc + v.chapters.length, 0)} Chapters
                </span>
                <span className={`flex items-center gap-1 ${unrecoveredForeshadowingCount > 0 ? 'text-amber-600 dark:text-amber-300' : ''}`}>
                    <MessageSquareText size={12} /> {unrecoveredForeshadowingCount} Foreshadowing Unrecovered
                </span>
                <span className="flex items-center gap-1">
                    <Clock size={12} />
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

    </>;
    const className = 'group bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden hover:shadow-xl hover:border-brand-300 dark:hover:border-brand-700 transition-all duration-300 flex flex-col h-64 relative cursor-pointer';
    const onContextMenu = (event: React.MouseEvent) => handleContextMenu(event, book.id);
    return isRenaming
        ? <div className={className} onContextMenu={onContextMenu} onClick={event => event.stopPropagation()}>{content}</div>
        : <Link to={`/editor/${book.id}`} className={className} onContextMenu={onContextMenu}>{content}</Link>;
}
