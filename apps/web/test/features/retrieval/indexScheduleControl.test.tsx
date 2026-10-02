import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexScheduleControl } from '../../../features/retrieval/components/IndexScheduleControl';
import { indexScheduleRepository } from '../../../data/local/indexScheduleRepository';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../../../data/local/indexScheduleRepository', () => ({ indexScheduleRepository: { read: vi.fn(), save: vi.fn() } }));
const initial = { enabled: false, databaseVersion: 1, pendingSources: 2, lastCompletedAt: null, lastError: null };

describe('IndexScheduleControl', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(indexScheduleRepository.read).mockResolvedValue(initial);
    });
    it('persists the switch with the observed version and preserves it on failure', async () => {
        vi.mocked(indexScheduleRepository.save).mockRejectedValue(new Error('Version conflict'));
        render(<IndexScheduleControl bookId="book-a" />);
        const toggle = screen.getByRole('button', { name: 'Automatically build local index' });
        await waitFor(() => expect(toggle).toBeEnabled());
        fireEvent.click(toggle);
        await screen.findByText('Search settings could not be saved. Try again.');
        expect(screen.queryByText('Version conflict')).not.toBeInTheDocument();
        expect(indexScheduleRepository.save).toHaveBeenCalledWith(true, 1);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText(/2 sources waiting/)).toBeInTheDocument();
    });
    it('shows the committed setting after successful save', async () => {
        vi.mocked(indexScheduleRepository.save).mockImplementation(async () => {
            const saved = { ...initial, enabled: true, databaseVersion: 2 };
            vi.mocked(indexScheduleRepository.read).mockResolvedValue(saved);
            return saved;
        });
        render(<IndexScheduleControl />);
        const toggle = screen.getByRole('button', { name: 'Automatically build local index' });
        await waitFor(() => expect(toggle).toBeEnabled());
        fireEvent.click(toggle);
        await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    });
});
