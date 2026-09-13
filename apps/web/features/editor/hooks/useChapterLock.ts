import { useLayoutEffect, useRef, useState } from 'react';

interface Options {
    sessionKey: string;
    isReadOnly: boolean;
    isDirty: boolean;
    pauseEdits: (paused: boolean) => void;
    setReadOnly: (locked: boolean) => void;
    flush: () => Promise<boolean>;
    persistToggle: () => Promise<boolean>;
}

/** Lock after saving; unlock before saving a draft stranded behind a lock. */
export function useChapterLock(options: Options) {
    const current = useRef(options);
    const busy = useRef(false);
    const [isChangingLock, setChangingLock] = useState(false);
    useLayoutEffect(() => { current.current = options; });
    useLayoutEffect(() => () => {
        current.current.pauseEdits(false);
        current.current = { ...current.current, sessionKey: '' };
    }, []);

    const toggle = async () => {
        if (busy.current) return;
        busy.current = true;
        const captured = current.current;
        const sameSession = () => current.current.sessionKey === captured.sessionKey;
        captured.pauseEdits(true);
        setChangingLock(true);
        try {
            // Saving while already locked cannot succeed. Do not put the same
            // precondition on unlocking, and never clear or reload the draft.
            if (!captured.isReadOnly && captured.isDirty && !await captured.flush()) return;
            if (!sameSession()) return;
            if (!await captured.persistToggle() || !sameSession()) return;
            current.current.setReadOnly(!captured.isReadOnly);
            // Use the normal scheduler and version checks after unlocking.
            // A conflict or ancestor lock still leaves the draft unsaved.
            if (captured.isReadOnly && captured.isDirty) await captured.flush();
        } finally {
            captured.pauseEdits(false);
            busy.current = false;
            setChangingLock(false);
        }
    };
    return { toggle, isChangingLock };
}
