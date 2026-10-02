import {
    useEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type PointerEvent,
    type ReactElement,
    type RefObject,
} from 'react';

interface OverlayHorizontalScrollbarProps {
    scrollElementRef: RefObject<HTMLElement | null>;
    scrollElementId: string;
    ariaLabel: string;
    bottomClassName?: string;
}

interface ScrollMetrics {
    isScrollable: boolean;
    maxScroll: number;
    scrollLeft: number;
    trackWidth: number;
    thumbWidth: number;
}

interface PointerDrag {
    startX: number;
    startScrollLeft: number;
}

const EMPTY_METRICS: ScrollMetrics = {
    isScrollable: false,
    maxScroll: 0,
    scrollLeft: 0,
    trackWidth: 0,
    thumbWidth: 0,
};

/** A persistent, overlay scrollbar for horizontal-only controls. */
export function OverlayHorizontalScrollbar({
    scrollElementRef,
    scrollElementId,
    ariaLabel,
    bottomClassName = 'bottom-0.5',
}: OverlayHorizontalScrollbarProps): ReactElement {
    const trackRef = useRef<HTMLDivElement>(null);
    const pointerDragRef = useRef<PointerDrag | null>(null);
    const [metrics, setMetrics] = useState(EMPTY_METRICS);

    useEffect(() => {
        const scrollElement = scrollElementRef.current;
        const track = trackRef.current;
        if (!scrollElement || !track) return;

        let frame: number | null = null;
        const update = () => {
            const maxScroll = Math.max(0, scrollElement.scrollWidth - scrollElement.clientWidth);
            const trackWidth = track.clientWidth;
            const isScrollable = maxScroll > 1 && trackWidth > 0;
            const thumbWidth = isScrollable
                ? Math.min(trackWidth, Math.max(28, trackWidth * scrollElement.clientWidth / scrollElement.scrollWidth))
                : trackWidth;
            const next: ScrollMetrics = {
                isScrollable,
                maxScroll,
                scrollLeft: Math.min(maxScroll, Math.max(0, scrollElement.scrollLeft)),
                trackWidth,
                thumbWidth,
            };

            setMetrics((current) => (
                current.isScrollable === next.isScrollable
                && current.maxScroll === next.maxScroll
                && current.scrollLeft === next.scrollLeft
                && current.trackWidth === next.trackWidth
                && current.thumbWidth === next.thumbWidth
                    ? current
                    : next
            ));
        };
        const scheduleUpdate = () => {
            if (frame !== null) return;
            frame = window.requestAnimationFrame(() => {
                frame = null;
                update();
            });
        };

        scrollElement.addEventListener('scroll', scheduleUpdate, { passive: true });
        window.addEventListener('resize', scheduleUpdate);

        const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleUpdate);
        resizeObserver?.observe(scrollElement);
        Array.from(scrollElement.children).forEach((child) => resizeObserver?.observe(child));

        const mutationObserver = new MutationObserver(scheduleUpdate);
        mutationObserver.observe(scrollElement, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
        });

        scheduleUpdate();
        return () => {
            scrollElement.removeEventListener('scroll', scheduleUpdate);
            window.removeEventListener('resize', scheduleUpdate);
            resizeObserver?.disconnect();
            mutationObserver.disconnect();
            if (frame !== null) window.cancelAnimationFrame(frame);
        };
    }, [scrollElementId, scrollElementRef]);

    const scrollToPointer = (event: PointerEvent<HTMLDivElement>) => {
        const scrollElement = scrollElementRef.current;
        const track = trackRef.current;
        if (!scrollElement || !track || metrics.maxScroll === 0) return;

        const trackRect = track.getBoundingClientRect();
        const maxThumbOffset = Math.max(0, metrics.trackWidth - metrics.thumbWidth);
        const clickedThumb = event.target instanceof HTMLElement
            && event.target.closest('[data-scrollbar-thumb="true"]') !== null;

        if (clickedThumb) {
            pointerDragRef.current = { startX: event.clientX, startScrollLeft: scrollElement.scrollLeft };
        } else {
            const clickedOffset = event.clientX - trackRect.left - metrics.thumbWidth / 2;
            const thumbOffset = Math.min(maxThumbOffset, Math.max(0, clickedOffset));
            const scrollLeft = maxThumbOffset === 0 ? 0 : thumbOffset / maxThumbOffset * metrics.maxScroll;
            scrollElement.scrollLeft = scrollLeft;
            pointerDragRef.current = { startX: event.clientX, startScrollLeft: scrollLeft };
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const drag = pointerDragRef.current;
        const scrollElement = scrollElementRef.current;
        const maxThumbOffset = Math.max(0, metrics.trackWidth - metrics.thumbWidth);
        if (!drag || !scrollElement || maxThumbOffset === 0) return;

        scrollElement.scrollLeft = drag.startScrollLeft
            + (event.clientX - drag.startX) * metrics.maxScroll / maxThumbOffset;
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const scrollElement = scrollElementRef.current;
        if (!scrollElement) return;

        const page = Math.max(40, scrollElement.clientWidth * 0.8);
        const scrollBy = (amount: number) => {
            event.preventDefault();
            scrollElement.scrollBy({ left: amount, behavior: 'smooth' });
        };

        switch (event.key) {
            case 'ArrowLeft': scrollBy(-40); break;
            case 'ArrowRight': scrollBy(40); break;
            case 'PageUp': scrollBy(-page); break;
            case 'PageDown': scrollBy(page); break;
            case 'Home':
                event.preventDefault();
                scrollElement.scrollTo({ left: 0, behavior: 'smooth' });
                break;
            case 'End':
                event.preventDefault();
                scrollElement.scrollTo({ left: metrics.maxScroll, behavior: 'smooth' });
                break;
            default: break;
        }
    };

    const maxThumbOffset = Math.max(0, metrics.trackWidth - metrics.thumbWidth);
    const thumbOffset = metrics.maxScroll === 0
        ? 0
        : metrics.scrollLeft / metrics.maxScroll * maxThumbOffset;

    return (
        <div
            ref={trackRef}
            role={metrics.isScrollable ? 'scrollbar' : undefined}
            aria-label={metrics.isScrollable ? ariaLabel : undefined}
            aria-controls={metrics.isScrollable ? scrollElementId : undefined}
            aria-orientation="horizontal"
            aria-valuemin={metrics.isScrollable ? 0 : undefined}
            aria-valuemax={metrics.isScrollable ? Math.round(metrics.maxScroll) : undefined}
            aria-valuenow={metrics.isScrollable ? Math.round(metrics.scrollLeft) : undefined}
            aria-hidden={!metrics.isScrollable}
            tabIndex={metrics.isScrollable ? 0 : -1}
            onPointerDown={scrollToPointer}
            onPointerMove={handlePointerMove}
            onPointerUp={() => { pointerDragRef.current = null; }}
            onPointerCancel={() => { pointerDragRef.current = null; }}
            onKeyDown={handleKeyDown}
            className={`group absolute ${bottomClassName} left-2 right-2 z-30 h-2 touch-none rounded-full bg-slate-500/10 transition-opacity dark:bg-slate-400/10 ${
                metrics.isScrollable ? 'cursor-pointer opacity-100' : 'pointer-events-none opacity-0'
            } focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand-500`}
        >
            <span
                data-scrollbar-thumb="true"
                className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-500/55 transition-[height,background-color] duration-200 group-hover:h-1.5 group-hover:bg-slate-600/70 dark:bg-slate-300/45 dark:group-hover:bg-slate-200/65"
                style={{ left: `${thumbOffset}px`, width: `${metrics.thumbWidth}px` }}
            />
        </div>
    );
}
