import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, BrainstormWorkspace, Character } from '../../../types';
import { createEmptyPlanning } from '../../../domain/storyPlanning';
import { createEmptyBrainstorm } from '../../../data/brainstormMapping';
import { brainstormApi } from '../../../data/brainstormApi';
import CharacterSettings from '../../../pages/CharacterSettings';
import StoryOutline from '../../../pages/StoryOutline';
import { useRelationshipGraph } from '../../../features/relationships/hooks/useRelationshipGraph';
import { useBrainstormWorkspace } from '../../../features/brainstorm/hooks/useBrainstormWorkspace';
import { useBookshelfActions } from '../../../features/books/hooks/useBookshelfActions';

const mocks = vi.hoisted(() => ({
    book: undefined as Book | undefined,
    loadPlanning: vi.fn(), savePlanning: vi.fn(), loadGraph: vi.fn(), saveGraph: vi.fn(),
    updateCharacter: vi.fn(), updateBook: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn(),
}));
vi.mock('../../../InteractionContent/BooksContext', () => ({ useBooks: () => ({
    getBook: () => mocks.book, books: mocks.book ? [mocks.book] : [],
    fetchStoryPlanning: mocks.loadPlanning, saveStoryPlanning: mocks.savePlanning,
    fetchGraphData: mocks.loadGraph, saveGraphData: mocks.saveGraph,
    updateCharacter: mocks.updateCharacter, updateBook: mocks.updateBook,
}) }));
vi.mock('../../../InteractionContent/PreferencesContext', () => ({ usePreferences: () => ({ autoHighlightSettings: { disabledRoles: [] } }) }));
vi.mock('react-hot-toast', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const character: Character = { id: '4', bookId: '1', name: 'Alice', aliases: ['Al'], role: 'protagonist', tags: [], description: '', color: '#fff' };
const makeBook = (): Book => ({
    id: '1', title: 'Book', author: 'Author', status: 'serializing', lastModified: 1, characters: [{ ...character }],
    volumes: [{ id: '2', title: 'Volume', chapters: [{ id: '3', title: 'Chapter', content: 'Alice', wordCount: 1,
        status: 'draft', isEditable: true, foreshadowings: [] }] }],
});
function renderPage(page: React.ReactNode, route: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}><Routes><Route path="/books/:bookId/*" element={page} /></Routes></MemoryRouter></QueryClientProvider>);
}
function GraphWrapper({ children }: { children: React.ReactNode }) { return <ReactFlowProvider>{children}</ReactFlowProvider>; }
beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.book = makeBook();
    mocks.loadPlanning.mockResolvedValue(createEmptyPlanning());
    mocks.savePlanning.mockResolvedValue(true);
    mocks.loadGraph.mockResolvedValue({ nodes: [], edges: [] });
    mocks.saveGraph.mockResolvedValue(true);
    mocks.updateCharacter.mockResolvedValue(true);
    mocks.updateBook.mockResolvedValue(true);
    vi.spyOn(brainstormApi, 'get').mockResolvedValue(createEmptyBrainstorm());
});

