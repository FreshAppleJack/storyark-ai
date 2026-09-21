import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, FileText, Folder,
    GripVertical, Lock, Pencil, Plus, ScrollText, Search, Sparkles, Trash2,
} from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Book, Chapter, Volume } from '../../../types';
import { getFuzzyScore } from '../../../utils/search';
import { StorySearchResults } from '../../retrieval/components/StorySearchResults';
import { useLocalStorySearch } from '../../retrieval/hooks/useLocalStorySearch';
import type { RetrievalSearchHit } from '../../../domain/retrieval/contracts';

export type NavigatorItemType = 'volume' | 'chapter';

export interface NavigatorDeleteTarget {
    type: NavigatorItemType;
    id: string;
    parentId?: string;
}

interface ContextMenuState {
    x: number;
    y: number;
    type: NavigatorItemType;
    id: string;
    parentId?: string;
}

interface RenamingState {
    id: string;
    type: NavigatorItemType;
    value: string;
}

interface DragItemState {
    index: number;
    type: NavigatorItemType;
    parentId?: string;
}

type SidebarSearchMode = 'chapter' | 'volume';
type StorySearchMode = 'title' | 'semantic';

interface SidebarSearchResult {
    type: SidebarSearchMode;
    volumeId: string;
    volumeTitle: string;
    chapterId?: string;
    chapterTitle?: string;
    score: number;
}

interface ChapterNavigatorProps {
    localMode?: boolean;
    book: Book;
    activeChapterId: string;
    onNavigateDashboard: () => void;
    onSelectChapter: (chapterId: string) => void;
    onAddVolume: (title: string) => Promise<string | null>;
    onAddChapter: (volumeId: string, title: string) => Promise<string | null>;
    onRenameVolume: (volumeId: string, title: string) => Promise<void>;
    onRenameChapter: (chapterId: string, title: string) => Promise<void>;
    onDeleteItem: (target: NavigatorDeleteTarget) => Promise<void>;
    onReorderVolumes: (volumes: Volume[]) => void;
    onReorderChapters: (volumeId: string, chapters: Chapter[]) => void;
    onOpenPlotSetting: (chapterId: string) => void;
}

/**
 * Left sidebar of the editor page: volume/chapter tree with fuzzy search,
 * inline rename, drag & drop reordering, a right-click context menu and the
 * delete confirmation modal. All domain mutations are delegated to the parent
 * page through callbacks; this component owns only its local UI state.
 */
