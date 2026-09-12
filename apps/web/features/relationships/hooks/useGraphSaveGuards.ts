import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useWindowCloseGuard } from '../../editor/hooks/useWindowCloseGuard';

export function useGraphSaveGuards(isDirty: boolean, flush: () => Promise<boolean>) {
    const blocker = useBlocker(isDirty);
    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        void flush().then(ok => { if (ok) blocker.proceed(); else blocker.reset(); });
    }, [blocker, flush]);
    useWindowCloseGuard({ isDirty, flush, onFlushFailed: () => {
        toast.error('The window remains open. Resolve the graph save error and retry Save or close again.');
    } });
    useEffect(() => {
        if (!isDirty) return;
        const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isDirty]);
}
