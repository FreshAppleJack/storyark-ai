import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BrainstormResults } from '../../../features/brainstorm/components/BrainstormResults';
import { EMPTY_BRAINSTORM_CANDIDATE } from '../../../features/brainstorm/brainstormCandidate';

describe('BrainstormResults', () => {
    it('renders a generation failure detail once when a failed candidate is present', () => {
        const errorMessage = 'The service did not return a valid completed text response for this protocol.';
        const props = {
            isGenerating: false,
            isSaving: false,
            handleGenerate: vi.fn(),
            regenerate: vi.fn(async () => undefined),
            stopGeneration: vi.fn(),
            discardCandidate: vi.fn(),
            generationAvailable: true,
            selectedChapterIds: ['chapter-1'],
            missingSummaryChapters: [],
            isSnapshotStale: false,
            errorMessage,
            visibleOptions: [],
            hasSelectedOption: false,
            workspace: { selectedOptionId: null, finalContent: '' } as ComponentProps<typeof BrainstormResults>['workspace'],
            chooseOption: vi.fn(),
            showAllOptions: vi.fn(),
            updateFinalContent: vi.fn(),
            candidate: { ...EMPTY_BRAINSTORM_CANDIDATE, status: 'failed' as const, errorMessage },
            isReadOnly: false,
            toggleRetrievalHit: vi.fn(),
        } satisfies ComponentProps<typeof BrainstormResults>;

        render(<BrainstormResults {...props} />);

        expect(screen.getAllByText(errorMessage)).toHaveLength(1);
        expect(screen.getByText('Generation failed. Existing options and manual edits are unchanged.')).toBeInTheDocument();
    });

    it('keeps the parse error visible when a malformed candidate is preserved for review', () => {
        const errorMessage = 'The model response is not valid JSON.';
        const props = {
            isGenerating: false,
            isSaving: false,
            handleGenerate: vi.fn(),
            regenerate: vi.fn(async () => undefined),
            stopGeneration: vi.fn(),
            discardCandidate: vi.fn(),
            generationAvailable: true,
            selectedChapterIds: ['chapter-1'],
            missingSummaryChapters: [],
            isSnapshotStale: false,
            errorMessage,
            visibleOptions: [],
            hasSelectedOption: false,
            workspace: { selectedOptionId: null, finalContent: '' } as ComponentProps<typeof BrainstormResults>['workspace'],
            chooseOption: vi.fn(),
            showAllOptions: vi.fn(),
            updateFinalContent: vi.fn(),
            candidate: { ...EMPTY_BRAINSTORM_CANDIDATE, status: 'invalid' as const, errorMessage, rawText: '{invalid' },
            isReadOnly: false,
            toggleRetrievalHit: vi.fn(),
        } satisfies ComponentProps<typeof BrainstormResults>;

        render(<BrainstormResults {...props} />);

        expect(screen.getAllByText(errorMessage)).toHaveLength(1);
        expect(screen.getByText('{invalid')).toBeInTheDocument();
    });
});
