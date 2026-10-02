import React from 'react';
import type { RetrievalContext, RetrievalContextEvidence } from '../../../domain/retrieval/contracts';

interface RetrievalContextPanelProps {
    context: RetrievalContext | null;
    notice: string | null;
    excludedHitIds: string[];
    onToggleHit: (hitId: string) => void;
    disabled?: boolean;
}

function sourceLabel(kind: RetrievalContextEvidence['sourceKind']): string {
    const label = kind.replaceAll('_', ' ');
    return label[0].toUpperCase() + label.slice(1);
}

function evidenceText(material: RetrievalContextEvidence): { title: string | null; details: string } {
    const text = material.text || material.quote;
    if (material.sourceKind !== 'character') return { title: null, details: text };
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(line));
    return { title: lines[0] ?? null, details: lines.slice(1).join(' · ') };
}

export function RetrievalContextPanel({
    context,
    notice,
    excludedHitIds,
    onToggleHit,
    disabled = false,
}: RetrievalContextPanelProps): React.ReactElement | null {
    if (!context && !notice) return null;
    const excluded = new Set(excludedHitIds);
    const materials = context?.evidence ?? [];
    return (
        <section className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950" aria-label="Retrieved context">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Reference material</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {materials.length > 0
                    ? `${materials.length} supporting source${materials.length === 1 ? '' : 's'}. Uncheck a source to exclude it from the next generation.`
                    : notice}
            </p>
            {materials.length > 0 && (
                <div className="mt-3 space-y-2">
                    {materials.map(material => {
                        const isExcluded = excluded.has(material.hitId);
                        const location = [material.volumeTitleSnapshot, material.chapterTitleSnapshot ?? material.chapterId].filter(Boolean).join(' / ') || 'Book context';
                        const { title, details } = evidenceText(material);
                        return (
                            <label key={material.hitId} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-xs transition ${isExcluded
                                ? 'border-amber-200 bg-amber-50/60 opacity-70 dark:border-amber-900/60 dark:bg-amber-950/20'
                                : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
                                <input
                                    type="checkbox"
                                    checked={!isExcluded}
                                    disabled={disabled}
                                    onChange={() => onToggleHit(material.hitId)}
                                    aria-label={`Use ${sourceLabel(material.sourceKind)} from ${location}`}
                                    className="mt-0.5 shrink-0 accent-brand-600"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                        <span className="font-semibold text-brand-700 dark:text-brand-300">{sourceLabel(material.sourceKind)}</span>
                                        <span className="min-w-0 truncate">{location}</span>
                                    </span>
                                    {title && <span className="mt-1 block font-semibold text-slate-800 dark:text-slate-100">{title}</span>}
                                    {details && <span className="mt-1 line-clamp-3 whitespace-pre-wrap leading-5 text-slate-700 dark:text-slate-200">{details}</span>}
                                    {isExcluded && <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">Excluded from next generation</span>}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
