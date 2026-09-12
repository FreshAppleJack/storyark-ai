/** Storage boundary v1. Declarations only; no IPC or in-memory fallback. */
export type UUID = string; // Rust validates canonical UUIDs and generates new IDs.
export type DatabaseVersion = number; // Positive safe integer; not a format version.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface StoredContent {
    format: 'tiptap-json' | 'legacy-json' | 'legacy-html' | 'unrecognized';
    version: 0 | 1;
    content: string;
    originalContent: string | null;
    originalFormat: 'legacy-json' | 'legacy-html' | 'unrecognized' | null;
}
export interface LocalRecord {
    id: UUID;
    title: string;
    position: number;
    isReadOnly: boolean;
    databaseVersion: DatabaseVersion;
    createdAt: number;
    updatedAt: number;
}
export interface LocalBook extends LocalRecord {
    author: string;
    status: 'serializing' | 'completed';
}
export interface LocalVolume extends LocalRecord {
    bookId: UUID;
    status: 'draft' | 'published';
}
export interface LocalChapter extends LocalRecord {
    bookId: UUID;
    volumeId: UUID;
    status: 'draft' | 'published';
    body: StoredContent;
    wordCount: number;
    foreshadowings: Array<{ id: string; excerpt: string; note: string; createdAt: number; updatedAt: number; isRecovered?: boolean; [key: string]: JsonValue | undefined }>;
}
export type Target =
    | { kind: 'book'; bookId: UUID }
    | { kind: 'volume'; bookId: UUID; volumeId: UUID }
    | { kind: 'chapter'; bookId: UUID; volumeId: UUID; chapterId: UUID };
export interface ExpectedTarget {
    target: Target;
    expectedDatabaseVersion: DatabaseVersion;
}
export interface SaveChapterRequest {
    bookId: UUID;
    volumeId: UUID;
    chapterId: UUID;
    expectedDatabaseVersion: DatabaseVersion;
    sessionKey: string;
    revision: number;
    title: string;
    contentFormat: 'tiptap-json';
    contentVersion: 1;
    content: string;
    wordCount: number;
    foreshadowings: LocalChapter['foreshadowings'];
}
export type StorageResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: { code: 'NOT_FOUND' | 'OWNERSHIP_MISMATCH' | 'VERSION_CONFLICT' | 'READ_ONLY' | 'INVALID_INPUT' | 'CONTENT_INCOMPATIBLE' | 'STORAGE_FAILURE'; message: string; currentDatabaseVersion?: DatabaseVersion } };
export interface LocalStorageCommands {
    listBooks(): Promise<StorageResult<LocalBook[]>>;
    readBook(input: { bookId: UUID }): Promise<StorageResult<{ book: LocalBook; volumes: LocalVolume[]; chapters: LocalChapter[] }>>;
    createBook(input: { title: string; author: string }): Promise<StorageResult<LocalBook>>;
    createVolume(input: { bookId: UUID; title: string; expectedBookVersion: DatabaseVersion }): Promise<StorageResult<{ volume: LocalVolume; book: LocalBook }>>;
    createChapter(input: { bookId: UUID; volumeId: UUID; title: string; expectedVolumeVersion: DatabaseVersion }): Promise<StorageResult<{ chapter: LocalChapter; volume: LocalVolume }>>;
    saveChapter(input: SaveChapterRequest): Promise<StorageResult<{ chapter: LocalChapter; sessionKey: string; revision: number }>>;
    rename(input: ExpectedTarget & { title: string }): Promise<StorageResult<LocalRecord>>;
    setStatus(input: ExpectedTarget & { status: 'serializing' | 'completed' | 'draft' | 'published' }): Promise<StorageResult<LocalRecord>>;
    setReadOnly(input: ExpectedTarget & { isReadOnly: boolean }): Promise<StorageResult<LocalRecord>>;
    reorder(input: {
        parent: null | ExpectedTarget;
        items: Array<ExpectedTarget>;
    }): Promise<StorageResult<LocalRecord[]>>;
    delete(input: ExpectedTarget & { expectedParentVersion?: DatabaseVersion }): Promise<StorageResult<{ deletedId: UUID; parent: LocalRecord | null }>>;
}
