import { isTauri } from '@tauri-apps/api/core';
import {
    parseStoryArkWorkExport,
    type StoryArkWorkExportValidationResult,
} from './exchange';

export type WorkExportSaveResult =
    | { status: 'saved'; byteLength: number; sha256: string }
    | { status: 'cancelled' };

function validationMessage(result: StoryArkWorkExportValidationResult): string {
    if (result.valid) return '';
    return result.errors.slice(0, 3).map(issue => `${issue.path}: ${issue.message}`).join(' ');
}

async function sha256(bytes: Uint8Array): Promise<string> {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 verification is unavailable in this desktop runtime.');
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function verifyJson(raw: string): void {
    const result = parseStoryArkWorkExport(raw);
    if (!result.valid) throw new Error(`The work export failed validation. ${validationMessage(result)}`);
}

function fileStem(title: string): string {
    let stem = Array.from(title).map(character => (
        character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character
    )).join('').trim().replace(/[. ]+$/g, '').slice(0, 120).replace(/[. ]+$/g, '');
    if (!stem) stem = 'StoryArk-work';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
    return stem;
}

export function workExportFilename(title: string): string {
    return `${fileStem(title)}.storyark.json`;
}

/**
 * Write a validated work export. Desktop writes go to a verified temporary
 * file and are renamed only after read-back, parse, size and hash checks.
 */
export async function saveWorkExport(raw: string, filename: string): Promise<WorkExportSaveResult> {
    verifyJson(raw);
    const bytes = new TextEncoder().encode(raw);
    const expectedHash = await sha256(bytes);

    if (!isTauri()) {
        const { saveAs } = await import('file-saver');
        saveAs(new Blob([bytes], { type: 'application/json;charset=utf-8' }), filename);
        return { status: 'saved', byteLength: bytes.byteLength, sha256: expectedHash };
    }

    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
        defaultPath: filename,
        filters: [{ name: 'StoryArk work export', extensions: ['storyark.json', 'json'] }],
    });
    if (path === null) return { status: 'cancelled' };
    if (!path.trim()) throw new Error('The selected export path is empty.');

    const temporaryPath = `${path}.storyark-${globalThis.crypto.randomUUID()}.tmp`;
    const { writeFile, readFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    let temporaryFileExists = true;
    try {
        await writeFile(temporaryPath, bytes);
        const writtenBytes = await readFile(temporaryPath);
        if (writtenBytes.byteLength !== bytes.byteLength) {
            throw new Error('The export size could not be verified. The destination was not replaced.');
        }
        const writtenHash = await sha256(writtenBytes);
        if (writtenHash !== expectedHash) {
            throw new Error('The export hash could not be verified. The destination was not replaced.');
        }
        const writtenText = new TextDecoder('utf-8', { fatal: true }).decode(writtenBytes);
        verifyJson(writtenText);
        await rename(temporaryPath, path);
        temporaryFileExists = false;
        return { status: 'saved', byteLength: writtenBytes.byteLength, sha256: writtenHash };
    } finally {
        if (temporaryFileExists) await remove(temporaryPath).catch(() => undefined);
    }
}
