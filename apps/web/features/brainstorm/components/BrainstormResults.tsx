import React from 'react';
import { BrainCircuit, CheckCircle2, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { BrainstormCandidate } from '../brainstormCandidate';
import type { BrainstormEditor } from '../hooks/useBrainstormWorkspace';
import { RetrievalContextPanel } from '../../retrieval/components/RetrievalContextPanel';
type Props = Pick<BrainstormEditor, 'isGenerating' | 'isSaving' | 'handleGenerate' | 'regenerate' | 'stopGeneration' | 'discardCandidate' | 'generationAvailable' | 'selectedChapterIds' | 'missingSummaryChapters' | 'isSnapshotStale' | 'errorMessage' | 'visibleOptions' | 'hasSelectedOption' | 'workspace' | 'chooseOption' | 'showAllOptions' | 'updateFinalContent' | 'candidate' | 'isReadOnly' | 'toggleRetrievalHit'>;
export function BrainstormResults({ isGenerating, isSaving, handleGenerate, regenerate, stopGeneration, discardCandidate, generationAvailable, selectedChapterIds, missingSummaryChapters, isSnapshotStale, errorMessage, visibleOptions, hasSelectedOption, workspace, chooseOption, showAllOptions, updateFinalContent, candidate, isReadOnly, toggleRetrievalHit }: Props) {
    const hasCandidate = candidate.status !== 'idle';
    const candidateAction = hasCandidate ? regenerate : handleGenerate;
    return (
        <main className="min-h-0 overflow-y-auto p-6">
            <div className="mx-auto max-w-4xl space-y-5">
                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                            <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-slate-800 dark:text-brand-300">
                                <Sparkles size={14} />
                                Three Directions
                            </div>
                            <h2 className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">Next Plot Brainstorm</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                Generate options from the story outline, background, selected chapter summaries, appearing characters, and relationships.
                            </p>
                        </div>
                        <Button onClick={candidateAction} disabled={!generationAvailable || isGenerating || isSaving || selectedChapterIds.length === 0}
                            title={generationAvailable ? undefined : 'Model integration is not available yet'} icon={isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}>
                            {isGenerating ? 'Generating...' : hasCandidate ? 'Regenerate' : 'AI Brainstorm'}
                        </Button>
                    </div>

                    {!generationAvailable && (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                            AI generation is not connected yet. You can still select chapters, review the context, write the final content by hand, and keep previously saved options.
                        </div>
                    )}
                    {isSnapshotStale && (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                            The saved brainstorm snapshot uses older chapter versions or summaries. Select “Save Result” on this page to refresh it; saving a chapter or planning page alone does not refresh this snapshot.
                        </div>
                    )}
                    {missingSummaryChapters.length > 0 && (
                        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                            Some selected chapters have missing or out-of-date summaries. The brainstorm will use a bounded excerpt of their current text instead; refresh summaries for fuller context.
                        </div>
                    )}
                    {errorMessage && (!hasCandidate || candidate.status === 'invalid' || errorMessage !== candidate.errorMessage) && (
                        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200">
                            {errorMessage}
                        </div>
                    )}
                    {isGenerating && (
                        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm leading-6 text-brand-800 dark:border-brand-900/70 dark:bg-brand-950/30 dark:text-brand-200">
                            Generation may take about 1 minute or longer. Please keep this page open while we prepare your options.
                        </div>
                    )}
                </section>

                {hasCandidate && (
                    <CandidatePanel
                        candidate={candidate}
                        isGenerating={isGenerating}
                        isSaving={isSaving}
                        stopGeneration={stopGeneration}
                        regenerate={regenerate}
                        discardCandidate={discardCandidate}
                        toggleRetrievalHit={toggleRetrievalHit}
                    />
                )}

                {visibleOptions.length === 0 && !workspace.finalContent.trim() ? (
                    <section className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
                        <BrainCircuit size={34} className="mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No brainstorm yet</h3>
                        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Select chapters, then generate three possible next directions.</p>
                    </section>
                ) : visibleOptions.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                        {visibleOptions.map(option => (
                            <article key={option.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">{option.title}</h3>
                                        {hasSelectedOption && workspace.selectedOptionId === option.id && (
                                            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                <CheckCircle2 size={13} />
                                                Selected
                                            </span>
                                        )}
                                    </div>
                                    {!hasSelectedOption ? (
                                        <Button size="sm" onClick={() => chooseOption(option)} disabled={isReadOnly || isGenerating} title={isReadOnly ? 'This workspace is read-only' : undefined}>Choose Direction</Button>
                                    ) : (
                                        <Button variant="secondary" size="sm" onClick={showAllOptions} disabled={isGenerating}>Show All Options</Button>
                                    )}
                                </div>
                                <div className="mt-4 grid gap-3 md:grid-cols-3">
                                    <InfoBlock title="Conflict / Hook" value={option.conflict} />
                                    <InfoBlock title="Motivation" value={option.motivation} />
                                    <InfoBlock title="Consequences" value={option.consequences} />
                                </div>
                                <div className="mt-4 whitespace-pre-line rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                                    {option.development}
                                </div>
                            </article>
                        ))}
                    </div>
                ) : null}

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Editable Result</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                            {workspace.selectedOptionId
                                ? 'This is the selected direction. Edit it freely, then save it as the working brainstorm result.'
                                : 'Write the final content by hand, then save it as the working brainstorm result.'}
                        </p>
                        <textarea
                            value={workspace.finalContent}
                            onChange={(event) => updateFinalContent(event.target.value)}
                            disabled={isReadOnly}
                            className="mt-4 min-h-80 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500 dark:focus:bg-slate-950"
                        />
                </section>
            </div>
        </main>
    );
}

function CandidatePanel({
    candidate,
    isGenerating,
    isSaving,
    stopGeneration,
    regenerate,
    discardCandidate,
    toggleRetrievalHit,
}: {
    candidate: BrainstormCandidate;
    isGenerating: boolean;
    isSaving: boolean;
    stopGeneration: () => void;
    regenerate: () => Promise<void>;
    discardCandidate: () => void;
    toggleRetrievalHit: (hitId: string) => void;
}) {
    const status = candidate.status === 'starting'
        ? 'Preparing the frozen chapter, planning, and relationship context...'
        : candidate.status === 'streaming'
            ? 'Generating three directions. Existing options and manual edits are unchanged.'
            : candidate.status === 'completed'
                ? 'Candidate ready. Choose a direction to add it to the editable workspace.'
                : candidate.status === 'adopted'
                    ? 'Candidate directions were added to the editable workspace. Save to persist them.'
                    : candidate.status === 'invalid'
                        ? 'The model response was kept for review, but it is not a valid brainstorm candidate.'
                        : candidate.status === 'failed'
                            ? 'Generation failed. Existing options and manual edits are unchanged.'
                            : candidate.status === 'cancelled'
                                ? 'Generation stopped. Existing options and manual edits are unchanged.'
                                : candidate.status === 'stale'
                                    ? 'The candidate needs review because its source context changed.'
                                    : candidate.errorMessage || 'The candidate was not adopted.';
    return (
        <section className="rounded-xl border border-brand-200 bg-brand-50/60 p-5 shadow-sm dark:border-brand-900/70 dark:bg-brand-950/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">New AI candidate</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300">{status}</p>
                    {candidate.errorMessage && candidate.status !== 'invalid' && (
                        <p className="mt-2 text-sm text-rose-700 dark:text-rose-200">{candidate.errorMessage}</p>
                    )}
                </div>
                <div className="flex flex-wrap gap-2">
                    {isGenerating ? (
                        <Button variant="secondary" size="sm" onClick={stopGeneration}>Stop</Button>
                    ) : (
                        <Button variant="secondary" size="sm" onClick={() => { void regenerate(); }} disabled={isSaving}>Regenerate</Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={discardCandidate} disabled={isGenerating || isSaving}>Discard candidate</Button>
                </div>
            </div>
            {candidate.rawText && ['invalid', 'failed', 'cancelled', 'stale'].includes(candidate.status) && (
                <details className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs dark:border-amber-900/70 dark:bg-amber-950/30">
                    <summary className="cursor-pointer font-semibold text-amber-800 dark:text-amber-200">Review raw generation text</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-white px-3 py-2 leading-5 text-slate-700 dark:border-amber-900/70 dark:bg-slate-950 dark:text-slate-200">{candidate.rawText}</pre>
                </details>
            )}
            {candidate.lastAttempt && (
                <div role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                    <div className="font-semibold">Latest generation attempt was not adopted</div>
                    <p className="mt-1">{candidate.lastAttempt.errorMessage}</p>
                    {candidate.lastAttempt.rawText && (
                        <details className="mt-2">
                            <summary className="cursor-pointer font-semibold">Review raw generation text</summary>
                            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-white px-4 py-3 text-xs leading-5 text-slate-700 dark:border-amber-900/70 dark:bg-slate-950 dark:text-slate-200">{candidate.lastAttempt.rawText}</pre>
                        </details>
                    )}
                    <RetrievalContextPanel
                        context={candidate.lastAttempt.retrievalContext}
                        notice={candidate.lastAttempt.retrievalNotice}
                        excludedHitIds={candidate.lastAttempt.retrievalContext?.excludedHitIds ?? []}
                        onToggleHit={toggleRetrievalHit}
                        disabled={isGenerating || isSaving}
                    />
                </div>
            )}
            <RetrievalContextPanel
                context={candidate.retrievalContext}
                notice={candidate.retrievalNotice}
                excludedHitIds={candidate.retrievalContext?.excludedHitIds ?? []}
                onToggleHit={toggleRetrievalHit}
                disabled={isGenerating || isSaving}
            />
        </section>
    );
}

const InfoBlock: React.FC<{ title: string; value: string }> = ({ title, value }) => (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-200">{value}</p>
    </div>
);
