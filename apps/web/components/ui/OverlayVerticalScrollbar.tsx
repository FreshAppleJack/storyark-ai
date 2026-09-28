import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

interface ScrollbarMetrics {
    controlsId?: string;
    top: number;
    left: number;
    height: number;
    thumbTop: number;
    thumbHeight: number;
    maxScroll: number;
    scrollTop: number;
}

const IDLE_DELAY_MS = 1400;
const TRACK_WIDTH = 12;

function isVerticallyScrollable(element: HTMLElement): boolean {
    if (element.scrollHeight <= element.clientHeight + 1) return false;
    if (element === document.scrollingElement) return true;
    return /auto|scroll|overlay/.test(getComputedStyle(element).overflowY);
}

function nearestScrollable(element: EventTarget | null): HTMLElement | null {
    let current = element instanceof HTMLElement ? element : null;
    while (current) {
        if (isVerticallyScrollable(current)) return current;
        current = current.parentElement;
    }
    const root = document.scrollingElement;
    return root instanceof HTMLElement && isVerticallyScrollable(root) ? root : null;
}

function measure(element: HTMLElement): ScrollbarMetrics | null {
    if (!element.isConnected || !isVerticallyScrollable(element)) return null;
    const modal = document.querySelector<HTMLElement>('[aria-modal="true"]');
    if (modal && !modal.contains(element)) return null;
    const root = element === document.scrollingElement;
    const rect = root
        ? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
        : element.getBoundingClientRect();
    const top = Math.max(0, rect.top);
    const bottom = Math.min(window.innerHeight, rect.bottom);
    const height = bottom - top;
    if (height < 28 || rect.right <= 0 || rect.left >= window.innerWidth) return null;
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const thumbHeight = Math.min(height, Math.max(30, height * element.clientHeight / element.scrollHeight));
    const scrollTop = Math.max(0, Math.min(maxScroll, element.scrollTop));
    return {
        controlsId: element.id || undefined,
        top,
        left: Math.min(window.innerWidth - TRACK_WIDTH, Math.max(0, rect.right - TRACK_WIDTH)),
        height,
        thumbTop: maxScroll ? scrollTop / maxScroll * (height - thumbHeight) : 0,
        thumbHeight,
        maxScroll,
        scrollTop,
    };
}

