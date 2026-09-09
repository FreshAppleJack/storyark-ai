/** Provider-owned serialization for writes to the same chapter. */
export function createChapterWriteQueue() {
    const pending = new Map<string, Promise<unknown>>();
    return {
        run<T>(bookId: string, chapterId: string, write: () => Promise<T>): Promise<T> {
            const key = JSON.stringify([bookId, chapterId]);
            const result = (pending.get(key) ?? Promise.resolve()).catch(() => undefined).then(write);
            pending.set(key, result);
            const clear = () => { if (pending.get(key) === result) pending.delete(key); };
            void result.then(clear, clear);
            return result;
        },
        async drain(bookId: string, chapterId: string) {
            await pending.get(JSON.stringify([bookId, chapterId]))?.catch(() => undefined);
        },
    };
}
