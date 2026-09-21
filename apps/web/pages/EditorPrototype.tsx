import React, { useState, useEffect, useEffectEvent, useRef, useMemo } from 'react';
import { useParams, useNavigate, useBlocker, NavigateOptions, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { localBookOptions, localCharactersOptions, projectBook, projectCharacter } from '../data/local/repository';
import { localPlanningOptions, type LocalPlanning } from '../data/local/planningRepository';
import { toast } from 'react-hot-toast';
import { useApp } from '../InteractionContent/AppContext';
import { asRecord } from '../utils/serialization';
import TiptapEditor, { TiptapEditorRef } from '../components/TiptapEditor';
import { Book, Chapter, ForeshadowingNote, PlotSetting, Volume } from '../types';
import { ChapterNavigator, NavigatorDeleteTarget } from '../features/editor/components/ChapterNavigator';
import { EditorHeader } from '../features/editor/components/EditorHeader';
import { AiContinueCandidate } from '../features/editor/components/AiContinueCandidate';
import { WritingContextPanel } from '../features/editor/components/WritingContextPanel';
import { Button } from '../components/ui/Button';
import { getEditorPlainText, getForeshadowingExcerptMap } from '../domain/chapterContent';
import { useChapterDraft } from '../features/editor/hooks/useChapterDraft';
import { useChapterLock } from '../features/editor/hooks/useChapterLock';
import { useChapterAutosave } from '../features/editor/hooks/useChapterAutosave';
import { useWindowCloseGuard } from '../features/editor/hooks/useWindowCloseGuard';
import { useLocalAiContinue } from '../features/editor/hooks/useLocalAiContinue';
import { useChapterExport } from '../features/editor/export/useChapterExport';
import { useWorkExport } from '../features/editor/export/useWorkExport';
import { WorkExportPreview } from '../features/editor/components/WorkExportPreview';
import { registerWorkDraftFlush } from '../services/workDraftFlushRegistry';
import type { RetrievalChunkLocator } from '../domain/retrieval/contracts';

function Editor({ localBook, localPlanning }: { localBook?: Book; localPlanning?: LocalPlanning }): React.ReactElement {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const {
        getBook, updateChapterContent, createVolume, createChapter,
        updateVolume, deleteVolume, deleteChapter,
        reorderVolumes, reorderChapters, toggleChapterLock,
        editorSpacingSettings, aiContinueSettings, autoHighlightSettings, fetchStoryPlanning,
        storageMode, saveLocalSnapshot,
    } = useApp();

    const isLocal = storageMode === 'local';
    const book = localBook ?? getBook(bookId || '');
    // Archived characters keep existing mentions but stop new auto-matching.
    const autoHighlightCharacters = useMemo(() => {
        const disabledRoles = new Set(autoHighlightSettings.disabledRoles);
        return (book?.characters || []).filter(character => !character.isArchived && !disabledRoles.has(character.role));
    }, [book?.characters, autoHighlightSettings.disabledRoles]);

    // 1. State Initialization
    const [activeChapterId, setActiveChapterId] = useState<string>('');

    // 2. Find current active volume and chapter
    const activeVolume = book?.volumes.find(v => v.chapters.some(c => c.id === activeChapterId));
    const activeChapter = activeVolume?.chapters.find(c => c.id === activeChapterId);

    // 3. State Management
    // The chapter draft (values + revision + dirty tracking) lives in a hook;
    // this page only keeps UI state and the save lifecycle.
    const chapterDraft = useChapterDraft({ bookId, volumeId: activeVolume?.id, chapterId: activeChapterId, chapter: activeChapter });
    const [legacyPlotSettings, setPlotSettings] = useState<PlotSetting[]>([]);
    const plotSettings = localPlanning?.plotSettings ?? legacyPlotSettings;
    const [activeForeshadowingId, setActiveForeshadowingId] = useState<string | null>(null);
    const [isForeshadowingPanelOpen, setIsForeshadowingPanelOpen] = useState(false);
    const [pendingRetrievalFocus, setPendingRetrievalFocus] = useState<{
        chapterId: string;
        locator: RetrievalChunkLocator;
    } | null>(null);

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
            if (isLocal) return saveLocalSnapshot?.(snapshot, chapterDraft.sessionKey) ?? Promise.resolve(false);
            return updateChapterContent(snapshot.bookId, snapshot.volumeId, snapshot.chapterId, snapshot.title, snapshot.content, snapshot.wordCount, snapshot.foreshadowings);
        },
    });

    const blocker = useBlocker(chapterDraft.isDirty);
    const { flush } = autosave;
    useEffect(() => registerWorkDraftFlush(bookId ?? '', 'chapter', flush), [bookId, flush]);
    const workExport = useWorkExport({
        bookId: book?.id ?? bookId ?? '',
        enabled: isLocal && !!book,
        currentDraftFlush: flush,
        currentDraftReadOnly: chapterDraft.isReadOnly,
        onError: (error) => {
            console.error('Work export failed:', error);
            toast.error(error instanceof Error ? error.message : 'Work export failed. Your draft remains available.');
        },
        onSaved: () => toast.success('StoryArk work export saved and verified.'),
    });
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

    // Native window close: flush first, and on failure ask whether to retry
    // or exit without the unsaved draft. The in-app blocker cannot see this.
    const [closePrompt, setClosePrompt] = useState<'saving' | 'failed' | null>(null);
    useWindowCloseGuard({
        isDirty: chapterDraft.isDirty,
        flush,
        onFlushFailed: () => setClosePrompt('failed'),
    });
    const retrySaveAndClose = async () => {
        setClosePrompt('saving');
        const ok = await flush();
        if (ok && isTauri()) await getCurrentWindow().destroy();
        else setClosePrompt('failed');
    };

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
        if (isLocal) return;
        const timer = setTimeout(() => {
            if (!book && bookId) {
                // display error page
                toast.error('Book not found and loading failed...');
                navigate('/dashboard');
            }
        }, 1500);

        return () => clearTimeout(timer);
    }, [book, bookId, navigate, isLocal]);

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
                // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the external localStorage selection once book data arrives.
                setActiveChapterId(targetChapterId);
            }
        }
    }, [book, bookId, activeChapterId]);

    // Listen for chapter switch
    useEffect(() => {
        if (activeChapterId && bookId) {
            localStorage.setItem(`lastActiveChapter_${bookId}`, activeChapterId);
        }
    }, [activeChapterId, bookId]);

    const loadPlanning = useEffectEvent((id: string) => fetchStoryPlanning(id));
    useEffect(() => {
        let isMounted = true;
        const loadPlotSettings = async () => {
            if (!bookId || isLocal) return;
            const planning = await loadPlanning(bookId);
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
    }, [bookId, isLocal]);

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
                if (typeof window !== 'undefined' && window.__DEBUG_HIGHLIGHTS__) {
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

        let pendingTarget: Record<string, unknown>;
        try {
            pendingTarget = asRecord(JSON.parse(pendingValue));
        } catch {
            localStorage.removeItem(storageKey);
            return;
        }

        if (
            pendingTarget.chapterId !== activeChapterId ||
            typeof pendingTarget.foreshadowingId !== 'string' || !pendingTarget.foreshadowingId ||
            !chapterDraft.foreshadowings.some(item => item.id === pendingTarget.foreshadowingId)
        ) {
            return;
        }

        const foreshadowingId = pendingTarget.foreshadowingId;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Apply an external cross-page focus request after its chapter has loaded.
        setActiveForeshadowingId(foreshadowingId);
        setIsForeshadowingPanelOpen(true);

        const delays = [160, 420, 800];
        const timers = delays.map(delay => window.setTimeout(() => {
            if (localStorage.getItem(storageKey) !== pendingValue) return;
            const didFocus = editorRef.current?.focusForeshadowing(foreshadowingId);
            if (didFocus) {
                localStorage.removeItem(storageKey);
            }
        }, delay));

        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [bookId, activeChapterId, chapterDraft.content, chapterDraft.foreshadowings]);

    useEffect(() => {
        if (!pendingRetrievalFocus || pendingRetrievalFocus.chapterId !== activeChapterId) return;

        const pending = pendingRetrievalFocus;
        const delays = [160, 420, 800];
        const timers = delays.map(delay => window.setTimeout(() => {
            const didFocus = editorRef.current?.focusRetrievalLocator(pending.locator);
            if (didFocus) {
                setPendingRetrievalFocus(null);
            }
        }, delay));

        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [activeChapterId, chapterDraft.content, pendingRetrievalFocus]);

    // Switching chapters waits until the current draft is fully saved; on
    // failure the user stays on the current chapter (the header shows the
    // error and a retry). Deleting the current chapter bypasses this on
    // purpose — there is nothing left to save.
    const requestChapterSwitch = async (targetChapterId: string): Promise<boolean> => {
        if (targetChapterId === activeChapterId) return true;
        if (chapterDraft.isDirty) {
            const ok = await autosave.flush();
            if (!ok) return false;
        }
        setActiveChapterId(targetChapterId);
        return true;
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

    const chapterLock = useChapterLock({
        sessionKey: chapterDraft.sessionKey,
        isReadOnly: chapterDraft.isReadOnly,
        isDirty: chapterDraft.isDirty,
        pauseEdits: chapterDraft.pauseEdits,
        setReadOnly: chapterDraft.setReadOnly,
        flush: autosave.flush,
        persistToggle: () => book && activeVolume && activeChapter
            ? toggleChapterLock(book.id, activeVolume.id, activeChapter.id) : Promise.resolve(false),
    });

    const aiContinue = useLocalAiContinue({
        enabled: isLocal && !!activeChapter,
        bookId: book?.id ?? bookId ?? '',
        chapterId: activeChapterId,
        sessionId: chapterDraft.sessionKey,
        draftRevision: chapterDraft.revision,
        databaseVersion: activeChapter?.databaseVersion ?? 0,
        isReadOnly: chapterDraft.isReadOnly || chapterLock.isChangingLock,
        contextChars: aiContinueSettings.contextChars,
        outputChars: aiContinueSettings.outputChars,
        getContextText: () => editorRef.current?.editor?.getText() ?? getEditorPlainText(chapterDraft.content),
        captureAnchor: () => editorRef.current?.captureSelection() ?? null,
        insertCandidateAtAnchor: (candidate, anchor) => editorRef.current?.insertAiCandidateAtAnchor(candidate, anchor) ?? false,
    });

    const handleToggleReadOnly = chapterLock.toggle;
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

    const handleExportWorkJson = (event: React.MouseEvent) => {
        event.stopPropagation();
        void workExport.prepare();
    };

    if (!book) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Loading Book Data...</div>;

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans relative transition-colors duration-300">
            <ChapterNavigator
                localMode={isLocal}
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
                onOpenRetrievalLocator={(chapterId, locator) => setPendingRetrievalFocus({ chapterId, locator })}
            />

            {/* Main Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 shadow-xl z-10">
                <EditorHeader
                    localMode={isLocal}
                    volumeTitle={activeVolume?.title}
                    chapterTitle={chapterDraft.title}
                    hasActiveChapter={!!activeChapter}
                    saveStatus={autosave.saveStatus}
                    aiAvailable={isLocal && !!activeChapter}
                    isAiLoading={aiContinue.isAiLoading}
                    isReadOnly={chapterDraft.isReadOnly || chapterLock.isChangingLock}
                    isContextPanelOpen={isForeshadowingPanelOpen}
                    contextPanelItemCount={contextPanelItemCount}
                    isExporting={isExporting || workExport.isExporting}
                    onNavigateForeshadowingBoard={() => void navigateAfterSave(`/books/${bookId}/foreshadowing`)}
                    onNavigateWorldBuilding={() => void navigateAfterSave(`/books/${bookId}/settings`)}
                    onAIContinue={aiContinue.continueWriting}
                    onStopAI={aiContinue.stop}
                    onToggleContextPanel={() => setIsForeshadowingPanelOpen(prev => !prev)}
                    onRetrySave={autosave.retry}
                    onNavigateSettings={() => void navigateAfterSave('/settings', { state: { returnTo: `/editor/${bookId}` } })}
                    onExportWord={handleExportWord}
                    onExportPdf={handleExportPDF}
                    onExportWorkJson={handleExportWorkJson}
                />

                <AiContinueCandidate
                    candidate={aiContinue.candidate}
                    isAiLoading={aiContinue.isAiLoading}
                    canAdopt={aiContinue.canAdopt}
                    adoptDisabledReason={aiContinue.adoptDisabledReason}
                    onStop={aiContinue.stop}
                    onAdopt={aiContinue.adoptCandidate}
                    onClose={aiContinue.closeCandidate}
                    onDiscard={aiContinue.discardCandidate}
                    onRegenerate={aiContinue.regenerate}
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
                                            disabled={chapterDraft.isReadOnly || chapterLock.isChangingLock}
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
                                        onContentNormalized={chapterDraft.adoptLoaded}
                                        onCharacterClick={handleCharacterClick}
                                        onForeshadowingCreate={handleForeshadowingCreate}
                                        onForeshadowingClick={handleForeshadowingClick}
                                        isEditable={!chapterDraft.isReadOnly && !chapterLock.isChangingLock}
                                        onToggleReadOnly={handleToggleReadOnly}
                                        placeholder={isLocal ? 'Start writing your story here...' : "Start writing your story here... Type '@' to mention a character."}
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
                        isReadOnly={chapterDraft.isReadOnly || chapterLock.isChangingLock}
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
                    <div><span>{isLocal ? 'Local storage · AI uses the configured desktop model' : 'StoryArk Sprint 5'}</span></div>
                </footer>
            </main>

            {workExport.preview && (
                <WorkExportPreview
                    preview={workExport.preview}
                    isExporting={workExport.isExporting}
                    onConfirm={() => void workExport.confirm()}
                    onClose={workExport.close}
                />
            )}

            {closePrompt && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-6" role="dialog" aria-modal="true" aria-labelledby="close-prompt-title">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900 space-y-4">
                        <h2 id="close-prompt-title" className="text-lg font-semibold text-slate-900 dark:text-white">Unsaved changes could not be saved</h2>
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                            The latest changes have not been written to the local database. Retry saving before exit,
                            or exit now and lose the unsaved draft. Force-quitting the app always keeps only the last
                            successfully saved transaction.
                        </p>
                        <div className="flex flex-wrap gap-3">
                            <Button onClick={() => void retrySaveAndClose()} disabled={closePrompt === 'saving'}>
                                {closePrompt === 'saving' ? 'Saving...' : 'Retry & Exit'}
                            </Button>
                            <Button variant="secondary" disabled={closePrompt === 'saving'}
                                onClick={() => { if (isTauri()) void getCurrentWindow().destroy(); }}>
                                Exit Without Saving
                            </Button>
                            <Button variant="ghost" disabled={closePrompt === 'saving'} onClick={() => setClosePrompt(null)}>
                                Cancel
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Changing books starts a new draft and save session after the route blocker
// has finished protecting the previous book.
export default function EditorRoute(): React.ReactElement {
    const { bookId } = useParams<{ bookId: string }>();
    const { storageMode } = useApp();
    if (storageMode === 'local') return <LocalEditorRoute key={bookId} bookId={bookId ?? ''} />;
    return <Editor key={bookId} />;
}

function LocalEditorRoute({ bookId }: { bookId: string }) {
    const query = useQuery({ ...localBookOptions(bookId), refetchOnMount: 'always' });
    const planning = useQuery(localPlanningOptions(bookId));
    const charactersQuery = useQuery(localCharactersOptions(bookId));
    const book = useMemo(() => query.data
        ? projectBook(query.data.book, query.data, charactersQuery.data?.map(projectCharacter))
        : undefined, [query.data, charactersQuery.data]);
    if (book && !query.isFetching && !query.error) return <>
        {planning.error && <p role="alert" className="text-xs text-rose-600">Planning could not be loaded. Writing remains available.</p>}
        <Editor localBook={book} localPlanning={planning.data} />
    </>;
    const pending = query.isPending || query.isFetching || charactersQuery.isPending;
    const error = query.error ?? charactersQuery.error;
    return <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        {pending ? <p role="status">Loading local book...</p> : <>
            <p role="alert">{error?.message ?? 'Book not found.'}</p>
            <button onClick={() => { void query.refetch(); void charactersQuery.refetch(); }}>Retry</button>
        </>}
        <Link to="/dashboard">Back to Bookshelf</Link>
    </main>;
}
