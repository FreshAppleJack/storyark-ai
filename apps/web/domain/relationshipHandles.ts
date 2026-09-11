import type { HandleConfig } from '../types';
import { asRecord, parseJsonSafe } from '../utils/serialization';

export const DEFAULT_HANDLE_CONFIG: HandleConfig = { top: 'target', right: 'source', bottom: 'source', left: 'target' };

export function normalizeHandleConfig(value: unknown): HandleConfig {
    const data = asRecord(parseJsonSafe(value, {}));
    const result = { ...DEFAULT_HANDLE_CONFIG };
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        const mode = data[side];
        if (mode === 'source' || mode === 'target' || mode === 'both' || mode === 'none') result[side] = mode;
    }
    return result;
}
