import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, ChevronDown, CircleHelp, FileCheck2, Lightbulb, Network, Search, Sparkles, X } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { HELP_QUESTION_COUNT, HELP_SECTIONS, searchHelp } from '../features/help/helpContent';

const sectionIcons = [BookOpen, Search, Sparkles, Lightbulb, Network, FileCheck2];

export default function Help() {
    const navigate = useNavigate();
    const location = useLocation();
    const settingsReturnTo = typeof location.state?.settingsReturnTo === 'string' && location.state.settingsReturnTo.startsWith('/')
        ? location.state.settingsReturnTo : '/dashboard';
    const [activeSection, setActiveSection] = useState(HELP_SECTIONS[0].id);
    const [query, setQuery] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const contentRef = useRef<HTMLDivElement>(null);
    const searching = query.trim().length > 0;
    const sections = searching ? searchHelp(query) : HELP_SECTIONS.filter(section => section.id === activeSection);
    const visibleQuestions = sections.flatMap(section => section.questions);
    const allExpanded = visibleQuestions.length > 0 && visibleQuestions.every(item => expanded.has(item.id));

    const toggleQuestion = (id: string) => setExpanded(previous => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
    });
    const toggleAll = () => setExpanded(previous => {
        const next = new Set(previous);
        visibleQuestions.forEach(item => { if (allExpanded) next.delete(item.id); else next.add(item.id); });
        return next;
    });
    const selectSection = (id: string) => {
        setActiveSection(id);
        setQuery('');
        // Bring the question list into view after switching, especially on small screens.
        window.requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: 'start' }));
    };

    return <div className="flex h-screen min-h-0 flex-col bg-slate-50 text-slate-900 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
        <header className="z-20 shrink-0 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 sm:px-6">
            <div className="mx-auto flex max-w-6xl items-center gap-3">
                <button
                    type="button"
                    onClick={() => navigate('/settings', { state: { returnTo: settingsReturnTo } })}
                    aria-label="Back to Settings"
                    title="Back to Settings"
                    className="shrink-0 rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                ><ArrowLeft size={20} aria-hidden="true" /></button>
                <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-brand-300">StoryArk Guide</p>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Help</h1>
                </div>
                <CircleHelp size={24} aria-hidden="true" className="ml-auto shrink-0 text-brand-600 dark:text-brand-300" />
            </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto" aria-label="StoryArk help">
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
                <Card className="mb-6 bg-gradient-to-br from-brand-50 via-white to-slate-100 p-5 dark:from-slate-900 dark:via-slate-950 dark:to-brand-950/40 sm:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">A little help for your writing workflow.</h2>
                            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-400">Explore {HELP_SECTIONS.length} topics and {HELP_QUESTION_COUNT} answers. Choose a topic or search, then open a question to read more.</p>
                        </div>
                        <div className="w-full lg:max-w-sm">
                            <label htmlFor="help-search" className="sr-only">Search help</label>
                            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900">
                                <Search size={18} aria-hidden="true" className="shrink-0 text-slate-400" />
                                <input id="help-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search questions and answers"
                                    className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500 [&::-webkit-search-cancel-button]:appearance-none" />
                                {query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}
                                    className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"><X size={16} aria-hidden="true" /></button>}
                            </div>
                        </div>
                    </div>
                </Card>

                <div className="grid min-w-0 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
                        <nav aria-label="Help topics" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
                            {HELP_SECTIONS.map((section, index) => {
                                const Icon = sectionIcons[index];
                                const selected = !searching && section.id === activeSection;
                                return <button key={section.id} type="button" onClick={() => selectSection(section.id)} aria-current={selected ? 'true' : undefined}
                                    className={`flex min-w-0 items-start gap-2.5 rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${selected
                                        ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200'
                                        : 'border-slate-200 bg-white/80 text-slate-600 hover:border-brand-200 hover:bg-brand-50/60 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 dark:hover:border-brand-800 dark:hover:bg-slate-900'}`}>
                                    <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
                                    <span className="min-w-0"><span className="block text-sm font-semibold leading-5">{section.title}</span><span className="mt-1 block text-xs opacity-75">{section.questions.length} questions</span></span>
                                </button>;
                            })}
                        </nav>
                    </aside>

                    <div ref={contentRef} className="min-w-0 scroll-mt-6">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <p role="status" className="text-sm text-slate-500 dark:text-slate-400">{searching ? `${visibleQuestions.length} ${visibleQuestions.length === 1 ? 'answer' : 'answers'} found across all topics` : `${visibleQuestions.length} questions in this topic`}</p>
                            {visibleQuestions.length > 0 && <Button variant="ghost" size="sm" onClick={toggleAll}>{allExpanded ? 'Collapse all' : 'Expand all'}</Button>}
                        </div>
                        {sections.length === 0 ? <Card className="py-10 text-center">
                            <Search size={28} aria-hidden="true" className="mx-auto mb-3 text-slate-400" />
                            <h2 className="text-lg font-semibold">No answers found</h2>
                            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">Try a shorter phrase, such as “character”, “search” or “save”.</p>
                            <Button variant="secondary" size="sm" className="mt-4" onClick={() => setQuery('')}>Clear search</Button>
                        </Card> : <div className="space-y-8">
                            {sections.map(section => <section key={section.id} aria-labelledby={`help-topic-${section.id}`}>
                                <div className="mb-4">
                                    <h2 id={`help-topic-${section.id}`} className="text-xl font-semibold tracking-tight">{section.title}</h2>
                                    <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{section.description}</p>
                                </div>
                                <div className="space-y-3">
                                    {section.questions.map(item => {
                                        const open = expanded.has(item.id);
                                        return <Card key={item.id} className="overflow-hidden rounded-xl p-0">
                                            <h3>
                                                <button id={item.id} type="button" aria-expanded={open} aria-controls={`${item.id}-answer`} onClick={() => toggleQuestion(item.id)}
                                                    className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left text-sm font-semibold leading-6 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 dark:hover:bg-slate-800/60 sm:px-5">
                                                    <span>{item.question}</span><ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-slate-400 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
                                                </button>
                                            </h3>
                                            <div id={`${item.id}-answer`} aria-labelledby={item.id} hidden={!open} className="border-t border-slate-100 px-4 pb-5 pt-4 text-sm leading-7 text-slate-600 dark:border-slate-800 dark:text-slate-300 sm:px-5">
                                                <p className="whitespace-pre-line break-words">{item.answer}</p>
                                            </div>
                                        </Card>;
                                    })}
                                </div>
                            </section>)}
                        </div>}
                    </div>
                </div>
            </div>
        </main>
    </div>;
}
