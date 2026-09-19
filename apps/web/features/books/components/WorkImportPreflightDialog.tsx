import React from 'react';
import { AlertTriangle, CheckCircle2, FileJson, Loader2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { WorkImportPreflightReport } from '../../../data/export/importPreflight';
import type { WorkImportPreparation, WorkImportResult, WorkImportStats } from '../../../data/export/importRepository';
import type { WorkImportOutcome, WorkImportPhase } from '../hooks/useWorkImport';

interface WorkImportPreflightDialogProps {
    report: WorkImportPreflightReport;
    preparation: WorkImportPreparation | null;
    importError: string | null;
    importErrorCode: string | null;
    phase: WorkImportPhase;
    outcome: WorkImportOutcome | null;
    isExecuting: boolean;
    cancelRequested: boolean;
    onClose: () => void;
    onImport: () => void;
    onReplace: () => void;
    onCreateCopy: () => void;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countItems(items: Array<[string, number]>) {
    return items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
            <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{value}</div>
        </div>
    ));
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

function statsText(stats: WorkImportStats): string {
    const planningItems = stats.planningSummaries + stats.plotSettings;
    return `${stats.volumes} volumes · ${stats.chapters} chapters · ${stats.characters} characters · ${stats.foreshadowings} notes · ${stats.graphNodes} graph nodes · ${stats.graphEdges} graph edges · ${planningItems} planning items · ${stats.brainstormWorkspaces} brainstorm workspaces`;
}

function VersionSummary({ label, version, updatedAt, stats }: { label: string; version: number; updatedAt: number; stats: WorkImportStats }): React.ReactElement {
    return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
            <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">Version {version}</div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Updated {formatTime(updatedAt)}</div>
            <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">{statsText(stats)}</div>
        </div>
    );
}

const FLOW_STEPS = ['Select file', 'Preflight summary', 'Conflict choice', 'Import progress', 'Result'];

function phaseIndex(phase: WorkImportPhase): number {
    if (phase === 'conflict') return 2;
    if (phase === 'executing') return 3;
    if (phase === 'result') return 4;
    return 1;
}

