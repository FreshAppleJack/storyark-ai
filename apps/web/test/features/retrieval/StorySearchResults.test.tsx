import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StorySearchResults } from '../../../features/retrieval/components/StorySearchResults';
import type { RetrievalSearchFilters, RetrievalSearchHit, RetrievalSearchResponse } from '../../../domain/retrieval/contracts';

describe('StorySearchResults', () => {
    it('shows a compact query-centered excerpt and sends its offset to Open and locate', () => {
        const query = '目标命中短语';
        const sourceText = `${'前文铺垫。'.repeat(40)}${query}${'后续叙述。'.repeat(40)}`;
        const hit = {
            hitId: 'hit-1',
            chapterId: 'chapter-1',
            sourceKind: 'manuscript',
            sourceVersion: 7,
            indexUpdatedAt: 1,
            freshness: 'fresh',
            recallMethods: ['lexical'],
            chunk: { sourceText, shortQuote: sourceText.slice(0, 96) },
            locator: {
                volumeTitleSnapshot: 'Volume 1',
                chapterTitleSnapshot: 'Chapter One',
                paragraphOrdinals: [0],
                paragraphSpans: [{ paragraphOrdinal: 0, nodePath: [0], startOffset: 0, endOffset: Array.from(sourceText).length }],
            },
        } as unknown as RetrievalSearchHit;
        const response = {
            hits: [hit],
            status: 'ready',
            effectiveMode: 'semantic',
            degraded: false,
        } as unknown as RetrievalSearchResponse;
        const filters: RetrievalSearchFilters = {
            sourceKinds: [],
            includePlanning: false,
            chapterRange: 'all',
            updatedAfter: null,
            updatedBefore: null,
        };
        const onSelectHit = vi.fn();
        const { container } = render(
            <StorySearchResults
                embeddingStatus={null}
                indexStatus={null}
                indexProgress={null}
                statusError={null}
                isStatusLoading={false}
                isIndexing={false}
                isSearching={false}
                searchError={null}
                response={response}
                lastQuery={query}
                filters={filters}
                chapters={[]}
                activeChapterId="chapter-1"
                selectionMessage=""
                onFiltersChange={vi.fn()}
                onQueueIndex={vi.fn()}
                onSelectHit={onSelectHit}
                onOpenChapterSummary={vi.fn()}
            />,
        );

        const excerpt = container.querySelector('article p');
        expect(excerpt).not.toBeNull();
        expect(screen.getByLabelText('Story search results')).toContainElement(excerpt);
        expect(excerpt!.closest('article')).not.toHaveClass('overflow-y-auto');
        expect(excerpt).toHaveTextContent(query);
        expect(Array.from(excerpt!.textContent ?? '').length).toBeLessThan(123);
        expect(screen.getByText(query, { selector: 'mark' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Open and locate' }));
        expect(onSelectHit).toHaveBeenCalledWith(hit, {
            chunkTextOffset: Array.from(sourceText.slice(0, sourceText.indexOf(query))).length,
            focusTextLength: Array.from(query).length,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Show full excerpt' }));
        expect(excerpt).toHaveTextContent(sourceText);
    });

    it('opens a chapter summary in planning instead of pretending it has a manuscript location', () => {
        const chapterId = 'chapter-summary-1';
        const summaryHit = {
            hitId: 'summary-hit-1',
            chapterId,
            sourceKind: 'chapter_summary',
            sourceVersion: 3,
            indexUpdatedAt: 1,
            freshness: 'fresh',
            recallMethods: ['semantic'],
            chunk: { sourceText: 'A summary excerpt about the event.', shortQuote: 'A summary excerpt' },
            locator: { chapterId, volumeTitleSnapshot: 'Volume 1', chapterTitleSnapshot: 'Chapter One', paragraphSpans: [] },
        } as unknown as RetrievalSearchHit;
        const response = {
            hits: [summaryHit],
            status: 'ready',
            effectiveMode: 'semantic',
            degraded: false,
        } as unknown as RetrievalSearchResponse;
        const onSelectHit = vi.fn();
        const onOpenChapterSummary = vi.fn();
        render(
            <StorySearchResults
                embeddingStatus={null}
                indexStatus={null}
                indexProgress={null}
                statusError={null}
                isStatusLoading={false}
                isIndexing={false}
                isSearching={false}
                searchError={null}
                response={response}
                lastQuery="event"
                filters={{ sourceKinds: [], includePlanning: false, chapterRange: 'all', updatedAfter: null, updatedBefore: null }}
                chapters={[]}
                activeChapterId={chapterId}
                selectionMessage=""
                onFiltersChange={vi.fn()}
                onQueueIndex={vi.fn()}
                onSelectHit={onSelectHit}
                onOpenChapterSummary={onOpenChapterSummary}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Open summary' }));
        expect(onOpenChapterSummary).toHaveBeenCalledWith(chapterId);
        expect(onSelectHit).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Open and locate' })).not.toBeInTheDocument();
    });

    it('opens a semantic-only excerpt without selecting or highlighting guessed text', () => {
        const sourceText = `${'开头叙述。'.repeat(40)}这是语义命中的中间独特段落。${'结尾叙述。'.repeat(40)}`;
        const hit = {
            hitId: 'semantic-hit-without-literal-match',
            chapterId: 'chapter-1',
            sourceKind: 'manuscript',
            sourceVersion: 8,
            indexUpdatedAt: 1,
            freshness: 'fresh',
            recallMethods: ['semantic'],
            chunk: { sourceText, shortQuote: sourceText.slice(0, 96) },
            locator: {
                volumeTitleSnapshot: 'Volume 1',
                chapterTitleSnapshot: 'Chapter One',
                paragraphOrdinals: [0],
                paragraphSpans: [{ paragraphOrdinal: 0, nodePath: [0], startOffset: 0, endOffset: Array.from(sourceText).length }],
            },
        } as unknown as RetrievalSearchHit;
        const response = {
            hits: [hit], status: 'ready', effectiveMode: 'semantic', degraded: false,
        } as unknown as RetrievalSearchResponse;
        const onSelectHit = vi.fn();
        const { container } = render(
            <StorySearchResults
                embeddingStatus={null}
                indexStatus={null}
                indexProgress={null}
                statusError={null}
                isStatusLoading={false}
                isIndexing={false}
                isSearching={false}
                searchError={null}
                response={response}
                lastQuery="这组查询词并未出现在正文"
                filters={{ sourceKinds: [], includePlanning: false, chapterRange: 'all', updatedAfter: null, updatedBefore: null }}
                chapters={[]}
                activeChapterId="chapter-1"
                selectionMessage=""
                onFiltersChange={vi.fn()}
                onQueueIndex={vi.fn()}
                onSelectHit={onSelectHit}
                onOpenChapterSummary={vi.fn()}
            />,
        );

        const excerpt = container.querySelector('article p');
        expect(excerpt).toHaveTextContent('中间独特段落');
        expect(excerpt?.textContent).not.toBe(sourceText);
        expect(excerpt?.textContent?.startsWith('…')).toBe(true);
        expect(Array.from(excerpt?.textContent ?? '').length).toBeLessThanOrEqual(122);
        expect(excerpt?.querySelector('mark')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Open and locate' }));
        expect(onSelectHit).toHaveBeenCalledWith(hit, null);
    });
});
