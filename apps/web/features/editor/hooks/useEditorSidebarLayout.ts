import { useEffect, useRef, useState } from 'react';
import {
    clampSidebarWidth, DEFAULT_CONTEXT_WIDTH, getSidebarLayout, readSidebarWidths,
    SIDEBAR_STORAGE_KEY, type SidebarSide, type SidebarWidths,
} from '../sidebarLayout';

export function useEditorSidebarLayout(rightOpen: boolean) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(() => window.innerWidth);
    const [leftExpanded, setLeftExpanded] = useState(true);
    const [preferred, setPreferred] = useState<SidebarWidths>(() => {
        try { return readSidebarWidths(localStorage.getItem(SIDEBAR_STORAGE_KEY)); }
        catch { return { left: null, right: DEFAULT_CONTEXT_WIDTH }; }
    });

    useEffect(() => {
        const measure = () => setContainerWidth(Math.round(containerRef.current?.getBoundingClientRect().width || window.innerWidth));
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        if (containerRef.current) observer?.observe(containerRef.current);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
    }, []);

    useEffect(() => {
        try { localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(preferred)); }
        catch { /* Resizing remains available when browser storage is disabled. */ }
    }, [preferred]);

    const layout = getSidebarLayout(containerWidth, preferred, leftExpanded, rightOpen);
    const resize = (side: SidebarSide, width: number) => {
        const max = side === 'left' ? layout.leftMax : layout.rightMax;
        const next = Math.min(max, clampSidebarWidth(side, width));
        // Keep the other panel steady during a drag; viewport clamps never overwrite preferences.
        setPreferred({
            left: side === 'left' ? next : preferred.left,
            right: side === 'right' ? next : rightOpen && !layout.rightOverlay ? layout.rightWidth : preferred.right,
        });
    };
    const reset = (side: SidebarSide) => setPreferred(current => ({
        ...current, [side]: side === 'left' ? null : DEFAULT_CONTEXT_WIDTH,
    }));

    return { containerRef, leftExpanded, setLeftExpanded, ...layout, resize, reset };
}
