import { useCallback, useRef, useState } from 'react';
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
    type WorkImportResult,
} from '../../../data/export/importRepository';
import { LocalStorageError } from '../../../data/local/repository';

export type WorkImportPhase = 'idle' | 'preflight' | 'conflict' | 'executing' | 'result';

export interface WorkImportOutcome {
    result: WorkImportResult;
    refreshError: string | null;
}

interface UseWorkImportOptions {
    onImported?: (result: WorkImportResult) => Promise<void> | void;
}

function errorDetails(error: unknown): { message: string; code: string } {
    if (error instanceof LocalStorageError) return { message: error.message, code: error.code };
    if (error instanceof Error) return { message: error.message, code: 'UNKNOWN' };
    return { message: 'The local import operation failed. The existing workspace was not changed.', code: 'UNKNOWN' };
}

function newRequestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `work-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useWorkImport({ onImported }: UseWorkImportOptions = {}) {
    const [report, setReport] = useState<WorkImportPreflightReport | null>(null);
    const [preparation, setPreparation] = useState<WorkImportPreparation | null>(null);
    const [importError, setImportError] = useState<string | null>(null);
    const [importErrorCode, setImportErrorCode] = useState<string | null>(null);
    const [phase, setPhase] = useState<WorkImportPhase>('idle');
    const [outcome, setOutcome] = useState<WorkImportOutcome | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [cancelRequested, setCancelRequested] = useState(false);
    const flowId = useRef(0);
    const requestId = useRef<string | null>(null);
    const nativeFilePickerAvailable = isTauri();

    const resetFlow = useCallback(() => {
        flowId.current += 1;
        requestId.current = null;
        setReport(null);
        setPreparation(null);
        setImportError(null);
        setImportErrorCode(null);
        setPhase('idle');
        setOutcome(null);
        setIsChecking(false);
        setCancelRequested(false);
    }, []);

    const applyReport = useCallback(async (nextReport: WorkImportPreflightReport, currentFlowId: number) => {
        if (currentFlowId !== flowId.current) return;
        setReport(nextReport);
        setPreparation(null);
        setImportError(null);
        setImportErrorCode(null);
        setOutcome(null);
        setPhase('preflight');
        if (nextReport.status !== 'valid' || !nativeFilePickerAvailable) return;
        try {
            const nextPreparation = await workImportRepository.prepare(nextReport.value);
            if (currentFlowId !== flowId.current) return;
            setPreparation(nextPreparation);
            setPhase(nextPreparation.status === 'conflict' || nextPreparation.nameConflict ? 'conflict' : 'preflight');
        } catch (error) {
            if (currentFlowId !== flowId.current) return;
            const details = errorDetails(error);
            setImportError(details.message);
            setImportErrorCode(details.code);
        }
    }, [nativeFilePickerAvailable]);

    const inspectBrowserFile = useCallback(async (file: File) => {
        const currentFlowId = flowId.current + 1;
        flowId.current = currentFlowId;
        if (file.size > EXCHANGE_LIMITS.maxExportBytes) {
            await applyReport(preflightWorkImportSize(file.name, file.size), currentFlowId);
            return;
        }
        setReport(null);
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (currentFlowId !== flowId.current) return;
            setIsChecking(true);
            await applyReport(preflightWorkImportBytes(file.name, bytes), currentFlowId);
        } catch {
            await applyReport(preflightReadFailure(file.name), currentFlowId);
        } finally {
            if (currentFlowId === flowId.current) setIsChecking(false);
        }
    }, [applyReport]);

    const openNativeImport = useCallback(async () => {
        if (!nativeFilePickerAvailable) return;
        const currentFlowId = flowId.current + 1;
        flowId.current = currentFlowId;
        setIsChecking(true);
        setReport(null);
        setPreparation(null);
        setImportError(null);
        setImportErrorCode(null);
        setOutcome(null);
        setPhase('preflight');
        try {
            const selection = await selectAndPreflightWorkImport();
            if (currentFlowId !== flowId.current) return;
            if (selection.status !== 'cancelled') await applyReport(selection, currentFlowId);
            else resetFlow();
        } catch (error) {
            const fileName = error instanceof WorkImportFileReadError ? error.fileName : 'Selected StoryArk work export';
            await applyReport(preflightReadFailure(fileName), currentFlowId);
        } finally {
            if (currentFlowId === flowId.current) setIsChecking(false);
        }
    }, [applyReport, nativeFilePickerAvailable, resetFlow]);

    const expectedTargetDatabaseVersion = preparation?.target?.databaseVersion;

    const executeImport = useCallback(async (mode: WorkImportMode) => {
        if (report?.status !== 'valid' || !nativeFilePickerAvailable || isExecuting || outcome) return false;
        const currentFlowId = flowId.current;
        const currentRequestId = newRequestId();
        requestId.current = currentRequestId;
        setIsExecuting(true);
        setImportError(null);
        setImportErrorCode(null);
        setCancelRequested(false);
        setPhase('executing');
        try {
            const result = await workImportRepository.execute(report.value, mode, expectedTargetDatabaseVersion, currentRequestId);
            if (currentFlowId !== flowId.current) return false;
            let refreshError: string | null = null;
            try {
                await onImported?.(result);
            } catch {
                refreshError = 'The work was imported, but the current views could not be refreshed. Reopen the work or retry the refresh.';
            }
            setOutcome({ result, refreshError });
            setPhase('result');
            return true;
        } catch (error) {
            if (currentFlowId !== flowId.current) return false;
            const details = errorDetails(error);
            setImportError(details.message);
            setImportErrorCode(details.code);
            setPhase('result');
            return false;
        } finally {
            if (currentFlowId === flowId.current) {
                setIsExecuting(false);
                setCancelRequested(false);
                requestId.current = null;
            }
        }
    }, [expectedTargetDatabaseVersion, isExecuting, nativeFilePickerAvailable, onImported, outcome, report]);

    const cancelImport = useCallback(async () => {
        if (!isExecuting) {
            resetFlow();
            return;
        }
        const currentRequestId = requestId.current;
        if (!currentRequestId || cancelRequested) return;
        setCancelRequested(true);
        try {
            await workImportRepository.cancel(currentRequestId);
        } catch {
            setCancelRequested(false);
            setImportError('The cancellation request could not be sent. The import is still running; wait for its result before closing.');
            setImportErrorCode('STORAGE_FAILURE');
        }
    }, [cancelRequested, isExecuting, resetFlow]);

    const closeReport = useCallback(() => {
        if (isExecuting) return;
        resetFlow();
    }, [isExecuting, resetFlow]);

    return {
        report,
        preparation,
        importError,
        importErrorCode,
        phase,
        outcome,
        isChecking,
        isExecuting,
        cancelRequested,
        nativeFilePickerAvailable,
        inspectBrowserFile,
        openNativeImport,
        executeImport,
        cancelImport,
        closeReport,
    };
}
