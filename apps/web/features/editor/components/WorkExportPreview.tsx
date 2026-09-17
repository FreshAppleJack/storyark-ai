import React from 'react';
import { CheckCircle2, Download, FileJson, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { WorkExportPreviewModel } from '../export/useWorkExport';

interface WorkExportPreviewProps {
    preview: WorkExportPreviewModel;
    isExporting: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

const countItems = (items: Array<[string, number]>) => items.map(([label, value]) => (
    <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{value}</div>
    </div>
));

export function WorkExportPreview({ preview, isExporting, onConfirm, onClose }: WorkExportPreviewProps): React.ReactElement {
    const { summary } = preview;
    const { counts } = summary;
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-6" role="presentation">
            <section
                className="max-h-[min(760px,calc(100vh-3rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                role="dialog"
                aria-modal="true"
                aria-labelledby="work-export-preview-title"
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-brand-100 p-3 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                            <FileJson size={24} />
                        </div>
                        <div>
                            <h2 id="work-export-preview-title" className="text-xl font-semibold text-slate-900 dark:text-white">Export StoryArk work</h2>
                            <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{summary.bookTitle}</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} disabled={isExporting} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Close export preview">
                        <X size={20} />
                    </button>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {countItems([
                        ['Volumes', counts.volumes],
                        ['Chapters', counts.chapters],
                        ['Characters', counts.characters],
                        ['Foreshadowings', counts.foreshadowings],
                        ['Graph nodes', counts.graphNodes],
                        ['Graph edges', counts.graphEdges],
                        ['Brainstorm workspaces', counts.brainstormWorkspaces],
                        ['Brainstorm options', counts.brainstormOptions],
                    ])}
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                        <h3 className="font-semibold text-slate-900 dark:text-white">Format</h3>
                        <dl className="mt-3 space-y-2 text-sm">
                            <div className="flex justify-between gap-4"><dt className="text-slate-500 dark:text-slate-400">Schema version</dt><dd className="font-mono text-slate-900 dark:text-white">{summary.schemaVersion}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500 dark:text-slate-400">Generated at</dt><dd className="text-right text-slate-900 dark:text-white">{new Date(preview.value.exportedAt).toLocaleString()}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500 dark:text-slate-400">Supported assets</dt><dd className="text-slate-900 dark:text-white">{summary.supportedAssetCount || 'None'}</dd></div>
                            <div className="flex justify-between gap-4"><dt className="text-slate-500 dark:text-slate-400">Retrieval index</dt><dd className="text-slate-900 dark:text-white">Not included; rebuildable</dd></div>
                        </dl>
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                        <h3 className="font-semibold text-slate-900 dark:text-white">Excluded from this file</h3>
                        <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                            {summary.exclusions.map(item => <li key={item} className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500" />{item}</li>)}
                        </ul>
                    </div>
                </div>

                <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">
                    Export reads the saved, same-book snapshot. The Save As destination is selected only after this preview; cancelling it does not report success.
                </p>
                <div className="mt-6 flex justify-end gap-3">
                    <Button variant="ghost" onClick={onClose} disabled={isExporting}>Cancel</Button>
                    <Button onClick={onConfirm} disabled={isExporting} icon={<Download size={16} />}>
                        {isExporting ? 'Verifying...' : 'Choose destination'}
                    </Button>
                </div>
            </section>
        </div>
    );
}
