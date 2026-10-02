import { useEffect, useState } from 'react';

export const LOADING_NOTICE_DELAY_MS = 200;

/** Keep fast reads quiet; a new resource or retry starts its own delay. */
export function useDelayedLoading(pending: boolean, identity: string, delayMs = LOADING_NOTICE_DELAY_MS): boolean {
    const [status, setStatus] = useState({ identity, pending, visible: false });
    // Reset before painting so the next resource cannot inherit a visible notice.
    if (status.identity !== identity || status.pending !== pending) {
        setStatus({ identity, pending, visible: false });
    }
    useEffect(() => {
        if (!pending) return;
        const timer = window.setTimeout(() => setStatus({ identity, pending: true, visible: true }), delayMs);
        return () => window.clearTimeout(timer);
    }, [identity, pending, delayMs]);
    return pending && status.identity === identity && status.pending && status.visible;
}
