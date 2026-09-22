import { isTauri } from '@tauri-apps/api/core';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { indexScheduleRepository, type IndexScheduleStatus } from '../../../data/local/indexScheduleRepository';
import { SettingShell, ToggleControl } from '../../settings/components/SettingControls';

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
    return <SettingShell
        title="Local story index"
        description="Keep semantic and lexical story search materials available locally. Automatic indexing waits for a pause in saved changes and uses local CPU."
        icon={<RefreshCw size={22} />}
    >
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Automatically build local index</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">Updates after saved changes settle for 60 seconds, or after 5 minutes of continuous changes.</p>
                </div>
                <ToggleControl
                    ariaLabel="Automatically build local index"
                    enabled={status?.enabled ?? false}
                    disabled={!status || saving}
                    onChange={() => void toggle()}
                />
            </div>
            {status && <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{status.enabled ? 'Automatic indexing on' : 'Automatic indexing off'}</p>
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{status.pendingSources} sources waiting</span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Last completed: {status.lastCompletedAt ? new Date(status.lastCompletedAt).toLocaleString() : 'Not yet'}</p>
                {status.lastError && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Last task failure: {status.lastError}</p>}
            </div>}
            {error && <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">{error}</p>}
        </div>
    </SettingShell>;
}
