import React from 'react';
import { AlertTriangle, CheckCircle2, Pencil, PenTool, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { BookshelfActions } from '../hooks/useBookshelfActions';
type Props = Pick<BookshelfActions, 'contextMenu' | 'showDeleteModal' | 'setShowDeleteModal' | 'setBookToDelete' | 'startRename' | 'handleToggleStatus' | 'handleDeleteClick' | 'confirmDelete' | 'contextBookStatus'>;
export function BookActionsMenu({ contextMenu, showDeleteModal, setShowDeleteModal, setBookToDelete, startRename, handleToggleStatus, handleDeleteClick, confirmDelete, contextBookStatus }: Props) {
    return <>
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
                    <Pencil size={14} className="text-slate-400" />
                    Rename Book
                </button>
                <button
                    onClick={handleToggleStatus}
                    className="w-full text-left px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-3 transition-colors"
                >
                    {contextBookStatus !== 'completed' ? (
                        <>
                            <CheckCircle2 size={14} className="text-emerald-500" />
                            Mark as Completed
                        </>
                    ) : (
                        <>
                            <PenTool size={14} className="text-amber-500" />
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
                        <div className="p-2 bg-rose-100 dark:bg-rose-950/60 rounded-full">
                            <AlertTriangle size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Book?</h3>
                    </div>

                    <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                        Are you sure you want to delete this book?
                        <br />
                        <span className="font-semibold text-rose-600">This action cannot be undone</span> and all volumes, chapters, characters, the relationship map, story planning and the brainstorm workspace will be permanently lost.
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
                            className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200 dark:shadow-rose-950/40"
                            onClick={confirmDelete}
                        >
                            Delete Book
                        </Button>
                    </div>
                </div>
            </div>
        )}
    </>;
}
