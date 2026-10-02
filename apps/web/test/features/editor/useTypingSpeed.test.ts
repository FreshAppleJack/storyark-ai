import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTypingSpeed } from '../../../features/editor/hooks/useTypingSpeed';

afterEach(() => vi.useRealTimers());

describe('useTypingSpeed', () => {
    it('updates during typing, returns to zero when idle, and resets across sessions or locks', () => {
        vi.useFakeTimers();
        const { result, rerender, unmount } = renderHook(
            ({ session, enabled }) => useTypingSpeed(session, enabled),
            { initialProps: { session: 'chapter-1', enabled: true } },
        );
        act(() => result.current.recordTypedText('中文hello'));
        expect(result.current.speed).toBe(84);
        act(() => vi.advanceTimersByTime(1_499));
        expect(result.current.speed).toBe(84);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.speed).toBe(0);
        act(() => result.current.recordTypedText('新'));
        expect(result.current.speed).toBe(12);
        rerender({ session: 'chapter-2', enabled: true });
        expect(result.current.speed).toBe(0);
        act(() => result.current.recordTypedText('abc'));
        rerender({ session: 'chapter-2', enabled: false });
        act(() => result.current.recordTypedText('ignored'));
        expect(result.current.speed).toBe(0);
        rerender({ session: 'chapter-2', enabled: true });
        expect(result.current.speed).toBe(0);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('extends the idle deadline for each new input and stops updating after unmount', () => {
        vi.useFakeTimers();
        const { result, unmount } = renderHook(() => useTypingSpeed('chapter-1', true));
        act(() => result.current.recordTypedText('ab'));
        act(() => vi.advanceTimersByTime(1_000));
        act(() => result.current.recordTypedText('cd'));
        expect(result.current.speed).toBe(48);
        act(() => vi.advanceTimersByTime(1_499));
        expect(result.current.speed).toBe(48);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.speed).toBe(0);
        act(() => result.current.recordTypedText('e'));
        expect(result.current.speed).toBe(12);
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});
