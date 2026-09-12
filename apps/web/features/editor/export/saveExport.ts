import { isTauri } from '@tauri-apps/api/core';

/** Keep chapter titles from becoming paths or invalid Windows filenames. */
export function exportFilename(title: string, extension: 'docx' | 'pdf'): string {
    let stem = Array.from(title).map(character => character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character).join('')
        .trim().replace(/[. ]+$/g, '').slice(0, 120).replace(/[. ]+$/g, '');
    if (!stem) stem = 'Chapter';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
    return `${stem}.${extension}`;
}

/** Cancellation is normal; desktop completion means the write has finished. */
export async function saveExport(blob: Blob, filename: string): Promise<void> {
    if (!isTauri()) {
        const { saveAs } = await import('file-saver');
        saveAs(blob, filename);
        return;
    }
    const { save } = await import('@tauri-apps/plugin-dialog');
    const extension = filename.endsWith('.docx') ? 'docx' : 'pdf';
    const path = await save({ defaultPath: filename, filters: [{
        name: extension === 'docx' ? 'Word Document' : 'PDF Document', extensions: [extension],
    }] });
    if (path === null) return;
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
}
