import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OverlayVerticalScrollbar } from '../../components/ui/OverlayVerticalScrollbar';

afterEach(() => {
    vi.useRealTimers();
    document.getElementById('test-scroll-area')?.remove();
    document.querySelector('[aria-modal="true"]')?.remove();
});

it('hides a background scrollbar while a modal dialog is open', async () => {
    const area = document.createElement('div');
    area.id = 'test-scroll-area';
    area.style.overflowY = 'auto';
    Object.defineProperties(area, {
        scrollHeight: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 200 },
    });
    area.getBoundingClientRect = () => ({ top: 20, bottom: 220, right: 400, left: 0, height: 200, width: 400, x: 0, y: 20, toJSON: () => ({}) });
    document.body.appendChild(area);
    render(<OverlayVerticalScrollbar />);
    fireEvent.scroll(area);
    expect(screen.getByRole('scrollbar', { name: 'Vertical scrollbar' })).toBeInTheDocument();

    const modal = document.createElement('section');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    await waitFor(() => expect(screen.queryByRole('scrollbar', { name: 'Vertical scrollbar' })).toBeNull());
    modal.remove();
});

it('draws an overlay for the active vertical scroller, expands on hover, and fades after inactivity', () => {
    vi.useFakeTimers();
    const area = document.createElement('div');
    area.id = 'test-scroll-area';
    area.style.overflowY = 'auto';
    Object.defineProperties(area, {
        scrollHeight: { configurable: true, value: 1000 },
        clientHeight: { configurable: true, value: 200 },
    });
    area.getBoundingClientRect = () => ({ top: 20, bottom: 220, right: 400, left: 0, height: 200, width: 400, x: 0, y: 20, toJSON: () => ({}) });
    document.body.appendChild(area);

    const { unmount } = render(<OverlayVerticalScrollbar />);
    fireEvent.scroll(area);
    const track = screen.getByRole('scrollbar', { name: 'Vertical scrollbar' });
    expect(track).toHaveClass('fixed');
    expect(track).toHaveStyle({ left: '388px', height: '200px' });
    expect(track).toHaveClass('opacity-100');
    expect(document.documentElement).toHaveClass('overlay-scrollbars-enabled');
    fireEvent.keyDown(track, { key: 'ArrowDown' });
    expect(area.scrollTop).toBe(40);
    expect(track).toHaveAttribute('aria-valuenow', '40');

    fireEvent.pointerEnter(track);
    expect(track.querySelector('[data-scrollbar-thumb="true"]')).toHaveClass('w-2.5');
    fireEvent.pointerLeave(track);
    act(() => vi.advanceTimersByTime(1400));
    expect(track).toHaveClass('opacity-0');

    unmount();
    area.remove();
    expect(document.documentElement).not.toHaveClass('overlay-scrollbars-enabled');
});
