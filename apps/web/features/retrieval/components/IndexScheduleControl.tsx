import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { indexScheduleRepository, type IndexScheduleStatus } from '../../../data/local/indexScheduleRepository';

export function IndexScheduleControl({ bookId }: { bookId?: string }) {
    const [status, setStatus] = useState<IndexScheduleStatus | null>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (!isTauri()) return;
        let disposed = false;
        let running = false;
        const refresh = async () => {
            if (running) return;
            running = true;
            try {
                const next = await indexScheduleRepository.read(bookId ?? null);
                if (!disposed) { setStatus(next); setError(''); }
            } catch (reason) {
                if (!disposed) setError(reason instanceof Error ? reason.message : 'Index status is unavailable.');
            } finally { running = false; }
        };
        void refresh();
        const timer = window.setInterval(() => void refresh(), 3000);
        return () => { disposed = true; window.clearInterval(timer); };
    }, [bookId]);
    if (!isTauri()) return null;
    const toggle = async () => {
        if (!status || saving) return;
        setSaving(true);
        try {
            await indexScheduleRepository.save(!status.enabled, status.databaseVersion);
            setStatus(await indexScheduleRepository.read(bookId ?? null));
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Index preference could not be saved.');
        } finally { setSaving(false); }
    };
    return <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        <label className="flex items-center justify-between gap-3 font-semibold text-slate-800 dark:text-slate-200">
            Automatically build local index
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={status?.enabled ?? false} disabled={!status || saving} onChange={() => void toggle()} />
        </label>
        <p>Updates after saved changes settle for 60 seconds, or after 5 minutes of continuous changes. Uses local CPU.</p>
        {status && <>
            <p>Auto indexing {status.enabled ? 'on' : 'off'} · {status.pendingSources} sources waiting</p>
            <p>Last completed: {status.lastCompletedAt ? new Date(status.lastCompletedAt).toLocaleString() : 'Not yet'}</p>
            {status.lastError && <p className="text-amber-700 dark:text-amber-300">Last task failure: {status.lastError}</p>}
        </>}
        {error && <p role="alert" className="text-rose-600 dark:text-rose-300">{error}</p>}
    </div>;
}
