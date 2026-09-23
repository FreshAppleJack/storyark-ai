import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { planningRepository, type LocalPlanning } from '../../../data/local/planningRepository';
import { localKeys, projectBook, type LocalBookDetail } from '../../../data/local/repository';
import { useStoryPlanning } from '../../../features/planning/hooks/useStoryPlanning';
import { createChapterSummarySourceSnapshot } from '../../../domain/chapterSummarySource';
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
    expect(save.mock.calls[1][0].chapterSummaries[0]).toMatchObject({
        provenance: 'author',
        sourceSnapshot: { chapterId: chapter.id, chapterDatabaseVersion: 1, fingerprintAlgorithm: 'fnv1a64-utf16-v1' },
    });
    expect(result.current.planning.databaseVersion).toBe(2);
    expect(result.current.isDirty).toBe(false);
    expect(legacy.save).not.toHaveBeenCalled();
});

it('keeps a stale legacy summary flagged until the author explicitly edits it', async () => {
    const currentChapter = { ...chapter, databaseVersion: 2 };
    const currentDetail: LocalBookDetail = { ...detail, chapters: [currentChapter, { ...chapter, id: 'other-chapter' }] };
    const currentBook = projectBook(book, currentDetail);
    const stalePlanning: LocalPlanning = {
        ...initial,
        databaseVersion: 1,
        chapterSummaries: [{ chapterId: currentChapter.id, summary: 'Review acknowledged', sourceChapterVersion: 1, updatedAt: 1 }],
    };
    const save = vi.spyOn(planningRepository, 'save').mockImplementation(async input => ({
        planning: { ...stalePlanning, ...input, databaseVersion: 2 },
        sessionKey: input.sessionKey,
        revision: input.revision,
    }));
    const { result } = renderHook(() => useStoryPlanning(book.id, currentBook, useLocalPlanningPersistence(stalePlanning)), wrapper());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.chapterOptions[0].sourceChanged).toBe(true);

    await act(async () => { await result.current.handleSave(); });

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
        chapterSummaries: [expect.objectContaining({ sourceChapterVersion: 1 })],
    }));
    expect(result.current.chapterOptions[0].sourceChanged).toBe(true);
    expect(result.current.chapterOptions[0].summaryFreshness?.status).toBe('needs-review');

    act(() => result.current.updateChapterSummary(currentChapter.id, 'Reviewed against the current chapter.'));
    await act(async () => { await result.current.flush(); });

    expect(save.mock.calls.at(-1)?.[0].chapterSummaries[0]).toMatchObject({
        sourceChapterVersion: 2,
        provenance: 'author',
        sourceSnapshot: { chapterId: currentChapter.id, chapterDatabaseVersion: 2 },
    });
    expect(result.current.chapterOptions[0].sourceChanged).toBe(false);
    expect(result.current.chapterOptions[0].summaryFreshness?.status).toBe('current');
});

it('keeps an accepted AI summary in the planning draft when the optimistic save conflicts', async () => {
    const save = vi.spyOn(planningRepository, 'save').mockRejectedValue(new Error('VERSION_CONFLICT'));
    const { result } = renderHook(() => useStoryPlanning(book.id, projected, useLocalPlanningPersistence(initial)), wrapper());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const sourceSnapshot = createChapterSummarySourceSnapshot(projected.volumes[0].chapters[0], 100);
    const generationMetadata = {
        providerId: 'api.example.invalid',
        configId: '00000000-0000-4000-8000-000000000080',
        protocol: 'openai-responses',
        modelId: 'model-a',
        generatedAt: 100,
        promptVersion: 'chapter-summary-v1',
        source: {
            bookId: book.id,
            chapterId: chapter.id,
            chapterDatabaseVersion: 1,
            sourceBodyFingerprint: sourceSnapshot.bodyFingerprint,
            planningDatabaseVersion: 0,
            allowedSources: [],
            retrievalTrace: null,
            includesFuturePlan: false as const,
        },
    };

    await act(async () => {
        expect(await result.current.adoptChapterSummarySuggestion({
            chapterId: chapter.id,
            summary: 'Accepted candidate kept in the draft.',
            sourceSnapshot,
            generationMetadata,
            expectedDraftRevision: 0,
        })).toBe('save-failed');
    });

    expect(result.current.planning.chapterSummaries[0]).toMatchObject({
        summary: 'Accepted candidate kept in the draft.',
        provenance: 'ai-adopted',
        generationMetadata: { modelId: 'model-a' },
    });
    expect(result.current.isDirty).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].expectedDatabaseVersion).toBe(0);
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