describe('page draft and persistence boundaries', () => {
    it('keeps a failed character draft and reports success only after a successful retry', async () => {
        mocks.updateCharacter.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        renderPage(<CharacterSettings />, '/books/1/settings?charId=4');
        const name = await screen.findByDisplayValue('Alice');
        fireEvent.change(name, { target: { value: '  Alice Revised  ' } });
        fireEvent.change(screen.getByPlaceholderText('Alias 1'), { target: { value: 'Alice Revised' } });
        fireEvent.change(screen.getByPlaceholderText('Alias 2'), { target: { value: ' Ally ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
        expect(mocks.toastSuccess).not.toHaveBeenCalled();
        expect(name).toHaveValue('  Alice Revised  ');
        expect(mocks.updateCharacter).toHaveBeenCalledWith('1', '4', expect.objectContaining({ name: 'Alice Revised', aliases: ['Ally'] }));
        fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledTimes(1));
    });

    it('keeps planning edits made during a save dirty and submits them on the next save', async () => {
        const pending = deferred<boolean>();
        mocks.savePlanning.mockReturnValueOnce(pending.promise);
        renderPage(<StoryOutline />, '/books/1/story-outline');
        const summary = await screen.findByPlaceholderText('Write the high-level story arc, main conflict, turning points, and ending direction...');
        fireEvent.change(summary, { target: { value: 'Submitted version' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save Planning' }));
        fireEvent.change(summary, { target: { value: 'Newer draft' } });
        await act(async () => { pending.resolve(true); });
        expect(summary).toHaveValue('Newer draft');
        expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
        expect(screen.queryByText('Saved')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save Planning' }));
        await screen.findByText('Saved');
        expect(mocks.savePlanning).toHaveBeenLastCalledWith('1', expect.objectContaining({ storySummary: 'Newer draft' }));
    });

    it('does not apply an old planning load after leaving and reopening the page', async () => {
        const old = deferred<ReturnType<typeof createEmptyPlanning>>();
        mocks.loadPlanning.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...createEmptyPlanning(), storySummary: 'Current book' });
        const first = renderPage(<StoryOutline />, '/books/1/story-outline');
        first.unmount();
        mocks.book = { ...makeBook(), id: '9' };
        renderPage(<StoryOutline />, '/books/9/story-outline');
        await screen.findByDisplayValue('Current book');
        await act(async () => { old.resolve({ ...createEmptyPlanning(), storySummary: 'Old response' }); });
        expect(screen.getByDisplayValue('Current book')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('Old response')).not.toBeInTheDocument();
    });

    it('blocks graph saving after load failure and initializes characters only after a successful retry', async () => {
        mocks.loadGraph.mockResolvedValueOnce(null).mockResolvedValueOnce({ nodes: [], edges: [] });
        const { result } = renderHook(() => useRelationshipGraph('1', mocks.book), { wrapper: GraphWrapper });
        await waitFor(() => expect(result.current.loadError).toBe(true));
        expect(result.current.nodes).toEqual([]);
        await act(async () => { await result.current.handleSave(); });
        expect(mocks.saveGraph).not.toHaveBeenCalled();
        act(() => result.current.retry());
        await waitFor(() => expect(result.current.isGraphLoaded).toBe(true));
        expect(result.current.nodes[0].data.id).toBe('4');
    });

    it('does not mark newer graph positions saved by an earlier request', async () => {
        const pending = deferred<boolean>();
        mocks.saveGraph.mockReturnValueOnce(pending.promise);
        const { result } = renderHook(() => useRelationshipGraph('1', mocks.book), { wrapper: GraphWrapper });
        await waitFor(() => expect(result.current.isGraphLoaded).toBe(true));
        let saving!: Promise<void>;
        act(() => { saving = result.current.handleSave(); });
        act(() => result.current.onNodesChange([{ id: '4', type: 'position', position: { x: 30, y: 40 } }]));
        await act(async () => { pending.resolve(true); await saving; });
        expect(result.current.nodes[0].position).toEqual({ x: 30, y: 40 });
        expect(result.current.lastSaved).toBeNull();
    });

    it('keeps brainstorm text edited during saving and prevents concurrent generation', async () => {
        const pending = deferred<BrainstormWorkspace>();
        const save = vi.spyOn(brainstormApi, 'save').mockReturnValueOnce(pending.promise);
        const generate = vi.spyOn(brainstormApi, 'generate');
        const { result } = renderHook(() => useBrainstormWorkspace('1', mocks.book, '3'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        act(() => result.current.updateFinalContent('Submitted'));
        let saving!: Promise<void>;
        act(() => { saving = result.current.handleSave(); });
        await act(async () => { await result.current.handleGenerate(); });
        expect(generate).not.toHaveBeenCalled();
        act(() => result.current.updateFinalContent('Newer text'));
        await act(async () => { pending.resolve({ ...createEmptyBrainstorm(), finalContent: 'Submitted' }); await saving; });
        expect(save).toHaveBeenCalledTimes(1);
        expect(result.current.workspace.finalContent).toBe('Newer text');
        expect(result.current.saveState).toBe('dirty');
    });

    it('discards a generated response after the selected context changes', async () => {
        const pending = deferred<BrainstormWorkspace>();
        vi.spyOn(brainstormApi, 'generate').mockReturnValueOnce(pending.promise);
        const { result } = renderHook(() => useBrainstormWorkspace('1', mocks.book, '3'));
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        let generating!: Promise<void>;
        act(() => { generating = result.current.handleGenerate(); });
        act(() => result.current.toggleChapter('3'));
        await act(async () => { pending.resolve({ ...createEmptyBrainstorm(), selectedChapterIds: ['3'], finalContent: 'Stale result' }); await generating; });
        expect(result.current.selectedChapterIds).toEqual([]);
        expect(result.current.workspace.finalContent).toBe('');
        expect(result.current.errorMessage).toContain('draft changed');
    });

    it('deduplicates rename submission and retries despite an optimistic title update', async () => {
        const pending = deferred<boolean>();
        mocks.updateBook.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(true);
        const { result, rerender } = renderHook(() => useBookshelfActions());
        act(() => result.current.handleContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 } as React.MouseEvent, '1'));
        act(() => result.current.startRename());
        act(() => result.current.setRenamingValue('New title'));
        let first!: Promise<void>;
        act(() => { first = result.current.submitRename(); void result.current.submitRename(); });
        expect(mocks.updateBook).toHaveBeenCalledTimes(1);
        mocks.book = { ...mocks.book!, title: 'New title' };
        rerender();
        await act(async () => { pending.resolve(false); await first; });
        expect(result.current.renamingId).toBe('1');
        await act(async () => { await result.current.submitRename(); });
        expect(mocks.updateBook).toHaveBeenCalledTimes(2);
        expect(result.current.renamingId).toBeNull();
    });
});
