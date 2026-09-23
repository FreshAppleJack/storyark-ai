import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AiContinueCandidate } from '../../../features/editor/components/AiContinueCandidate';
import type { AiContinueCandidate as AiContinueCandidateState } from '../../../features/editor/hooks/useLocalAiContinue';

describe('AiContinueCandidate', () => {
    it('offers a close action after adoption without showing discard', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const candidate: AiContinueCandidateState = {
            status: 'adopted',
            text: 'candidate',
            errorMessage: null,
            source: {
                bookId: 'book-1',
                chapterId: 'chapter-1',
                sessionId: 'session-1',
                draftRevision: 3,
                databaseVersion: 7,
                contextSource: 'current-in-memory-draft',
                contextText: 'draft',
                anchor: { from: 4, to: 4, docSize: 18, selectedText: '', retrievalAnchor: { paragraphOrdinal: 0, textOffset: 3 } },
                generatedAnchor: { from: 4, to: 4, docSize: 18, selectedText: '', retrievalAnchor: { paragraphOrdinal: 0, textOffset: 3 } },
                lockWasValid: true,
                retrievalContext: null,
                retrievalStatus: null,
                retrievalNotice: null,
            },
        };

        render(
            <AiContinueCandidate
                candidate={candidate}
                isAiLoading={false}
                canAdopt={false}
                adoptDisabledReason={null}
                saveStatus="saved"
                draftRevision={4}
                onStop={vi.fn()}
                onAdopt={vi.fn()}
                onClose={onClose}
                onDiscard={vi.fn()}
                onRegenerate={vi.fn()}
                onReselectInsertionPoint={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Discard candidate' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Close' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
