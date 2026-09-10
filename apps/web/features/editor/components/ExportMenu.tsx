import React, { useEffect, useState } from 'react';
import { Download, FileText, FileType, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';

interface ExportMenuProps {
    isExporting: boolean;
    onExportWord: (event: React.MouseEvent) => void;
    onExportPdf: (event: React.MouseEvent) => void;
}

/**
 * Header export dropdown (Word / PDF). The parent owns the actual export
 * handlers (they need the editor instance and chapter title); this component
 * only manages open/close, including close-on-outside-click.
 */
export function ExportMenu({ isExporting, onExportWord, onExportPdf }: ExportMenuProps): React.ReactElement {
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const closeMenu = () => setIsOpen(false);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

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

    return (
        <div className="relative">
            <Button
                variant="primary"
                size="sm"
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
                disabled={isExporting}
            >
                {isExporting ? <Loader2 size={14} className="animate-spin mr-2"/> : <Download size={14} className="mr-2"/>}
                Export
            </Button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-md shadow-xl border border-slate-200 dark:border-slate-800 z-50 animate-in fade-in zoom-in duration-100 overflow-hidden">
                    <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400">
                        Export as...
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
                </div>
            )}
        </div>
    );
}
