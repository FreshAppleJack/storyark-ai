import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useApp } from '../InteractionContent/AppContext';
import apiClient from '../services/api';
import TiptapEditor, { TiptapEditorRef } from '../components/TiptapEditor';
import {
    ChevronDown, ChevronRight, Plus, Settings, FileText, Folder,
    CheckCircle2, Cloud, ArrowLeft, Wand2, Loader2,
    Pencil, Trash2, AlertTriangle, GripVertical, History as HistoryIcon,
    Globe, Lock, Download, FileType, Search, PanelRightClose, PanelRightOpen, MessageSquareText, ListTree, ScrollText
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { ForeshadowingNote, PlotSetting } from '../types';
import { saveAs } from 'file-saver';
import { asBlob } from 'html-docx-js-typescript';
import html2pdf from 'html2pdf.js';

interface ContextMenuState {
    x: number;
    y: number;
    type: 'volume' | 'chapter';
    id: string;
    parentId?: string;
}

interface RenamingState {
    id: string;
    type: 'volume' | 'chapter';
    value: string;
}

type SidebarSearchMode = 'chapter' | 'volume';

interface SidebarSearchResult {
    type: SidebarSearchMode;
    volumeId: string;
    volumeTitle: string;
    chapterId?: string;
    chapterTitle?: string;
    score: number;
}

const normalizeSearchText = (value: string) => value.toLowerCase().replace(/\s+/g, '');

const getFuzzyScore = (value: string, query: string) => {
    const target = normalizeSearchText(value);
    const needle = normalizeSearchText(query);
    if (!needle) return null;
    if (!target) return null;

    const exactIndex = target.indexOf(needle);
    if (exactIndex >= 0) {
        return exactIndex + Math.max(0, target.length - needle.length) * 0.01;
    }

    let targetIndex = 0;
    let gapPenalty = 0;
    for (const char of needle) {
        const foundIndex = target.indexOf(char, targetIndex);
        if (foundIndex === -1) return null;
        gapPenalty += foundIndex - targetIndex;
        targetIndex = foundIndex + 1;
    }

    return 100 + gapPenalty + Math.max(0, target.length - needle.length) * 0.02;
};

const getForeshadowingExcerptMap = (content: string) => {
    const excerpts = new Map<string, string[]>();
    const getForeshadowingIds = (node: any): string[] => {
        if (!Array.isArray(node?.marks)) return [];
        return node.marks
            .filter((mark: any) => mark.type === 'foreshadowing' && mark.attrs?.id)
            .map((mark: any) => mark.attrs.id as string);
    };

    const appendText = (id: string, text: string) => {
        if (!text) return;
        const existing = excerpts.get(id) || [];
        existing.push(text);
        excerpts.set(id, existing);
    };

    const visit = (node: any) => {
        const foreshadowingIds = getForeshadowingIds(node);
        if (foreshadowingIds.length > 0) {
            const text = node.type === 'mention'
                ? (node.attrs?.label || node.attrs?.id || '')
                : node.type === 'text'
                    ? (node.text || '')
                    : node.type === 'hardBreak'
                        ? ' '
                        : '';
            foreshadowingIds.forEach(id => appendText(id, text));
        }

        if (Array.isArray(node.content)) {
            node.content.forEach(visit);
            if (['paragraph', 'heading', 'blockquote'].includes(node.type)) {
                const idsInBlock = new Set<string>();
                const collectIds = (child: any) => {
                    getForeshadowingIds(child).forEach((id: string) => idsInBlock.add(id));
                    if (Array.isArray(child.content)) child.content.forEach(collectIds);
                };
                node.content.forEach(collectIds);
                idsInBlock.forEach(id => appendText(id, ' '));
            }
        }
    };

    try {
        const parsed = JSON.parse(content);
        visit(parsed);
    } catch (error) {
        return new Map<string, string>();
    }

    const normalized = new Map<string, string>();
    excerpts.forEach((parts, id) => {
        const text = parts.join('').replace(/[\s\u3000]+/g, ' ').trim();
        if (text) {
            normalized.set(id, text.length > 120 ? `${text.slice(0, 120)}...` : text);
        }
    });
    return normalized;
};

const getEditorPlainText = (content: string) => {
    const visit = (node: any): string => {
        if (!node) return '';
        if (node.type === 'text') return node.text || '';
        if (node.type === 'mention') return node.attrs?.label || node.attrs?.id || '';
        if (node.type === 'hardBreak') return '\n';
        if (!Array.isArray(node.content)) return '';
        const text = node.content.map(visit).join('');
        return ['paragraph', 'heading', 'blockquote'].includes(node.type) ? `${text}\n` : text;
    };

    try {
        return visit(JSON.parse(content)).replace(/[\s\u3000]+/g, ' ').trim();
    } catch (error) {
        return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
};

const Editor: React.FC = () => {
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

    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [wordCount, setWordCount] = useState(0);
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(new Set());
    const [sidebarSearchMode, setSidebarSearchMode] = useState<SidebarSearchMode>('chapter');
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
    const [sidebarSearchMessage, setSidebarSearchMessage] = useState('');
    const [sidebarSearchTarget, setSidebarSearchTarget] = useState<{ type: SidebarSearchMode; id: string } | null>(null);

    // Export Menu State
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Read Only State Management
    const [isReadOnly, setIsReadOnly] = useState(false);

    const lastLoadedChapterIdRef = useRef<string | null>(null);
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const editorRef = useRef<TiptapEditorRef>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const dragItemRef = useRef<any>(null);
    const dragOverItemRef = useRef<any>(null);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<{ type: 'volume' | 'chapter', id: string, parentId?: string } | null>(null);

    const [renamingState, setRenamingState] = useState<RenamingState | null>(null);

    const sidebarSearchResults = useMemo<SidebarSearchResult[]>(() => {
        if (!book || !sidebarSearchQuery.trim()) return [];

        const results: SidebarSearchResult[] = [];
        if (sidebarSearchMode === 'volume') {
            book.volumes.forEach((volume) => {
                const score = getFuzzyScore(volume.title, sidebarSearchQuery);
                if (score !== null) {
                    results.push({
                        type: 'volume',
                        volumeId: volume.id,
                        volumeTitle: volume.title,
                        chapterId: volume.chapters[0]?.id,
                        chapterTitle: volume.chapters[0]?.title,
                        score,
                    });
                }
            });
        } else {
            book.volumes.forEach((volume) => {
                volume.chapters.forEach((chapter) => {
                    const score = getFuzzyScore(chapter.title, sidebarSearchQuery);
                    if (score !== null) {
                        results.push({
                            type: 'chapter',
                            volumeId: volume.id,
                            volumeTitle: volume.title,
                            chapterId: chapter.id,
                            chapterTitle: chapter.title,
                            score,
                        });
                    }
                });
            });
        }

        return results.sort((a, b) => a.score - b.score).slice(0, 8);
    }, [book, sidebarSearchMode, sidebarSearchQuery]);
    const foreshadowingExcerptMap = useMemo(() => getForeshadowingExcerptMap(content), [content]);
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

    // Initialize expanded volumes & Restore last viewed chapter
    useEffect(() => {
        if (book?.volumes) {
            setExpandedVolumes(new Set(book.volumes.map(v => v.id)));

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

    useEffect(() => {
        const handleClick = () => {
            setContextMenu(null);
            setShowExportMenu(false); // Close export menu on click outside
            if (renamingState) submitRename();
        };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [renamingState]);

    useEffect(() => {
        if (renamingState && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
    }, [renamingState?.id]);

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
                await updateChapterContent(book.id, activeVolume!.id, activeChapter!.id, title, content, wordCount, foreshadowings);
                setSaveStatus('saved');
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

    // --- Drag & Drop Handlers (Keep existing logic) ---
    const handleDragStart = (e: React.DragEvent, type: 'volume' | 'chapter', index: number, parentId?: string) => {
        if (renamingState) {
            e.preventDefault(); return;
        }
        dragItemRef.current = { index, type, parentId };
        (e.currentTarget as HTMLDivElement).style.opacity = '0.5';
        e.stopPropagation();
    };

    const handleDragEnter = (e: React.DragEvent, type: 'volume' | 'chapter', index: number, parentId?: string) => {
        e.preventDefault(); e.stopPropagation();
        if (renamingState) return;

        dragOverItemRef.current = { index, type, parentId };

        if (!dragItemRef.current || !book) return;
        if (dragItemRef.current.type !== type) return;
        if (type === 'chapter' && dragItemRef.current.parentId !== parentId) return;

        const dragIndex = dragItemRef.current.index;
        const hoverIndex = index;
        if (dragIndex === hoverIndex) return;

        if (type === 'volume') {
            const newVolumes = [...book.volumes];
            const draggedVol = newVolumes[dragIndex];
            newVolumes.splice(dragIndex, 1);
            newVolumes.splice(hoverIndex, 0, draggedVol);
            reorderVolumes(book.id, newVolumes);
        } else if (type === 'chapter') {
            const volume = book.volumes.find(v => v.id === parentId);
            if (volume) {
                const newChapters = [...volume.chapters];
                const draggedChap = newChapters[dragIndex];
                newChapters.splice(dragIndex, 1);
                newChapters.splice(hoverIndex, 0, draggedChap);
                reorderChapters(book.id, volume.id, newChapters);
            }
        }
        dragItemRef.current.index = hoverIndex;
    };

    const handleDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLDivElement).style.opacity = '1';
        dragItemRef.current = null;
        dragOverItemRef.current = null;
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

    // --- Volume & Chapter Management Handlers ---
    const toggleVolume = (vid: string) => {
        if (renamingState && renamingState.id === vid) return;
        const newSet = new Set(expandedVolumes);
        if (newSet.has(vid)) newSet.delete(vid);
        else newSet.add(vid);
        setExpandedVolumes(newSet);
    };

    const handleAddVolume = async () => {
        const volTitle = `Volume ${book!.volumes.length + 1}`;
        const newVolumeId = await createVolume(book!.id, volTitle);
        if (newVolumeId) {
            setRenamingState({ id: newVolumeId, type: 'volume', value: volTitle });
        }
    };

    const handleAddChapter = async (volId: string) => {
        const chapTitle = "New Chapter";
        if (book) {
            const newChapterId = await createChapter(book.id, volId, chapTitle);
            if (newChapterId) {
                setActiveChapterId(newChapterId);
                setRenamingState({ id: newChapterId, type: 'chapter', value: chapTitle });
            }
        }
    };

    const handleContextMenu = (e: React.MouseEvent, type: 'volume' | 'chapter', id: string, parentId?: string) => {
        e.preventDefault(); e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, type, id, parentId });
    };

    const startRenaming = () => {
        if (!contextMenu || !book) return;
        let initialValue = '';
        if (contextMenu.type === 'volume') {
            const vol = book.volumes.find(v => v.id === contextMenu.id);
            if (vol) initialValue = vol.title;
        } else {
            const vol = book.volumes.find(v => v.id === contextMenu.parentId);
            const chap = vol?.chapters.find(c => c.id === contextMenu.id);
            if (chap) initialValue = chap.title;
        }
        setRenamingState({ id: contextMenu.id, type: contextMenu.type, value: initialValue });
        setContextMenu(null);
    };

    const submitRename = async () => {
        if (!renamingState || !book) return;
        const { id, type, value } = renamingState;
        if (!value.trim()) { cancelRename(); return; }
        try {
            if (type === 'volume') {
                const vol = book.volumes.find(v => v.id === id);
                if (vol && vol.title !== value) await updateVolume(book.id, id, value);
            } else {
                const volume = book.volumes.find(v => v.chapters.some(c => c.id === id));
                const chapter = volume?.chapters.find(c => c.id === id);
                if (volume && chapter && chapter.title !== value) {
                    const currentWordCount = (activeChapterId === id) ? wordCount : (chapter.wordCount || 0);
                    await updateChapterContent(book.id, volume.id, id, value, chapter.content || '', currentWordCount, chapter.foreshadowings || []);
                    if (activeChapterId === id) setTitle(value);
                }
            }
        } catch (e) { console.error("Rename failed", e); }
        setRenamingState(null);
    };

    const cancelRename = () => setRenamingState(null);
    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') submitRename();
        if (e.key === 'Escape') cancelRename();
    };

    const scrollSidebarItemIntoView = (type: SidebarSearchMode, id: string) => {
        window.setTimeout(() => {
            const element = document.getElementById(`sidebar-${type}-${id}`);
            element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }, 80);
    };

    const selectSidebarSearchResult = (result: SidebarSearchResult) => {
        setExpandedVolumes(prev => {
            const next = new Set(prev);
            next.add(result.volumeId);
            return next;
        });

        if (result.chapterId) {
            setActiveChapterId(result.chapterId);
            setSidebarSearchTarget({ type: 'chapter', id: result.chapterId });
            setSidebarSearchMessage(result.type === 'volume'
                ? `Opened the first chapter in "${result.volumeTitle}".`
                : `Opened "${result.chapterTitle}".`
            );
            scrollSidebarItemIntoView('chapter', result.chapterId);
        } else {
            setActiveChapterId('');
            setSidebarSearchTarget({ type: 'volume', id: result.volumeId });
            setSidebarSearchMessage(`"${result.volumeTitle}" has no chapters yet.`);
            scrollSidebarItemIntoView('volume', result.volumeId);
        }
    };

    const handleSidebarSearchSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const trimmedQuery = sidebarSearchQuery.trim();
        if (!trimmedQuery) {
            setSidebarSearchMessage('Type a search term first.');
            return;
        }

        const firstResult = sidebarSearchResults[0];
        if (!firstResult) {
            setSidebarSearchMessage(`No matching ${sidebarSearchMode}s found.`);
            return;
        }

        selectSidebarSearchResult(firstResult);
    };

    const handleDeleteClick = () => {
        if (contextMenu) {
            setItemToDelete({ type: contextMenu.type, id: contextMenu.id, parentId: contextMenu.parentId });
            setShowDeleteModal(true); setContextMenu(null);
        }
    };

    const handleOpenPlotSetting = () => {
        if (!contextMenu || contextMenu.type !== 'chapter') return;
        navigate(`/books/${bookId}/story-outline?chapterId=${contextMenu.id}`);
        setContextMenu(null);
    };

    const confirmDelete = async () => {
        if (itemToDelete && book) {
            if (itemToDelete.type === 'volume') {
                await deleteVolume(book.id, itemToDelete.id);
                if (activeVolume && activeVolume.id === itemToDelete.id) setActiveChapterId('');
            } else if (itemToDelete.type === 'chapter' && itemToDelete.parentId) {
                await deleteChapter(book.id, itemToDelete.parentId, itemToDelete.id);
                if (activeChapterId === itemToDelete.id) setActiveChapterId('');
            }
        }
        setShowDeleteModal(false); setItemToDelete(null);
    };

    // --- EXPORT LOGIC ---

    const prepareContentForExport = () => {
        if (!editorRef.current || !activeChapter) return null;
        // Get editor HTML content
        const editorHtml = editorRef.current.getHTML();
        // Concat title and editor HTML
        const fullContentHtml = `
            <div style="font-family: 'Songti SC', serif; padding: 20px;">
                <h1 style="text-align: center; margin-bottom: 20px;">${title}</h1>
                ${editorHtml}
            </div>
        `;
        return fullContentHtml;
    };

    const handleExportWord = async (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsExporting(true);
        setShowExportMenu(false);

        try {
            const htmlContent = prepareContentForExport();
            if (!htmlContent) return;

            // Construct a complete HTML page structure to ensure Word recognizes UTF-8 encoding
            const htmlDocument = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <title>${title}</title>
                    <style>
                        body { font-family: "Songti SC", "SimSun", serif; font-size: 14pt; line-height: 1.5; }
                        p { margin-bottom: 1em; text-indent: 2em; }
                    </style>
                </head>
                <body>
                    ${htmlContent}
                </body>
                </html>
            `;

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
        setShowExportMenu(false);

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
            {/* Sidebar code... (unchanged) */}
            <aside className={`flex-shrink-0 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out flex flex-col ${sidebarExpanded ? 'w-72' : 'w-16'}`}>
                {/* Sidebar Header */}
                <div className="h-14 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4">
                    {sidebarExpanded ? (
                        <div className="flex items-center gap-2 overflow-hidden cursor-pointer" onClick={() => navigate('/dashboard')}>
                            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white flex-shrink-0">
                                <ArrowLeft size={16} />
                            </div>
                            <span className="font-bold text-slate-800 dark:text-white truncate text-xs">Back to Dashboard</span>
                        </div>
                    ) : (
                        <div onClick={() => navigate('/dashboard')} className="w-8 h-8 mx-auto bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 font-serif font-bold">
                            <ArrowLeft size={16}/>
                        </div>
                    )}
                    <button onClick={() => setSidebarExpanded(!sidebarExpanded)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 focus:outline-none">
                        {sidebarExpanded ? <ChevronDown className="rotate-90" size={18}/> : <ChevronRight size={18}/>}
                    </button>
                </div>

                {sidebarExpanded && (
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`w-10 h-14 ${book.coverColor || 'bg-slate-700'} rounded shadow-sm flex-shrink-0`}></div>
                            <div className="overflow-hidden">
                                <h2 className="font-semibold text-sm text-slate-900 dark:text-white truncate" title={book.title}>{book.title}</h2>
                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">by {book.author}</p>
                            </div>
                        </div>
                        <form className="mt-4 space-y-2" onSubmit={handleSidebarSearchSubmit}>
                            <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-xs font-medium dark:bg-slate-900">
                                {(['chapter', 'volume'] as SidebarSearchMode[]).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => {
                                            setSidebarSearchMode(mode);
                                            setSidebarSearchMessage('');
                                        }}
                                        className={`rounded-md px-2 py-1.5 capitalize transition ${
                                            sidebarSearchMode === mode
                                                ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-300'
                                                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                                        }`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
                                <Search size={15} className="flex-shrink-0 text-slate-400" />
                                <input
                                    value={sidebarSearchQuery}
                                    onChange={(event) => {
                                        setSidebarSearchQuery(event.target.value);
                                        setSidebarSearchMessage('');
                                    }}
                                    placeholder={`Search ${sidebarSearchMode}s`}
                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                />
                                <button
                                    type="submit"
                                    className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-700"
                                >
                                    Go
                                </button>
                            </div>
                            {sidebarSearchQuery.trim() && sidebarSearchResults.length > 0 && (
                                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                    {sidebarSearchResults.map((result) => (
                                        <button
                                            key={`${result.type}-${result.volumeId}-${result.chapterId || 'volume'}`}
                                            type="button"
                                            onClick={() => selectSidebarSearchResult(result)}
                                            className="w-full px-3 py-2 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-brand-950/40"
                                        >
                                            <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                                {result.type === 'chapter' ? result.chapterTitle : result.volumeTitle}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                                {result.type === 'chapter' ? result.volumeTitle : (result.chapterTitle ? `First chapter: ${result.chapterTitle}` : 'No chapters yet')}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {sidebarSearchMessage && (
                                <p className={`text-xs leading-5 ${sidebarSearchMessage.startsWith('No ') || sidebarSearchMessage.startsWith('Type ') ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {sidebarSearchMessage}
                                </p>
                            )}
                        </form>
                    </div>
                )}

                {/* Sidebar List */}
                <div className="flex-1 overflow-y-auto py-2 custom-scrollbar relative" onClick={() => {
                    if (renamingState) submitRename();
                }}>
                    {sidebarExpanded ? (
                        <div className="px-2 space-y-1">
                            {book.volumes.length === 0 && (
                                <div className="text-center py-4 text-xs text-slate-400">
                                    No volumes yet.<br/>Create one to start writing.
                                </div>
                            )}

                            {book.volumes.map((vol, vIndex) => {
                                const isVolDraggable = !expandedVolumes.has(vol.id) && renamingState?.id !== vol.id;
                                const isRenamingVol = renamingState?.id === vol.id && renamingState?.type === 'volume';

                                return (
                                    <div
                                        id={`sidebar-volume-${vol.id}`}
                                        key={vol.id}
                                        className="mb-2"
                                        draggable={isVolDraggable}
                                        onDragStart={(e) => handleDragStart(e, 'volume', vIndex)}
                                        onDragEnter={(e) => handleDragEnter(e, 'volume', vIndex)}
                                        onDragEnd={handleDragEnd}
                                        onDragOver={(e) => e.preventDefault()}
                                    >
                                        <div className="flex items-center justify-between group/vol pr-2">
                                            <button
                                                onClick={() => toggleVolume(vol.id)}
                                                onContextMenu={(e) => handleContextMenu(e, 'volume', vol.id)}
                                                className={`
                                                flex-1 flex items-center gap-1 p-2 text-xs font-semibold text-slate-500 dark:text-slate-400
                                                hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors
                                                ${sidebarSearchTarget?.type === 'volume' && sidebarSearchTarget.id === vol.id ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-800' : ''}
                                                ${isVolDraggable ? 'cursor-grab active:cursor-grabbing' : ''}
                                            `}
                                            >
                                                {isVolDraggable && <GripVertical size={12} className="opacity-0 group-hover/vol:opacity-50 mr-1" />}
                                                {expandedVolumes.has(vol.id) ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                                                <Folder size={14} />

                                                {isRenamingVol ? (
                                                    <input
                                                        ref={renameInputRef}
                                                        type="text"
                                                        value={renamingState.value}
                                                        onChange={(e) => setRenamingState({...renamingState, value: e.target.value})}
                                                        onKeyDown={handleRenameKeyDown}
                                                        onBlur={submitRename}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-brand-300 dark:border-brand-800 rounded px-1 py-0.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-900"
                                                    />
                                                ) : (
                                                    <span className="truncate">{vol.title}</span>
                                                )}
                                            </button>
                                            <button onClick={() => handleAddChapter(vol.id)} title="Add Chapter" className="opacity-0 group-hover/vol:opacity-100 p-1 hover:bg-brand-100 dark:hover:bg-brand-950/40 text-brand-600 dark:text-brand-300 rounded">
                                                <Plus size={12} />
                                            </button>
                                        </div>

                                        {expandedVolumes.has(vol.id) && (
                                            <div className="ml-4 mt-1 space-y-0.5 border-l border-slate-200 dark:border-slate-800 pl-2">
                                                {vol.chapters.map((chapter, cIndex) => {
                                                    const isRenamingChap = renamingState?.id === chapter.id && renamingState?.type === 'chapter';

                                                    return (
                                                        <div
                                                            id={`sidebar-chapter-${chapter.id}`}
                                                            key={chapter.id}
                                                            onContextMenu={(e) => handleContextMenu(e, 'chapter', chapter.id, vol.id)}
                                                            draggable={!isRenamingChap}
                                                            onDragStart={(e) => handleDragStart(e, 'chapter', cIndex, vol.id)}
                                                            onDragEnter={(e) => handleDragEnter(e, 'chapter', cIndex, vol.id)}
                                                            onDragEnd={handleDragEnd}
                                                            onDragOver={(e) => e.preventDefault()}
                                                            onClick={() => !isRenamingChap && setActiveChapterId(chapter.id)}
                                                            className={`
                                                                w-full flex items-center justify-between p-2 text-sm rounded-md transition-colors text-left group cursor-grab active:cursor-grabbing
                                                                ${activeChapterId === chapter.id
                                                                ? 'bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300 font-medium'
                                                                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                                                            }
                                                                ${sidebarSearchTarget?.type === 'chapter' && sidebarSearchTarget.id === chapter.id ? 'ring-1 ring-brand-200 dark:ring-brand-800' : ''}
                                                            `}
                                                        >
                                                            <div className="flex items-center gap-2 overflow-hidden flex-1">
                                                                <GripVertical size={12} className="opacity-0 group-hover:opacity-30 text-slate-400 flex-shrink-0" />
                                                                <FileText size={14} className={`flex-shrink-0 ${activeChapterId === chapter.id ? 'text-brand-500' : 'text-slate-400'}`} />
                                                                {chapter.isEditable === false && <Lock size={14} className="text-rose-500 flex-shrink-0" />}

                                                                {isRenamingChap ? (
                                                                    <input
                                                                        ref={renameInputRef}
                                                                        type="text"
                                                                        value={renamingState.value}
                                                                        onChange={(e) => setRenamingState({...renamingState, value: e.target.value})}
                                                                        onKeyDown={handleRenameKeyDown}
                                                                        onBlur={submitRename}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-brand-300 dark:border-brand-800 rounded px-1 py-0.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-900"
                                                                    />
                                                                ) : (
                                                                    <span className="truncate">{chapter.title}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                {vol.chapters.length === 0 && <div className="text-xs text-slate-300 dark:text-slate-600 italic p-2">No chapters</div>}
                                            </div>
                                        )}
                                    </div>
                                )})}
                            <button onClick={handleAddVolume} className="w-full flex items-center gap-2 p-2 mt-4 text-xs font-medium text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-md hover:border-brand-400 hover:text-brand-600 dark:hover:text-brand-300 justify-center">
                                <Plus size={14} /> Create Volume
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-4 py-4">
                            <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300"><Folder size={20}/></div>
                            <div className="w-4 h-px bg-slate-200 dark:bg-slate-800"></div>
                            <div className="p-2 rounded-lg bg-brand-50 dark:bg-brand-950/40 text-brand-600 dark:text-brand-300"><FileText size={20}/></div>
                        </div>
                    )}
                </div>
            </aside>

            {/* Context Menu & Modals (Unchanged) */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg rounded-md py-1 w-44"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.type === 'chapter' && (
                        <button onClick={handleOpenPlotSetting} className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2">
                            <ScrollText size={12} /> Plot Setting
                        </button>
                    )}
                    <button onClick={startRenaming} className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2">
                        <Pencil size={12} /> Rename
                    </button>
                    <button onClick={handleDeleteClick} className="w-full text-left px-3 py-2 text-xs text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center gap-2">
                        <Trash2 size={12} /> Delete
                    </button>
                </div>
            )}

            {showDeleteModal && itemToDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4 text-rose-600">
                            <div className="p-2 bg-rose-100 rounded-full"><AlertTriangle size={24} /></div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete {itemToDelete.type === 'volume' ? 'Volume' : 'Chapter'}?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                            Are you sure you want to delete this {itemToDelete.type}? <br/>
                            {itemToDelete.type === 'volume' ? <span className="font-semibold text-rose-600">All chapters inside will be lost.</span> : <span>This action cannot be undone.</span>}
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button variant="ghost" onClick={() => { setShowDeleteModal(false); setItemToDelete(null); }}>Cancel</Button>
                            <Button variant="primary" className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200" onClick={confirmDelete}>Delete</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Area */}
            <main className="flex-1 flex flex-col min-w-0 bg-white dark:bg-slate-950 shadow-xl z-10">
                <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 flex-shrink-0">
                    <div className="flex items-center gap-4">
                        {activeChapter ? (
                            <div className="flex flex-col">
                                <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                                {activeVolume?.title} <ChevronRight size={10}/>
                                </span>
                                <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                            </div>
                        ) : (
                            <span className="text-slate-400 dark:text-slate-500 text-sm">Select a chapter to start writing</span>
                        )}
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 text-xs font-medium transition-colors duration-300">
                            {saveStatus === 'saved' && <><CheckCircle2 size={14} className="text-emerald-500" /><span className="text-slate-400">Saved</span></>}
                            {saveStatus === 'saving' && <><HistoryIcon size={14} className="text-brand-500 animate-spin" /><span className="text-brand-600">Saving...</span></>}
                            {saveStatus === 'unsaved' && <><Cloud size={14} className="text-amber-500" /><span className="text-amber-600">Unsaved Changes</span></>}
                        </div>

                        <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />

                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/books/${bookId}/foreshadowing`)}
                            className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                        >
                            <ListTree size={16} className="mr-2" />
                            Foreshadowing Board
                        </Button>

                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => navigate(`/books/${bookId}/settings`)}
                            className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50"
                        >
                            <Globe size={16} className="mr-2" />
                            World Building
                        </Button>

                        <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />

                        <Button variant="secondary" size="sm" className="text-brand-600 dark:text-brand-300 border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 hover:bg-brand-100 dark:hover:bg-brand-900/50" onClick={handleAIContinue} disabled={isAiLoading || isReadOnly}>
                            {isAiLoading ? <Loader2 size={16} className="animate-spin mr-2"/> : <Wand2 size={16} className="mr-2"/>}
                            {isAiLoading ? 'AI Writing...' : 'AI Continue'}
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setIsForeshadowingPanelOpen(prev => !prev)}
                            className="text-slate-600 dark:text-slate-300"
                            title={isForeshadowingPanelOpen ? 'Hide Foreshadowing & Plot' : 'Show Foreshadowing & Plot'}
                        >
                            {isForeshadowingPanelOpen ? <PanelRightClose size={16} className="mr-2"/> : <PanelRightOpen size={16} className="mr-2"/>}
                            Foreshadowing & Plot
                            {contextPanelItemCount > 0 && (
                                <span className="ml-2 rounded-full bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                    {contextPanelItemCount}
                                </span>
                            )}
                        </Button>
                        <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate('/settings', { state: { returnTo: `/editor/${bookId}` } })}
                            title="Global Settings"
                        >
                            <Settings className="block w-4 h-4" />
                        </Button>

                        {/* --- Export Dropdown --- */}
                        <div className="relative">
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); }}
                                disabled={isExporting}
                            >
                                {isExporting ? <Loader2 size={14} className="animate-spin mr-2"/> : <Download size={14} className="mr-2"/>}
                                Export
                            </Button>

                            {showExportMenu && (
                                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-md shadow-xl border border-slate-200 dark:border-slate-800 z-50 animate-in fade-in zoom-in duration-100 overflow-hidden">
                                    <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400">
                                        Export as...
                                    </div>
                                    <button
                                        onClick={handleExportWord}
                                        className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-3 transition-colors"
                                    >
                                        <div className="p-1.5 bg-blue-100 text-blue-600 rounded">
                                            <FileText size={16} />
                                        </div>
                                        <div>
                                            <div className="font-medium">Word Document</div>
                                            <div className="text-[10px] text-slate-400">.docx format</div>
                                        </div>
                                    </button>
                                    <div className="h-px bg-slate-100 dark:bg-slate-800 w-full"></div>
                                    <button
                                        onClick={handleExportPDF}
                                        className="w-full text-left px-4 py-3 text-sm text-slate-700 dark:text-slate-200 hover:bg-brand-50 dark:hover:bg-brand-950/40 hover:text-brand-700 dark:hover:text-brand-300 flex items-center gap-3 transition-colors"
                                    >
                                        <div className="p-1.5 bg-red-100 text-red-600 rounded">
                                            <FileType size={16} />
                                        </div>
                                        <div>
                                            <div className="font-medium">PDF Document</div>
                                            <div className="text-[10px] text-slate-400">High quality print</div>
                                        </div>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

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

                    <aside
                        className={`flex-shrink-0 overflow-hidden bg-white dark:bg-slate-950 shadow-xl transition-all duration-300 ease-in-out ${
                            isForeshadowingPanelOpen
                                ? 'w-80 xl:w-96 opacity-100 border-l border-slate-200 dark:border-slate-800'
                                : 'w-0 opacity-0 border-l-0 pointer-events-none'
                        }`}
                    >
                        <div className="h-full w-80 xl:w-96 flex flex-col">
                            <section className="flex-1 min-h-0 flex flex-col border-b border-slate-200 dark:border-slate-800">
                                <div className="h-14 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                            <MessageSquareText size={16} className="text-slate-400" />
                                            Foreshadowing
                                        </div>
                                        <p className="text-[11px] text-slate-400 truncate">
                                            {foreshadowings.filter(item => !item.isRecovered).length === 1
                                                ? '1 unrecovered note'
                                                : `${foreshadowings.filter(item => !item.isRecovered).length} unrecovered notes`}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setIsForeshadowingPanelOpen(false)}
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
                                            const excerpt = foreshadowingExcerptMap.get(item.id) || item.excerpt;
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
                                                        onClick={() => handleFocusForeshadowing(item.id)}
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
                                                            onChange={(event) => handleForeshadowingNoteChange(item.id, event.target.value)}
                                                            placeholder="Write the payoff, hidden meaning, or future reveal..."
                                                            className="min-h-[108px] w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-600 dark:focus:ring-brand-950/60"
                                                            disabled={isReadOnly}
                                                        />
                                                        <div className="mt-2 flex justify-end">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteForeshadowing(item.id)}
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
                                            {linkedPlotSettings.length === 1
                                                ? '1 linked plot setting'
                                                : `${linkedPlotSettings.length} linked plot settings`}
                                        </p>
                                    </div>
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => navigate(`/books/${bookId}/story-outline?chapterId=${activeChapterId}`)}
                                        disabled={!activeChapterId}
                                    >
                                        Open Outline
                                    </Button>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                                    {linkedPlotSettings.length === 0 ? (
                                        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-4 text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                                            No plot details have been linked to this chapter yet.
                                        </div>
                                    ) : (
                                        linkedPlotSettings.map((plot, index) => (
                                            <article
                                                key={plot.id}
                                                className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                                            Plot Setting {linkedPlotSettings.length - index}
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
};

export default Editor;
