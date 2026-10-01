export const SIDEBAR_LIMITS = {
    left: { min: 280, max: 560 },
    right: { min: 240, max: 480 },
} as const;
export const MIN_WRITING_WIDTH = 560;
export const DEFAULT_CONTEXT_WIDTH = 288;
export const SIDEBAR_STORAGE_KEY = 'storyark.editor.sidebar-widths.v1';

export type SidebarSide = 'left' | 'right';
export interface SidebarWidths { left: number | null; right: number }

export function clampSidebarWidth(side: SidebarSide, width: number): number {
    const { min, max } = SIDEBAR_LIMITS[side];
    return Math.round(Math.min(max, Math.max(min, width)));
}

export function readSidebarWidths(value: string | null): SidebarWidths {
    const defaults = { left: null, right: DEFAULT_CONTEXT_WIDTH };
    try {
        const parsed = JSON.parse(value ?? 'null');
        if (!parsed || typeof parsed !== 'object') return defaults;
        return {
            left: typeof parsed.left === 'number' && Number.isFinite(parsed.left)
                ? clampSidebarWidth('left', parsed.left) : null,
            right: typeof parsed.right === 'number' && Number.isFinite(parsed.right)
                ? clampSidebarWidth('right', parsed.right) : DEFAULT_CONTEXT_WIDTH,
        };
    } catch {
        return defaults;
    }
}

export function getSidebarLayout(width: number, preferred: SidebarWidths, leftExpanded: boolean, rightOpen: boolean) {
    const leftOverlay = width <= 900;
    const leftDefault = width >= 1280 ? 384 : 320;
    const leftDesired = preferred.left ?? leftDefault;
    const leftInlineMin = leftExpanded ? SIDEBAR_LIMITS.left.min : 64;
    const rightOverlay = width - (leftOverlay ? 0 : leftInlineMin)
        < MIN_WRITING_WIDTH + SIDEBAR_LIMITS.right.min;
    const leftCap = leftOverlay
        ? Math.min(SIDEBAR_LIMITS.left.max, Math.max(SIDEBAR_LIMITS.left.min, width / 2), width - 32)
        : Math.min(SIDEBAR_LIMITS.left.max, width - MIN_WRITING_WIDTH - (rightOpen && !rightOverlay ? SIDEBAR_LIMITS.right.min : 0));
    const leftWidth = leftExpanded ? Math.min(clampSidebarWidth('left', leftDesired), leftCap) : 64;
    const inlineLeft = leftOverlay ? 0 : leftWidth;
    const rightCap = rightOverlay
        ? Math.min(SIDEBAR_LIMITS.right.max, Math.max(SIDEBAR_LIMITS.right.min, width / 2), width - 32)
        : Math.min(SIDEBAR_LIMITS.right.max, width - inlineLeft - MIN_WRITING_WIDTH);
    const rightWidth = Math.min(clampSidebarWidth('right', preferred.right), rightCap);
    return {
        leftWidth, rightWidth, leftOverlay, rightOverlay,
        leftMax: Math.floor(leftOverlay ? leftCap : Math.min(SIDEBAR_LIMITS.left.max,
            width - MIN_WRITING_WIDTH - (rightOpen && !rightOverlay ? rightWidth : 0))),
        rightMax: Math.floor(rightCap),
    };
}
