import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
    ArrowLeft,
    BrainCircuit,
    CheckCircle2,
    Loader2,
    RefreshCw,
    Save,
    Sparkles,
    Users,
    Wand2
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useApp } from '../InteractionContent/AppContext';
import apiClient from '../services/api';
import { BrainstormOption, BrainstormWorkspace, Chapter, Character, StoryPlanning } from '../types';
import { escapeRegex, getCharacterMatchTerms } from '../domain/characters';

interface ChapterOption {
    id: string;
    title: string;
    volumeTitle: string;
    summary: string;
    content: string;
}

interface BrainstormResponse {
    selectedChapterIds?: string;
    contextSnapshot?: string;
    generatedOptions?: string;
    selectedOptionId?: string | null;
    finalContent?: string;
    updatedAt?: string;
}

const EMPTY_PLANNING: StoryPlanning = {
    storySummary: '',
    storyBackground: '',
    chapterSummaries: [],
    plotSettings: [],
};

const EMPTY_WORKSPACE: BrainstormWorkspace = {
    selectedChapterIds: [],
    contextSnapshot: {},
    generatedOptions: [],
    selectedOptionId: null,
    finalContent: '',
};

const parseJsonSafe = <T,>(value: any, fallback: T): T => {
    if (!value) return fallback;
    if (typeof value !== 'string') return value as T;
    try {
        return JSON.parse(value) as T;
    } catch (error) {
        return fallback;
    }
};

const normalizeWorkspace = (data?: BrainstormResponse | null): BrainstormWorkspace => ({
    selectedChapterIds: parseJsonSafe<string[]>(data?.selectedChapterIds, []),
    contextSnapshot: parseJsonSafe<any>(data?.contextSnapshot, {}),
    generatedOptions: parseJsonSafe<BrainstormOption[]>(data?.generatedOptions, []),
    selectedOptionId: data?.selectedOptionId || null,
    finalContent: data?.finalContent || '',
    updatedAt: data?.updatedAt ? new Date(data.updatedAt).getTime() : undefined,
});

const extractContentSignals = (content: string) => {
    const ids = new Set<string>();
    const textParts: string[] = [];

    const visit = (node: any) => {
        if (!node) return;
        if (node.type === 'mention' && node.attrs?.id) {
            ids.add(String(node.attrs.id));
            if (node.attrs.label) textParts.push(String(node.attrs.label));
            return;
        }
        if (node.type === 'text' && node.text) {
            textParts.push(String(node.text));
        }
        if (Array.isArray(node.content)) {
            node.content.forEach(visit);
        }
    };

    try {
        visit(JSON.parse(content));
    } catch (error) {
        if (typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(content || '', 'text/html');
            doc.body.querySelectorAll('[data-id]').forEach(element => {
                const id = element.getAttribute('data-id');
                if (id) ids.add(id);
            });
            textParts.push(doc.body.textContent || '');
        } else {
            textParts.push((content || '').replace(/<[^>]+>/g, ' '));
        }
    }

    return { ids, text: textParts.join('') };
};

const getMentionedCharacterIds = (
    content: string,
    allCharacters: Character[],
    autoHighlightCharacters: Character[]
) => {
    const { ids, text } = extractContentSignals(content);
    if (!text) return ids;

    getCharacterMatchTerms(autoHighlightCharacters).forEach(term => {
        const pattern = new RegExp(escapeRegex(term.text), 'g');
        if (pattern.test(text)) {
            ids.add(term.character.id);
        }
    });

    const validCharacterIds = new Set(allCharacters.map(character => character.id));
    Array.from(ids).forEach(id => {
        if (!validCharacterIds.has(id)) ids.delete(id);
    });

    return ids;
};

const formatOptionAsEditableText = (option: BrainstormOption) => (
    `${option.title}\n\nConflict / Hook:\n${option.conflict}\n\nCharacter Motivation:\n${option.motivation}\n\nPotential Consequences:\n${option.consequences}\n\nDevelopment Plan:\n${option.development}`
);

