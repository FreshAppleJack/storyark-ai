import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Link2, Plus, Search, Trash2, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import type { StoryPlanningEditor } from '../hooks/useStoryPlanning';
import { filterPlots, filterLinkedChapters, type ChapterOption } from '../planningSelectors';
type Props = Pick<StoryPlanningEditor, 'planning' | 'selectedPlotId' | 'setSelectedPlotId' | 'selectedPlot' |
    'addPlotSetting' | 'updateSelectedPlot' | 'deleteSelectedPlot' | 'togglePlotChapter'> & { chapterOptions: ChapterOption[] };
export function PlotSettingsPanel({ planning, selectedPlotId, setSelectedPlotId, selectedPlot,
    addPlotSetting, updateSelectedPlot, deleteSelectedPlot, togglePlotChapter, chapterOptions }: Props) {
    const [plotSearchQuery, setPlotSearchQuery] = useState('');
    const [linkedSearch, setLinkedSearch] = useState({ plotId: selectedPlotId, query: '' });
    const linkedChapterSearchQuery = linkedSearch.plotId === selectedPlotId ? linkedSearch.query : '';
    const setLinkedChapterSearchQuery = (query: string) => setLinkedSearch({ plotId: selectedPlotId, query });
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const chapterById = useMemo(() => new Map(chapterOptions.map(chapter => [chapter.id, chapter])), [chapterOptions]);
    const filteredPlots = useMemo(() => filterPlots(planning, chapterById, plotSearchQuery), [planning, chapterById, plotSearchQuery]);
    const filteredLinkedChapters = useMemo(() => filterLinkedChapters(chapterOptions, linkedChapterSearchQuery), [chapterOptions, linkedChapterSearchQuery]);
    const confirmDeleteSelectedPlot = () => { deleteSelectedPlot(); setShowDeleteModal(false); };
    const selectPlot = (id: string) => { setSelectedPlotId(id); setLinkedChapterSearchQuery(''); setShowDeleteModal(false); };
    return <>
        <aside className="min-h-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 flex flex-col">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <Link2 size={15} />
                        Plot Settings
                    </div>
                    <button
                        onClick={addPlotSetting}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700"
                        title="Add plot setting"
                    >
                        <Plus size={16} />
                    </button>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-950 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                    <Search size={15} className="flex-shrink-0 text-slate-400" />
                    <input
                        value={plotSearchQuery}
                        onChange={(event) => setPlotSearchQuery(event.target.value)}
                        placeholder="Search plot settings"
                        className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                    />
                    {plotSearchQuery && (
                        <button className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setPlotSearchQuery('')}>
                            <X size={13} />
                        </button>
                    )}
                </div>
                {plotSearchQuery.trim() && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {filteredPlots.length === 1 ? '1 plot found' : `${filteredPlots.length} plots found`}
                    </p>
                )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {planning.plotSettings.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
                        <Link2 size={28} className="mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">No plot settings yet</p>
                        <Button size="sm" className="mt-4" onClick={addPlotSetting}>Create Plot Setting</Button>
                    </div>
                ) : filteredPlots.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">No matching plot settings found.</div>
                ) : (
                    <div className="space-y-2">
                        {filteredPlots.map(plot => (
                            <button
                                key={plot.id}
                                onClick={() => selectPlot(plot.id)}
                                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedPlotId === plot.id
                                        ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-slate-800'
                                        : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800'
                                    }`}
                            >
                                <div className="truncate text-sm font-bold text-slate-900 dark:text-white">{plot.title || 'Untitled Plot'}</div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{plot.chapterIds.length} linked chapters</div>
                            </button>
                        ))}
                    </div>
                )}

                {selectedPlot && (
                    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Selected Plot</h3>
                            <Button variant="danger" size="sm" onClick={() => setShowDeleteModal(true)} icon={<Trash2 size={14} />}>Delete</Button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Title</label>
                                <input
                                    value={selectedPlot.title}
                                    onChange={(event) => updateSelectedPlot({ title: event.target.value })}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-500"
                                />
                            </div>
                            <div>
                                <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">Details</label>
                                <textarea
                                    value={selectedPlot.details}
                                    onChange={(event) => updateSelectedPlot({ details: event.target.value })}
                                    placeholder="Conflict, motivation, action beats, expected result..."
                                    className="h-36 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-brand-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-500"
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">Linked Chapters</label>
                                <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-900/40">
                                    <Search size={14} className="flex-shrink-0 text-slate-400" />
                                    <input
                                        value={linkedChapterSearchQuery}
                                        onChange={(event) => setLinkedChapterSearchQuery(event.target.value)}
                                        placeholder="Search linked chapters"
                                        className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                    />
                                    {linkedChapterSearchQuery && (
                                        <button
                                            type="button"
                                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                                            onClick={() => setLinkedChapterSearchQuery('')}
                                        >
                                            <X size={13} />
                                        </button>
                                    )}
                                </div>
                                {linkedChapterSearchQuery.trim() && (
                                    <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                                        {filteredLinkedChapters.length === 1 ? '1 chapter found' : `${filteredLinkedChapters.length} chapters found`}
                                    </p>
                                )}
                                <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
                                    {filteredLinkedChapters.length === 0 ? (
                                        <div className="px-3 py-8 text-center text-xs text-slate-400">No matching chapters found.</div>
                                    ) : filteredLinkedChapters.map(chapter => {
                                        const isChecked = selectedPlot.chapterIds.includes(chapter.id);
                                        return (
                                            <button
                                                key={chapter.id}
                                                type="button"
                                                onClick={() => togglePlotChapter(chapter.id)}
                                                className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left text-xs transition last:border-b-0 dark:border-slate-800 ${isChecked ? 'bg-brand-50 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                                                    }`}
                                            >
                                                <span className={`flex h-4 w-4 items-center justify-center rounded border ${isChecked ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-700'
                                                    }`}>
                                                    {isChecked && <CheckCircle2 size={12} />}
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{chapter.title}</span>
                                                    <span className="block truncate text-slate-400">{chapter.volumeTitle}</span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </aside>
        {showDeleteModal && selectedPlot && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                    <div className="flex items-center gap-3 mb-4 text-rose-600">
                        <div className="p-2 bg-rose-100 dark:bg-rose-950/60 rounded-full">
                            <AlertTriangle size={24} />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete Plot Setting?</h3>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                        Are you sure you want to delete <span className="font-bold text-slate-800 dark:text-white">{selectedPlot.title || 'Untitled Plot'}</span>?<br />
                        This plot setting and its chapter links will be removed from the planning board.
                    </p>
                    <div className="flex justify-end gap-3">
                        <Button variant="ghost" onClick={() => setShowDeleteModal(false)}>Cancel</Button>
                        <Button
                            variant="primary"
                            className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200 dark:shadow-none"
                            onClick={confirmDeleteSelectedPlot}
                        >
                            Delete
                        </Button>
                    </div>
                </div>
            </div>
        )}
    </>;
}
