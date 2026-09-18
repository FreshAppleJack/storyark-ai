import { isTauri } from '@tauri-apps/api/core';
import { EXCHANGE_LIMITS } from './exchange/limits';
import {
    preflightWorkImportBytes,
    preflightWorkImportFailure,
    preflightWorkImportSize,
    type WorkImportPreflightReport,
} from './importPreflight';

export class WorkImportFileReadError extends Error {
    constructor(public readonly fileName: string) {
        super('The selected file could not be read.');
        this.name = 'WorkImportFileReadError';
    }
}

export type WorkImportFileSelection = WorkImportPreflightReport | { status: 'cancelled' };

function fileNameFromPath(path: string): string {
    const normalized = path.replace(/[\\/]+$/, '');
    const name = normalized.slice(Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\')) + 1).trim();
    return name || 'Selected StoryArk work export';
}

export async function selectAndPreflightWorkImport(): Promise<WorkImportFileSelection> {
    if (!isTauri()) throw new Error('Native file selection is unavailable outside the desktop runtime.');

    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
        title: 'Select a StoryArk work export',
        multiple: false,
        directory: false,
        filters: [{ name: 'StoryArk work export', extensions: ['storyark.json', 'json'] }],
    });
    if (typeof selected !== 'string' || !selected.trim()) return { status: 'cancelled' };

    const fileName = fileNameFromPath(selected);
    const { readFile, stat } = await import('@tauri-apps/plugin-fs');
    let reportedSize: number | undefined;
    try {
        reportedSize = (await stat(selected)).size;
    } catch {
        reportedSize = undefined;
    }
    if (reportedSize !== undefined && reportedSize > EXCHANGE_LIMITS.maxExportBytes) {
        return preflightWorkImportSize(fileName, reportedSize);
    }

    let bytes: Uint8Array;
    try {
        bytes = await readFile(selected);
    } catch {
        throw new WorkImportFileReadError(fileName);
    }
    return preflightWorkImportBytes(fileName, bytes);
}

export function preflightReadFailure(fileName: string): WorkImportPreflightReport {
    return preflightWorkImportFailure(fileName);
}
