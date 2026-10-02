import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BrainCircuit, Loader2 } from 'lucide-react';
import type { BrainstormWorkspace } from '../../../types';
import { brainstormApi } from '../../../data/brainstormApi';
import { localBrainstormOptions } from '../../../data/local/brainstormRepository';

const PREVIEW_HOVER_DELAY_MS = 400;

/** A saved brainstorm reference that stays readable while the author writes. */
export function BrainstormShortcut({ bookId, localMode, onOpen }: {
    bookId: string;
    localMode: boolean;
    onOpen: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 8, top: 8, width: 420, maxHeight: 560 });
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const id = useId();
    const workspace = useQuery<BrainstormWorkspace>({
        ...(localMode ? localBrainstormOptions(bookId) : {
            queryKey: ['brainstorm-preview', bookId], queryFn: () => brainstormApi.get(bookId),
            staleTime: 0, retry: false, refetchOnWindowFocus: false,
        }),
        enabled: open,
    });
    const cancelClose = useCallback(() => {
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
        closeTimer.current = null;
    }, []);
    const cancelOpen = useCallback(() => {
        if (openTimer.current !== null) clearTimeout(openTimer.current);
        openTimer.current = null;
    }, []);
    const show = () => { cancelOpen(); cancelClose(); setOpen(true); };
    const scheduleOpen = () => {
        cancelOpen(); cancelClose();
        if (open) return;
        openTimer.current = setTimeout(() => { openTimer.current = null; setOpen(true); }, PREVIEW_HOVER_DELAY_MS);
    };
    const hide = () => { cancelOpen(); cancelClose(); setOpen(false); };
    const scheduleClose = () => {
        cancelOpen();
        cancelClose();
        closeTimer.current = setTimeout(() => {
            if (!buttonRef.current?.contains(document.activeElement) && !panelRef.current?.contains(document.activeElement)) setOpen(false);
        }, 240);
    };
    useEffect(() => () => { cancelOpen(); cancelClose(); }, [cancelOpen, cancelClose]);

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const anchor = buttonRef.current?.getBoundingClientRect();
            if (!anchor) return;
            const width = Math.min(420, window.innerWidth - 16);
            const maxHeight = Math.min(560, window.innerHeight - 16);
            const height = Math.min(panelRef.current?.getBoundingClientRect().height || maxHeight, maxHeight);
            const preferredLeft = anchor.right + 12 + width <= window.innerWidth - 8
                ? anchor.right + 12 : anchor.left - width - 12;
            const next = {
                width, maxHeight,
                left: Math.max(8, Math.min(preferredLeft, window.innerWidth - width - 8)),
                top: Math.max(8, Math.min(anchor.top, window.innerHeight - height - 8)),
            };
            setPosition(previous => previous.left === next.left && previous.top === next.top
                && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next);
        };
        place();
        const observer = new ResizeObserver(place);
        if (buttonRef.current?.parentElement) observer.observe(buttonRef.current.parentElement);
        if (panelRef.current) observer.observe(panelRef.current);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (panelRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
            cancelClose(); setOpen(false);
        };
        const leaveFocus = (event: FocusEvent) => {
            if (event.target instanceof Node && !buttonRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) {
                cancelClose(); setOpen(false);
            }
        };
        document.addEventListener('keydown', escape);
        document.addEventListener('focusin', leaveFocus);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            document.removeEventListener('keydown', escape);
            document.removeEventListener('focusin', leaveFocus);
        };
    }, [open, cancelClose]);

    const openWorkspace = () => { hide(); onOpen(); };
    return <>
        <button ref={buttonRef} type="button" aria-label="Open AI Brainstorm" aria-haspopup="dialog" aria-expanded={open}
            aria-controls={open ? id : undefined} onClick={openWorkspace} onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose} onFocus={show}
            onKeyDown={event => { if (event.key === 'ArrowDown' && open) { event.preventDefault(); panelRef.current?.focus(); } }}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-brand-50 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-brand-950/50 dark:hover:text-brand-300">
            <BrainCircuit size={18} aria-hidden="true" />
        </button>
        {open && createPortal(<div ref={panelRef} id={id} role="dialog" aria-labelledby={`${id}-title`} tabIndex={-1}
            onMouseEnter={cancelClose} onMouseLeave={scheduleClose}
            style={position} className="fixed z-50 flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl shadow-slate-900/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/40">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><BrainCircuit size={16} aria-hidden="true" className="text-brand-500" />Brainstorm notes</h3>
                <button type="button" onClick={openWorkspace} className="flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">Open<ArrowUpRight size={14} aria-hidden="true" /></button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-4 text-sm leading-6">
                {workspace.isPending ? <p role="status" className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><Loader2 size={16} className="animate-spin" />Loading brainstorm notes…</p>
                    : workspace.isError ? <div role="alert"><p>Couldn’t load your brainstorm notes. Try again or open AI Brainstorm.</p><button type="button" onClick={() => void workspace.refetch()} className="mt-2 rounded text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-brand-300">Retry</button></div>
                    : workspace.data?.finalContent.trim() ? <p className="whitespace-pre-wrap break-words">{workspace.data.finalContent}</p>
                    : <p className="text-slate-500 dark:text-slate-400">No brainstorm notes yet. Open AI Brainstorm to write or save a result.</p>}
            </div>
        </div>, document.body)}
    </>;
}
