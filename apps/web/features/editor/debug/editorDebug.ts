const DEBUG_HIGHLIGHTS = false;

/**
 * Debug logger for editor highlight tracing.
 * Enable by flipping DEBUG_HIGHLIGHTS or setting
 * window.__DEBUG_HIGHLIGHTS__ = true at runtime.
 */
export const dlog = (...args: any[]) => {
    if (DEBUG_HIGHLIGHTS || (typeof window !== 'undefined' && (window as any).__DEBUG_HIGHLIGHTS__)) {
        // eslint-disable-next-line no-console
        console.log('[TiptapHL]', ...args);
    }
};
