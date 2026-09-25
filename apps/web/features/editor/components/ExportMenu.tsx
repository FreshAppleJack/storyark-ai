import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileJson, FileText, FileType, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

interface ExportMenuProps {
    isExporting: boolean;
    onExportWord: (event: React.MouseEvent) => void;
    onExportPdf: (event: React.MouseEvent) => void;
    onExportWorkJson?: (event: React.MouseEvent) => void;
    canExportWorkJson?: boolean;
}

function getMenuPosition(anchor: DOMRect, menuWidth: number, menuHeight: number): { left: number; top: number } {
    const viewportPadding = 8;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
    const left = Math.min(Math.max(anchor.right - menuWidth, viewportPadding), maxLeft);
    const belowTop = anchor.bottom + viewportPadding;
    const top = menuHeight && belowTop + menuHeight > window.innerHeight - viewportPadding
        ? Math.max(viewportPadding, anchor.top - menuHeight - viewportPadding)
        : Math.min(belowTop, Math.max(viewportPadding, window.innerHeight - menuHeight - viewportPadding));

    return { left, top };
}

/**
 * Header export dropdown (Word / PDF). The parent owns the actual export
 * handlers (they need the editor instance and chapter title); this component
 * only manages open/close, including close-on-outside-click.
 */
export function ExportMenu({ isExporting, onExportWord, onExportPdf, onExportWorkJson, canExportWorkJson = false }: ExportMenuProps): React.ReactElement {
    const [isOpen, setIsOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
    const triggerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const closeMenu = () => setIsOpen(false);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    useLayoutEffect(() => {
        if (!isOpen) return;

        const updatePosition = () => {
            const anchor = triggerRef.current?.getBoundingClientRect();
            if (!anchor) return;

            const menuWidth = menuRef.current?.offsetWidth || 192;
            const menuHeight = menuRef.current?.offsetHeight || 0;
            const position = getMenuPosition(anchor, menuWidth, menuHeight);

            setMenuPosition(previous => previous?.left === position.left && previous.top === position.top
                ? previous
                : position);
        };

        const frame = window.requestAnimationFrame(updatePosition);
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    const handleExportWord = (event: React.MouseEvent) => {
        if (isExporting) return;
        setIsOpen(false);
        onExportWord(event);
    };

    const handleExportPdf = (event: React.MouseEvent) => {
        if (isExporting) return;
        setIsOpen(false);
        onExportPdf(event);
    };

    const handleExportWorkJson = (event: React.MouseEvent) => {
        if (isExporting) return;
        setIsOpen(false);
        onExportWorkJson?.(event);
    };

    return (
        <div className="relative mr-1" ref={triggerRef}>
            <Button
                variant="primary"
                size="sm"
                onClick={(e) => {
                    e.stopPropagation();
                    const nextIsOpen = !isOpen;
                    if (nextIsOpen) {
                        const anchor = triggerRef.current?.getBoundingClientRect();
                        if (anchor) setMenuPosition(getMenuPosition(anchor, 192, 0));
                    } else {
                        setMenuPosition(null);
                    }
                    setIsOpen(nextIsOpen);
                }}
                disabled={isExporting}
                aria-expanded={isOpen}
                aria-controls="export-menu"
            >
                {isExporting ? <Loader2 size={14} className="animate-spin mr-2"/> : <Download size={14} className="mr-2"/>}
                Export
            </Button>

            {isOpen && menuPosition && createPortal(
                <div
                    ref={menuRef}
                    id="export-menu"
                    data-testid="export-menu"
                    onClick={event => event.stopPropagation()}
                    style={{ left: menuPosition.left, top: menuPosition.top }}
                    className="fixed z-[100] max-h-[calc(100vh-1rem)] w-48 overflow-y-auto overflow-x-hidden rounded-md border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in duration-100 dark:border-slate-800 dark:bg-slate-900"
                >
                    <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Document exports
                    </div>
                    <button
                        disabled={isExporting}
                        onClick={handleExportWord}
                        className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-3 transition-colors"
                    >
                        <div className="p-1.5 bg-blue-100 text-blue-600 rounded">
                            <FileText size={16} />
                        </div>
                        <div>
                            <div className="font-medium">Word Document</div>
                            <div className="text-[10px] text-slate-400">.docx format</div>
                        </div>
                    </button>
                    <div className="h-px bg-slate-100 dark:bg-slate-800 w-full"></div>
                    <button
                        disabled={isExporting}
                        onClick={handleExportPdf}
                        className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-3 transition-colors"
                    >
                        <div className="p-1.5 bg-red-100 text-red-600 rounded">
                            <FileType size={16} />
                        </div>
                        <div>
                            <div className="font-medium">PDF Document</div>
                            <div className="text-[10px] text-slate-400">High quality print</div>
                        </div>
                    </button>
                    {canExportWorkJson && onExportWorkJson && <>
                        <div className="h-px bg-slate-100 dark:bg-slate-800 w-full"></div>
                        <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400">
                            Work exchange
                        </div>
                        <button
                            disabled={isExporting}
                            onClick={handleExportWorkJson}
                            className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-3 transition-colors"
                        >
                            <div className="p-1.5 bg-emerald-100 text-emerald-600 rounded">
                                <FileJson size={16} />
                            </div>
                            <div>
                                <div className="font-medium">StoryArk work</div>
                                <div className="text-[10px] text-slate-400">.storyark.json</div>
                            </div>
                        </button>
                    </>}
                </div>,
                document.body,
            )}
        </div>
    );
}
