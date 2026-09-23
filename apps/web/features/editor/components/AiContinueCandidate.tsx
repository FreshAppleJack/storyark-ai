import { Check, Loader2, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { EditorSaveStatus } from './EditorHeader';
import type { AiContinueCandidate as AiContinueCandidateState } from '../hooks/useLocalAiContinue';
import { RetrievalContextPanel } from '../../retrieval/components/RetrievalContextPanel';

interface AiContinueCandidateProps {
    candidate: AiContinueCandidateState;
    isAiLoading: boolean;
    canAdopt: boolean;
    adoptDisabledReason: string | null;
    saveStatus: EditorSaveStatus;
    draftRevision: number;
    onStop: () => void;
    onAdopt: () => void;
    onClose: () => void;
    onDiscard: () => void;
    onRegenerate: () => void;
    onReselectInsertionPoint: () => void;
    onToggleRetrievalHit: (hitId: string) => void;
}

function statusLabel(status: AiContinueCandidateState['status']): string {
    switch (status) {
        case 'starting': return 'Preparing';
        case 'streaming': return 'Generating';
        case 'validating': return 'Checking manuscript and source versions';
        case 'completed': return 'Ready to review';
        case 'cancelled': return 'Stopped';
        case 'failed': return 'Generation failed';
        case 'stale': return 'Needs review';
        case 'adopted': return 'Adopted';
        default: return 'Candidate';
    }
}

export function AiContinueCandidate({
    candidate,
    isAiLoading,
    canAdopt,
    adoptDisabledReason,
    saveStatus,
    draftRevision,
    onStop,
    onAdopt,
    onClose,
    onDiscard,
    onRegenerate,
    onReselectInsertionPoint,
    onToggleRetrievalHit,
}: AiContinueCandidateProps): React.ReactElement | null {
    if (candidate.status === 'idle') return null;

    const canRegenerate = !isAiLoading && candidate.status !== 'validating' && candidate.status !== 'adopted';
    const canDiscard = candidate.status !== 'adopted';
    const adoptionObserved = candidate.status === 'adopted'
        && !!candidate.source
        && draftRevision > candidate.source.draftRevision;
    const persistenceMessage = !adoptionObserved
        ? 'Applying the insertion to the draft…'
        : saveStatus === 'saved'
            ? 'Manuscript save complete.'
            : saveStatus === 'saving'
                ? 'Saving the adopted text…'
                : saveStatus === 'error'
                    ? 'Save failed. The adopted text remains in the editor; retry from the save indicator.'
                    : 'Adopted into the draft. Save is pending.';

    return (
        <section
            className="mx-6 mt-4 rounded-lg border border-brand-200 bg-brand-50/70 p-4 dark:border-brand-900 dark:bg-brand-950/30"
            aria-label="AI continuation candidate"
        >
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Continue candidate</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{statusLabel(candidate.status)} · {candidate.status === 'adopted' ? persistenceMessage : 'The original draft is unchanged until adoption.'}</p>
                </div>
                {candidate.source && (
                    <span className="text-right text-[11px] text-slate-500 dark:text-slate-400">
                        Source: current in-memory draft · revision {candidate.source.draftRevision}
                    </span>
                )}
            </div>

            <div className="mt-3 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 font-serif text-sm leading-6 whitespace-pre-wrap text-slate-800 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                {candidate.text || (isAiLoading ? 'Waiting for model output...' : 'No candidate text was produced.')}
            </div>

            {candidate.errorMessage && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" role="status">
                    {candidate.errorMessage}
                </p>
            )}

            <RetrievalContextPanel
                context={candidate.source?.retrievalContext ?? null}
                notice={candidate.source?.retrievalNotice ?? null}
                excludedHitIds={candidate.source?.retrievalContext?.excludedHitIds ?? []}
                onToggleHit={onToggleRetrievalHit}
                disabled={isAiLoading || candidate.status === 'validating'}
            />

            {candidate.status === 'completed' && !canAdopt && adoptDisabledReason && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{adoptDisabledReason}</p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
                {isAiLoading && (
                    <Button variant="secondary" size="sm" onClick={onStop}>
                        <Square size={14} className="mr-2" />
                        Stop
                    </Button>
                )}
                {candidate.status === 'completed' && (
                    <Button
                        size="sm"
                        onClick={onAdopt}
                        disabled={!canAdopt}
                        title={adoptDisabledReason ?? undefined}
                    >
                        <Check size={14} className="mr-2" />
                        Adopt
                    </Button>
                )}
                {candidate.status === 'stale' && candidate.source?.staleReason === 'anchor' && (
                    <Button variant="secondary" size="sm" onClick={onReselectInsertionPoint}>
                        Use current insertion point
                    </Button>
                )}
                {canRegenerate && (
                    <Button variant="secondary" size="sm" onClick={onRegenerate}>
                        {candidate.status === 'starting' ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
                        Regenerate
                    </Button>
                )}
                {canDiscard && (
                    <Button variant="ghost" size="sm" onClick={onDiscard}>
                        <Trash2 size={14} className="mr-2" />
                        Discard candidate
                    </Button>
                )}
                {candidate.status === 'adopted' && (
                    <Button variant="secondary" size="sm" className="ml-auto" onClick={onClose}>
                        <X size={14} className="mr-2" />
                        Close
                    </Button>
                )}
            </div>
        </section>
    );
}
