import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChapterLock } from '../../../features/editor/hooks/useChapterLock';
import { useChapterDraft } from '../../../features/editor/hooks/useChapterDraft';
import type { Chapter } from '../../../types';

const chapter: Chapter = { id: 'c', title: 'Title', content: 'Original', wordCount: 1, status: 'draft', isEditable: true, foreshadowings: [] };
function options(overrides = {}) {
    return { sessionKey: 'c:1', isReadOnly: false, isDirty: true, pauseEdits: vi.fn(), setReadOnly: vi.fn(),
        flush: vi.fn().mockResolvedValue(true), persistToggle: vi.fn().mockResolvedValue(true), ...overrides };
}
describe('Chapter lock recovery', () => {
    it('unlocks a dirty draft before attempting its normal save', async () => {
        const order: string[] = [];
        const settings = options({ isReadOnly: true, persistToggle: vi.fn(async () => { order.push('unlock'); return true; }),
            flush: vi.fn(async () => { order.push('save'); return false; }) });
        const { result } = renderHook(() => useChapterLock(settings));
        await act(async () => { await result.current.toggle(); });
        expect(order).toEqual(['unlock', 'save']);
        expect(settings.setReadOnly).toHaveBeenCalledWith(false);
        expect(settings.pauseEdits).toHaveBeenLastCalledWith(false);
    });
    it('does not lock after a failed save or write after a failed unlock', async () => {
        const settings = options({ flush: vi.fn().mockResolvedValue(false) });
        const { result, rerender } = renderHook(props => useChapterLock(props), { initialProps: settings });
        await act(async () => { await result.current.toggle(); });
        expect(settings.persistToggle).not.toHaveBeenCalled();
        const locked = options({ isReadOnly: true, persistToggle: vi.fn().mockResolvedValue(false) });
        rerender(locked);
        await act(async () => { await result.current.toggle(); });
        expect(locked.flush).not.toHaveBeenCalled();
        expect(locked.setReadOnly).not.toHaveBeenCalled();
    });
    it('serializes clicks and ignores confirmation for a different chapter', async () => {
        let resolve!: (ok: boolean) => void;
        const settings = options({ isDirty: false, persistToggle: vi.fn(() => new Promise<boolean>(done => { resolve = done; })) });
        const { result, rerender } = renderHook(props => useChapterLock(props), { initialProps: settings });
        let operation!: Promise<void>;
        act(() => { operation = result.current.toggle(); void result.current.toggle(); });
        expect(settings.persistToggle).toHaveBeenCalledTimes(1);
        rerender({ ...settings, sessionKey: 'another:2' });
        await act(async () => { resolve(true); await operation; });
        expect(settings.setReadOnly).not.toHaveBeenCalled();
        expect(result.current.isChangingLock).toBe(false);
    });
    it('retains dirty text and notes when a lock arrives, and rejects readonly update events', () => {
        const { result, rerender } = renderHook(props => useChapterDraft({ chapterId: 'c', chapter: props }), { initialProps: chapter });
        act(() => { result.current.applyEditorUpdate('Unsaved body', 2); });
        const snapshot = result.current.getSnapshot();
        rerender({ ...chapter, isEditable: false });
        expect(result.current.isDirty).toBe(true);
        expect(result.current.isReadOnly).toBe(true);
        act(() => { result.current.applyEditorUpdate('Synthetic normalization', 3); result.current.setTitle('Unexpected'); });
        expect(result.current.getSnapshot()).toEqual(snapshot);
        act(() => { result.current.setReadOnly(false); });
        expect(result.current.getSnapshot()).toEqual(snapshot);
        expect(result.current.isDirty).toBe(true);
    });
    it('pauses new edits during lock transitions without losing existing input', () => {
        const { result } = renderHook(() => useChapterDraft({ chapterId: 'c', chapter }));
        act(() => { result.current.applyEditorUpdate('Pending', 1); });
        const snapshot = result.current.getSnapshot();
        act(() => { result.current.pauseEdits(true); result.current.applyEditorUpdate('Late event', 2); });
        expect(result.current.getSnapshot()).toEqual(snapshot);
        act(() => { result.current.pauseEdits(false); result.current.applyEditorUpdate('Next edit', 2); });
        expect(result.current.content).toBe('Next edit');
    });
});
