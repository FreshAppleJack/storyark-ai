import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useWindowCloseGuard } from '../../editor/hooks/useWindowCloseGuard';

interface CharacterSaveGuardProps {
    isDirty: boolean;
    flush: () => Promise<boolean>;
}

/** Flush character edits before an in-app route or native window close. */
export function CharacterSaveGuard({ isDirty, flush }: CharacterSaveGuardProps) {
    const blocker = useBlocker(isDirty);

    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        void flush().then(ok => {
            if (ok) blocker.proceed();
            else blocker.reset();
        });
    }, [blocker, flush]);

    useWindowCloseGuard({
        isDirty,
        flush,
        onFlushFailed: () => toast.error('Save failed. The window stays open with your draft. Retry saving before closing.'),
    });

    useEffect(() => {
        if (!isDirty) return;
        const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', prevent);
        return () => window.removeEventListener('beforeunload', prevent);
    }, [isDirty]);

    return null;
}
