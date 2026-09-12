import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import { useBooks } from '../../../InteractionContent/BooksContext';

interface ContextMenuState { x: number; y: number; bookId: string }
export function useBookshelfActions() {
    const { books, createBook, updateBook, deleteBook } = useBooks();
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [bookToDelete, setBookToDelete] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renamingValue, updateRenamingValue] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);
    const mounted = useRef(false);
    const busy = useRef(false);
    const revision = useRef(0);
    const failedRenameId = useRef<string | null>(null);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const setRenamingValue = (value: string) => { revision.current++; updateRenamingValue(value); };
    const cancelRename = useCallback(() => {
        revision.current++;
        setRenamingId(null);
        updateRenamingValue('');
    }, []);
    const submitRename = useCallback(async () => {
        if (!renamingId || busy.current) return;
        busy.current = true;
        const snapshotRevision = revision.current;
        const finalTitle = renamingValue.trim() || 'Untitled Story';
        const book = books.find(item => item.id === renamingId);
        try {
            if (book && (book.title !== finalTitle || failedRenameId.current === renamingId)) {
                const ok = await updateBook(renamingId, { title: finalTitle });
                if (!mounted.current) return;
                if (!ok) {
                    failedRenameId.current = renamingId;
                    toast.error('Failed to rename the book. Retry to save your title.');
                    return;
                }
            }
            failedRenameId.current = null;
            if (mounted.current && revision.current === snapshotRevision) cancelRename();
        } finally { busy.current = false; }
    }, [books, renamingId, renamingValue, updateBook, cancelRename]);
    useEffect(() => {
        const handleClick = () => { setContextMenu(null); void submitRename(); };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [submitRename]);
    useEffect(() => {
        if (renamingId) { renameInputRef.current?.focus(); renameInputRef.current?.select(); }
    }, [renamingId]);
    const handleCreate = async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            const id = await createBook('Untitled Story');
            if (!mounted.current) return;
            if (!id) { toast.error('Failed to create a book.'); return; }
            revision.current++;
            setRenamingId(id);
            updateRenamingValue('Untitled Story');
        } finally { busy.current = false; }
    };
    const handleContextMenu = (event: React.MouseEvent, bookId: string) => {
        event.preventDefault(); event.stopPropagation();
        setContextMenu({ x: event.clientX, y: event.clientY, bookId });
    };
    const startRename = () => {
        const book = books.find(item => item.id === contextMenu?.bookId);
        if (book) { revision.current++; setRenamingId(book.id); updateRenamingValue(book.title); }
        setContextMenu(null);
    };
    const handleRenameKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'Enter') void submitRename();
        else if (event.key === 'Escape') cancelRename();
    };
    const handleToggleStatus = async () => {
        const book = books.find(item => item.id === contextMenu?.bookId);
        if (!book || busy.current) return;
        busy.current = true;
        setContextMenu(null);
        try {
            const ok = await updateBook(book.id, { status: book.status === 'completed' ? 'serializing' : 'completed' });
            if (mounted.current && !ok) toast.error('Failed to save book status.');
        } finally { busy.current = false; }
    };
    const handleDeleteClick = () => {
        if (!contextMenu) return;
        setBookToDelete(contextMenu.bookId);
        setShowDeleteModal(true);
        setContextMenu(null);
    };
    const confirmDelete = async () => {
        if (!bookToDelete || busy.current) return;
        busy.current = true;
        try {
            const ok = await deleteBook(bookToDelete);
            if (!mounted.current) return;
            if (!ok) { toast.error('Failed to delete the book. Retry to finish deletion.'); return; }
            setShowDeleteModal(false);
            setBookToDelete(null);
        } finally { busy.current = false; }
    };
    return {
        contextMenu, contextBookStatus: books.find(book => book.id === contextMenu?.bookId)?.status,
        showDeleteModal, setShowDeleteModal, setBookToDelete, renamingId, renamingValue, setRenamingValue,
        renameInputRef, handleCreate, handleContextMenu, startRename, submitRename, handleRenameKeyDown,
        handleToggleStatus, handleDeleteClick, confirmDelete
    };
}
export type BookshelfActions = ReturnType<typeof useBookshelfActions>;
