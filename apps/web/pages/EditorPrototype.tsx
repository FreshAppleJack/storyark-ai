import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useBlocker, NavigateOptions } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useApp } from '../InteractionContent/AppContext';
import apiClient from '../services/api';
import TiptapEditor, { TiptapEditorRef } from '../components/TiptapEditor';
import { Chapter, ForeshadowingNote, PlotSetting, Volume } from '../types';
import { ChapterNavigator, NavigatorDeleteTarget } from '../features/editor/components/ChapterNavigator';
import { EditorHeader } from '../features/editor/components/EditorHeader';
import { WritingContextPanel } from '../features/editor/components/WritingContextPanel';
import { getEditorPlainText, getForeshadowingExcerptMap } from '../domain/chapterContent';
import { useChapterDraft } from '../features/editor/hooks/useChapterDraft';
import { useChapterAutosave } from '../features/editor/hooks/useChapterAutosave';
import { useAiContinue } from '../features/editor/hooks/useAiContinue';
import { useChapterExport } from '../features/editor/export/useChapterExport';

function Editor(): React.ReactElement {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const {
        getBook, updateChapterContent, createVolume, createChapter,
        updateVolume, deleteVolume, deleteChapter,
        reorderVolumes, reorderChapters, toggleChapterLock,
        editorSpacingSettings, aiContinueSettings, autoHighlightSettings, fetchStoryPlanning
    } = useApp();

    const book = getBook(bookId || '');
    const autoHighlightCharacters = useMemo(() => {
        const disabledRoles = new Set(autoHighlightSettings.disabledRoles);
        return (book?.characters || []).filter(character => !disabledRoles.has(character.role));
    }, [book?.characters, autoHighlightSettings.disabledRoles]);

    // 1. State Initialization
    const [activeChapterId, setActiveChapterId] = useState<string>('');

    // 2. Find current active volume and chapter
    let activeVolume = book?.volumes.find(v => v.chapters.some(c => c.id === activeChapterId));
    let activeChapter = activeVolume?.chapters.find(c => c.id === activeChapterId);

    // 3. State Management
    // The chapter draft (values + revision + dirty tracking) lives in a hook;
    // this page only keeps UI state and the save lifecycle.
    const chapterDraft = useChapterDraft({ bookId, volumeId: activeVolume?.id, chapterId: activeChapterId, chapter: activeChapter });
    const [plotSettings, setPlotSettings] = useState<PlotSetting[]>([]);
    const [activeForeshadowingId, setActiveForeshadowingId] = useState<string | null>(null);
    const [isForeshadowingPanelOpen, setIsForeshadowingPanelOpen] = useState(false);

    const editorRef = useRef<TiptapEditorRef>(null);

    const { isExporting, runExport } = useChapterExport({
        getSnapshot: () => activeChapter && editorRef.current
            ? { title: chapterDraft.title, editorHtml: editorRef.current.getHTML() }
            : null,
        onError: (format, error) => {
            console.error(`${format.toUpperCase()} export failed:`, error);
            toast.error(`${format === 'docx' ? 'Word' : 'PDF'} export failed. Please try again.`);
        },
    });

    // AI continuation with chapter-switch protection: results arriving after
    // a switch are dropped, and a stale request never clears a newer one.
    const aiContinue = useAiContinue({
        chapterId: activeChapterId,
        isReadOnly: chapterDraft.isReadOnly,
        hasContent: !!chapterDraft.content,
        contextChars: aiContinueSettings.contextChars,
        outputChars: aiContinueSettings.outputChars,
        getContextText: () => {
            if (editorRef.current && editorRef.current.editor) {
                return editorRef.current.editor.getText();
            }
            return getEditorPlainText(chapterDraft.content);
        },
        requestContinue: async (payload) => {
            const response = await apiClient.post('/ai/continue', payload);
            return (response as any).result;
        },
        insertResult: (formattedHtml) => {
            const editor = editorRef.current?.editor;
            // The hook pins the chapter identity; this only guards a lock
            // toggled while the request was in flight.
            if (editor && editor.isEditable !== false) {
                editorRef.current?.insertContent(formattedHtml);
            }
        },
        onError: () => toast.error('AI continue failed. Please try again.'),
    });

    // Save scheduler: debounce, serial saves, flush and retry all go through
    // this single entry — no page-level timers or save status state.
    const autosave = useChapterAutosave({
        chapterId: activeChapter ? activeChapterId : '',
        sessionKey: chapterDraft.sessionKey,
        revision: chapterDraft.revision,
        getSnapshot: chapterDraft.getSnapshot,
        markSaved: chapterDraft.markSaved,
        saveChapter: (snapshot) => {
            if (!snapshot.bookId || !snapshot.volumeId || !snapshot.chapterId) return Promise.resolve(false);
            return updateChapterContent(snapshot.bookId, snapshot.volumeId, snapshot.chapterId, snapshot.title, snapshot.content, snapshot.wordCount, snapshot.foreshadowings);
        },
    });

    const blocker = useBlocker(chapterDraft.isDirty);
    const { flush } = autosave;
    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        let cancelled = false;
        void flush().then(ok => {
            if (cancelled) return;
            if (ok) blocker.proceed();
            else blocker.reset();
        });
        return () => { cancelled = true; };
    }, [blocker, flush]);

    // Reset the panel selection when the active chapter changes (adjust-during-render).
    const [prevChapterId, setPrevChapterId] = useState(activeChapterId);
    if (prevChapterId !== activeChapterId) {
        setPrevChapterId(activeChapterId);
        setActiveForeshadowingId(null);
    }

    const foreshadowingExcerptMap = useMemo(() => getForeshadowingExcerptMap(chapterDraft.content, 120), [chapterDraft.content]);
    const linkedPlotSettings = useMemo(
        () => plotSettings.filter(plot => plot.chapterIds.includes(activeChapterId)),
        [plotSettings, activeChapterId]
    );
    const contextPanelItemCount = chapterDraft.foreshadowings.length + linkedPlotSettings.length;

    // Redirect if book not found
    // Prevent users from editing deleted books
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!book && bookId) {
                // display error page
                toast.error('Book not found and loading failed...');
                navigate('/dashboard');
            }
        }, 1500);

        return () => clearTimeout(timer);
    }, [book, bookId, navigate]);

    // Restore last viewed chapter
    useEffect(() => {
        if (book?.volumes) {
            const savedChapterId = localStorage.getItem(`lastActiveChapter_${bookId}`);
            let targetChapterId = '';
            const isSavedIdValid = savedChapterId && book.volumes.some(v => v.chapters.some(c => c.id === savedChapterId));

            if (isSavedIdValid) {
                targetChapterId = savedChapterId!;
            } else if (book.volumes.length > 0 && book.volumes[0].chapters.length > 0) {
                targetChapterId = book.volumes[0].chapters[0].id;
            }

            if (targetChapterId && !activeChapterId) {
                // Initial load: the draft is still empty, so no flush is needed.
                setActiveChapterId(targetChapterId);
            }
        }
    }, [book, bookId]);

    // Listen for chapter switch
    useEffect(() => {
        if (activeChapterId && bookId) {
            localStorage.setItem(`lastActiveChapter_${bookId}`, activeChapterId);
        }
    }, [activeChapterId, bookId]);

    useEffect(() => {
        let isMounted = true;
        const loadPlotSettings = async () => {
            if (!bookId) return;
            const planning = await fetchStoryPlanning(bookId);
            if (!isMounted) return;
            if (!planning) {
                setPlotSettings([]);
                toast.error('Could not load plot settings. Reopen the book to retry.');
                return;
            }
            setPlotSettings(planning.plotSettings);
        };

        void loadPlotSettings();
        return () => { isMounted = false; };
    }, [bookId]);

    // Backup safety-net: when the character list reference changes (e.g. user
    // came back from /books/:bookId/settings after editing colors / renaming),
    // explicitly poke the editor to refresh highlights.
    //
    // The TiptapEditor itself already self-heals via an internal effect that
    // reacts to its `characters` prop, but we keep this here as a defensive
    // double-tap. It is idempotent (the AutoHighlight plugin only modifies
    // the doc if it actually finds drift) so the extra call costs nothing.
    const prevCharactersStrRef = useRef<string | null>(null);
    useEffect(() => {
        const currentChars = book?.characters || [];
        const currentCharsStr = JSON.stringify(
            currentChars.map(c => ({ id: c.id, name: c.name, aliases: c.aliases || [], color: c.color }))
        );

        if (prevCharactersStrRef.current === currentCharsStr) return;
        const isFirst = prevCharactersStrRef.current === null;
        prevCharactersStrRef.current = currentCharsStr;

        // Defer to next microtask so the TiptapEditor's own effect (which is
        // wired to the same data source) goes first, then we double-tap.
        Promise.resolve().then(() => {
            if (editorRef.current) {
                if (typeof window !== 'undefined' && (window as any).__DEBUG_HIGHLIGHTS__) {
                    // eslint-disable-next-line no-console
                    console.log('[EditorPrototype] characters changed -> forceRefreshHighlights', {
                        isFirst,
                        characters: currentChars.map(c => ({ id: c.id, name: c.name, aliases: c.aliases || [], color: c.color })),
                    });
                }
                editorRef.current.forceRefreshHighlights();
            }
        });
    }, [book?.characters]);

    useEffect(() => {
        if (!bookId || !activeChapterId) return;

        const storageKey = `pendingForeshadowingFocus_${bookId}`;
        const pendingValue = localStorage.getItem(storageKey);
        if (!pendingValue) return;

        let pendingTarget: { chapterId?: string; foreshadowingId?: string };
        try {
            pendingTarget = JSON.parse(pendingValue);
        } catch (error) {
            localStorage.removeItem(storageKey);
            return;
        }

        if (
            pendingTarget.chapterId !== activeChapterId ||
            !pendingTarget.foreshadowingId ||
            !chapterDraft.foreshadowings.some(item => item.id === pendingTarget.foreshadowingId)
        ) {
            return;
        }

        setActiveForeshadowingId(pendingTarget.foreshadowingId);
        setIsForeshadowingPanelOpen(true);

        const delays = [160, 420, 800];
        const timers = delays.map(delay => window.setTimeout(() => {
            if (localStorage.getItem(storageKey) !== pendingValue) return;
            const didFocus = editorRef.current?.focusForeshadowing(pendingTarget.foreshadowingId!);
            if (didFocus) {
                localStorage.removeItem(storageKey);
            }
        }, delay));

        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [bookId, activeChapterId, chapterDraft.content, chapterDraft.foreshadowings]);

    // Switching chapters waits until the current draft is fully saved; on
    // failure the user stays on the current chapter (the header shows the
    // error and a retry). Deleting the current chapter bypasses this on
    // purpose — there is nothing left to save.
    const requestChapterSwitch = async (targetChapterId: string) => {
        if (targetChapterId === activeChapterId) return;
        if (chapterDraft.isDirty) {
            const ok = await autosave.flush();
            if (!ok) return;
        }
        setActiveChapterId(targetChapterId);
    };

    // Leaving the editor in-app gets the same protection: flush first,
    // stay on failure.
    const navigateAfterSave = async (to: string, options?: NavigateOptions) => {
        if (chapterDraft.isDirty) {
            const ok = await autosave.flush();
            if (!ok) return;
        }
        navigate(to, options);
    };

    // Handle toggle read only state
    const handleToggleReadOnly = async () => {
        if (!book || !activeVolume || !activeChapter) return;
        const nextReadOnlyState = !chapterDraft.isReadOnly;
        chapterDraft.setReadOnly(nextReadOnlyState);
        await toggleChapterLock(book.id, activeVolume.id, activeChapter.id);
    };

    // --- Editor Interaction Handlers ---
    const handleEditorUpdate = (newContent: string, newWordCount: number) => {
        chapterDraft.applyEditorUpdate(newContent, newWordCount);
    };

    const handleCharacterClick = (charId: string) => {
        void navigateAfterSave(`/books/${bookId}/settings?charId=${charId}`);
    };

    const handleForeshadowingCreate = (note: ForeshadowingNote) => {
        chapterDraft.addForeshadowing(note);
        setActiveForeshadowingId(note.id);
        setIsForeshadowingPanelOpen(true);
    };

    const handleForeshadowingClick = (id: string) => {
        setActiveForeshadowingId(id);
        setIsForeshadowingPanelOpen(true);
    };

    const handleForeshadowingNoteChange = (id: string, noteText: string) => {
        chapterDraft.updateForeshadowingNote(id, noteText, Date.now());
    };

    const handleDeleteForeshadowing = (id: string) => {
        editorRef.current?.removeForeshadowing(id);
        chapterDraft.removeForeshadowing(id);
        setActiveForeshadowingId(prev => prev === id ? null : prev);
    };

    const handleFocusForeshadowing = (id: string) => {
        setActiveForeshadowingId(id);
        editorRef.current?.focusForeshadowing(id);
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        chapterDraft.setTitle(e.target.value);
    };

    // --- Navigator Callbacks (book id binding + draft state live here) ---
    const handleAddVolume = async (volTitle: string): Promise<string | null> => {
        if (!book) return null;
        return await createVolume(book.id, volTitle);
    };

    const handleAddChapter = async (volId: string, chapTitle: string): Promise<string | null> => {
        if (!book) return null;
        const newChapterId = await createChapter(book.id, volId, chapTitle);
        if (newChapterId) {
            await requestChapterSwitch(newChapterId);
        }
        return newChapterId;
    };

    const handleRenameVolume = async (volumeId: string, value: string) => {
        if (!book) return;
        const vol = book.volumes.find(v => v.id === volumeId);
        if (vol && vol.title !== value) await updateVolume(book.id, volumeId, value);
    };

    const handleRenameChapter = async (chapterId: string, value: string) => {
        if (!book) return;
        const volume = book.volumes.find(v => v.chapters.some(c => c.id === chapterId));
        const chapter = volume?.chapters.find(c => c.id === chapterId);
        if (volume && chapter) {
            const isCurrentChapter = activeChapterId === chapterId;
            if (isCurrentChapter) {
                // The active chapter is owned by the draft + scheduler: update
                // the draft only and let the unified entry persist it. This
                // removes the previous direct-PUT + autosave double write.
                if (chapterDraft.title !== value) chapterDraft.setTitle(value);
                return;
            }
            // AppProvider serializes this with every write to the same chapter.
            const ok = await updateChapterContent(book.id, volume.id, chapterId, value, chapter.content || '', chapter.wordCount || 0, chapter.foreshadowings || []);
            if (!ok) {
                toast.error('Failed to save the new title. Please try again.');
            }
        }
    };

    const handleDeleteItem = async (target: NavigatorDeleteTarget) => {
        if (!book) return;
        // Deleting the current chapter discards its draft instead of saving
        // it first — the chapter is gone either way.
        if (target.type === 'volume') {
            if (activeVolume && activeVolume.id === target.id) setActiveChapterId('');
            await deleteVolume(book.id, target.id);
        } else if (target.type === 'chapter' && target.parentId) {
            if (activeChapterId === target.id) setActiveChapterId('');
            await deleteChapter(book.id, target.parentId, target.id);
        }
    };

    const handleReorderVolumes = (volumes: Volume[]) => {
        if (book) reorderVolumes(book.id, volumes);
    };

    const handleReorderChapters = (volumeId: string, chapters: Chapter[]) => {
        if (book) reorderChapters(book.id, volumeId, chapters);
    };

    const handleExportWord = (event: React.MouseEvent) => {
        event.stopPropagation();
        void runExport('docx');
    };

    const handleExportPDF = (event: React.MouseEvent) => {
        event.stopPropagation();
        void runExport('pdf');
    };

    if (!book) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Loading Book Data...</div>;

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans relative transition-colors duration-300">
            <ChapterNavigator
                key={book.id}
                book={book}
                activeChapterId={activeChapterId}
                onNavigateDashboard={() => void navigateAfterSave('/dashboard')}
                onSelectChapter={requestChapterSwitch}
                onAddVolume={handleAddVolume}
                onAddChapter={handleAddChapter}
                onRenameVolume={handleRenameVolume}
                onRenameChapter={handleRenameChapter}
                onDeleteItem={handleDeleteItem}
                onReorderVolumes={handleReorderVolumes}
                onReorderChapters={handleReorderChapters}
                onOpenPlotSetting={(chapterId) => void navigateAfterSave(`/books/${bookId}/story-outline?chapterId=${chapterId}`)}
            />

            {/* Main Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 shadow-xl z-10">
                <EditorHeader
                    volumeTitle={activeVolume?.title}
                    chapterTitle={chapterDraft.title}
                    hasActiveChapter={!!activeChapter}
                    saveStatus={autosave.saveStatus}
                    isAiLoading={aiContinue.isAiLoading}
                    isReadOnly={chapterDraft.isReadOnly}
                    isContextPanelOpen={isForeshadowingPanelOpen}
                    contextPanelItemCount={contextPanelItemCount}
                    isExporting={isExporting}
                    onNavigateForeshadowingBoard={() => void navigateAfterSave(`/books/${bookId}/foreshadowing`)}
                    onNavigateWorldBuilding={() => void navigateAfterSave(`/books/${bookId}/settings`)}
                    onAIContinue={aiContinue.continueWriting}
                    onToggleContextPanel={() => setIsForeshadowingPanelOpen(prev => !prev)}
                    onRetrySave={autosave.retry}
                    onNavigateSettings={() => void navigateAfterSave('/settings', { state: { returnTo: `/editor/${bookId}` } })}
                    onExportWord={handleExportWord}
                    onExportPdf={handleExportPDF}
                />

                <div className="flex-1 min-h-0 bg-slate-100 dark:bg-slate-900 flex overflow-hidden">
                    <div className="flex-1 overflow-y-auto flex justify-center items-start pb-12 px-4">
                        <div className="w-full max-w-3xl mt-8 bg-white dark:bg-slate-950 shadow-md border border-slate-200 dark:border-slate-800 min-h-[1300px] flex flex-col relative">
                            {activeChapter ? (
                                <>
                                    <div
                                        className="pb-2"
                                        style={{
                                            paddingLeft: editorSpacingSettings.editorMarginPx,
                                            paddingRight: editorSpacingSettings.editorMarginPx,
                                            paddingTop: editorSpacingSettings.editorMarginPx,
                                        }}
                                    >
                                        <input
                                            className="w-full text-4xl font-bold text-slate-900 dark:text-white placeholder-slate-300 dark:placeholder-slate-600 border-none focus:ring-0 focus:outline-none font-serif bg-transparent p-0 disabled:opacity-70 disabled:cursor-not-allowed"
                                            placeholder="Chapter Title"
                                            value={chapterDraft.title}
                                            onChange={handleTitleChange}
                                            disabled={chapterDraft.isReadOnly}
                                        />
                                    </div>
                                    <div className="mt-4 h-px bg-slate-100 dark:bg-slate-800 w-full"></div>

                                    <TiptapEditor
                                        ref={editorRef}
                                        content={chapterDraft.content}
                                        contentId = {activeChapterId}
                                        characters={book?.characters}
                                        autoHighlightCharacters={autoHighlightCharacters}
                                        onUpdate={handleEditorUpdate}
                                        onCharacterClick={handleCharacterClick}
                                        onForeshadowingCreate={handleForeshadowingCreate}
                                        onForeshadowingClick={handleForeshadowingClick}
                                        isEditable={!chapterDraft.isReadOnly}
                                        onToggleReadOnly={handleToggleReadOnly}
                                        placeholder="Start writing your story here... Type '@' to mention a character."
                                        editorMarginPx={editorSpacingSettings.editorMarginPx}
                                        editorLineHeight={editorSpacingSettings.editorLineHeight}
                                        className="text-lg text-slate-800 dark:text-slate-200 font-serif min-h-[800px]"
                                    />
                                </>
                            ) : (
                                <div className="flex items-center justify-center h-full text-slate-400 dark:text-slate-500 p-20">
                                    {book.volumes.length === 0 ? "Create a volume to start" : "Select or create a chapter from the sidebar"}
                                </div>
                            )}
                        </div>
                    </div>

                    <WritingContextPanel
                        isOpen={isForeshadowingPanelOpen}
                        foreshadowings={chapterDraft.foreshadowings}
                        excerptMap={foreshadowingExcerptMap}
                        activeForeshadowingId={activeForeshadowingId}
                        plotSettings={linkedPlotSettings}
                        isReadOnly={chapterDraft.isReadOnly}
                        canOpenOutline={!!activeChapterId}
                        onClose={() => setIsForeshadowingPanelOpen(false)}
                        onFocusForeshadowing={handleFocusForeshadowing}
                        onNoteChange={handleForeshadowingNoteChange}
                        onDeleteForeshadowing={handleDeleteForeshadowing}
                        onOpenOutline={() => void navigateAfterSave(`/books/${bookId}/story-outline?chapterId=${activeChapterId}`)}
                    />
                </div>

                <footer className="h-8 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 text-xs text-slate-500 dark:text-slate-400 select-none flex-shrink-0 z-20">
                    <div className="flex gap-4">
                        <span>Words: <span className="font-mono text-slate-700 dark:text-slate-200">{chapterDraft.wordCount}</span></span>
                    </div>
                    <div><span>StoryArk Sprint 5</span></div>
                </footer>
            </main>
        </div>
    );
}

// Changing books starts a new draft and save session after the route blocker
// has finished protecting the previous book.
export default function EditorRoute(): React.ReactElement {
    const { bookId } = useParams<{ bookId: string }>();
    return <Editor key={bookId} />;
}
