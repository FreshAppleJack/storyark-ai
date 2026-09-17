import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditorHeader, EditorSaveStatus } from '../../../features/editor/components/EditorHeader';

function createProps(overrides: Record<string, unknown> = {}) {
    return {
        volumeTitle: 'Volume 1',
        chapterTitle: 'My Chapter',
        hasActiveChapter: true,
        saveStatus: 'saved' as EditorSaveStatus,
        isAiLoading: false,
        isReadOnly: false,
        isContextPanelOpen: false,
        contextPanelItemCount: 0,
        isExporting: false,
        onNavigateForeshadowingBoard: vi.fn(),
        onNavigateWorldBuilding: vi.fn(),
        onAIContinue: vi.fn(),
        onStopAI: vi.fn(),
        onToggleContextPanel: vi.fn(),
        onRetrySave: vi.fn(),
        onNavigateSettings: vi.fn(),
        onExportWord: vi.fn(),
        onExportPdf: vi.fn(),
        ...overrides,
    };
}

describe('EditorHeader', () => {
    it('shows the volume and chapter breadcrumb', () => {
        render(<EditorHeader {...createProps()} />);

        expect(screen.getByText('Volume 1')).toBeInTheDocument();
        expect(screen.getByText('My Chapter')).toBeInTheDocument();
    });

    it('prompts to select a chapter when none is active', () => {
        render(<EditorHeader {...createProps({ hasActiveChapter: false })} />);

        expect(screen.getByText('Select a chapter to start writing')).toBeInTheDocument();
    });

    it('reflects the save status', () => {
        const { rerender } = render(<EditorHeader {...createProps({ saveStatus: 'saved' })} />);
        expect(screen.getByText('Saved')).toBeInTheDocument();

        rerender(<EditorHeader {...createProps({ saveStatus: 'saving' })} />);
        expect(screen.getByText('Saving...')).toBeInTheDocument();

        rerender(<EditorHeader {...createProps({ saveStatus: 'unsaved' })} />);
        expect(screen.getByText('Unsaved Changes')).toBeInTheDocument();
    });

    it('shows a retry action when saving failed', async () => {
        const user = userEvent.setup();
        const props = createProps({ saveStatus: 'error' });
        render(<EditorHeader {...props} />);

        expect(screen.getByText('Save failed')).toBeInTheDocument();
        await user.click(screen.getByText('Retry'));
        expect(props.onRetrySave).toHaveBeenCalledTimes(1);
    });

    it('delegates AI continue and disables it in read-only mode', async () => {
        const user = userEvent.setup();
        const props = createProps();
        const { rerender } = render(<EditorHeader {...props} />);

        await user.click(screen.getByText('AI Continue'));
        expect(props.onAIContinue).toHaveBeenCalledTimes(1);

        rerender(<EditorHeader {...createProps({ isReadOnly: true })} />);
        expect(screen.getByText('AI Continue').closest('button')).toBeDisabled();
    });

    it('offers a stop action while a local continuation is streaming', async () => {
        const user = userEvent.setup();
        const props = createProps({ isAiLoading: true });
        render(<EditorHeader {...props} />);

        expect(screen.queryByText('AI Continue')).not.toBeInTheDocument();
        await user.click(screen.getByText('Stop AI'));
        expect(props.onStopAI).toHaveBeenCalledTimes(1);
    });

    it('shows the context panel item count and delegates the toggle', async () => {
        const user = userEvent.setup();
        const props = createProps({ contextPanelItemCount: 3 });
        render(<EditorHeader {...props} />);

        expect(screen.getByText('3')).toBeInTheDocument();
        await user.click(screen.getByText('Foreshadowing & Plot'));
        expect(props.onToggleContextPanel).toHaveBeenCalledTimes(1);
    });

    it('delegates the navigation shortcuts', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<EditorHeader {...props} />);

        await user.click(screen.getByText('Foreshadowing Board'));
        expect(props.onNavigateForeshadowingBoard).toHaveBeenCalledTimes(1);

        await user.click(screen.getByText('World Building'));
        expect(props.onNavigateWorldBuilding).toHaveBeenCalledTimes(1);

        await user.click(screen.getByTitle('Global Settings'));
        expect(props.onNavigateSettings).toHaveBeenCalledTimes(1);
    });
});

describe('ExportMenu', () => {
    it('opens the dropdown and delegates Word export', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<EditorHeader {...props} />);

        expect(screen.queryByText('Word Document')).not.toBeInTheDocument();
        await user.click(screen.getByText('Export'));
        expect(screen.getByText('Word Document')).toBeInTheDocument();

        await user.click(screen.getByText('Word Document'));
        expect(props.onExportWord).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Word Document')).not.toBeInTheDocument();
    });

    it('delegates PDF export', async () => {
        const user = userEvent.setup();
        const props = createProps();
        render(<EditorHeader {...props} />);

        await user.click(screen.getByText('Export'));
        await user.click(screen.getByText('PDF Document'));

        expect(props.onExportPdf).toHaveBeenCalledTimes(1);
    });

    it('offers the whole-work JSON export only in local mode', async () => {
        const user = userEvent.setup();
        const onExportWorkJson = vi.fn();
        render(<EditorHeader {...createProps({ localMode: true, onExportWorkJson })} />);

        await user.click(screen.getByText('Export'));
        await user.click(screen.getByText('StoryArk work'));

        expect(onExportWorkJson).toHaveBeenCalledTimes(1);
    });

    it('closes the dropdown on outside click', async () => {
        const user = userEvent.setup();
        render(<EditorHeader {...createProps()} />);

        await user.click(screen.getByText('Export'));
        expect(screen.getByText('Word Document')).toBeInTheDocument();

        await user.click(document.body);
        expect(screen.queryByText('Word Document')).not.toBeInTheDocument();
    });
});
