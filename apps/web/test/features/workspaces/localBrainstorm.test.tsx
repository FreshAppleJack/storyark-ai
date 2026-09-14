import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Book } from '../../../types';
import type { LocalBrainstorm } from '../../../data/local/brainstormRepository';
import { brainstormRepository } from '../../../data/local/brainstormRepository';
import { createEmptyBrainstorm } from '../../../data/brainstormMapping';
import { brainstormApi } from '../../../data/brainstormApi';
import { useBrainstormWorkspace, type BrainstormSources } from '../../../features/brainstorm/hooks/useBrainstormWorkspace';
import { useLocalBrainstormPersistence } from '../../../features/brainstorm/hooks/useLocalBrainstormPersistence';
import { isContextSnapshotStale } from '../../../features/brainstorm/brainstormContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const legacy = vi.hoisted(() => ({ planning: vi.fn(), graph: vi.fn() }));
const api = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn(), save: vi.fn() }));
vi.mock('../../../InteractionContent/BooksContext', () => ({ useBooks: () => ({ fetchStoryPlanning: legacy.planning, fetchGraphData: legacy.graph }) }));
vi.mock('../../../InteractionContent/PreferencesContext', () => ({ usePreferences: () => ({ autoHighlightSettings: { disabledRoles: [] } }) }));
vi.mock('../../../data/brainstormApi', () => ({ brainstormApi: api }));

const book: Book = {
    id: 'book', title: 'Book', author: '', status: 'serializing', lastModified: 0,
    volumes: [{ id: 'volume', title: 'Volume', chapters: [
        { id: 'chapter-1', title: 'One', content: 'text', databaseVersion: 3, foreshadowings: [] },
        { id: 'chapter-2', title: 'Two', content: '', databaseVersion: 1, foreshadowings: [] },
    ] as never[] }],
    characters: [],
};
const planning = { storySummary: 'Overview', storyBackground: 'World', chapterSummaries: [{ chapterId: 'chapter-1', summary: 'Summary one', updatedAt: 1, sourceChapterVersion: 3 }], plotSettings: [] };
const initial: LocalBrainstorm = {
    bookId: 'book', databaseVersion: 4, selectedChapterIds: ['chapter-1'],
    contextSnapshot: {}, generatedOptions: [], selectedOptionId: null, finalContent: 'Draft finale',
};

function setup(workspace = initial) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(() => {
        const persistence = useLocalBrainstormPersistence(workspace);
        const sources: BrainstormSources = { planning, relationships: [], persistence };
        return useBrainstormWorkspace(book.id, book, null, sources);
    }, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('loads the local workspace without legacy calls and disables generation', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.workspace.finalContent).toBe('Draft finale');
    expect(result.current.selectedChapterIds).toEqual(['chapter-1']);
    expect(result.current.generationAvailable).toBe(false);
    expect(legacy.planning).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => { await result.current.handleGenerate(); });
    expect(api.generate).not.toHaveBeenCalled();
});

it('saves through the pinned version and drains edits made while saving', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const save = vi.spyOn(brainstormRepository, 'save').mockImplementation(async input => {
        if (input.expectedDatabaseVersion === 4) await pending;
        return { workspace: { ...input, databaseVersion: input.expectedDatabaseVersion + 1, bookId: 'book', updatedAt: 1 } as never,
            sessionKey: input.sessionKey, revision: input.revision };
    });
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.updateFinalContent('First revision'));
    let flushing!: Promise<boolean>;
    act(() => { flushing = result.current.handleSave().then(() => true); });
    act(() => result.current.updateFinalContent('Second revision'));
    await act(async () => { release(); await flushing; });
    const versions = save.mock.calls.map(([input]) => input.expectedDatabaseVersion);
    expect(versions).toEqual([4, 5]);
    expect(save.mock.calls[1][0].finalContent).toBe('Second revision');
    expect(result.current.saveState).toBe('saved');
    expect(result.current.isDirty).toBe(false);
});

it('keeps the draft and reports the error when a save fails, without clearing newer input', async () => {
    const save = vi.spyOn(brainstormRepository, 'save').mockRejectedValue(new Error('VERSION_CONFLICT'));
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.updateFinalContent('Keep me'));
    await act(async () => { await result.current.handleSave(); });
    expect(result.current.errorMessage).toContain('VERSION_CONFLICT');
    expect(result.current.workspace.finalContent).toBe('Keep me');
    expect(result.current.isDirty).toBe(true);
    expect(save.mock.calls.every(([input]) => input.expectedDatabaseVersion === 4)).toBe(true);
});

