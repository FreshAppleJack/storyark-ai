import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useApp } from '../InteractionContent/AppContext';
import apiClient from '../services/api';
import TiptapEditor, { TiptapEditorRef } from '../components/TiptapEditor';
import { Chapter, ForeshadowingNote, PlotSetting, Volume } from '../types';
import { saveAs } from 'file-saver';
import { asBlob } from 'html-docx-js-typescript';
import html2pdf from 'html2pdf.js';
import { ChapterNavigator, NavigatorDeleteTarget } from '../features/editor/components/ChapterNavigator';
import { EditorHeader } from '../features/editor/components/EditorHeader';
import { WritingContextPanel } from '../features/editor/components/WritingContextPanel';
import { getEditorPlainText, getForeshadowingExcerptMap } from '../domain/chapterContent';
import { buildChapterExportHtml, buildWordExportDocument } from '../features/editor/utils/exportHtml';

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
    const [content, setContent] = useState<string>('');
    const [title, setTitle] = useState<string>('');
    const [foreshadowings, setForeshadowings] = useState<ForeshadowingNote[]>([]);
    const [plotSettings, setPlotSettings] = useState<PlotSetting[]>([]);
    const [activeForeshadowingId, setActiveForeshadowingId] = useState<string | null>(null);
    const [isForeshadowingPanelOpen, setIsForeshadowingPanelOpen] = useState(false);

    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [wordCount, setWordCount] = useState(0);

    // Export State
    const [isExporting, setIsExporting] = useState(false);

    // Read Only State Management
    const [isReadOnly, setIsReadOnly] = useState(false);

    const lastLoadedChapterIdRef = useRef<string | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const editorRef = useRef<TiptapEditorRef>(null);

    const foreshadowingExcerptMap = useMemo(() => getForeshadowingExcerptMap(content, 120), [content]);
    const linkedPlotSettings = useMemo(
        () => plotSettings.filter(plot => plot.chapterIds.includes(activeChapterId)),
        [plotSettings, activeChapterId]
    );
    const contextPanelItemCount = foreshadowings.length + linkedPlotSettings.length;

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

    // Sync data to state when chapter switch
    useEffect(() => {
        if (activeChapter) {
            setTitle(activeChapter.title || '');
            if (activeChapterId !== lastLoadedChapterIdRef.current) {
                setContent(activeChapter.content || '');
                setForeshadowings(activeChapter.foreshadowings || []);
                setActiveForeshadowingId(null);
                lastLoadedChapterIdRef.current = activeChapterId;
                setWordCount(activeChapter.wordCount || 0);
                setIsReadOnly(activeChapter.isEditable === false);
            }
        }
    }, [activeChapterId, activeChapter]);

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
            !foreshadowings.some(item => item.id === pendingTarget.foreshadowingId)
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
    }, [bookId, activeChapterId, content, foreshadowings]);

    // Auto Save Logic
    useEffect(() => {
        if (!activeChapter || !activeVolume || !book) return;

        if (saveStatus === 'unsaved') {
            if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
            setSaveStatus('saving');
            autoSaveTimerRef.current = setTimeout(async () => {
                const ok = await updateChapterContent(book.id, activeVolume!.id, activeChapter!.id, title, content, wordCount, foreshadowings);
                // Only a successful PUT may show Saved; failures keep the draft
                // and surface an error state the user can retry from.
                setSaveStatus(ok ? 'saved' : 'error');
            }, 1000);
        }
    }, [content, title, foreshadowings, saveStatus, activeChapterId, wordCount]);

    // Handle toggle read only state
    const handleToggleReadOnly = async () => {
        if (!book || !activeVolume || !activeChapter) return;
        const nextReadOnlyState = !isReadOnly;
        setIsReadOnly(nextReadOnlyState);
        await toggleChapterLock(book.id, activeVolume.id, activeChapter.id);
    };

    // --- Editor Interaction Handlers ---
    const handleEditorUpdate = (newContent: string, newWordCount: number) => {
        if (newContent !== content) {
            setContent(newContent);
            setSaveStatus('unsaved');
        }
        setWordCount(newWordCount);
    };

    const handleCharacterClick = (charId: string) => {
        navigate(`/books/${bookId}/settings?charId=${charId}`);
    };

    const handleForeshadowingCreate = (note: ForeshadowingNote) => {
        setForeshadowings(prev => [note, ...prev]);
        setActiveForeshadowingId(note.id);
        setIsForeshadowingPanelOpen(true);
        setSaveStatus('unsaved');
    };

    const handleForeshadowingClick = (id: string) => {
        setActiveForeshadowingId(id);
        setIsForeshadowingPanelOpen(true);
    };

    const handleForeshadowingNoteChange = (id: string, noteText: string) => {
        setForeshadowings(prev => prev.map(item => (
            item.id === id ? { ...item, note: noteText, updatedAt: Date.now() } : item
        )));
        setSaveStatus('unsaved');
    };

    const handleDeleteForeshadowing = (id: string) => {
        editorRef.current?.removeForeshadowing(id);
        setForeshadowings(prev => prev.filter(item => item.id !== id));
        setActiveForeshadowingId(prev => prev === id ? null : prev);
        setSaveStatus('unsaved');
    };

    const handleFocusForeshadowing = (id: string) => {
        setActiveForeshadowingId(id);
        editorRef.current?.focusForeshadowing(id);
    };

    const handleAIContinue = async () => {
        if (!content || isAiLoading) return;
        setIsAiLoading(true);
        try {
            let contextToSend = "";
            if (editorRef.current && editorRef.current.editor) {
                contextToSend = editorRef.current.editor.getText().slice(-aiContinueSettings.contextChars);
            } else {
                contextToSend = getEditorPlainText(content).slice(-aiContinueSettings.contextChars);
            }

            const response = await apiClient.post('/ai/continue', {
                content: contextToSend,
                outputLengthChars: aiContinueSettings.outputChars,
            });
            const aiText = (response as any).result;

            let formattedAiText = '';
            if (aiText && aiText.trim()) {
                // The original code used <br/> for concatenation, causing the entire AI content
                // to be placed within a single paragraph (Block Node).
                // This results in alignment operations being applied to the entire large text block.
                // Fix: split by newline characters and wrap each line in an individual <p> tag.
                const lines = aiText.split(/\r?\n/).filter((line: string) => line.trim() !== '');
                formattedAiText = lines.map((line: string) => `<p>\u3000\u3000${line.trim()}</p>`).join('');
            }

            if (editorRef.current && formattedAiText) {
                editorRef.current.insertContent(formattedAiText);
            }

        } catch (err) {
            console.error("AI Request Failed:", err);
        } finally {
            setIsAiLoading(false);
        }
    };

    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTitle = e.target.value;
        setTitle(newTitle);
        setSaveStatus('unsaved');
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
            setActiveChapterId(newChapterId);
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
        if (volume && chapter && chapter.title !== value) {
            const isCurrentChapter = activeChapterId === chapterId;
            const currentContent = isCurrentChapter ? content : (chapter.content || '');
            const currentWordCount = isCurrentChapter ? wordCount : (chapter.wordCount || 0);
            const currentForeshadowings = isCurrentChapter ? foreshadowings : (chapter.foreshadowings || []);
            // Update the current title before awaiting: an old request must not
            // overwrite the title after the user switches chapters.
            if (isCurrentChapter) {
                setTitle(value);
                setSaveStatus('unsaved');
            }
            const ok = await updateChapterContent(book.id, volume.id, chapterId, value, currentContent, currentWordCount, currentForeshadowings);
            if (!ok) {
                // The new title stays pending: for the active chapter the draft
                // keeps it and autosave retries; warn either way.
                toast.error('Failed to save the new title. Please try again.');
            }
        }
    };

    const handleDeleteItem = async (target: NavigatorDeleteTarget) => {
        if (!book) return;
        if (target.type === 'volume') {
            await deleteVolume(book.id, target.id);
            if (activeVolume && activeVolume.id === target.id) setActiveChapterId('');
        } else if (target.type === 'chapter' && target.parentId) {
            await deleteChapter(book.id, target.parentId, target.id);
            if (activeChapterId === target.id) setActiveChapterId('');
        }
    };

    const handleReorderVolumes = (volumes: Volume[]) => {
        if (book) reorderVolumes(book.id, volumes);
    };

    const handleReorderChapters = (volumeId: string, chapters: Chapter[]) => {
        if (book) reorderChapters(book.id, volumeId, chapters);
    };

    // --- EXPORT LOGIC ---

    const prepareContentForExport = () => {
        if (!editorRef.current || !activeChapter) return null;
        // Concat title and editor HTML
        return buildChapterExportHtml(title, editorRef.current.getHTML());
    };

    const handleExportWord = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExporting(true);

        try {
            const htmlContent = prepareContentForExport();
            if (!htmlContent) return;

            const htmlDocument = buildWordExportDocument(title, htmlContent);

            if (asBlob) {
                const buffer = await asBlob(htmlDocument, {
                    orientation: 'portrait',
                    margins: { top: 720, right: 720, bottom: 720, left: 720 } // Twips (1/1440 inch)
                });
                saveAs(buffer as Blob, `${title}.docx`);
            } else {
                alert("Libraries 'html-docx-js-typescript' and 'file-saver' are required.");
            }
        } catch (error) {
            console.error("Export Word failed:", error);
            alert("Export failed.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPDF = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExporting(true);

        // For better PDF effect, we clone a hidden DOM element to generate PDF
        // Avoid including editor's cursor, UI controls, etc.
        try {
            const element = document.createElement('div');
            element.innerHTML = prepareContentForExport() || '';
            // Temporarily apply styles to the cloned element
            element.style.fontFamily = '"Songti SC", serif';
            element.style.fontSize = '12pt';
            element.style.lineHeight = '1.8';
            element.style.color = '#000';
            element.style.padding = '40px';

            const opt = {
                margin: 1, // inch
                filename: `${title}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true }, // scale: 2 improves clarity
                jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] } // Avoid cutting text
            };

            if (html2pdf) {
                html2pdf().set(opt as any).from(element).save();
            } else {
                alert("Library 'html2pdf.js' is required.");
            }
        } catch (error) {
            console.error("Export PDF failed:", error);
        } finally {
            setIsExporting(false);
        }
    };

    if (!book) return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400">Loading Book Data...</div>;

    return (
        <div className="flex h-screen bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans relative transition-colors duration-300">
            <ChapterNavigator
                key={book.id}
                book={book}
                activeChapterId={activeChapterId}
                onNavigateDashboard={() => navigate('/dashboard')}
                onSelectChapter={setActiveChapterId}
                onAddVolume={handleAddVolume}
                onAddChapter={handleAddChapter}
                onRenameVolume={handleRenameVolume}
                onRenameChapter={handleRenameChapter}
                onDeleteItem={handleDeleteItem}
                onReorderVolumes={handleReorderVolumes}
                onReorderChapters={handleReorderChapters}
                onOpenPlotSetting={(chapterId) => navigate(`/books/${bookId}/story-outline?chapterId=${chapterId}`)}
            />

            {/* Main Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 shadow-xl z-10">
                <EditorHeader
                    volumeTitle={activeVolume?.title}
                    chapterTitle={title}
                    hasActiveChapter={!!activeChapter}
                    saveStatus={saveStatus}
                    isAiLoading={isAiLoading}
                    isReadOnly={isReadOnly}
                    isContextPanelOpen={isForeshadowingPanelOpen}
                    contextPanelItemCount={contextPanelItemCount}
                    isExporting={isExporting}
                    onNavigateForeshadowingBoard={() => navigate(`/books/${bookId}/foreshadowing`)}
                    onNavigateWorldBuilding={() => navigate(`/books/${bookId}/settings`)}
                    onAIContinue={handleAIContinue}
                    onToggleContextPanel={() => setIsForeshadowingPanelOpen(prev => !prev)}
                    onRetrySave={() => setSaveStatus('unsaved')}
                    onNavigateSettings={() => navigate('/settings', { state: { returnTo: `/editor/${bookId}` } })}
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
                                            value={title}
                                            onChange={handleTitleChange}
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                    <div className="mt-4 h-px bg-slate-100 dark:bg-slate-800 w-full"></div>

                                    <TiptapEditor
                                        ref={editorRef}
                                        content={content}
                                        contentId = {activeChapterId}
                                        characters={book?.characters}
                                        autoHighlightCharacters={autoHighlightCharacters}
                                        onUpdate={handleEditorUpdate}
                                        onCharacterClick={handleCharacterClick}
                                        onForeshadowingCreate={handleForeshadowingCreate}
                                        onForeshadowingClick={handleForeshadowingClick}
                                        isEditable={!isReadOnly}
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
                        foreshadowings={foreshadowings}
                        excerptMap={foreshadowingExcerptMap}
                        activeForeshadowingId={activeForeshadowingId}
                        plotSettings={linkedPlotSettings}
                        isReadOnly={isReadOnly}
                        canOpenOutline={!!activeChapterId}
                        onClose={() => setIsForeshadowingPanelOpen(false)}
                        onFocusForeshadowing={handleFocusForeshadowing}
                        onNoteChange={handleForeshadowingNoteChange}
                        onDeleteForeshadowing={handleDeleteForeshadowing}
                        onOpenOutline={() => navigate(`/books/${bookId}/story-outline?chapterId=${activeChapterId}`)}
                    />
                </div>

                <footer className="h-8 bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 text-xs text-slate-500 dark:text-slate-400 select-none flex-shrink-0 z-20">
                    <div className="flex gap-4">
                        <span>Words: <span className="font-mono text-slate-700 dark:text-slate-200">{wordCount}</span></span>
                    </div>
                    <div><span>StoryArk Sprint 5</span></div>
                </footer>
            </main>
        </div>
    );
}

export default Editor;
