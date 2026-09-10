import { useEffect, useRef, useState } from 'react';
import { exportChapter, type ChapterExportFormat, type ChapterExportSnapshot } from './exportChapter';

interface UseChapterExportOptions {
    getSnapshot: () => ChapterExportSnapshot | null;
    onError: (format: ChapterExportFormat, error: unknown) => void;
}

/** Owns one export operation across chapter switches; conversion owns its resources. */
export function useChapterExport({ getSnapshot, onError }: UseChapterExportOptions) {
    const [isExporting, setIsExporting] = useState(false);
    const pending = useRef(false);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const runExport = async (format: ChapterExportFormat): Promise<void> => {
        if (pending.current || !mounted.current) return;
        pending.current = true;
        try {
            const snapshot = getSnapshot();
            if (!snapshot) return;
            setIsExporting(true);
            await exportChapter(format, snapshot);
        } catch (error) {
            if (mounted.current) onError(format, error);
        } finally {
            pending.current = false;
            if (mounted.current) setIsExporting(false);
        }
    };

    return { isExporting, runExport };
}
