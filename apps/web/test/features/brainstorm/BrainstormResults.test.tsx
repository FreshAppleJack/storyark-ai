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
        const rawDetails = screen.getByText('View AI response').closest('details');
        expect(rawDetails).not.toHaveAttribute('open');
        expect(rawDetails).toContainElement(screen.getByText('{invalid'));
    });

    it('shows generation status and parsed directions without displaying raw output', () => {
        const direction = {
            id: 'direction-1', title: 'A new route', conflict: 'A blocked passage',
            motivation: 'Find the missing friend', consequences: 'The search becomes urgent', development: 'Follow the clue',
        };
        const props = {
            isGenerating: true,
            isSaving: false,
            handleGenerate: vi.fn(),
            regenerate: vi.fn(async () => undefined),
            stopGeneration: vi.fn(),
            discardCandidate: vi.fn(),
            generationAvailable: true,
            selectedChapterIds: ['chapter-1'],
            missingSummaryChapters: [],
            isSnapshotStale: false,
            errorMessage: null,
            visibleOptions: [],
            hasSelectedOption: false,
            workspace: { selectedOptionId: null, finalContent: '' } as ComponentProps<typeof BrainstormResults>['workspace'],
            chooseOption: vi.fn(),
            showAllOptions: vi.fn(),
            updateFinalContent: vi.fn(),
            candidate: { ...EMPTY_BRAINSTORM_CANDIDATE, status: 'streaming' as const, rawText: '```json\n{"options":[' },
            isReadOnly: false,
            toggleRetrievalHit: vi.fn(),
        } satisfies ComponentProps<typeof BrainstormResults>;

        const { rerender } = render(<BrainstormResults {...props} />);
        expect(screen.getByText(/Generating three directions/)).toBeInTheDocument();
        expect(screen.queryByText(/```json/)).toBeNull();
        rerender(<BrainstormResults {...props} isGenerating={false} visibleOptions={[direction]}
            candidate={{ ...props.candidate, status: 'completed', rawText: '```json\n{"options":[...]}\n```' }} />);
        expect(screen.getByText('A new route')).toBeInTheDocument();
        expect(screen.queryByText(/```json/)).toBeNull();
    });

    it('keeps an editable result visible without calling it an empty brainstorm', () => {
        const props = {
            isGenerating: false, isSaving: false, handleGenerate: vi.fn(),
            regenerate: vi.fn(async () => undefined), stopGeneration: vi.fn(), discardCandidate: vi.fn(),
            generationAvailable: true, selectedChapterIds: ['chapter-1'], missingSummaryChapters: [],
            isSnapshotStale: false, errorMessage: null, visibleOptions: [], hasSelectedOption: false,
            workspace: { selectedOptionId: 'saved-1', finalContent: 'Hand-edited saved result' } as ComponentProps<typeof BrainstormResults>['workspace'],
            chooseOption: vi.fn(), showAllOptions: vi.fn(), updateFinalContent: vi.fn(),
            candidate: EMPTY_BRAINSTORM_CANDIDATE, isReadOnly: false, toggleRetrievalHit: vi.fn(),
        } satisfies ComponentProps<typeof BrainstormResults>;

        render(<BrainstormResults {...props} />);
        expect(screen.getByRole('textbox')).toHaveValue('Hand-edited saved result');
        expect(screen.queryByText('No brainstorm yet')).toBeNull();
    });
});
