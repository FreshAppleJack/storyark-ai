import { useCallback, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { EXCHANGE_LIMITS } from '../../../data/export/exchange/limits';
import {
    preflightReadFailure,
    selectAndPreflightWorkImport,
    WorkImportFileReadError,
} from '../../../data/export/importFile';
import {
    preflightWorkImportBytes,
    preflightWorkImportSize,
    type WorkImportPreflightReport,
} from '../../../data/export/importPreflight';

export function useWorkImport() {
    const [report, setReport] = useState<WorkImportPreflightReport | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const nativeFilePickerAvailable = isTauri();

    const inspectBytes = useCallback(async (fileName: string, bytes: Uint8Array) => {
        setIsChecking(true);
        setReport(null);
        await Promise.resolve();
        try {
            setReport(preflightWorkImportBytes(fileName, bytes));
        } finally {
            setIsChecking(false);
        }
    }, []);

    const inspectBrowserFile = useCallback(async (file: File) => {
        if (file.size > EXCHANGE_LIMITS.maxExportBytes) {
            setReport(preflightWorkImportSize(file.name, file.size));
            return;
        }
        setReport(null);
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            await inspectBytes(file.name, bytes);
        } catch {
            setReport(preflightReadFailure(file.name));
        }
    }, [inspectBytes]);

    const openNativeImport = useCallback(async () => {
        if (!nativeFilePickerAvailable) return;
        setIsChecking(true);
        setReport(null);
        try {
            const selection = await selectAndPreflightWorkImport();
            if (selection.status !== 'cancelled') setReport(selection);
        } catch (error) {
            const fileName = error instanceof WorkImportFileReadError ? error.fileName : 'Selected StoryArk work export';
            setReport(preflightReadFailure(fileName));
        } finally {
            setIsChecking(false);
        }
    }, [nativeFilePickerAvailable]);

    return {
        report,
        isChecking,
        nativeFilePickerAvailable,
        inspectBrowserFile,
        openNativeImport,
        closeReport: useCallback(() => setReport(null), []),
    };
}
