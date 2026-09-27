import type { ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import type {
    RetrievalSearchFilters,
    RetrievalSourceKind,
} from '../../../domain/retrieval/contracts';
import { createDefaultStorySearchFilters } from '../hooks/useLocalStorySearch';
import type { StorySearchChapterOption } from '../hooks/useLocalStorySearch';

interface StorySearchFiltersProps {
    filters: RetrievalSearchFilters;
    chapters: StorySearchChapterOption[];
    activeChapterId: string;
    onChange: (patch: Partial<RetrievalSearchFilters>) => void;
}

const SOURCE_OPTIONS: Array<{ kind: RetrievalSourceKind; label: string }> = [
    { kind: 'manuscript', label: 'Manuscript' },
    { kind: 'chapter_summary', label: 'Chapter summaries' },
    { kind: 'confirmed_setting', label: 'Confirmed settings' },
    { kind: 'character', label: 'Characters' },
    { kind: 'relationship', label: 'Relationships' },
    { kind: 'foreshadowing_note', label: 'Foreshadowing notes' },
];

function dateInputValue(timestamp: number | null): string {
    if (timestamp === null) return '';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function dateInputTimestamp(value: string, endOfDay = false): number | null {
    if (!value) return null;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export function StorySearchFilters({
    filters,
    chapters,
    activeChapterId,
    onChange,
}: StorySearchFiltersProps): ReactElement {
    const manuscriptExcluded = !filters.sourceKinds.includes('manuscript');

    return (
        <details className="group/filters rounded-lg border border-slate-200 bg-white text-xs dark:border-slate-800 dark:bg-slate-900">
            <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 font-semibold text-slate-700 outline-none dark:text-slate-200">
                <span>Search filters</span>
                {manuscriptExcluded && (
                    <span aria-label="Manuscript excluded from search" className="text-amber-600 dark:text-amber-300">
                        Manuscript excluded
                    </span>
                )}
                <ChevronDown aria-hidden="true" size={14} className="ml-auto shrink-0 transition-transform group-open/filters:rotate-180" />
            </summary>
            <div className="space-y-3 border-t border-slate-200 px-3 py-3 dark:border-slate-800">
                {manuscriptExcluded && (
                    <p className="text-amber-700 dark:text-amber-300">Manuscript text will not be searched.</p>
                )}
                <fieldset>
                    <legend className="mb-1.5 w-full">
                        <span className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-600 dark:text-slate-300">Evidence sources</span>
                            <button
                                type="button"
                                onClick={() => onChange(createDefaultStorySearchFilters())}
                                className="ml-auto rounded px-1.5 py-1 font-semibold text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950/40"
                            >
                                Reset filters
                            </button>
                        </span>
                    </legend>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
                        {SOURCE_OPTIONS.map(option => {
                            const checked = filters.sourceKinds.includes(option.kind);
                            return (
                                <label key={option.kind} className="flex min-w-0 items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                            const next = checked
                                                ? filters.sourceKinds.filter(kind => kind !== option.kind)
                                                : [...filters.sourceKinds, option.kind];
                                            if (next.length > 0) onChange({ sourceKinds: next });
                                        }}
                                        className="accent-brand-600"
                                    />
                                    <span className="truncate">{option.label}</span>
                                </label>
                            );
                        })}
                    </div>
                    <label className="mt-2 flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <input
                            type="checkbox"
                            checked={filters.includePlanning}
                            onChange={event => onChange({ includePlanning: event.target.checked })}
                            className="accent-brand-600"
                        />
                        <span>Include planning material</span>
                    </label>
                </fieldset>

                <label className="block font-semibold text-slate-600 dark:text-slate-300">
                    Chapter range
                    <select
                        value={filters.chapterRange}
                        onChange={event => onChange({ chapterRange: event.target.value as RetrievalSearchFilters['chapterRange'] })}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-normal text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    >
                        <option value="all">All chapters</option>
                        <option value="current" disabled={!activeChapterId}>Current chapter</option>
                        <option value="before_current" disabled={!activeChapterId}>Current and earlier chapters</option>
                    </select>
                </label>

                <fieldset className="grid grid-cols-2 gap-2">
                    <label className="font-semibold text-slate-600 dark:text-slate-300">
                        Updated after
                        <input
                            type="date"
                            value={dateInputValue(filters.updatedAfter)}
                            onChange={event => onChange({ updatedAfter: dateInputTimestamp(event.target.value) })}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-normal text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        />
                    </label>
                    <label className="font-semibold text-slate-600 dark:text-slate-300">
                        Updated before
                        <input
                            type="date"
                            value={dateInputValue(filters.updatedBefore)}
                            onChange={event => onChange({ updatedBefore: dateInputTimestamp(event.target.value, true) })}
                            className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-normal text-slate-700 outline-none focus:border-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        />
                    </label>
                </fieldset>

                {chapters.length > 0 && activeChapterId && (
                    <p className="text-[11px] leading-4 text-slate-400 dark:text-slate-500">
                        Current chapter: {chapters.find(chapter => chapter.id === activeChapterId)?.title ?? 'Unknown'}
                    </p>
                )}
            </div>
        </details>
    );
}