const AiBrainstorm: React.FC = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { getBook, fetchStoryPlanning, fetchGraphData, autoHighlightSettings } = useApp();
    const book = getBook(bookId || '');

    const [planning, setPlanning] = useState<StoryPlanning>(EMPTY_PLANNING);
    const [workspace, setWorkspace] = useState<BrainstormWorkspace>(EMPTY_WORKSPACE);
    const [selectedChapterIds, setSelectedChapterIds] = useState<string[]>([]);
    const [relationships, setRelationships] = useState<Array<{ source: string; target: string; label: string }>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
    const [errorMessage, setErrorMessage] = useState('');

    const chapterOptions = useMemo<ChapterOption[]>(() => {
        if (!book) return [];
        const summaryMap = new Map(planning.chapterSummaries.map(item => [item.chapterId, item.summary]));
        return book.volumes.flatMap(volume => (
            volume.chapters.map((chapter: Chapter) => ({
                id: chapter.id,
                title: chapter.title,
                volumeTitle: volume.title,
                summary: summaryMap.get(chapter.id) || '',
                content: chapter.content || '',
            }))
        ));
    }, [book, planning.chapterSummaries]);

    const selectedChapters = useMemo(
        () => chapterOptions.filter(chapter => selectedChapterIds.includes(chapter.id)),
        [chapterOptions, selectedChapterIds]
    );

    const autoHighlightCharacters = useMemo(() => {
        const disabledRoles = new Set(autoHighlightSettings.disabledRoles);
        return (book?.characters || []).filter(character => !disabledRoles.has(character.role));
    }, [book?.characters, autoHighlightSettings.disabledRoles]);

    const mentionedCharacterIds = useMemo(() => {
        const ids = new Set<string>();
        const allCharacters = book?.characters || [];
        selectedChapters.forEach(chapter => {
            getMentionedCharacterIds(chapter.content, allCharacters, autoHighlightCharacters).forEach(id => ids.add(id));
        });
        return ids;
    }, [book?.characters, autoHighlightCharacters, selectedChapters]);

    const mentionedCharacters = useMemo(
        () => (book?.characters || []).filter((character: Character) => mentionedCharacterIds.has(character.id)),
        [book?.characters, mentionedCharacterIds]
    );

    const missingSummaryChapters = selectedChapters.filter(chapter => !chapter.summary.trim());
    const selectedOption = workspace.generatedOptions.find(option => option.id === workspace.selectedOptionId) || null;
    const visibleOptions = workspace.selectedOptionId
        ? workspace.generatedOptions.filter(option => option.id === workspace.selectedOptionId)
        : workspace.generatedOptions;

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            if (!bookId) return;
            setIsLoading(true);
            const [loadedPlanning, brainstormData, graphData] = await Promise.all([
                fetchStoryPlanning(bookId),
                apiClient.get(`/books/${bookId}/brainstorm`) as Promise<BrainstormResponse>,
                fetchGraphData(bookId),
            ]);
            if (!isMounted) return;

            const loadedWorkspace = normalizeWorkspace(brainstormData);
            const chapterParam = searchParams.get('chapterId');
            const initialChapterIds = chapterParam
                ? [chapterParam]
                : loadedWorkspace.selectedChapterIds;

            setPlanning(loadedPlanning);
            setWorkspace(loadedWorkspace);
            setSelectedChapterIds(initialChapterIds);
            setRelationships(buildRelationships(graphData, book?.characters || []));
            setSaveState('idle');
            setIsLoading(false);
        };

        void load();
        return () => { isMounted = false; };
    }, [bookId]);

    const buildContextSnapshot = () => {
        const characterNameById = new Map((book?.characters || []).map(character => [character.id, character.name]));
        const selectedCharacterIds = new Set(mentionedCharacters.map(character => character.id));
        const relatedRelationships = relationships.filter(item => (
            selectedCharacterIds.has(item.source) && selectedCharacterIds.has(item.target)
        ));

        return {
            bookTitle: book?.title || '',
            storySummary: planning.storySummary,
            storyBackground: planning.storyBackground,
            selectedChapters: selectedChapters.map(chapter => ({
                id: chapter.id,
                title: chapter.title,
                volumeTitle: chapter.volumeTitle,
                summary: chapter.summary,
            })),
            missingSummaryChapterTitles: missingSummaryChapters.map(chapter => chapter.title),
            appearingCharacters: mentionedCharacters.map(character => ({
                id: character.id,
                name: character.name,
                role: character.role,
                tags: character.tags,
                biographyAndNotes: character.description,
            })),
            relationships: relatedRelationships.map(item => ({
                source: characterNameById.get(item.source) || item.source,
                target: characterNameById.get(item.target) || item.target,
                label: item.label,
            })),
            outputGoal: 'Give three moderately detailed alternative next-plot directions with conflict hook, character motivation, potential consequences, and an editable development plan.',
        };
    };

    const toggleChapter = (chapterId: string) => {
        setSelectedChapterIds(prev => (
            prev.includes(chapterId)
                ? prev.filter(id => id !== chapterId)
                : [...prev, chapterId]
        ));
        setSaveState('dirty');
    };

    const handleGenerate = async () => {
        if (!bookId || selectedChapterIds.length === 0) {
            setErrorMessage('Select at least one chapter before brainstorming.');
            return;
        }

        setIsGenerating(true);
        setErrorMessage('');
        const contextSnapshot = buildContextSnapshot();
        try {
            const response = await apiClient.post(`/books/${bookId}/brainstorm/generate`, {
                selectedChapterIds,
                contextSnapshot,
            }, { timeout: 60000 }) as BrainstormResponse;
            const nextWorkspace = normalizeWorkspace(response);
            setWorkspace(nextWorkspace);
            setSelectedChapterIds(nextWorkspace.selectedChapterIds);
            setSaveState('saved');
        } catch (error) {
            console.error('AI brainstorm failed:', error);
            setErrorMessage('AI brainstorm failed. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const chooseOption = (option: BrainstormOption) => {
        setWorkspace(prev => ({
            ...prev,
            selectedOptionId: option.id,
            finalContent: formatOptionAsEditableText(option),
        }));
        setSaveState('dirty');
    };

    const showAllOptions = () => {
        setWorkspace(prev => ({ ...prev, selectedOptionId: null }));
        setSaveState('dirty');
    };

    const updateFinalContent = (value: string) => {
        setWorkspace(prev => ({ ...prev, finalContent: value }));
        setSaveState('dirty');
    };

    const handleSave = async () => {
        if (!bookId) return;
        setIsSaving(true);
        setErrorMessage('');
        const payload = {
            selectedChapterIds: JSON.stringify(selectedChapterIds),
            contextSnapshot: JSON.stringify(workspace.contextSnapshot || buildContextSnapshot()),
            generatedOptions: JSON.stringify(workspace.generatedOptions),
            selectedOptionId: workspace.selectedOptionId || null,
            finalContent: workspace.finalContent,
        };

        try {
            const response = await apiClient.put(`/books/${bookId}/brainstorm`, payload) as BrainstormResponse;
            setWorkspace(normalizeWorkspace(response));
            setSaveState('saved');
            window.setTimeout(() => setSaveState('idle'), 1600);
        } catch (error) {
            console.error('Save brainstorm failed:', error);
            setErrorMessage('Save failed. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!book) {
        return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Book not found</div>;
    }

    return (
        <div className="h-screen flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 flex-shrink-0">
                <div className="flex items-center gap-4 min-w-0">
                    <button
                        onClick={() => navigate(`/books/${bookId}/story-outline`)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="font-bold text-lg text-slate-900 dark:text-white truncate">AI Brainstorm</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{book.title}</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                    <div className="flex min-w-28 justify-end">
                        {saveState === 'dirty' && <span className="text-xs font-medium text-amber-600 dark:text-amber-300">Unsaved changes</span>}
                        {saveState === 'saved' && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-300">
                                <CheckCircle2 size={14} />
                                Saved
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button onClick={handleSave} disabled={isSaving || isLoading} icon={isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}>
                            {isSaving ? 'Saving...' : 'Save Result'}
                        </Button>
                        <Button variant="secondary" onClick={handleGenerate} disabled={isGenerating || isLoading} icon={isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}>
                            {isGenerating ? 'Brainstorming...' : 'Regenerate'}
                        </Button>
                    </div>
                </div>
            </header>

            {isLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                    <Loader2 size={22} className="animate-spin mr-2" />
                    Loading brainstorm workspace...
                </div>
            ) : (
                <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[340px_minmax(520px,1fr)_340px] overflow-hidden">
                    <aside className="min-h-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <BrainCircuit size={15} />
                                Brainstorm Context
                            </div>
                            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                                Select the chapters that should guide the next plot direction.
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-2">
                            {chapterOptions.map(chapter => {
                                const selected = selectedChapterIds.includes(chapter.id);
                                const missingSummary = !chapter.summary.trim();
                                return (
                                    <button
                                        key={chapter.id}
                                        onClick={() => toggleChapter(chapter.id)}
                                        className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                                            selected
                                                ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-slate-800'
                                                : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                                                selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-700'
                                            }`}>
                                                {selected && <CheckCircle2 size={12} />}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{chapter.title}</span>
                                                <span className="block truncate text-xs text-slate-400">{chapter.volumeTitle}</span>
                                                {missingSummary && <span className="mt-1 block text-[11px] text-amber-600 dark:text-amber-300">Missing summary</span>}
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>

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
                                    <Button onClick={handleGenerate} disabled={isGenerating || selectedChapterIds.length === 0} icon={isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}>
                                        {isGenerating ? 'Generating...' : 'AI Brainstorm'}
                                    </Button>
                                </div>

                                {missingSummaryChapters.length > 0 && (
                                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                                        Some selected chapters do not have plot summaries yet. Add chapter summaries first, otherwise the brainstorm may be less relevant.
                                    </div>
                                )}
                                {errorMessage && (
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

                            {visibleOptions.length === 0 ? (
                                <section className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
                                    <BrainCircuit size={34} className="mx-auto mb-4 text-slate-300 dark:text-slate-600" />
                                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">No brainstorm yet</h3>
                                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Select chapters, then generate three possible next directions.</p>
                                </section>
                            ) : (
                                <div className="grid grid-cols-1 gap-4">
                                    {visibleOptions.map(option => (
                                        <article key={option.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div>
                                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{option.title}</h3>
                                                    {workspace.selectedOptionId === option.id && (
                                                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                                                            <CheckCircle2 size={13} />
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                                {!workspace.selectedOptionId ? (
                                                    <Button size="sm" onClick={() => chooseOption(option)}>Choose Direction</Button>
                                                ) : (
                                                    <Button variant="secondary" size="sm" onClick={showAllOptions}>Show All Options</Button>
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
                            )}

                            {workspace.selectedOptionId && (
                                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Editable Result</h3>
                                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                        This is the selected direction. Edit it freely, then save it as the working brainstorm result.
                                    </p>
                                    <textarea
                                        value={workspace.finalContent}
                                        onChange={(event) => updateFinalContent(event.target.value)}
                                        className="mt-4 min-h-80 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-500"
                                    />
                                </section>
                            )}
                        </div>
                    </main>

                    <aside className="min-h-0 bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 overflow-y-auto p-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                <Users size={15} />
                                Appearing Characters
                            </div>
                            {mentionedCharacters.length === 0 ? (
                                <p className="mt-4 text-sm leading-6 text-slate-500 dark:text-slate-400">No highlighted characters found in the selected chapters.</p>
                            ) : (
                                <div className="mt-4 space-y-3">
                                    {mentionedCharacters.map(character => (
                                        <div key={character.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                                            <div className="flex items-center gap-2">
                                                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: character.color }} />
                                                <span className="font-semibold text-slate-900 dark:text-white">{character.name}</span>
                                            </div>
                                            <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">{character.role}</p>
                                            {character.tags.length > 0 && (
                                                <div className="mt-2 flex flex-wrap gap-1.5">
                                                    {character.tags.map(tag => (
                                                        <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{tag}</span>
                                                    ))}
                                                </div>
                                            )}
                                            {character.description && <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{character.description}</p>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            )}
        </div>
    );
};

const InfoBlock: React.FC<{ title: string; value: string }> = ({ title, value }) => (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700 dark:text-slate-200">{value}</p>
    </div>
);

const buildRelationships = (graphData: any, characters: Character[]) => {
    const characterByNodeKey = new Map<string, string>();
    const validCharacterIds = new Set(characters.map(character => character.id));

    (graphData?.nodes || []).forEach((node: any) => {
        const nodeKey = String(node.nodeKey || node.id || '');
        const characterId = String(node.characterId || node.data?.id || node.id || '');
        if (nodeKey && validCharacterIds.has(characterId)) {
            characterByNodeKey.set(nodeKey, characterId);
        }
    });

    return (graphData?.edges || [])
        .map((edge: any) => {
            const sourceKey = String(edge.sourceNodeKey || edge.source || '');
            const targetKey = String(edge.targetNodeKey || edge.target || '');
            return {
                source: characterByNodeKey.get(sourceKey) || sourceKey,
                target: characterByNodeKey.get(targetKey) || targetKey,
                label: edge.label || '',
            };
        })
        .filter((edge: { source: string; target: string }) => edge.source && edge.target);
};

export default AiBrainstorm;