it('marks a failed load and never flushes an empty workspace over it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const failing = {
        load: vi.fn().mockRejectedValue(new Error('disk gone')),
        save: vi.fn(),
    };
    const { result } = renderHook(() => useBrainstormWorkspace(book.id, book, null, { planning, relationships: [], persistence: failing }),
        { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(result.current.loadError).toBe(true));
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    expect(failing.save).not.toHaveBeenCalled();
});

it('detects stale snapshots from chapter versions and summary drift', () => {
    const options = [{ id: 'chapter-1', databaseVersion: 3, summary: 'Summary one' } as never];
    const fresh = { selectedChapters: [{ id: 'chapter-1', databaseVersion: 3, summary: 'Summary one' }] };
    expect(isContextSnapshotStale(fresh, options)).toBe(false);
    expect(isContextSnapshotStale({ selectedChapters: [{ id: 'chapter-1', databaseVersion: 2, summary: 'Summary one' }] }, options)).toBe(true);
    expect(isContextSnapshotStale({ selectedChapters: [{ id: 'chapter-1', summary: 'Summary one' }] }, options)).toBe(true);
    expect(isContextSnapshotStale({ selectedChapters: [{ id: 'chapter-1', databaseVersion: 3, summary: 'Rewritten' }] }, options)).toBe(true);
    expect(isContextSnapshotStale({}, options)).toBe(false);
});

it('builds the snapshot on first save with chapter source versions', async () => {
    vi.spyOn(brainstormRepository, 'save').mockImplementation(async input => (
        { workspace: { ...input, databaseVersion: 5, bookId: 'book', updatedAt: 1 } as never, sessionKey: input.sessionKey, revision: input.revision }
    ));
    const { result } = setup();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.updateFinalContent('Final'));
    await act(async () => { await result.current.handleSave(); });
    const input = vi.mocked(brainstormRepository.save).mock.calls[0][0];
    const snapshot = input.contextSnapshot as { selectedChapters: Array<{ id: string; databaseVersion?: number }> };
    expect(snapshot.selectedChapters[0]).toMatchObject({ id: 'chapter-1', databaseVersion: 3 });
    expect(result.current.isSnapshotStale).toBe(false);
});

it('does not reuse the previous selection state when a new brainstorm candidate replaces it', async () => {
    const nextBook: Book = {
        ...book,
        volumes: [{
            ...book.volumes[0],
            chapters: [
                ...book.volumes[0].chapters,
                { id: '4', title: 'Next chapter', content: 'Alice continues', wordCount: 2, status: 'draft', isEditable: true, foreshadowings: [] },
            ],
        }],
    };
    const option = (id: string, title: string) => ({
        id, title, conflict: `${title} conflict`, motivation: `${title} motivation`,
        consequences: `${title} consequences`, development: `${title} development`,
    });
    const previousOptions = [option('old-1', 'Previous one'), option('old-2', 'Previous two'), option('old-3', 'Previous three')];
    const nextOptions = [option('new-1', 'New one'), option('new-2', 'New two'), option('new-3', 'New three')];
    legacy.planning.mockResolvedValue(planning);
    legacy.graph.mockResolvedValue({ nodes: [], edges: [] });
    api.get.mockResolvedValue(createEmptyBrainstorm());
    vi.spyOn(brainstormApi, 'generate')
        .mockResolvedValueOnce({ ...createEmptyBrainstorm(), generatedOptions: previousOptions } as never)
        .mockResolvedValueOnce({ ...createEmptyBrainstorm(), generatedOptions: nextOptions } as never);

    const { result } = renderHook(() => useBrainstormWorkspace('book', nextBook, null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.toggleChapter('3'));
    await act(async () => { await result.current.handleGenerate(); });
    act(() => result.current.chooseOption(previousOptions[0]));
    expect(result.current.workspace.selectedOptionId).toBe('old-1');
    expect(result.current.workspace.finalContent).toContain('Previous one');

    act(() => result.current.toggleChapter('4'));
    await act(async () => { await result.current.handleGenerate(); });

    expect(result.current.visibleOptions.map(item => item.id)).toEqual(['new-1', 'new-2', 'new-3']);
    expect(result.current.hasSelectedOption).toBe(false);
    act(() => result.current.chooseOption(nextOptions[0]));
    expect(result.current.workspace.selectedOptionId).toBe('new-1');
    expect(result.current.workspace.finalContent).toContain('New one');
});
