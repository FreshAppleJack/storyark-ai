import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Wand2, Save, Loader2, PanelLeftClose, PanelLeftOpen, CheckCircle2, HistoryIcon } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useBooks } from '../InteractionContent/BooksContext';
import { usePreferences } from '../InteractionContent/PreferencesContext';
import { useRelationshipGraph } from '../features/relationships/hooks/useRelationshipGraph';
import { RelationshipCanvas } from '../features/relationships/components/RelationshipCanvas';
import { CharacterPalette } from '../features/relationships/components/CharacterPalette';
function RelationshipMapContent({ bookId }: { bookId: string }) {
    const navigate = useNavigate();
    const { getBook } = useBooks();
    const { isDarkMode } = usePreferences();
    const book = getBook(bookId);
    const graph = useRelationshipGraph(bookId, book);
    const { isSaving, isGraphLoaded, lastSaved, handleSave, onLayout } = graph;
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    if (!book) return <div className="p-8 text-slate-500">Book not found</div>;
    return (
        <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 z-10 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
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
                            <><CheckCircle2 size={14} className="text-emerald-500" /><span className="text-slate-400">Saved</span></>
                        ) : null}
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
            {graph.loadError ? (
                <div role="alert" className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-500">
                    <p>Could not load the relationship map. Retry before editing.</p>
                    <Button onClick={graph.retry}>Retry</Button>
                </div>
            ) : !isGraphLoaded ? (
                <div role="status" className="flex-1 flex items-center justify-center text-slate-500">Loading relationship map...</div>
            ) : (
                <div className="flex-1 flex overflow-hidden">
                    <CharacterPalette characters={book.characters} isSidebarOpen={isSidebarOpen} />
                    <RelationshipCanvas {...graph} isDarkMode={isDarkMode} />
                </div>
            )}
        </div>
    );
}
export default function RelationshipMap() {
    const { bookId = '' } = useParams();
    return <ReactFlowProvider key={bookId}><RelationshipMapContent bookId={bookId} /></ReactFlowProvider>;
}
