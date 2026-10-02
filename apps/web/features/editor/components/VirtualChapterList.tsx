import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';

export interface TreeRow { id: string; height: number }
export interface VirtualChapterListHandle { scrollToItem(id: string): void }

/** One scroll surface for both volumes and chapters, with variable row heights. */
export function VirtualChapterList<T extends TreeRow>({ rows, renderRow, pinnedIds, activeId, hidden, ref }: {
    rows: T[]; renderRow: (row: T) => ReactNode; pinnedIds: string[];
    activeId: string; hidden: boolean; ref?: Ref<VirtualChapterListHandle>;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [viewport, setViewport] = useState({ top: 0, height: 320 });
    const layout = useMemo(() => {
        let total = 0;
        const offsets: number[] = [];
        for (const row of rows) { offsets.push(total); total += row.height; }
        return { offsets, total, indices: new Map(rows.map((row, index) => [row.id, index])) };
    }, [rows]);
    const scrollToItem = (id: string) => {
        const index = layout.indices.get(id);
        const element = scrollRef.current;
        if (index === undefined || !element) return;
        const top = layout.offsets[index];
        const bottom = top + rows[index].height;
        const height = element.clientHeight || viewport.height;
        const next = top < element.scrollTop ? top : bottom > element.scrollTop + height ? bottom - height : element.scrollTop;
        element.scrollTop = next;
        setViewport({ top: next, height });
    };
    useImperativeHandle(ref, () => ({ scrollToItem }));
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!element) return;
        const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight || 320 });
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useLayoutEffect(() => {
        if (!hidden) scrollToItem(activeId);
        // Directory changes must not snap the user's browsing position back to selection.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeId, hidden]);
    // Binary search avoids walking thousands of rows on each scroll event.
    let low = 0, high = rows.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (layout.offsets[middle] + rows[middle].height < viewport.top) low = middle + 1;
        else high = middle;
    }
    const indices = new Set<number>();
    for (let index = Math.max(0, low - 6); index < rows.length; index++) {
        if (layout.offsets[index] > viewport.top + viewport.height + 6 * 40) break;
        indices.add(index);
    }
    for (const id of pinnedIds) {
        const index = layout.indices.get(id);
        if (index !== undefined) indices.add(index);
    }
    return <div ref={scrollRef} hidden={hidden} data-testid="chapter-tree-scroll"
        className="min-h-0 flex-1 overflow-y-auto py-2 relative"
        onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight || viewport.height })}>
        <div className="relative mx-2" style={{ height: layout.total }}>
            {[...indices].sort((a, b) => a - b).map(index => <div key={rows[index].id}
                style={{ position: 'absolute', top: layout.offsets[index], height: rows[index].height, left: 0, right: 0 }}>
                {renderRow(rows[index])}
            </div>)}
        </div>
    </div>;
}
