import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WritingContextPanel } from '../../../features/editor/components/WritingContextPanel';
import { ForeshadowingNote, PlotSetting } from '../../../types';

const notes: ForeshadowingNote[] = [
    { id: 'f1', excerpt: 'stored excerpt', note: 'payoff note', createdAt: 1700000000000, updatedAt: 1700000000000 },
    { id: 'f2', excerpt: 'second excerpt', note: '', isRecovered: true, createdAt: 1700000000000, updatedAt: 1700000000000 },
];

const plots: PlotSetting[] = [
    { id: 'p1', title: 'Main Plot', details: 'plot details', chapterIds: ['c1'], createdAt: 1, updatedAt: 2 },
];

function createProps(overrides: Record<string, unknown> = {}) {
    return {
        isOpen: true,
        foreshadowings: notes,
        excerptMap: new Map<string, string>([['f1', 'live excerpt']]),
        activeForeshadowingId: null as string | null,
        plotSettings: plots,
        isReadOnly: false,
        canOpenOutline: true,
        onClose: vi.fn(),
        onFocusForeshadowing: vi.fn(),
        onNoteChange: vi.fn(),
        onDeleteForeshadowing: vi.fn(),
        onOpenOutline: vi.fn(),
        ...overrides,
    };
}

describe('WritingContextPanel', () => {
    it('prefers the live excerpt from the map over the stored one', () => {
        render(<WritingContextPanel {...createProps()} />);

        expect(screen.getByText(/live excerpt/)).toBeInTheDocument();
        expect(screen.getByText(/second excerpt/)).toBeInTheDocument();
        expect(screen.queryByText(/stored excerpt/)).not.toBeInTheDocument();
    });

    it('counts only unrecovered notes in the subtitle', () => {
        render(<WritingContextPanel {...createProps()} />);

        expect(screen.getByText('1 unrecovered note')).toBeInTheDocument();
        expect(screen.getByText('Recovered')).toBeInTheDocument();
    });

    it('shows a hint when there are no foreshadowing notes', () => {
        render(<WritingContextPanel {...createProps({ foreshadowings: [] })} />);

        expect(screen.getByText(/Select text in the editor/)).toBeInTheDocument();
    });

    it('delegates note edits', () => {
        const props = createProps();
        render(<WritingContextPanel {...props} />);

        const textarea = screen.getAllByPlaceholderText('Write the payoff, hidden meaning, or future reveal...')[0];
        fireEvent.change(textarea, { target: { value: 'new text' } });

        expect(props.onNoteChange).toHaveBeenCalledWith('f1', 'new text');
    });

    it('delegates note deletion', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<WritingContextPanel {...props} />);

        await user.click(screen.getAllByText('Delete')[0]);

        expect(props.onDeleteForeshadowing).toHaveBeenCalledWith('f1');
    });

    it('delegates focusing a foreshadowing in the editor', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<WritingContextPanel {...props} />);

        await user.click(screen.getByText(/live excerpt/));

        expect(props.onFocusForeshadowing).toHaveBeenCalledWith('f1');
    });

    it('lists linked plot settings with their details', () => {
        render(<WritingContextPanel {...createProps()} />);

        expect(screen.getByText('Main Plot')).toBeInTheDocument();
        expect(screen.getByText('plot details')).toBeInTheDocument();
        expect(screen.getByText('1 linked plot setting')).toBeInTheDocument();
    });

    it('shows an empty state when no plot settings are linked', () => {
        render(<WritingContextPanel {...createProps({ plotSettings: [] })} />);

        expect(screen.getByText('No plot details have been linked to this chapter yet.')).toBeInTheDocument();
    });

    it('disables Open Outline without an active chapter and delegates otherwise', async () => {
        const user = userEvent.setup();
        const props = createProps();
        const { rerender } = render(<WritingContextPanel {...createProps({ canOpenOutline: false })} />);
        expect(screen.getByText('Open Outline').closest('button')).toBeDisabled();

        rerender(<WritingContextPanel {...props} />);
        await user.click(screen.getByText('Open Outline'));
        expect(props.onOpenOutline).toHaveBeenCalledTimes(1);
    });

    it('collapses to zero width when closed', () => {
        const { container } = render(<WritingContextPanel {...createProps({ isOpen: false })} />);

        expect(container.querySelector('aside')?.className).toContain('w-0');
    });
});
