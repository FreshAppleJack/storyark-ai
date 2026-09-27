import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { STORY_SEARCH_SOURCE_KINDS } from '../../../features/retrieval/hooks/useLocalStorySearch';
import { StorySearchFilters } from '../../../features/retrieval/components/StorySearchFilters';

describe('StorySearchFilters', () => {
    it('makes an excluded manuscript scope visible and can restore the default search scope', () => {
        const onChange = vi.fn();
        render(
            <StorySearchFilters
                filters={{
                    sourceKinds: ['chapter_summary'],
                    includePlanning: false,
                    chapterRange: 'current',
                    updatedAfter: 100,
                    updatedBefore: 200,
                }}
                chapters={[]}
                activeChapterId="chapter-1"
                onChange={onChange}
            />,
        );

        expect(screen.getByLabelText('Manuscript excluded from search')).toBeInTheDocument();
        fireEvent.click(screen.getByText('Search filters'));
        expect(screen.getByText('Manuscript text will not be searched.')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));

        expect(onChange).toHaveBeenCalledWith({
            sourceKinds: STORY_SEARCH_SOURCE_KINDS,
            includePlanning: false,
            chapterRange: 'all',
            updatedAfter: null,
            updatedBefore: null,
        });
    });
});
