import type { ReactNode } from 'react';
import { useDelayedLoading } from '../hooks/useDelayedLoading';

interface DelayedLoadingProps {
    identity: string;
    children: ReactNode;
}

export function DelayedLoading({ identity, children }: DelayedLoadingProps) {
    return useDelayedLoading(true, identity) ? children : null;
}

export function PageLoading({ identity, children }: DelayedLoadingProps) {
    return <main aria-busy="true" className="min-h-screen flex items-center justify-center p-8 bg-slate-50 text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <DelayedLoading identity={identity}><p role="status">{children}</p></DelayedLoading>
    </main>;
}
