import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowCloseGuard } from '../../../features/editor/hooks/useWindowCloseGuard';

const tauri = vi.hoisted(() => ({
    isTauri: vi.fn(),
    destroy: vi.fn(),
    unlisten: vi.fn(),
    closeHandler: undefined as undefined | ((event: { preventDefault: () => void }) => void),
    onCloseRequested: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: tauri.isTauri }));
vi.mock('@tauri-apps/api/window', () => ({
    getCurrentWindow: () => ({ onCloseRequested: tauri.onCloseRequested, destroy: tauri.destroy }),
}));

function emitClose() {
    const prevented = vi.fn();
    tauri.closeHandler?.({ preventDefault: prevented });
    return prevented;
}

describe('useWindowCloseGuard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tauri.isTauri.mockReturnValue(true);
        tauri.destroy.mockResolvedValue(undefined);
        tauri.onCloseRequested.mockImplementation((handler: typeof tauri.closeHandler) => {
            tauri.closeHandler = handler;
            return Promise.resolve(tauri.unlisten);
        });
    });
    afterEach(() => { tauri.closeHandler = undefined; });

    it('does nothing outside the desktop runtime', () => {
        tauri.isTauri.mockReturnValue(false);
        renderHook(() => useWindowCloseGuard({ isDirty: true, flush: vi.fn(), onFlushFailed: vi.fn() }));
        expect(tauri.onCloseRequested).not.toHaveBeenCalled();
    });

    it('lets a clean draft close without preventing the default', () => {
        renderHook(() => useWindowCloseGuard({ isDirty: false, flush: vi.fn(), onFlushFailed: vi.fn() }));
        expect(tauri.onCloseRequested).toHaveBeenCalledTimes(1);
        expect(emitClose()).not.toHaveBeenCalled();
        expect(tauri.destroy).not.toHaveBeenCalled();
    });

    it('prevents the close, flushes the dirty draft and then destroys the window', async () => {
        const flush = vi.fn().mockResolvedValue(true);
        renderHook(() => useWindowCloseGuard({ isDirty: true, flush, onFlushFailed: vi.fn() }));
        const prevented = emitClose();
        expect(prevented).toHaveBeenCalledTimes(1);
        await act(async () => { await Promise.resolve(); });
        expect(flush).toHaveBeenCalledTimes(1);
        expect(tauri.destroy).toHaveBeenCalledTimes(1);
    });

    it('reports a failed flush instead of destroying the window', async () => {
        const onFlushFailed = vi.fn();
        const flush = vi.fn().mockResolvedValue(false);
        renderHook(() => useWindowCloseGuard({ isDirty: true, flush, onFlushFailed }));
        emitClose();
        await act(async () => { await Promise.resolve(); });
        expect(onFlushFailed).toHaveBeenCalledTimes(1);
        expect(tauri.destroy).not.toHaveBeenCalled();
    });

    it('ignores repeated close requests while a flush is in flight', async () => {
        let release!: (value: boolean) => void;
        const flush = vi.fn().mockImplementation(() => new Promise<boolean>(resolve => { release = resolve; }));
        renderHook(() => useWindowCloseGuard({ isDirty: true, flush, onFlushFailed: vi.fn() }));
        emitClose();
        emitClose();
        await act(async () => { await Promise.resolve(); });
        expect(flush).toHaveBeenCalledTimes(1);
        await act(async () => { release(true); await Promise.resolve(); });
        expect(tauri.destroy).toHaveBeenCalledTimes(1);
    });

    it('unlistens on unmount', async () => {
        const { unmount } = renderHook(() => useWindowCloseGuard({ isDirty: true, flush: vi.fn(), onFlushFailed: vi.fn() }));
        // Let the onCloseRequested registration promise settle first.
        await act(async () => { await Promise.resolve(); });
        unmount();
        expect(tauri.unlisten).toHaveBeenCalledTimes(1);
    });
});
