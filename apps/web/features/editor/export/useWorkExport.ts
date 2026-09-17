import { useCallback, useEffect, useRef, useState } from 'react';
import {
    buildStoryArkWorkExport,
    summarizeStoryArkWorkExport,
    type WorkExportSummary,
} from '../../../data/export/exchange/build';
import { serializeStoryArkWorkExport } from '../../../data/export/exchange';
import { localExportRepository } from '../../../data/local/exportRepository';
import { saveWorkExport, workExportFilename, type WorkExportSaveResult } from '../../../data/export/workFile';
import { flushWorkDrafts } from '../../../services/workDraftFlushRegistry';
import type { StoryArkWorkExport } from '../../../data/export/exchange';

export interface WorkExportPreviewModel {
    value: StoryArkWorkExport;
    raw: string;
    summary: WorkExportSummary;
}

interface UseWorkExportOptions {
    bookId: string;
    enabled: boolean;
    currentDraftFlush: () => Promise<boolean>;
    onError: (error: unknown) => void;
    onSaved: (result: Extract<WorkExportSaveResult, { status: 'saved' }>) => void;
}

/** Coordinates local draft flushing, snapshot construction, preview and save. */
export function useWorkExport({ bookId, enabled, currentDraftFlush, onError, onSaved }: UseWorkExportOptions) {
    const [isExporting, setIsExporting] = useState(false);
    const [preview, setPreview] = useState<WorkExportPreviewModel | null>(null);
    const pending = useRef(false);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const prepare = useCallback(async () => {
        if (!enabled || !bookId || pending.current) return;
        pending.current = true;
        setIsExporting(true);
        try {
            const flushed = await flushWorkDrafts(bookId, [{ kind: 'chapter', flush: currentDraftFlush }]);
            if (!flushed) throw new Error('A work draft could not be saved. Export stopped; the draft remains available.');
            const snapshot = await localExportRepository.readSnapshot(bookId);
            const value = buildStoryArkWorkExport(snapshot);
            const raw = serializeStoryArkWorkExport(value);
            if (mounted.current) {
                setPreview({ value, raw, summary: summarizeStoryArkWorkExport(value) });
            }
        } catch (error) {
            if (mounted.current) onError(error);
        } finally {
            pending.current = false;
            if (mounted.current) setIsExporting(false);
        }
    }, [bookId, currentDraftFlush, enabled, onError]);

    const confirm = useCallback(async () => {
        if (!preview || pending.current) return;
        pending.current = true;
        setIsExporting(true);
        try {
            const result = await saveWorkExport(preview.raw, workExportFilename(preview.value.book.title));
            if (result.status === 'saved') {
                if (mounted.current) {
                    setPreview(null);
                    onSaved(result);
                }
            }
            // A cancelled Save As is deliberately silent and leaves the
            // preview open so the user can retry without losing context.
        } catch (error) {
            if (mounted.current) onError(error);
        } finally {
            pending.current = false;
            if (mounted.current) setIsExporting(false);
        }
    }, [onError, onSaved, preview]);

    const close = useCallback(() => {
        if (!isExporting) setPreview(null);
    }, [isExporting]);

    return { isExporting, preview, prepare, confirm, close };
}
