import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { FileText } from 'lucide-react';
import { reportError } from '../../../data/diagnostics';
import { SettingShell } from './SettingControls';

export function ErrorLogSettings() {
    const [path, setPath] = useState<string | null>(null);
    useEffect(() => {
        if (!isTauri()) return;
        let disposed = false;
        void invoke<{ path: string | null }>('diagnostic_log_info').then(info => {
            if (!disposed) setPath(info.path);
        }).catch(error => reportError('diagnostic_log_info', error));
        return () => { disposed = true; };
    }, []);
    if (!isTauri()) return null;
    return <SettingShell title="Error log" description="If something goes wrong, share this file when asking for help." icon={<FileText size={22} />}>
        <p className="select-all break-all text-sm text-slate-600 dark:text-slate-300">
            {path ?? 'The error log is unavailable. Check that StoryArk can write to your app folder.'}
        </p>
    </SettingShell>;
}
