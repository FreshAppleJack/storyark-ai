import React from 'react';
import type { RetrievalContext } from '../../../domain/retrieval/contracts';

interface RetrievalContextPanelProps {
    context: RetrievalContext | null;
    notice: string | null;
    excludedHitIds: string[];
    onToggleHit: (hitId: string) => void;
    disabled?: boolean;
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
        <section className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950" aria-label="Retrieved context">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Retrieved context</h3>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                        {materials.length > 0
                            ? `${materials.length} source${materials.length === 1 ? '' : 's'} used. Exclude a source before regenerating if it is not relevant.`
                            : notice}
                    </p>
                </div>
                {context && <span className="text-right text-[11px] text-slate-400">{context.task}</span>}
            </div>
            {materials.length > 0 && (
                <div className="mt-2 space-y-2">
                    {materials.map(material => {
                        const isExcluded = excluded.has(material.hitId);
                        return (
                            <label key={material.hitId} className={`flex gap-2 rounded border px-2 py-2 text-xs ${isExcluded ? 'border-amber-200 bg-amber-50/60 opacity-70 dark:border-amber-900/60 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
                                <input
                                    type="checkbox"
                                    checked={!isExcluded}
                                    disabled={disabled}
                                    onChange={() => onToggleHit(material.hitId)}
                                    className="mt-0.5 accent-brand-600"
                                />
                                <span className="min-w-0">
                                    <span className="flex flex-wrap gap-x-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                                        <span>{material.sourceKind}</span>
                                        <span>{material.chapterId ?? 'book-level'}</span>
                                        <span>source v{material.sourceVersion}</span>
                                        {isExcluded && <span className="text-amber-700 dark:text-amber-300">excluded for next generation</span>}
                                    </span>
                                    <span className="mt-1 block line-clamp-3 whitespace-pre-wrap leading-5 text-slate-700 dark:text-slate-200">{material.text || material.quote}</span>
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
