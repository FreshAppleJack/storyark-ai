import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface UseWindowCloseGuardOptions {
    isDirty: boolean;
    flush: () => Promise<boolean>;
    onFlushFailed: () => void;
}

/**
 * Native window close protection: the in-app route blocker cannot see the OS
 * close button. A dirty draft prevents the default close, flushes through the
 * same save scheduler, and only then destroys the window. On failure the page
 * is asked to show a retry/discard choice instead of losing the draft.
 * No-op outside the desktop runtime.
 */
export function useWindowCloseGuard({ isDirty, flush, onFlushFailed }: UseWindowCloseGuardOptions): void {
    const latest = useRef({ isDirty, flush, onFlushFailed });
    useEffect(() => {
        latest.current = { isDirty, flush, onFlushFailed };
    });
    const inProgressRef = useRef(false);

    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | undefined;
        let cancelled = false;
        void getCurrentWindow().onCloseRequested(event => {
            if (!latest.current.isDirty) return;
            // preventDefault must run synchronously inside the event callback.
            event.preventDefault();
            if (inProgressRef.current) return;
            inProgressRef.current = true;
            void (async () => {
                try {
                    const ok = await latest.current.flush();
                    if (ok) {
                        await getCurrentWindow().destroy();
                        return;
                    }
                    latest.current.onFlushFailed();
                } finally {
                    inProgressRef.current = false;
                }
            })();
        }).then(fn => {
            if (cancelled) fn();
            else unlisten = fn;
        });
        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);
}