function FlowSteps({ phase, hasError }: { phase: WorkImportPhase; hasError: boolean }): React.ReactElement {
    const current = phaseIndex(phase);
    return (
        <ol className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Import progress">
            {FLOW_STEPS.map((step, index) => {
                const complete = index < current && !hasError;
                const active = index === current;
                return (
                    <li key={step} className={`rounded-lg border px-2 py-2 text-center text-xs ${complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200' : active ? 'border-brand-300 bg-brand-50 font-semibold text-brand-800 dark:border-brand-700 dark:bg-brand-950/30 dark:text-brand-200' : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'}`}>
                        <span className="block">{index + 1}</span>
                        <span className="mt-1 block">{step}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function importModeLabel(result: WorkImportResult): string {
    if (result.mode === 'replace') return 'Work replaced successfully';
    if (result.mode === 'copy') return 'Work copy created successfully';
    return 'Work imported successfully';
}

function nextStepForError(code: string | null): string {
    switch (code) {
        case 'IMPORT_INVALID':
        case 'IMPORT_UNSUPPORTED_VERSION':
        case 'UNSUPPORTED_ASSET':
            return 'Fix the export file or choose another export, then run preflight again.';
        case 'IMPORT_CONFLICT':
        case 'VERSION_CONFLICT':
            return 'Reload the import decision and choose Create copy, or cancel and select the current export again.';
        case 'READ_ONLY':
            return 'Unlock the target work before replacing it, or choose Create copy.';
        case 'BACKUP_FAILED':
            return 'Check the local storage folder and available disk space, then retry. No replacement was started.';
        case 'CANCELLED':
            return 'No database changes were made. You can start the import again when ready.';
        default:
            return 'The original work was preserved. Check storage availability and retry; use a verified recovery backup if one was generated.';
    }
}

export function WorkImportPreflightDialog({
    report,
    preparation,
    importError,
    importErrorCode,
    phase,
    outcome,
    isExecuting,
    cancelRequested,
    onClose,
    onImport,
    onReplace,
    onCreateCopy,
}: WorkImportPreflightDialogProps): React.ReactElement {
    const valid = report.status === 'valid';
    const targetConflict = preparation?.status === 'conflict' && preparation.target;
    const nameConflict = preparation?.nameConflict === true;
    const canExecute = valid && preparation !== null && !isExecuting && !outcome && !importError;
    const hasError = Boolean(importError) || !valid;
    const title = outcome
        ? importModeLabel(outcome.result)
        : isExecuting
            ? 'Importing StoryArk work'
            : importError && phase === 'result'
                ? 'Import failed'
                : phase === 'conflict'
                    ? 'Choose how to import this work'
                    : valid
                        ? 'Import preflight passed'
                        : 'Import preflight failed';

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-6" role="presentation">
            <section
                className="max-h-[min(800px,calc(100vh-3rem))] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
                role="dialog"
                aria-modal="true"
                aria-labelledby="work-import-preflight-title"
            >
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className={outcome ? 'rounded-xl bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : hasError ? 'rounded-xl bg-rose-100 p-3 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' : isExecuting ? 'rounded-xl bg-brand-100 p-3 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300' : 'rounded-xl bg-emerald-100 p-3 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'}>
                            {isExecuting ? <Loader2 size={24} className="animate-spin" /> : outcome ? <CheckCircle2 size={24} /> : hasError ? <AlertTriangle size={24} /> : <CheckCircle2 size={24} />}
                        </div>
                        <div>
                            <h2 id="work-import-preflight-title" className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
                            <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{report.fileName}</p>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} disabled={isExecuting && cancelRequested} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Cancel or close import">
                        <X size={20} />
                    </button>
                </div>

                <FlowSteps phase={phase} hasError={hasError && phase !== 'result'} />

                <div className="mt-5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                    <FileJson size={16} />
                    <span>{formatBytes(report.byteLength)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{phase === 'preflight' ? 'No database changes yet' : 'Same-book import boundary'}</span>
                </div>

                {valid ? (
                    <>
                        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {countItems([
                                ['Volumes', report.summary.volumes],
                                ['Chapters', report.summary.chapters],
                                ['Characters', report.summary.characters],
                                ['Foreshadowings', report.summary.foreshadowings],
                                ['Graph nodes', report.summary.graphNodes],
                                ['Graph edges', report.summary.graphEdges],
                                ['Planning items', report.summary.planningSummaries + report.summary.plotSettings],
                                ['Assets', report.summary.assets],
                            ])}
                        </div>

                        {outcome ? (
                            <div className="mt-6 space-y-3">
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
                                    <p className="font-semibold">{importModeLabel(outcome.result)}.</p>
                                    <p className="mt-1">The bookshelf and local work queries were refreshed after the transaction completed.</p>
                                </div>
                                {outcome.result.mode === 'replace' && outcome.result.backupFileName && (
                                    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900/70 dark:bg-sky-950/30 dark:text-sky-200">
                                        <p className="font-semibold">Recovery backup generated</p>
                                        <p className="mt-1 break-words">{outcome.result.backupFileName}</p>
                                        <p className="mt-1">Stop other StoryArk instances before using a controlled restore.</p>
                                    </div>
                                )}
                                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                                    <p className="font-semibold">Search index pending</p>
                                    <p className="mt-1">The imported work is usable now. A later local indexing task will rebuild derived search data; this is not an import failure.</p>
                                </div>
                                {outcome.refreshError && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">{outcome.refreshError}</p>}
                            </div>
                        ) : isExecuting ? (
                            <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900 dark:border-brand-900/70 dark:bg-brand-950/30 dark:text-brand-200">
                                <p className="font-semibold">Writing the work in one protected transaction...</p>
                                <p className="mt-1">You can cancel while the operation is running. Cancellation is checked before the transaction commits; the target remains unchanged if it is cancelled.</p>
                            </div>
                        ) : (
                            <>
                                <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200">
                                    <p className="font-semibold">Preflight passed. No database changes were made.</p>
                                    <p className="mt-1">The file passed the in-memory structure and reference checks. Choose an import action to write it to the local workspace.</p>
                                </div>
                                {!preparation && !importError && <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">Checking the local workspace for ID and name conflicts...</p>}
                                {preparation && (
                                    <div className="mt-5 space-y-4">
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <VersionSummary label="Import version" version={preparation.importVersion} updatedAt={preparation.importUpdatedAt} stats={preparation.importStats} />
                                            {targetConflict ? (
                                                <VersionSummary label="Current local version" version={targetConflict.databaseVersion} updatedAt={targetConflict.updatedAt} stats={targetConflict.stats} />
                                            ) : (
                                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Target</div>
                                                    <div className="mt-2 text-sm text-slate-700 dark:text-slate-200">No work with this ID exists</div>
                                                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">The import will create a new local work.</div>
                                                </div>
                                            )}
                                        </div>
                                        {targetConflict && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">This export has the same work ID as the local work. Choose Replace, Create copy, or Cancel; StoryArk will not merge the two versions.</p>}
                                        {!targetConflict && nameConflict && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">Another local work already uses this title, but it has a different ID. Create copy will use <strong>{preparation.copyTitle}</strong> and preserve the author text.</p>}
                                        {targetConflict && <p className="text-sm text-slate-600 dark:text-slate-300">Create copy will use <strong>{preparation.copyTitle}</strong> and allocate new IDs for every internal reference.</p>}
                                    </div>
                                )}
                            </>
                        )}
                        {importError && <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200" role="alert"><p className="font-semibold">Import was not completed.</p><p className="mt-1">{importError}</p><p className="mt-2 font-medium">Next step: {nextStepForError(importErrorCode)}</p></div>}
                        {report.warnings.length > 0 && <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/30"><h3 className="font-semibold text-amber-900 dark:text-amber-200">Content requiring safe handling</h3><ul className="mt-3 space-y-2 text-sm text-amber-900 dark:text-amber-100">{report.warnings.map((warning, index) => <li key={`${warning.path}-${index}`}><code className="mr-2 rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900/50">{warning.path}</code>{warning.message}</li>)}</ul></div>}
                    </>
                ) : (
                    <>
                        <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"><p className="font-semibold">No database changes were made.</p><p className="mt-1">Fix the reported fields or choose another export. The target workspace was not created or modified.</p><p className="mt-2 font-medium">Next step: Fix the file and run preflight again.</p></div>
                        <div className="mt-5 space-y-3">{report.errors.map((error, index) => <div key={`${error.path}-${index}`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><code className="text-xs font-semibold text-slate-700 dark:text-slate-200">{error.path}</code><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{error.message}</p></div>)}</div>
                    </>
                )}

                <div className="mt-6 flex flex-wrap justify-end gap-3">
                    <Button variant="secondary" onClick={onClose} disabled={isExecuting && cancelRequested}>{isExecuting ? (cancelRequested ? 'Cancelling...' : 'Cancel import') : outcome ? 'Close' : targetConflict || nameConflict ? 'Cancel' : 'Close'}</Button>
                    {valid && preparation && !outcome && !importError && !isExecuting && (
                        targetConflict ? <><Button variant="secondary" onClick={onCreateCopy} disabled={!canExecute}>Create copy</Button><Button onClick={onReplace} disabled={!canExecute}>Replace</Button></>
                            : nameConflict ? <Button onClick={onCreateCopy} disabled={!canExecute}>Create copy</Button>
                                : <Button onClick={onImport} disabled={!canExecute}>Import work</Button>
                    )}
                </div>
            </section>
        </div>
    );
}
