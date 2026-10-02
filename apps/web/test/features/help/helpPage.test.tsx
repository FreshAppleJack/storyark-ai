import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Help from '../../../pages/Help';

function renderHelp() {
    return render(<MemoryRouter><Help /></MemoryRouter>);
}

describe('Help page', () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    beforeAll(() => {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
    });
    afterAll(() => {
        if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    });

    it('opens individual questions with the keyboard and expands or collapses a topic', async () => {
        const user = userEvent.setup();
        renderHelp();
        const question = screen.getByRole('button', { name: 'How do I quickly insert a character name?' });
        const answer = document.getElementById(question.getAttribute('aria-controls')!);
        expect(question).toHaveAttribute('aria-expanded', 'false');
        expect(answer).not.toBeVisible();
        question.focus();
        await user.keyboard('{Enter}');
        expect(question).toHaveAttribute('aria-expanded', 'true');
        expect(answer).toBeVisible();
        await user.click(screen.getByRole('button', { name: 'Expand all' }));
        expect(screen.getAllByRole('button').filter(button => button.getAttribute('aria-expanded') === 'true')).toHaveLength(15);
        await user.click(screen.getByRole('button', { name: 'Collapse all' }));
        expect(answer).not.toBeVisible();
    });

    it('switches topics, searches all answers and recovers from no matches', async () => {
        const user = userEvent.setup();
        renderHelp();
        const topics = screen.getByRole('navigation', { name: 'Help topics' });
        expect(within(topics).getAllByRole('button')).toHaveLength(6);
        await user.click(within(topics).getByRole('button', { name: /AI Continue/ }));
        expect(screen.getByRole('button', { name: 'What does AI Continue use as context?' })).toBeInTheDocument();
        await user.type(screen.getByRole('searchbox', { name: 'Search help' }), 'ctrl windows');
        expect(screen.getByRole('button', { name: 'How can I check character details while writing?' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent('1 answer found across all topics');
        await user.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(screen.getByRole('button', { name: 'What does AI Continue use as context?' })).toBeInTheDocument();
        await user.type(screen.getByRole('searchbox'), 'not-a-guide-term');
        expect(screen.getByRole('heading', { name: 'No answers found' })).toBeInTheDocument();
        await user.click(within(topics).getByRole('button', { name: /Saving, models/ }));
        expect(screen.getByRole('searchbox')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Does StoryArk automatically sync between computers?' })).toBeInTheDocument();
    });

    it('returns to Settings without losing the original return destination', async () => {
        function SettingsDestination() {
            const location = useLocation();
            return <p>{location.state?.returnTo}</p>;
        }
        const user = userEvent.setup();
        render(<MemoryRouter initialEntries={[{ pathname: '/help', state: { settingsReturnTo: '/editor/test-book' } }]}>
            <Routes><Route path="/help" element={<Help />} /><Route path="/settings" element={<SettingsDestination />} /></Routes>
        </MemoryRouter>);
        await user.click(screen.getByRole('button', { name: 'Back to Settings' }));
        expect(screen.getByText('/editor/test-book')).toBeInTheDocument();
    });
});
