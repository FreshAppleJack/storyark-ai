export type WorkDraftKind = 'chapter' | 'characters' | 'planning' | 'graph' | 'brainstorm';

interface RegisteredFlush {
    token: symbol;
    flush: () => Promise<boolean>;
}

const registrations = new Map<string, Map<WorkDraftKind, RegisteredFlush>>();

/** Register the draft owned by a currently mounted local-work page. */
export function registerWorkDraftFlush(
    bookId: string,
    kind: WorkDraftKind,
    flush: () => Promise<boolean>,
): () => void {
    if (!bookId) return () => undefined;
    const bookRegistrations = registrations.get(bookId) ?? new Map<WorkDraftKind, RegisteredFlush>();
    const token = Symbol(kind);
    bookRegistrations.set(kind, { token, flush });
    registrations.set(bookId, bookRegistrations);
    return () => {
        const current = registrations.get(bookId);
        if (!current || current.get(kind)?.token !== token) return;
        current.delete(kind);
        if (current.size === 0) registrations.delete(bookId);
    };
}

/**
 * Flush all drafts still mounted for a book in a stable order. Fallbacks let
 * an exporter flush its owning page even before its registration effect runs.
 */
export async function flushWorkDrafts(
    bookId: string,
    fallbacks: Array<{ kind: WorkDraftKind; flush: () => Promise<boolean> }> = [],
): Promise<boolean> {
    const current = new Map(registrations.get(bookId));
    fallbacks.forEach(fallback => {
        if (!current.has(fallback.kind)) current.set(fallback.kind, { token: Symbol(fallback.kind), flush: fallback.flush });
    });
    const order: WorkDraftKind[] = ['chapter', 'characters', 'planning', 'graph', 'brainstorm'];
    for (const kind of order) {
        const registered = current.get(kind);
        if (!registered) continue;
        try {
            if (!await registered.flush()) return false;
        } catch {
            return false;
        }
    }
    return true;
}
