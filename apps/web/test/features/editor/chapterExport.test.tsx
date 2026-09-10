import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportChapter } from '../../../features/editor/export/exportChapter';
import { useChapterExport } from '../../../features/editor/export/useChapterExport';

const libs = vi.hoisted(() => ({
    asBlob: vi.fn(),
    saveAs: vi.fn(),
    html2pdf: vi.fn(),
}));
vi.mock('html-docx-js-typescript', () => ({ asBlob: libs.asBlob }));
vi.mock('file-saver', () => ({ saveAs: libs.saveAs }));
vi.mock('html2pdf.js', () => ({ default: libs.html2pdf }));

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function pdfWorker(completion: Promise<void>) {
    const overlay = document.createElement('div');
    const frame = document.createElement('iframe');
    const worker = {
        prop: { overlay },
        set: vi.fn<(options: { filename: string; html2canvas: { onclone: (document: Document) => void } }) => unknown>().mockReturnThis(),
        from: vi.fn<(element: HTMLElement) => unknown>().mockReturnThis(),
        save: vi.fn(() => {
            document.body.append(overlay, frame);
            worker.set.mock.calls[0][0].html2canvas.onclone(frame.contentDocument!);
            return completion;
        }),
    };
    libs.html2pdf.mockReturnValue(worker);
    return { worker, overlay, frame };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Chapter export', () => {
    it('converts and downloads the captured Word title and content', async () => {
        const blob = new Blob(['document']);
        libs.asBlob.mockResolvedValue(blob);
        const snapshot = { title: '第一章', editorHtml: '<p><strong>Original body</strong></p>' };
        const operation = exportChapter('docx', snapshot);
        snapshot.title = 'Another chapter';
        snapshot.editorHtml = '<p>Another body</p>';
        await operation;
        expect(libs.asBlob).toHaveBeenCalledWith(
            expect.stringContaining('<strong>Original body</strong>'),
            expect.objectContaining({ orientation: 'portrait' }),
        );
        expect(libs.asBlob.mock.calls[0][0]).toContain('<title>第一章</title>');
        expect(libs.saveAs).toHaveBeenCalledWith(blob, '第一章.docx');
    });

    it('keeps PDF busy until completion, rejects duplicate actions and preserves the chapter snapshot', async () => {
        const completion = deferred();
        const { worker, overlay, frame } = pdfWorker(completion.promise);
        let snapshot = { title: 'First', editorHtml: '<p>First body</p>' };
        const onError = vi.fn();
        const { result, rerender } = renderHook(() => useChapterExport({ getSnapshot: () => snapshot, onError }));
        let operation!: Promise<void>;
        await act(async () => {
            operation = result.current.runExport('pdf');
            await result.current.runExport('docx');
        });
        expect(result.current.isExporting).toBe(true);
        expect(worker.save).toHaveBeenCalledTimes(1);
        expect(libs.asBlob).not.toHaveBeenCalled();
        snapshot = { title: 'Second', editorHtml: '<p>Second body</p>' };
        rerender();
        expect(worker.set.mock.calls[0][0].filename).toBe('First.pdf');
        expect(worker.from.mock.calls[0][0].innerHTML).toContain('First body');
        await act(async () => { completion.resolve(); await operation; });
        expect(result.current.isExporting).toBe(false);
        expect(overlay.isConnected).toBe(false);
        expect(frame.isConnected).toBe(false);
        expect(onError).not.toHaveBeenCalled();
    });

    it('reports asynchronous PDF failure, cleans owned resources and permits retry', async () => {
        const completion = deferred();
        const { overlay, frame } = pdfWorker(completion.promise);
        const unrelated = document.createElement('div');
        unrelated.className = 'html2pdf__overlay';
        document.body.append(unrelated);
        const onError = vi.fn();
        const { result } = renderHook(() => useChapterExport({
            getSnapshot: () => ({ title: 'Chapter', editorHtml: '<p>Body</p>' }), onError,
        }));
        let operation!: Promise<void>;
        await act(async () => { operation = result.current.runExport('pdf'); });
        const error = new Error('Canvas rendering failed');
        await act(async () => { completion.reject(error); await operation; });
        expect(onError).toHaveBeenCalledWith('pdf', error);
        expect(result.current.isExporting).toBe(false);
        expect(overlay.isConnected).toBe(false);
        expect(frame.isConnected).toBe(false);
        expect(unrelated.isConnected).toBe(true);
        unrelated.remove();
        const retry = pdfWorker(Promise.resolve());
        await act(async () => { await result.current.runExport('pdf'); });
        expect(retry.worker.save).toHaveBeenCalledTimes(1);
        expect(result.current.isExporting).toBe(false);
    });

    it('reports Word conversion failure without downloading or leaving the UI busy', async () => {
        const error = new Error('Conversion failed');
        libs.asBlob.mockRejectedValue(error);
        const onError = vi.fn();
        const { result } = renderHook(() => useChapterExport({
            getSnapshot: () => ({ title: 'Chapter', editorHtml: '<p>Body</p>' }), onError,
        }));
        await act(async () => { await result.current.runExport('docx'); });
        expect(libs.saveAs).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith('docx', error);
        expect(result.current.isExporting).toBe(false);
    });
});
