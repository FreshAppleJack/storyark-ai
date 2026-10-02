import type { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

/** Shared settings and help surface, with matching light and dark themes. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
    return <section
        className={cn('rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm shadow-slate-200/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 dark:shadow-black/20', className)}
        {...props}
    />;
}
