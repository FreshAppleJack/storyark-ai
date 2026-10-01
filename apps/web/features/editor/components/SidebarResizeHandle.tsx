import React, { useEffect, useRef, useState } from 'react';
import type { SidebarSide } from '../sidebarLayout';

interface SidebarResizeHandleProps {
    side: SidebarSide;
    width: number;
    min: number;
    max: number;
    onResize: (width: number) => void;
    onReset: () => void;
    onDraggingChange?: (dragging: boolean) => void;
}

export function SidebarResizeHandle({ side, width, min, max, onResize, onReset, onDraggingChange }: SidebarResizeHandleProps) {
    const drag = useRef<{ id: number; x: number; width: number } | null>(null);
    const restore = useRef<(() => void) | null>(null);
    const [dragging, setDragging] = useState(false);
    useEffect(() => () => {
        restore.current?.();
        onDraggingChange?.(false);
    }, [onDraggingChange]);

    const finish = () => {
        drag.current = null;
        restore.current?.();
        restore.current = null;
        setDragging(false);
        onDraggingChange?.(false);
    };
    const direction = side === 'left' ? 1 : -1;
    const change = (value: number) => onResize(Math.min(max, Math.max(min, value)));

    return <div
        role="separator"
        aria-orientation="vertical"
        aria-label={side === 'left' ? 'Resize chapter sidebar' : 'Resize writing context sidebar'}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Math.round(width)}
        aria-valuetext={`${Math.round(width)} pixels`}
        tabIndex={0}
        title="Double-click to reset"
        className={`group absolute inset-y-0 z-40 w-2 cursor-col-resize touch-none select-none outline-none hover:bg-brand-500/15 focus-visible:bg-brand-500/20 ${side === 'left' ? 'right-0' : 'left-0'} ${dragging ? 'bg-brand-500/20' : ''}`}
        onPointerDown={event => {
            if (event.button !== 0 || drag.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, x: event.clientX, width };
            const { cursor, userSelect } = document.body.style;
            restore.current = () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; };
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            setDragging(true);
            onDraggingChange?.(true);
        }}
        onPointerMove={event => {
            const start = drag.current;
            if (start?.id === event.pointerId) change(start.width + direction * (event.clientX - start.x));
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={onReset}
        onKeyDown={event => {
            const step = event.shiftKey ? 40 : 16;
            if (event.key === 'ArrowLeft') change(width - direction * step);
            else if (event.key === 'ArrowRight') change(width + direction * step);
            else if (event.key === 'Home') change(min);
            else if (event.key === 'End') change(max);
            else return;
            event.preventDefault();
        }}
    >
        <span className={`absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${dragging ? 'opacity-100' : 'opacity-0'}`} />
    </div>;
}