export function ChapterNavigator({
    localMode = false,
    book,
    activeChapterId,
    onNavigateDashboard,
    onSelectChapter,
    onAddVolume,
    onAddChapter,
    onRenameVolume,
    onRenameChapter,
    onDeleteItem,
    onReorderVolumes,
    onReorderChapters,
    onOpenPlotSetting,
}: ChapterNavigatorProps): React.ReactElement {
    const [sidebarExpanded, setSidebarExpanded] = useState(true);
    const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(() => new Set(book.volumes.map(v => v.id)));
    const [storySearchMode, setStorySearchMode] = useState<StorySearchMode>('title');
    const [sidebarSearchMode, setSidebarSearchMode] = useState<SidebarSearchMode>('chapter');
    const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
    const [sidebarSearchMessage, setSidebarSearchMessage] = useState('');
    const [sidebarSearchTarget, setSidebarSearchTarget] = useState<{ type: SidebarSearchMode; id: string } | null>(null);

    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<NavigatorDeleteTarget | null>(null);
    const [renamingState, setRenamingState] = useState<RenamingState | null>(null);

    const renameInputRef = useRef<HTMLInputElement>(null);
    const submittedRenameRef = useRef<RenamingState | null>(null);
    const dragItemRef = useRef<DragItemState | null>(null);
    const dragOverItemRef = useRef<DragItemState | null>(null);
    const storySearch = useLocalStorySearch(book.id, localMode && storySearchMode === 'semantic');

    // Only reconcile membership; content updates and reordering preserve user choices.
    const volumeIds = book.volumes.map(volume => volume.id);
    const [knownVolumes, setKnownVolumes] = useState({ bookId: book.id, ids: volumeIds });
    if (knownVolumes.bookId !== book.id || knownVolumes.ids.length !== volumeIds.length
        || volumeIds.some(id => !knownVolumes.ids.includes(id))) {
        setKnownVolumes({ bookId: book.id, ids: volumeIds });
        setExpandedVolumes(new Set(volumeIds.filter(id => knownVolumes.bookId !== book.id
            || !knownVolumes.ids.includes(id) || expandedVolumes.has(id))));
    }

    const cancelRename = useCallback(() => {
        submittedRenameRef.current = renamingState;
        setRenamingState(null);
    }, [renamingState]);

    const submitRename = useCallback(async () => {
        if (!renamingState || submittedRenameRef.current === renamingState) return;
        // Claim this edit before blur/Enter can submit it again. A completed
        // request must not close a newer rename session.
        submittedRenameRef.current = renamingState;
        setRenamingState(null);
        const { id, type, value } = renamingState;
        if (!value.trim()) return;
        try {
            if (type === 'volume') {
                await onRenameVolume(id, value);
            } else {
                await onRenameChapter(id, value);
            }
        } catch (e) { console.error("Rename failed", e); }
    }, [renamingState, onRenameVolume, onRenameChapter]);

    // Rename commits on input blur or Enter, not on bubbling click events.
    useEffect(() => {
        const handleClick = () => {
            setContextMenu(null);
        };
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    useEffect(() => {
        if (renamingState && renameInputRef.current) {
            renameInputRef.current.focus();
            renameInputRef.current.select();
        }
        // Only re-focus when the rename target changes, not on each keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [renamingState?.id]);

    const sidebarSearchResults = useMemo<SidebarSearchResult[]>(() => {
        if (!sidebarSearchQuery.trim()) return [];

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

    // --- Drag & Drop Handlers ---
    const handleDragStart = (e: React.DragEvent, type: NavigatorItemType, index: number, parentId?: string) => {
        if (renamingState) {
            e.preventDefault(); return;
        }
        dragItemRef.current = { index, type, parentId };
        (e.currentTarget as HTMLDivElement).style.opacity = '0.5';
        e.stopPropagation();
    };

    const handleDragEnter = (e: React.DragEvent, type: NavigatorItemType, index: number, parentId?: string) => {
        e.preventDefault(); e.stopPropagation();
        if (renamingState) return;

        dragOverItemRef.current = { index, type, parentId };

        if (!dragItemRef.current) return;
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
            onReorderVolumes(newVolumes);
        } else if (type === 'chapter') {
            const volume = book.volumes.find(v => v.id === parentId);
            if (volume) {
                const newChapters = [...volume.chapters];
                const draggedChap = newChapters[dragIndex];
                newChapters.splice(dragIndex, 1);
                newChapters.splice(hoverIndex, 0, draggedChap);
                onReorderChapters(volume.id, newChapters);
            }
        }
        dragItemRef.current.index = hoverIndex;
    };

    const handleDragEnd = (e: React.DragEvent) => {
        (e.currentTarget as HTMLDivElement).style.opacity = '1';
        dragItemRef.current = null;
        dragOverItemRef.current = null;
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
        const volTitle = `Volume ${book.volumes.length + 1}`;
        const newVolumeId = await onAddVolume(volTitle);
        if (newVolumeId) {
            setRenamingState({ id: newVolumeId, type: 'volume', value: volTitle });
        }
    };

    const handleAddChapter = async (volId: string) => {
        const chapTitle = "New Chapter";
        const newChapterId = await onAddChapter(volId, chapTitle);
        if (newChapterId) {
            setRenamingState({ id: newChapterId, type: 'chapter', value: chapTitle });
        }
    };

    const handleContextMenu = (e: React.MouseEvent, type: NavigatorItemType, id: string, parentId?: string) => {
        e.preventDefault(); e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, type, id, parentId });
    };

    const startRenaming = () => {
        if (!contextMenu) return;
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
            onSelectChapter(result.chapterId);
            setSidebarSearchTarget({ type: 'chapter', id: result.chapterId });
            setSidebarSearchMessage(result.type === 'volume'
                ? `Opened the first chapter in "${result.volumeTitle}".`
                : `Opened "${result.chapterTitle}".`
            );
            scrollSidebarItemIntoView('chapter', result.chapterId);
        } else {
            onSelectChapter('');
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

        if (storySearchMode === 'semantic') {
            void storySearch.search(trimmedQuery);
            return;
        }

        const firstResult = sidebarSearchResults[0];
        if (!firstResult) {
            setSidebarSearchMessage(`No matching ${sidebarSearchMode}s found.`);
            return;
        }

        selectSidebarSearchResult(firstResult);
    };

    const selectStorySearchResult = (hit: RetrievalSearchHit) => {
        const chapterId = hit.chapterId || hit.locator.chapterId;
        if (!chapterId) return;

        const volume = book.volumes.find(candidate => candidate.chapters.some(chapter => chapter.id === chapterId));
        if (!volume) {
            setSidebarSearchMessage('This source belongs to a chapter that is no longer in the current book.');
            return;
        }

        setExpandedVolumes(prev => {
            const next = new Set(prev);
            next.add(volume.id);
            return next;
        });
        onSelectChapter(chapterId);
        setSidebarSearchTarget({ type: 'chapter', id: chapterId });
        setSidebarSearchMessage(`Opened the source chapter: "${hit.locator.chapterTitleSnapshot || chapterId}".`);
        scrollSidebarItemIntoView('chapter', chapterId);
    };

    const handleDeleteClick = () => {
        if (contextMenu) {
            setItemToDelete({ type: contextMenu.type, id: contextMenu.id, parentId: contextMenu.parentId });
            setShowDeleteModal(true); setContextMenu(null);
        }
    };

    const handleOpenPlotSetting = () => {
        if (!contextMenu || contextMenu.type !== 'chapter') return;
        onOpenPlotSetting(contextMenu.id);
        setContextMenu(null);
    };

    const confirmDelete = async () => {
        if (itemToDelete) {
            await onDeleteItem(itemToDelete);
        }
        setShowDeleteModal(false); setItemToDelete(null);
    };

    return (
        <>
            <aside className={`flex-shrink-0 bg-slate-50 dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 ease-in-out flex flex-col ${sidebarExpanded ? 'w-72' : 'w-16'}`}>
                {/* Sidebar Header */}
                <div className="h-14 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4">
                    {sidebarExpanded ? (
                        <div className="flex items-center gap-2 overflow-hidden cursor-pointer" onClick={onNavigateDashboard}>
                            <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white flex-shrink-0">
                                <ArrowLeft size={16} />
                            </div>
                            <span className="font-bold text-slate-800 dark:text-white truncate text-xs">Back to Dashboard</span>
                        </div>
                    ) : (
                        <div onClick={onNavigateDashboard} className="w-8 h-8 mx-auto bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer rounded-lg flex items-center justify-center text-slate-600 dark:text-slate-300 font-serif font-bold">
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
                            {localMode && (
                                <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-[11px] font-medium dark:bg-slate-900">
                                    {(['title', 'semantic'] as StorySearchMode[]).map((mode) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            onClick={() => {
                                                setStorySearchMode(mode);
                                                setSidebarSearchMessage('');
                                                storySearch.clearSearch();
                                            }}
                                            className={`rounded-md px-2 py-1.5 transition ${
                                                storySearchMode === mode
                                                    ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-300'
                                                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                                            }`}
                                        >
                                            {mode === 'title' ? 'Title / Chapter' : 'Semantic / Story'}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {(storySearchMode === 'title' || !localMode) && (
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
                            )}
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
                                {storySearchMode === 'semantic' ? (
                                    <Sparkles size={15} className="flex-shrink-0 text-brand-500" />
                                ) : (
                                    <Search size={15} className="flex-shrink-0 text-slate-400" />
                                )}
                                <input
                                    value={sidebarSearchQuery}
                                    onChange={(event) => {
                                        setSidebarSearchQuery(event.target.value);
                                        setSidebarSearchMessage('');
                                        if (storySearchMode === 'semantic') storySearch.clearSearch();
                                    }}
                                    placeholder={storySearchMode === 'semantic' ? 'Search the story' : `Search ${sidebarSearchMode}s`}
                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                />
                                <button
                                    type="submit"
                                    disabled={storySearchMode === 'semantic' && storySearch.isSearching}
                                    className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-700"
                                >
                                    {storySearchMode === 'semantic' && storySearch.isSearching ? '…' : 'Go'}
                                </button>
                            </div>
                            {storySearchMode === 'semantic' ? (
                                <StorySearchResults
                                    embeddingStatus={storySearch.embeddingStatus}
                                    indexStatus={storySearch.indexStatus}
                                    statusError={storySearch.statusError}
                                    isStatusLoading={storySearch.isStatusLoading}
                                    isIndexing={storySearch.isIndexing}
                                    isSearching={storySearch.isSearching}
                                    searchError={storySearch.searchError}
                                    response={storySearch.response}
                                    lastQuery={storySearch.lastQuery}
                                    onQueueIndex={() => void storySearch.queueIndex()}
                                    onSelectHit={selectStorySearchResult}
                                />
                            ) : sidebarSearchQuery.trim() && sidebarSearchResults.length > 0 && (
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
                            {storySearchMode !== 'semantic' && sidebarSearchMessage && (
                                <p className={`text-xs leading-5 ${sidebarSearchMessage.startsWith('No ') || sidebarSearchMessage.startsWith('Type ') ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {sidebarSearchMessage}
                                </p>
                            )}
                        </form>
                    </div>
                )}

                {/* Sidebar List */}
                <div className="flex-1 overflow-y-auto py-2 custom-scrollbar relative">
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
                                                            onClick={() => !isRenamingChap && onSelectChapter(chapter.id)}
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

            {/* Navigator context menu */}
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

            {/* Delete confirmation modal */}
            {showDeleteModal && itemToDelete && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 p-6 rounded-lg shadow-xl max-w-sm w-full mx-4 border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center gap-3 mb-4 text-rose-600">
                            <div className="p-2 bg-rose-100 rounded-full"><AlertTriangle size={24} /></div>
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Delete {itemToDelete.type === 'volume' ? 'Volume' : 'Chapter'}?</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mb-6 text-sm leading-relaxed">
                            Are you sure you want to delete this {itemToDelete.type}? <br/>
                            {localMode && <span>Chapter summaries and live planning/brainstorm links will be removed. Plot text and historical snapshots will be retained with missing-source notices. </span>}
                            {itemToDelete.type === 'volume' ? <span className="font-semibold text-rose-600">All chapters inside will be lost.</span> : <span>This action cannot be undone.</span>}
                        </p>
                        <div className="flex justify-end gap-3">
                            <Button variant="ghost" onClick={() => { setShowDeleteModal(false); setItemToDelete(null); }}>Cancel</Button>
                            <Button variant="primary" className="bg-rose-600 hover:bg-rose-700 text-white border-none shadow-md shadow-rose-200" onClick={confirmDelete}>Delete</Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
