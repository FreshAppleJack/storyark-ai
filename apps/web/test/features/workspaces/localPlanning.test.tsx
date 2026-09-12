import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { planningRepository, type LocalPlanning } from '../../../data/local/planningRepository';
import { localKeys, projectBook, type LocalBookDetail } from '../../../data/local/repository';
import { useStoryPlanning } from '../../../features/planning/hooks/useStoryPlanning';
import { useLocalPlanningPersistence } from '../../../features/planning/hooks/useLocalPlanningPersistence';
import { useLocalNoteDrafts } from '../../../features/foreshadowing/hooks/useLocalNoteDrafts';
import { collectForeshadowingCards, foreshadowingCardKey } from '../../../features/foreshadowing/foreshadowingSelectors';

const legacy = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('../../../InteractionContent/BooksContext', () => ({ useBooks: () => ({ fetchStoryPlanning: legacy.load, saveStoryPlanning: legacy.save }) }));
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn() } }));
const book = { id: 'book', title: 'Book', author: '', status: 'serializing' as const, position: 0, isReadOnly: false, databaseVersion: 1, createdAt: 1, updatedAt: 1 };
const volume = { ...book, id: 'volume', bookId: book.id, status: 'draft' as const };
const note = { id: 'same-old-id', note: 'Original', excerpt: 'No mark', createdAt: 1, updatedAt: 1, extra: 'keep' };
const chapter = { ...volume, id: 'chapter', volumeId: volume.id, wordCount: 0, foreshadowings: [note],
    body: { format: 'tiptap-json' as const, version: 1 as const, content: '{"type":"doc","content":[{"type":"paragraph"}]}', originalContent: null, originalFormat: null } };
const detail: LocalBookDetail = { book, volumes: [volume], chapters: [chapter, { ...chapter, id: 'other-chapter' }] };
const projected = projectBook(book, detail);
const initial: LocalPlanning = { bookId: book.id, databaseVersion: 0, storySummary: '', storyBackground: '', chapterSummaries: [], plotSettings: [] };
function wrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(localKeys.book(book.id), detail);
    return { client, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

it('saves newer planning edits in order and keeps the chapter source version', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const save = vi.spyOn(planningRepository, 'save').mockImplementation(async input => {
        if (input.expectedDatabaseVersion === 0) await pending;
        return { planning: { ...initial, ...input, databaseVersion: input.expectedDatabaseVersion + 1 }, sessionKey: input.sessionKey, revision: input.revision };
    });
    const { result } = renderHook(() => useStoryPlanning(book.id, projected, useLocalPlanningPersistence(initial)), wrapper());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.updateChapterSummary(chapter.id, 'Summary with source'));
    let saving!: Promise<boolean>;
    act(() => { saving = result.current.flush(); });
    act(() => result.current.updatePlanningField('storyBackground', 'New world rule'));
    await act(async () => { release(); expect(await saving).toBe(true); });
    expect(save.mock.calls.map(([input]) => input.expectedDatabaseVersion)).toEqual([0, 1]);
    expect(save.mock.calls[1][0].storyBackground).toBe('New world rule');
    expect(save.mock.calls[1][0].chapterSummaries[0].sourceChapterVersion).toBe(1);
    expect(result.current.isDirty).toBe(false);
    expect(legacy.save).not.toHaveBeenCalled();
});

it('retains planning on conflict and does not advance the expected version', async () => {
    const save = vi.spyOn(planningRepository, 'save').mockRejectedValue(new Error('VERSION_CONFLICT'));
    const { result } = renderHook(() => useStoryPlanning(book.id, projected, useLocalPlanningPersistence(initial)), wrapper());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.updatePlanningField('storySummary', 'Keep my draft'));
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    expect(result.current.planning.storySummary).toBe('Keep my draft');
    expect(result.current.isDirty).toBe(true);
    expect(save.mock.calls.map(([input]) => input.expectedDatabaseVersion)).toEqual([0, 0]);
});

it('cannot save a planning workspace after load failure', async () => {
    const save = vi.fn();
    const persistence = { load: async () => { throw new Error('Storage failure'); }, save };
    const { result } = renderHook(() => useStoryPlanning(book.id, projected, persistence), wrapper());
    await waitFor(() => expect(result.current.loadError).toBe(true));
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    expect(save).not.toHaveBeenCalled();
});

it('scopes identical orphan note IDs by chapter and does not write a stale full chapter', async () => {
    const cards = collectForeshadowingCards(projected);
    expect(cards).toHaveLength(2);
    expect(cards.every(card => !card.isLocated)).toBe(true);
    expect(foreshadowingCardKey(cards[0])).not.toBe(foreshadowingCardKey(cards[1]));
    const update = vi.spyOn(planningRepository, 'updateNote').mockImplementation(async input => ({ ...chapter,
        id: input.chapterId, databaseVersion: 2, foreshadowings: [{ ...note, note: input.note ?? note.note }] }));
    const { result } = renderHook(() => useLocalNoteDrafts(detail), wrapper());
    act(() => result.current.editNote(cards[0], 'Edited orphan'));
    await act(async () => { expect(await result.current.flush()).toBe(true); });
    expect(update.mock.calls[0][0]).toEqual({ bookId: book.id, chapterId: chapter.id, noteId: note.id, expectedDatabaseVersion: 1, note: 'Edited orphan', isRecovered: undefined });
    expect(result.current.isDirty).toBe(false);
});

it('retains note changes on failure and serializes changes made during a pending save', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const update = vi.spyOn(planningRepository, 'updateNote').mockImplementation(async input => {
        if (input.expectedDatabaseVersion === 1) await pending;
        return { ...chapter, databaseVersion: input.expectedDatabaseVersion + 1, foreshadowings: [{ ...note, note: input.note ?? '' }] };
    });
    const card = collectForeshadowingCards(projected)[0];
    const { result } = renderHook(() => useLocalNoteDrafts(detail), wrapper());
    act(() => result.current.editNote(card, 'First'));
    let saving!: Promise<boolean>;
    await act(async () => { saving = result.current.flush(); });
    act(() => result.current.editNote(card, 'Second'));
    await act(async () => { release(); expect(await saving).toBe(true); });
    expect(update.mock.calls.map(([input]) => input.expectedDatabaseVersion)).toEqual([1, 2]);
    update.mockRejectedValue(new Error('VERSION_CONFLICT'));
    act(() => result.current.editNote(card, 'Keep after conflict'));
    await act(async () => { expect(await result.current.flush()).toBe(false); });
    expect(result.current.drafts[foreshadowingCardKey(card)].note).toBe('Keep after conflict');
    expect(result.current.isDirty).toBe(true);
});
