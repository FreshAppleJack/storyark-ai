import { useRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OverlayHorizontalScrollbar } from '../../components/ui/OverlayHorizontalScrollbar';

function HorizontalStrip() {
    const scrollRef = useRef<HTMLDivElement>(null);
    return <div className="relative">
        <div ref={scrollRef} id="chapter-strip" className="scrollbar-hidden-x overflow-x-auto">Chapters</div>
        <OverlayHorizontalScrollbar scrollElementRef={scrollRef} scrollElementId="chapter-strip" ariaLabel="Chapter summaries" />
    </div>;
}

it('keeps an accessible overlay track for a horizontally scrollable chapter strip', async () => {
    const { container } = render(<HorizontalStrip />);
    const strip = container.querySelector('#chapter-strip') as HTMLDivElement;
    const track = container.querySelector('[aria-orientation="horizontal"]') as HTMLDivElement;
    Object.defineProperties(strip, {
        scrollWidth: { configurable: true, value: 800 },
        clientWidth: { configurable: true, value: 200 },
    });
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 200 });
    fireEvent.resize(window);

    const scrollbar = await screen.findByRole('scrollbar', { name: 'Chapter summaries' });
    await waitFor(() => expect(scrollbar).toHaveAttribute('aria-valuemax', '600'));
    expect(scrollbar).toHaveClass('absolute', 'opacity-100');
    expect(scrollbar).toHaveClass('h-2');
    expect(scrollbar.querySelector('[data-scrollbar-thumb="true"]')).toHaveClass('h-1');
});
