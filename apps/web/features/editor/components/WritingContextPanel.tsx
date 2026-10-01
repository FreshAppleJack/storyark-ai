import React from 'react';
import { CheckCircle2, MessageSquareText, PanelRightClose, ScrollText, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { ForeshadowingNote, PlotSetting } from '../../../types';

interface WritingContextPanelProps {
    sidebarWidth?: number;
    isOverlay?: boolean;
    resizeHandle?: React.ReactNode;
    isOpen: boolean;
    foreshadowings: ForeshadowingNote[];
    excerptMap: Map<string, string>;
    activeForeshadowingId: string | null;
    plotSettings: PlotSetting[];
    isReadOnly: boolean;
    canOpenOutline: boolean;
    onClose: () => void;
    onFocusForeshadowing: (id: string) => void;
    onNoteChange: (id: string, note: string) => void;
    onDeleteForeshadowing: (id: string) => void;
    onOpenOutline: () => void;
}

/**
 * Right-hand panel with the chapter's foreshadowing notes (editable) and the
 * linked plot settings (read only). The parent page owns the data and every
 * mutation; this component only renders and forwards user intent.
 */
export function WritingContextPanel({
    sidebarWidth,
    isOverlay = false,
    resizeHandle,
    isOpen,
    foreshadowings,
    excerptMap,
    activeForeshadowingId,
    plotSettings,
    isReadOnly,
    canOpenOutline,
    onClose,
    onFocusForeshadowing,
    onNoteChange,
    onDeleteForeshadowing,
    onOpenOutline,
}: WritingContextPanelProps): React.ReactElement {
    const unrecoveredCount = foreshadowings.filter(item => !item.isRecovered).length;

    return (
        <aside
            style={sidebarWidth === undefined ? undefined : { width: isOpen ? sidebarWidth : 0 }}
            inert={!isOpen}
            className={`min-w-0 flex-shrink-0 overflow-hidden bg-white dark:bg-slate-950 shadow-xl ${sidebarWidth === undefined ? 'transition-all' : 'transition-opacity'} duration-300 ease-in-out ${isOverlay ? 'absolute inset-y-0 right-0 z-30' : 'relative'} ${
                isOpen
                    ? 'w-72 opacity-100 border-l border-slate-200 dark:border-slate-800'
                    : 'w-0 opacity-0 border-l-0 pointer-events-none'
            }`}
        >
            {isOpen && resizeHandle}
            <div className={`h-full flex flex-col ${sidebarWidth === undefined ? 'w-72' : 'w-full'}`}>
                <section className="flex-1 min-h-0 flex flex-col border-b border-slate-200 dark:border-slate-800">
                    <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                <MessageSquareText size={16} className="text-slate-400" />
                                Foreshadowing
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">
                                {unrecoveredCount === 1
                                    ? '1 unrecovered note'
                                    : `${unrecoveredCount} unrecovered notes`}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
                            title="Hide Foreshadowing & Plot"
                        >
                            <PanelRightClose size={17} />
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                        {foreshadowings.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                Select text in the editor, right-click it, then choose <span className="font-semibold text-slate-700 dark:text-slate-200">Add Foreshadowing</span>.
                            </div>
                        ) : (
                            foreshadowings.map((item, index) => {
                                const isActive = activeForeshadowingId === item.id;
                                const excerpt = excerptMap.get(item.id) || item.excerpt;
                                return (
                                    <div
                                        key={item.id}
                                        className={`rounded-lg border bg-white dark:bg-slate-900 transition ${
                                            isActive
                                                ? 'border-brand-300 ring-2 ring-brand-100 dark:border-brand-700 dark:ring-brand-950/60'
                                                : 'border-slate-200 dark:border-slate-800'
                                        }`}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => onFocusForeshadowing(item.id)}
                                            className="w-full px-3 pt-3 text-left"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Foreshadowing {foreshadowings.length - index}</span>
                                                {item.isRecovered && (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                        <CheckCircle2 size={11} />
                                                        Recovered
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-slate-400">{new Date(item.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                            <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300 line-clamp-3">
                                                "{excerpt}"
                                            </p>
                                        </button>
                                        <div className="px-3 pb-3 pt-2">
                                            <textarea
                                                value={item.note}
                                                onChange={(event) => onNoteChange(item.id, event.target.value)}
                                                placeholder="Write the payoff, hidden meaning, or future reveal..."
                                                className="min-h-[108px] w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-600 dark:focus:ring-brand-950/60"
                                                disabled={isReadOnly}
                                            />
                                            <div className="mt-2 flex justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => onDeleteForeshadowing(item.id)}
                                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                                                >
                                                    <Trash2 size={13} />
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>

                <section className="flex-1 min-h-0 flex flex-col">
                    <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                <ScrollText size={16} className="text-slate-400" />
                                Plot View
                            </div>
                            <p className="text-[11px] text-slate-400 truncate">
                                {plotSettings.length === 1
                                    ? '1 linked plot setting'
                                    : `${plotSettings.length} linked plot settings`}
                            </p>
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={onOpenOutline}
                            disabled={!canOpenOutline}
                        >
                            Open Outline
                        </Button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                        {plotSettings.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                No plot details have been linked to this chapter yet.
                            </div>
                        ) : (
                            plotSettings.map((plot, index) => (
                                <article
                                    key={plot.id}
                                    className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                                Plot Setting {plotSettings.length - index}
                                            </div>
                                            <h3 className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">
                                                {plot.title || 'Untitled Plot'}
                                            </h3>
                                        </div>
                                        <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                            Read only
                                        </span>
                                    </div>
                                    <p className="mt-3 whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
                                        {plot.details || 'No details written yet.'}
                                    </p>
                                </article>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </aside>
    );
}
