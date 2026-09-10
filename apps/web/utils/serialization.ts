/** Decode legacy JSON fields without trusting their shape. */
export function parseJsonSafe(value: unknown, fallback: unknown): unknown {
    if (typeof value !== 'string') return value ?? fallback;
    try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

export function asRecord(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
}

export function parseTags(value: unknown): string[] {
    let parsed = value;
    if (typeof value === 'string') {
        try { parsed = JSON.parse(value); }
        catch { return value.split(/[,，\s]+/).filter(Boolean); }
    }
    if (Array.isArray(parsed)) return parsed.filter((tag): tag is string => typeof tag === 'string');
    return [];
}
