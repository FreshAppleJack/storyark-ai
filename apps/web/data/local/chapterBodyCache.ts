import { QueryClient } from '@tanstack/react-query';
import type { LocalChapter } from './contracts';
import { localKeys } from './repository';

export const CHAPTER_CACHE_LIMIT = 8;
export const CHAPTER_CACHE_BYTES = 16 * 1024 * 1024;

function bytes(chapter: LocalChapter): number {
    return 2 * (chapter.body.content.length + (chapter.body.originalContent?.length ?? 0)
        + chapter.foreshadowings.reduce((total, note) => total + note.excerpt.length + note.note.length, 0));
}

/** Saved bodies only. Drafts and active query observers own their data independently. */
export class ChapterBodyCache {
    private entries = new Map<string, { chapter: LocalChapter; bytes: number }>();
    private sizeBytes = 0;
    private key(bookId: string, chapterId: string) { return JSON.stringify([bookId, chapterId]); }
    constructor(private readonly limit = CHAPTER_CACHE_LIMIT, private readonly byteLimit = CHAPTER_CACHE_BYTES) {}
    get(bookId: string, chapterId: string, version: number): LocalChapter | undefined {
        const key = this.key(bookId, chapterId);
        const entry = this.entries.get(key);
        if (!entry || entry.chapter.databaseVersion !== version) { this.remove(bookId, chapterId); return; }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.chapter;
    }
    put(chapter: LocalChapter) {
        const previous = this.entries.get(this.key(chapter.bookId, chapter.id));
        if (previous && previous.chapter.databaseVersion > chapter.databaseVersion) return;
        this.remove(chapter.bookId, chapter.id);
        const weight = bytes(chapter);
        if (weight > this.byteLimit || this.limit < 1) return;
        this.entries.set(this.key(chapter.bookId, chapter.id), { chapter, bytes: weight });
        this.sizeBytes += weight;
        while (this.entries.size > this.limit || this.sizeBytes > this.byteLimit) {
            const [key, entry] = this.entries.entries().next().value!;
            this.entries.delete(key);
            this.sizeBytes -= entry.bytes;
        }
    }
    remove(bookId: string, chapterId: string) {
        const key = this.key(bookId, chapterId);
        const previous = this.entries.get(key);
        if (previous) this.sizeBytes -= previous.bytes;
        this.entries.delete(key);
    }
    clearBook(bookId: string) {
        for (const entry of this.entries.values()) if (entry.chapter.bookId === bookId) this.remove(bookId, entry.chapter.id);
    }
    get size() { return this.entries.size; }
}

const caches = new WeakMap<QueryClient, ChapterBodyCache>();
export function chapterBodyCache(client: QueryClient): ChapterBodyCache {
    let cache = caches.get(client);
    if (!cache) { cache = new ChapterBodyCache(); caches.set(client, cache); }
    return cache;
}

export function rememberChapter(client: QueryClient, chapter: LocalChapter) {
    chapterBodyCache(client).put(chapter);
    const key = localKeys.chapter(chapter.bookId, chapter.id);
    // Never create an unbounded second body cache in React Query.
    if (client.getQueryState(key)) client.setQueryData(key, chapter);
}
