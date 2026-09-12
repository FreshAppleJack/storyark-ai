import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Wand2, Save, Loader2, PanelLeftClose, PanelLeftOpen, CheckCircle2, HistoryIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { localBookOptions, localCharactersOptions, projectBook, projectCharacter } from '../data/local/repository';
import { graphRepository, localGraphOptions, localGraphKey, type LocalGraph } from '../data/local/graphRepository';
import type { Book } from '../types';
import { useLocalGraphPersistence } from '../features/relationships/hooks/useLocalGraphPersistence';
import { useGraphSaveGuards } from '../features/relationships/hooks/useGraphSaveGuards';
import { usePreferences } from '../InteractionContent/PreferencesContext';
import { useRelationshipGraph } from '../features/relationships/hooks/useRelationshipGraph';
import { RelationshipCanvas } from '../features/relationships/components/RelationshipCanvas';
import { CharacterPalette } from '../features/relationships/components/CharacterPalette';
function RelationshipMapContent({ bookId, book, initial }: { bookId: string; book: Book; initial: LocalGraph }) {
    const navigate = useNavigate();

    const { isDarkMode } = usePreferences();
    const persistence = useLocalGraphPersistence(initial, book.characters);
    const graph = useRelationshipGraph(bookId, book, persistence);
    useGraphSaveGuards(graph.isDirty, graph.flush);
    const { isSaving, isGraphLoaded, lastSaved, handleSave, onLayout } = graph;
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    if (!book) return <div className="p-8 text-slate-500">Book not found</div>;
    return (
        <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 z-10 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <button aria-label="Back to editor" onClick={() => navigate(`/editor/${bookId}`)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 flex items-center gap-2 transition-colors"
                        title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
                    >
                        {isSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
                    </button>
                    <h1 className="font-bold text-lg text-slate-800 dark:text-white">
                        Relationship Map:《{book.title}》
                    </h1>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-xs font-medium transition-colors duration-300 min-w-[80px] justify-end">
                        {isSaving ? (
                            <><HistoryIcon size={14} className="text-brand-500 animate-spin" /><span className="text-brand-600">Saving...</span></>
                        ) : lastSaved ? (
                            <><CheckCircle2 size={14} className="text-emerald-500" /><span className="text-slate-400">Saved locally</span></>
                        ) : graph.isDirty ? <span>Unsaved changes</span> : null}
                    </div>

                    <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />

                    <Button size="sm" variant="secondary" disabled={!isGraphLoaded} onClick={() => onLayout('TB')}>
                        <Wand2 size={14} className="mr-2 text-brand-600" />
                        Auto-Layout
                    </Button>

                    <Button size="sm" onClick={handleSave} disabled={isSaving || !isGraphLoaded}>
                        {isSaving ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
                        Save
                    </Button>
                </div>
            </header>
            {graph.saveError && <p role="alert" className="px-4 py-2 text-red-600">{graph.saveError} Use Save to retry. For a version conflict, copy needed information before reloading.</p>}
            {graph.loadError ? (
                <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
                    <p>Could not load the relationship map. Retry before editing.</p>
                    <Button onClick={graph.retry}>Retry</Button>
                </div>
            ) : !isGraphLoaded ? (
                <div role="status" className="flex-1 flex items-center justify-center text-slate-500">Loading relationship map...</div>
            ) : (
                <div className="flex-1 flex overflow-hidden">
                    <CharacterPalette characters={book.characters.filter(character => !character.isArchived)} isSidebarOpen={isSidebarOpen} />
                    <RelationshipCanvas {...graph} isDarkMode={isDarkMode} />
                </div>
            )}
        </div>
    );
}
function LocalGraphRoute({ bookId }: { bookId: string }) {
    const client = useQueryClient();
    const detail = useQuery(localBookOptions(bookId));
    const characters = useQuery(localCharactersOptions(bookId));
    const graph = useQuery(localGraphOptions(bookId));
    const [initializing, setInitializing] = useState(false);
    const [initializationError, setInitializationError] = useState<string | null>(null);
    const book = useMemo(() => detail.data && characters.data
        ? projectBook(detail.data.book, detail.data, characters.data.map(projectCharacter)) : undefined,
        [detail.data, characters.data]);
    const error = detail.error ?? characters.error ?? graph.error;
    const initialize = async () => {
        setInitializing(true);
        setInitializationError(null);
        try { client.setQueryData(localGraphKey(bookId), await graphRepository.initialize(bookId)); }
        catch (error) { setInitializationError(error instanceof Error ? error.message : 'Graph initialization failed.'); }
        finally { setInitializing(false); }
    };
    if (error || !book || graph.isPending || graph.isFetching) return <main className="p-8 space-y-4">
        <p role={error ? 'alert' : 'status'}>{error?.message ?? 'Loading local relationship map...'}</p>
        {error && <Button onClick={() => { void detail.refetch(); void characters.refetch(); void graph.refetch(); }}>Retry</Button>}
        <Link to={`/editor/${bookId}`}>Back to editor</Link>
    </main>;
    if (!graph.data) return <main className="p-8 space-y-4">
        <h1>Relationship Map: {book.title}</h1>
        <p>Create an empty map, then drag characters from the palette. Saved empty maps stay empty.</p>
        {initializationError && <p role="alert">{initializationError}</p>}
        <Button disabled={initializing} onClick={() => { void initialize(); }}>Create relationship map</Button>
        <Link to={`/editor/${bookId}`}>Back to editor</Link>
    </main>;
    return <RelationshipMapContent bookId={bookId} book={book} initial={graph.data} />;
}
export default function RelationshipMap() {
    const { bookId = '' } = useParams();
    return <ReactFlowProvider key={bookId}><LocalGraphRoute bookId={bookId} /></ReactFlowProvider>;
}
