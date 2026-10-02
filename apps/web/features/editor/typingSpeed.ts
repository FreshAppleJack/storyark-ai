import { calculateCharacterCount } from '../../utils/textUtils';

const WINDOW_MS = 30_000;
const IDLE_MS = 1_500;
const WARMUP_MS = 5_000;

/** A short rolling estimate of characters typed, independent of saved word counts. */
export function createTypingSpeedTracker() {
    let samples: { at: number; count: number }[] = [];
    let startedAt: number | null = null;
    let speed = 0;

    const read = (now: number): number => {
        const latest = samples.at(-1);
        if (!latest || now - latest.at >= IDLE_MS) {
            samples = [];
            startedAt = null;
            speed = 0;
        }
        // Hold the last estimate during a short pause, then clear it when idle.
        return speed;
    };

    return {
        read,
        record(text: string, now: number): number {
            read(now);
            const count = calculateCharacterCount(text);
            if (count > 0) {
                startedAt ??= now;
                samples.push({ at: now, count });
                samples = samples.filter(sample => sample.at > now - WINDOW_MS);
                const elapsed = Math.min(WINDOW_MS, Math.max(WARMUP_MS, now - startedAt));
                speed = Math.round(samples.reduce((total, sample) => total + sample.count, 0) * 60_000 / elapsed);
            }
            return read(now);
        },
    };
}

/** Observe typing without handling or cancelling ProseMirror's input events. */
export function createTypingInputObserver(onTypedText: (text: string) => void, canCount: () => boolean) {
    let composing = false;
    let lastInput: { text: string; at: number; source: 'input' | 'text' | 'composition' } | null = null;
    const record = (text: string, source: 'input' | 'text' | 'composition') => {
        const at = Date.now();
        // DOM input and ProseMirror text input can describe the same insertion.
        // IME commits can also be followed by either notification.
        if (lastInput && source !== lastInput.source && text === lastInput.text && at - lastInput.at < 100) return;
        if (canCount()) onTypedText(text);
        lastInput = { text, at, source };
    };
    return {
        handleTextInput: (_view: unknown, _from: number, _to: number, text: string) => {
            if (!composing && text) record(text, 'text');
            return false;
        },
        compositionstart: () => {
            composing = true;
            lastInput = null;
            return false;
        },
        compositionend: (_view: unknown, event: CompositionEvent) => {
            composing = false;
            if (event.data) record(event.data, 'composition');
            return false;
        },
        input: (_view: unknown, event: InputEvent) => {
            if (composing || event.isComposing) return false;
            if (event.inputType === 'insertText' && event.data) {
                record(event.data, 'input');
            }
            return false;
        },
        blur: () => {
            composing = false;
            lastInput = null;
            return false;
        },
    };
}
