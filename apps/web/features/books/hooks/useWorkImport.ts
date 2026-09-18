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
import {
    workImportRepository,
    type WorkImportMode,
    type WorkImportPreparation,
} from '../../../data/export/importRepository';
import { LocalStorageError } from '../../../data/local/repository';

interface UseWorkImportOptions {
    onImported?: () => Promise<void> | void;
}

function errorMessage(error: unknown): string {
    if (error instanceof LocalStorageError) return error.message;
    if (error instanceof Error) return error.message;
    return 'The local import operation failed. The existing workspace was not changed.';
}

export function useWorkImport({ onImported }: UseWorkImportOptions = {}) {
    const [report, setReport] = useState<WorkImportPreflightReport | null>(null);
    const [preparation, setPreparation] = useState<WorkImportPreparation | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const nativeFilePickerAvailable = isTauri();

    const applyReport = useCallback(async (nextReport: WorkImportPreflightReport) => {
        setReport(nextReport);
        setPreparation(null);
        setImportError(null);
        if (nextReport.status !== 'valid' || !nativeFilePickerAvailable) return;
        try {
            setPreparation(await workImportRepository.prepare(nextReport.value));
        } catch (error) {
            setImportError(errorMessage(error));
        }
    }, [nativeFilePickerAvailable]);

    const inspectBytes = useCallback(async (fileName: string, bytes: Uint8Array) => {
        setIsChecking(true);
        setReport(null);
        setPreparation(null);
        setImportError(null);
        await Promise.resolve();
        try {
            await applyReport(preflightWorkImportBytes(fileName, bytes));
        } finally {
            setIsChecking(false);
        }
    }, [applyReport]);

    const inspectBrowserFile = useCallback(async (file: File) => {
        if (file.size > EXCHANGE_LIMITS.maxExportBytes) {
            void applyReport(preflightWorkImportSize(file.name, file.size));
            return;
        }
        setReport(null);
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            await inspectBytes(file.name, bytes);
        } catch {
            await applyReport(preflightReadFailure(file.name));
        }
    }, [applyReport, inspectBytes]);

    const openNativeImport = useCallback(async () => {
        if (!nativeFilePickerAvailable) return;
        setIsChecking(true);
        setReport(null);
        try {
            const selection = await selectAndPreflightWorkImport();
            if (selection.status !== 'cancelled') await applyReport(selection);
        } catch (error) {
            const fileName = error instanceof WorkImportFileReadError ? error.fileName : 'Selected StoryArk work export';
            await applyReport(preflightReadFailure(fileName));
        } finally {
            setIsChecking(false);
        }
    }, [applyReport, nativeFilePickerAvailable]);

    const expectedTargetDatabaseVersion = preparation?.target?.databaseVersion;

    const executeImport = useCallback(async (mode: WorkImportMode) => {
        if (report?.status !== 'valid' || !nativeFilePickerAvailable || isExecuting) return false;
        setIsExecuting(true);
        setImportError(null);
        try {
            await workImportRepository.execute(report.value, mode, expectedTargetDatabaseVersion);
            await onImported?.();
            setReport(null);
            setPreparation(null);
            return true;
        } catch (error) {
            setImportError(errorMessage(error));
            return false;
        } finally {
            setIsExecuting(false);
        }
    }, [expectedTargetDatabaseVersion, isExecuting, nativeFilePickerAvailable, onImported, report]);

    const closeReport = useCallback(() => {
        if (isExecuting) return;
        setReport(null);
        setPreparation(null);
        setImportError(null);
    }, [isExecuting]);

    return {
        report,
        preparation,
        importError,
        isChecking,
        isExecuting,
        nativeFilePickerAvailable,
        inspectBrowserFile,
        openNativeImport,
        executeImport,
        closeReport,
    };
}
