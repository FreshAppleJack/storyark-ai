const DEBUG_HIGHLIGHTS = false;
import type { Editor } from '@tiptap/core';
import type { Character } from '../../../types';

export interface MentionDebugEntry {
    pos: number;
    id: string;
    label: string;
    color?: string;
}

declare global {
    interface Window {
        __DEBUG_HIGHLIGHTS__?: boolean;
        __debugTiptap?: {
            getEditor: () => Editor;
            getCharacters: () => Character[];
            inspectMentions: () => MentionDebugEntry[];
            diffMentions: () => unknown[];
            forceRefresh: () => void;
        };
    }
}

/**
 * Debug logger for editor highlight tracing.
 * Enable by flipping DEBUG_HIGHLIGHTS or setting
 * window.__DEBUG_HIGHLIGHTS__ = true at runtime.
 */
export const dlog = (...args: unknown[]) => {
    if (DEBUG_HIGHLIGHTS || (typeof window !== 'undefined' && window.__DEBUG_HIGHLIGHTS__)) {
        console.log('[TiptapHL]', ...args);
    }
};
