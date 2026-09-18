import { beforeEach, describe, expect, it, vi } from 'vitest';
import sampleExport from '../../../docs/samples/storyark-work-export-v1.json?raw';
import { EXCHANGE_LIMITS } from '../../../data/export/exchange/limits';
import { selectAndPreflightWorkImport } from '../../../data/export/importFile';

const native = vi.hoisted(() => ({
    isTauri: vi.fn(),
    open: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: native.open }));
vi.mock('@tauri-apps/plugin-fs', () => ({ stat: native.stat, readFile: native.readFile }));

describe('native work import file boundary', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        native.isTauri.mockReturnValue(true);
    });

    it('checks the native file size before reading an oversized export', async () => {
        native.open.mockResolvedValue('C:/exports/too-large.storyark.json');
        native.stat.mockResolvedValue({ size: EXCHANGE_LIMITS.maxExportBytes + 1 });

        const result = await selectAndPreflightWorkImport();

        expect(result.status).toBe('invalid');
        expect(native.readFile).not.toHaveBeenCalled();
    });

    it('reads and preflights the selected file while exposing only its filename', async () => {
        native.open.mockResolvedValue('C:/private/Book.storyark.json');
        native.stat.mockResolvedValue({ size: new TextEncoder().encode(sampleExport).byteLength });
        native.readFile.mockResolvedValue(new TextEncoder().encode(sampleExport));

        const result = await selectAndPreflightWorkImport();

        expect(result.status).toBe('valid');
        expect(result.fileName).toBe('Book.storyark.json');
        expect(result.fileName).not.toContain('C:/private');
    });

    it('treats the native file dialog cancellation as a no-op', async () => {
        native.open.mockResolvedValue(null);

        await expect(selectAndPreflightWorkImport()).resolves.toEqual({ status: 'cancelled' });
        expect(native.stat).not.toHaveBeenCalled();
        expect(native.readFile).not.toHaveBeenCalled();
    });
});
