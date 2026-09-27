import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChapterSummarySuggestionReview } from '../../../features/planning/components/ChapterSummarySuggestionReview';
import type { ChapterSummarySuggestion } from '../../../domain/chapterSummarySource';

const chapterId = 'chapter-1';

function suggestion(): ChapterSummarySuggestion {
    return {
        status: 'candidate',
        chapterId,
        rawText: 'She entered the archive.',
        suggestedSummary: 'She entered the archive.',
        errorMessage: null,
        previousSummary: 'Manual: she opened the room.',
        sourcePreview: 'She pushed open the archive door and found the room empty.',
        sourceFingerprint: 'source-fingerprint',
        draftRevision: 2,
        sourceSnapshot: {
            chapterId,
            chapterDatabaseVersion: 4,
            chapterTitle: 'Rainy night',
            contentFormat: 'tiptap-json',
            contentVersion: 1,
            fingerprintAlgorithm: 'fnv1a64-utf16-v1',
            bodyFingerprint: '0123456789abcdef',
            structuredFingerprint: 'fedcba9876543210',
            blockFingerprints: ['fedcba9876543210'],
            mentionedCharacterIds: [],
            foreshadowingIds: [],
            foreshadowingNoteFingerprints: [],
            capturedAt: 100,
        },
        generationMetadata: null,
        retrievalContext: null,
        retrievalStatus: 'no_results',
        retrievalNotice: 'No supporting retrieval sources matched. The selected chapter text was used.',
    };
}

function renderReview(overrides: Partial<React.ComponentProps<typeof ChapterSummarySuggestionReview>> = {}) {
    const callbacks = {
        onGenerate: vi.fn(), onStop: vi.fn(), onAccept: vi.fn(), onKeepManual: vi.fn(), onToggleHit: vi.fn(),
    };
    render(<ChapterSummarySuggestionReview
        chapterId={chapterId}
        chapterTitle="Rainy night"
        volumeTitle="Volume 1"
        hasWrittenText
        isReadOnly={false}
        isGenerating={false}
        isAnyGenerating={false}
        modelAvailability="ready"
        modelNotice={null}
        suggestion={suggestion()}
        isCurrent
        {...callbacks}
        {...overrides}
    />);
    return callbacks;
}

it('keeps the candidate separate from the manual summary without showing chapter source text', () => {
    const callbacks = renderReview();

    expect(screen.queryByText('Not accepted')).toBeNull();
    expect(screen.getByText(/stays unchanged until you accept it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(screen.getByText('Manual: she opened the room.')).toBeTruthy();
    expect(screen.getByText('She entered the archive.')).toBeTruthy();
    expect(screen.queryByText(/She pushed open the archive door/)).toBeNull();
    expect(screen.getByText(/No supporting retrieval sources matched/)).toBeTruthy();
    const actions = screen.getByRole('button', { name: 'Accept' }).parentElement;
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Keep manual' }));
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Hide review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(callbacks.onAccept).toHaveBeenCalledWith(chapterId);
    fireEvent.click(screen.getByRole('button', { name: 'Keep manual' }));
    expect(callbacks.onKeepManual).toHaveBeenCalledWith(chapterId);
});

it('clearly disables generation when the default model is not configured', () => {
    const callbacks = renderReview({
        suggestion: undefined,
        modelAvailability: 'missing',
        modelNotice: 'No default AI model is configured. Manual editing and saving remain available.',
    });

    expect(screen.getByRole('button', { name: 'Generate suggestion' })).toBeDisabled();
    expect(screen.getByText(/Manual editing and saving remain available/)).toBeTruthy();
    expect(callbacks.onGenerate).not.toHaveBeenCalled();
});

it('shows a failed generation detail only once', () => {
    const errorMessage = 'The service did not return a valid completed text response for this protocol.';
    const failedSuggestion: ChapterSummarySuggestion = {
        ...suggestion(),
        status: 'failed',
        suggestedSummary: null,
        errorMessage,
    };

    renderReview({ suggestion: failedSuggestion });

    expect(screen.getAllByText(errorMessage)).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toContain('Generation failed.');
});
