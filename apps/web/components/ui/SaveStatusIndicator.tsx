import React from 'react';
import { CheckCircle2, Cloud, CloudOff, History as HistoryIcon } from 'lucide-react';

export type SaveIndicatorState = 'saved' | 'saving' | 'unsaved' | 'error';

/**
 * The one persistent save indicator shared by every page header, using the
 * editor's original visuals: cloud + amber for unsaved, spinner for saving,
 * green check for saved, cloud-off + retry for failure.
 */
export function SaveStatusIndicator({ state, savedText = 'Saved locally', onRetry }: {
    state: SaveIndicatorState;
    savedText?: string;
    onRetry?: () => void;
}): React.ReactElement {
    return (
        <div className="flex items-center gap-2 text-xs font-medium transition-colors duration-300">
            {state === 'saved' && <><CheckCircle2 size={14} className="text-emerald-500" /><span className="text-slate-400">{savedText}</span></>}
            {state === 'saving' && <><HistoryIcon size={14} className="text-brand-500 animate-spin" /><span className="text-brand-600">Saving...</span></>}
            {state === 'unsaved' && <><Cloud size={14} className="text-amber-500" /><span className="text-amber-600">Unsaved Changes</span></>}
            {state === 'error' && (
                <>
                    <CloudOff size={14} className="text-rose-500" />
                    <span className="text-rose-600 dark:text-rose-300">Save failed</span>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="rounded-md border border-rose-200 px-1.5 py-0.5 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                        >
                            Retry
                        </button>
                    )}
                </>
            )}
        </div>
    );
}
