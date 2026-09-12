import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportFilename, saveExport } from '../../../features/editor/export/saveExport';

const mocks = vi.hoisted(() => ({ isTauri: vi.fn(), save: vi.fn(), writeFile: vi.fn(), saveAs: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: mocks.isTauri }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: mocks.writeFile }));
vi.mock('file-saver', () => ({ saveAs: mocks.saveAs }));
beforeEach(() => { vi.resetAllMocks(); mocks.isTauri.mockReturnValue(true); });

describe('Export destination', () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const blob = { arrayBuffer: async () => bytes.buffer } as Blob;
    it('writes converted bytes only to the selected native destination', async () => {
        mocks.save.mockResolvedValue('C:/selected/chapter.pdf');
        await saveExport(blob, 'chapter.pdf');
        expect(mocks.writeFile).toHaveBeenCalledWith('C:/selected/chapter.pdf', bytes);
        expect(mocks.saveAs).not.toHaveBeenCalled();
    });
    it('cancels without writing or falling back to a browser download', async () => {
        mocks.save.mockResolvedValue(null);
        await saveExport(blob, 'chapter.docx');
        expect(mocks.writeFile).not.toHaveBeenCalled();
        expect(mocks.saveAs).not.toHaveBeenCalled();
    });
    it('propagates write failure and waits for disk completion', async () => {
        mocks.save.mockResolvedValue('C:/selected/chapter.pdf');
        let reject!: (error: Error) => void;
        mocks.writeFile.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
        const operation = saveExport(blob, 'chapter.pdf');
        await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalled());
        const result = expect(operation).rejects.toThrow('Disk full');
        reject(new Error('Disk full'));
        await result;
        expect(mocks.saveAs).not.toHaveBeenCalled();
    });
    it('retains browser download support', async () => {
        mocks.isTauri.mockReturnValue(false);
        await saveExport(blob, 'chapter.pdf');
        expect(mocks.saveAs).toHaveBeenCalledWith(blob, 'chapter.pdf');
        expect(mocks.save).not.toHaveBeenCalled();
    });
    it('keeps Unicode titles while sanitizing paths and reserved filenames', () => {
        expect(exportFilename('第一章: 起点/结尾?', 'docx')).toBe('第一章_ 起点_结尾_.docx');
        expect(exportFilename('CON', 'pdf')).toBe('_CON.pdf');
        expect(exportFilename(' ... ', 'pdf')).toBe('Chapter.pdf');
    });
});
