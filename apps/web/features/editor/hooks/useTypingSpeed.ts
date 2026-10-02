import { useCallback, useEffect, useMemo, useState } from 'react';
import { createTypingSpeedTracker } from '../typingSpeed';

export function useTypingSpeed(sessionKey: string, enabled: boolean) {
    const tracker = useMemo(() => ({ sessionKey, enabled, ...createTypingSpeedTracker() }), [sessionKey, enabled]);
    const [reading, setReading] = useState({ tracker, value: 0 });
    const recordTypedText = useCallback((text: string) => {
        if (enabled) setReading({ tracker, value: tracker.record(text, Date.now()) });
    }, [tracker, enabled]);

    useEffect(() => {
        if (!enabled) return;
        const timer = window.setInterval(() => {
            const value = tracker.read(Date.now());
            setReading(previous => previous.tracker === tracker && previous.value === value
                ? previous : { tracker, value });
        }, 1000);
        return () => window.clearInterval(timer);
    }, [tracker, enabled]);

    return { speed: enabled && reading.tracker === tracker ? reading.value : 0, recordTypedText };
}