/** One overlay follows the scroll container the user is currently using. */
export function OverlayVerticalScrollbar() {
    const scrollElementRef = useRef<HTMLElement | null>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const hoverRef = useRef(false);
    const dragRef = useRef<{ pointerY: number; scrollTop: number } | null>(null);
    const idleTimerRef = useRef<number | null>(null);
    const [metrics, setMetrics] = useState<ScrollbarMetrics | null>(null);
    const [visible, setVisible] = useState(false);
    const [hovered, setHovered] = useState(false);

    useEffect(() => {
        document.documentElement.classList.add('overlay-scrollbars-enabled');
        const clearIdle = () => {
            if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
            idleTimerRef.current = null;
        };
        const hideLater = () => {
            clearIdle();
            if (!hoverRef.current && !dragRef.current) {
                idleTimerRef.current = window.setTimeout(() => setVisible(false), IDLE_DELAY_MS);
            }
        };
        const refresh = () => {
            const element = scrollElementRef.current;
            const next = element && measure(element);
            setMetrics(current => current && next
                && current.top === next.top && current.left === next.left
                && current.height === next.height && current.thumbTop === next.thumbTop
                && current.thumbHeight === next.thumbHeight && current.maxScroll === next.maxScroll
                && current.scrollTop === next.scrollTop && current.controlsId === next.controlsId
                ? current : next);
            if (!next) setVisible(false);
        };
        const activate = (element: HTMLElement | null) => {
            if (!element) return;
            if (scrollElementRef.current !== element) {
                scrollElementRef.current = element;
                hoverRef.current = false;
                setHovered(false);
            }
            refresh();
            setVisible(true);
            hideLater();
        };
        const onPointerOver = (event: globalThis.PointerEvent) => {
            if (trackRef.current?.contains(event.target as Node)) return;
            activate(nearestScrollable(event.target));
        };
        const onFocusIn = (event: FocusEvent) => activate(nearestScrollable(event.target));
        const onScroll = (event: Event) => {
            const target = event.target === document
                ? document.scrollingElement
                : event.target;
            if (target instanceof HTMLElement && isVerticallyScrollable(target)) activate(target);
        };
        document.addEventListener('pointerover', onPointerOver, true);
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', refresh);
        const mutationObserver = new MutationObserver(refresh);
        mutationObserver.observe(document.body, { childList: true, subtree: true });
        return () => {
            clearIdle();
            document.documentElement.classList.remove('overlay-scrollbars-enabled');
            document.removeEventListener('pointerover', onPointerOver, true);
            document.removeEventListener('focusin', onFocusIn, true);
            document.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', refresh);
            mutationObserver.disconnect();
        };
    }, []);

    const keepVisible = () => {
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
        hoverRef.current = true;
        setHovered(true);
        setVisible(true);
    };
    const releaseHover = () => {
        if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
        hoverRef.current = false;
        setHovered(false);
        if (!dragRef.current) {
            idleTimerRef.current = window.setTimeout(() => setVisible(false), IDLE_DELAY_MS);
        }
    };
    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        const element = scrollElementRef.current;
        if (!element || !metrics) return;
        const isThumb = event.target instanceof HTMLElement && event.target.dataset.scrollbarThumb === 'true';
        if (!isThumb) {
            const track = trackRef.current?.getBoundingClientRect();
            if (track) {
                const position = Math.max(0, Math.min(metrics.height - metrics.thumbHeight,
                    event.clientY - track.top - metrics.thumbHeight / 2));
                element.scrollTop = position / Math.max(1, metrics.height - metrics.thumbHeight) * metrics.maxScroll;
            }
        }
        dragRef.current = { pointerY: event.clientY, scrollTop: element.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
        keepVisible();
        event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const element = scrollElementRef.current;
        const drag = dragRef.current;
        if (!element || !drag || !metrics) return;
        const travel = metrics.height - metrics.thumbHeight;
        if (travel > 0) element.scrollTop = drag.scrollTop + (event.clientY - drag.pointerY) / travel * metrics.maxScroll;
        setMetrics(measure(element));
    };
    const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
        dragRef.current = null;
        const rect = trackRef.current?.getBoundingClientRect();
        if (rect && (event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom)) releaseHover();
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const element = scrollElementRef.current;
        if (!element || !metrics) return;
        const page = Math.max(40, element.clientHeight * 0.8);
        const amounts: Record<string, number> = { ArrowUp: -40, ArrowDown: 40, PageUp: -page, PageDown: page };
        if (event.key in amounts) element.scrollTop += amounts[event.key];
        else if (event.key === 'Home') element.scrollTop = 0;
        else if (event.key === 'End') element.scrollTop = metrics.maxScroll;
        else return;
        event.preventDefault();
        setMetrics(measure(element));
        keepVisible();
    };

    return createPortal(
        <div
            ref={trackRef}
            role={metrics ? 'scrollbar' : undefined}
            aria-label={metrics ? 'Vertical scrollbar' : undefined}
            aria-controls={metrics?.controlsId}
            aria-orientation="vertical"
            aria-valuemin={metrics ? 0 : undefined}
            aria-valuemax={metrics ? Math.round(metrics.maxScroll) : undefined}
            aria-valuenow={metrics ? Math.round(metrics.scrollTop) : undefined}
            tabIndex={metrics && visible ? 0 : -1}
            onFocus={keepVisible}
            onBlur={releaseHover}
            onPointerEnter={keepVisible}
            onPointerLeave={releaseHover}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onKeyDown={onKeyDown}
            className={`fixed z-[200] w-3 touch-none transition-opacity duration-500 ${metrics ? '' : 'pointer-events-none'} ${visible ? 'opacity-100' : 'opacity-0'} focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand-500`}
            style={{ top: metrics?.top ?? 0, left: metrics?.left ?? 0, height: metrics?.height ?? 0 }}
        >
            {metrics && <span
                data-scrollbar-thumb="true"
                className={`absolute right-0 rounded-full transition-[width,background-color] duration-200 ${hovered
                    ? 'w-2.5 bg-slate-500/55 dark:bg-slate-400/55'
                    : 'w-1 bg-slate-500/30 dark:bg-slate-400/30'}`}
                style={{ top: metrics.thumbTop, height: metrics.thumbHeight }}
            />}
        </div>,
        document.body,
    );
}
