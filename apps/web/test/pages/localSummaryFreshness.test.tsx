import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChapterSummaryGenerationMetadata } from '../../domain/chapterSummarySource';
import { createChapterSummarySourceSnapshot } from '../../domain/chapterSummarySource';
import type { LocalBookDetail } from '../../data/local/repository';
import { localRepository } from '../../data/local/repository';
import { planningRepository, type LocalPlanning } from '../../data/local/planningRepository';
import StoryOutline from '../../pages/StoryOutline';

vi.mock('../../InteractionContent/BooksContext', () => ({
    useBooks: () => ({ storageMode: 'local', getBook: () => undefined, fetchStoryPlanning: vi.fn(), saveStoryPlanning: vi.fn() }),
}));
vi.mock('../../features/planning/hooks/useChapterSummarySuggestions', () => ({
    useChapterSummarySuggestions: () => ({
        suggestions: {}, activeChapterId: null, modelAvailability: 'unavailable', modelNotice: null,
        isCurrent: () => true, generate: vi.fn(), stop: vi.fn(), accept: vi.fn(), keepManual: vi.fn(), toggleRetrievalHit: vi.fn(),
    }),
}));

afterEach(() => vi.restoreAllMocks());

it('uses current local character versions when checking an adopted chapter summary', async () => {
    const bookId = 'book-1';
    const chapterId = 'chapter-1';
    const characterId = 'character-1';
    const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '她推开门。' }] }] });
    const chapter = {
        id: chapterId, bookId, volumeId: 'volume-1', title: 'The Door', position: 0,
        isReadOnly: false, databaseVersion: 3, createdAt: 1, updatedAt: 3,
        status: 'draft' as const, body: {
            format: 'tiptap-json' as const, version: 1 as const, content, originalContent: null, originalFormat: null,
        }, wordCount: 5, foreshadowings: [],
    };
    const detail: LocalBookDetail = {
        book: {
            id: bookId, title: 'Book', author: 'Author', status: 'serializing', coverColor: '#123',
            position: 0, isReadOnly: false, databaseVersion: 1, createdAt: 1, updatedAt: 1,
        },
        volumes: [{
            id: 'volume-1', bookId, title: 'Volume 1', position: 0, isReadOnly: false,
            databaseVersion: 1, createdAt: 1, updatedAt: 1, status: 'draft',
        }],
        chapters: [chapter],
    };
    const character = {
        id: characterId, bookId, name: 'Alice', aliases: [], role: 'protagonist' as const, description: '',
        color: '#123', tags: [], avatar: null, handleConfig: null, isArchived: false,
        position: 0, databaseVersion: 7, createdAt: 1, updatedAt: 7,
    };
    const sourceSnapshot = createChapterSummarySourceSnapshot({
        id: chapterId, title: chapter.title, databaseVersion: chapter.databaseVersion,
        contentFormat: 'tiptap-json', contentVersion: 1, content,
    });
    const generationMetadata = {
        source: { allowedSources: [{ sourceId: `${bookId}:character:${characterId}`, sourceVersion: character.databaseVersion }] },
    } as unknown as ChapterSummaryGenerationMetadata;
    const planning: LocalPlanning = {
        bookId, databaseVersion: 1, storySummary: '', storyBackground: '', plotSettings: [], updatedAt: 1,
        chapterSummaries: [{
            chapterId, summary: 'Alice enters the room.', updatedAt: 1, provenance: 'ai-adopted',
            sourceSnapshot, generationMetadata,
        }],
    };

    vi.spyOn(localRepository, 'readBook').mockResolvedValue(detail);
    const readCharacters = vi.spyOn(localRepository, 'listCharacters').mockResolvedValue([character]);
    vi.spyOn(planningRepository, 'read').mockResolvedValue(planning);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: '/books/:bookId/story-outline', element: <StoryOutline /> }], {
        initialEntries: [`/books/${bookId}/story-outline`],
    });
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);

    expect(await screen.findByDisplayValue('Alice enters the room.')).toBeInTheDocument();
    expect(readCharacters).toHaveBeenCalledWith(bookId);
    expect(screen.queryByText('Possible changes — review')).not.toBeInTheDocument();
    expect(screen.queryByText('A setting or character source changed or is no longer available.')).not.toBeInTheDocument();
});
