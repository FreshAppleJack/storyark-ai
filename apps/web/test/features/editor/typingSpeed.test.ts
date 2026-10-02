import { describe, expect, it, vi } from 'vitest';
import { createTypingInputObserver, createTypingSpeedTracker } from '../../../features/editor/typingSpeed';

describe('typing speed estimate', () => {
    it('counts Chinese characters and English letters, not English words or spaces', () => {
        const tracker = createTypingSpeedTracker();
        expect(tracker.record('你好 hello', 0)).toBe(84);
        expect(tracker.read(5_000)).toBe(84);
        expect(tracker.read(9_000)).toBe(47);
        expect(tracker.read(10_000)).toBe(0);
        expect(tracker.record('新', 11_000)).toBe(12);
    });

    it('uses only the rolling window during continuous typing', () => {
        const tracker = createTypingSpeedTracker();
        for (let time = 0; time <= 40_000; time += 5_000) tracker.record('abcdefghij', time);
        expect(tracker.read(40_000)).toBe(120);
        expect(tracker.record(' \n\u200B', 40_000)).toBe(120);
    });
});

describe('typing input observer', () => {
    it('counts an IME commit once, ignoring preedit and a duplicate final input', () => {
        const onTypedText = vi.fn();
        const observer = createTypingInputObserver(onTypedText, () => true);
        observer.compositionstart();
        observer.input(null, new InputEvent('input', { inputType: 'insertCompositionText', data: 'zhong', isComposing: true }));
        observer.input(null, new InputEvent('input', { inputType: 'insertCompositionText', data: '中文', isComposing: true }));
        observer.compositionend(null, new CompositionEvent('compositionend', { data: '中文' }));
        observer.input(null, new InputEvent('input', { inputType: 'insertText', data: '中文' }));
        observer.input(null, new InputEvent('input', { inputType: 'insertText', data: 'a' }));
        expect(onTypedText.mock.calls).toEqual([['中文'], ['a']]);
    });

    it('ignores cancelled composition, paste, drop, undo and locked input', () => {
        const onTypedText = vi.fn();
        let enabled = true;
        const observer = createTypingInputObserver(onTypedText, () => enabled);
        observer.compositionstart();
        observer.compositionend(null, new CompositionEvent('compositionend', { data: '' }));
        for (const inputType of ['insertFromPaste', 'insertFromDrop', 'historyUndo', 'deleteContentBackward']) {
            observer.input(null, new InputEvent('input', { inputType, data: 'ignored' }));
        }
        enabled = false;
        observer.input(null, new InputEvent('input', { inputType: 'insertText', data: 'locked' }));
        observer.compositionend(null, new CompositionEvent('compositionend', { data: '锁定' }));
        expect(onTypedText).not.toHaveBeenCalled();
    });
});
