/** Storage boundary v1. Declarations only; no IPC or in-memory fallback. */
import type { CharacterRole } from '../../types';

export type UUID = string; // Rust validates canonical UUIDs and generates new IDs.
export type DatabaseVersion = number; // Positive safe integer; not a format version.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type ContentState = 'editable' | 'read-only' | 'pending-migration';
export interface StoredContent {
    format: 'tiptap-json' | 'legacy-json' | 'legacy-html' | 'unrecognized';
    version: 0 | 1;
    content: string;
    originalContent: string | null;
    originalFormat: 'legacy-json' | 'legacy-html' | 'unrecognized' | null;
    contentState?: ContentState;
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
    coverColor: string;
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
export type { CharacterRole };
export type HandleSide = 'top' | 'right' | 'bottom' | 'left';
export type HandleMode = 'source' | 'target' | 'both' | 'none';
export type HandleConfigMap = Partial<Record<HandleSide, HandleMode>>;
export interface LocalCharacter {
    id: UUID;
    bookId: UUID;
    name: string;
    aliases: string[];
    role: CharacterRole;
    description: string;
    color: string;
    tags: string[];
    avatar: string | null;
    handleConfig: HandleConfigMap | null;
    isArchived: boolean;
    position: number;
    databaseVersion: DatabaseVersion;
    createdAt: number;
    updatedAt: number;
}
export type Target =
    | { kind: 'book'; bookId: UUID }
    | { kind: 'volume'; bookId: UUID; volumeId: UUID }
    | { kind: 'chapter'; bookId: UUID; volumeId: UUID; chapterId: UUID };
/** Flat shape: serde flattens the target fields beside the expected version. */
export type ExpectedTarget = Target & { expectedDatabaseVersion: DatabaseVersion };
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
    | { ok: false; error: { code: 'NOT_FOUND' | 'OWNERSHIP_MISMATCH' | 'VERSION_CONFLICT' | 'READ_ONLY' | 'INVALID_INPUT' | 'CONTENT_INCOMPATIBLE' | 'STORAGE_FAILURE' | 'IMPORT_INVALID' | 'IMPORT_UNSUPPORTED_VERSION' | 'IMPORT_CONFLICT' | 'BACKUP_FAILED' | 'UNSUPPORTED_ASSET' | 'CANCELLED' | 'INDEX_STALE' | 'PROVIDER_UNAVAILABLE'; message: string; currentDatabaseVersion?: DatabaseVersion } };
export interface LocalStorageCommands {
    listBooks(): Promise<StorageResult<LocalBook[]>>;
    readBook(input: { bookId: UUID }): Promise<StorageResult<{ book: LocalBook; volumes: LocalVolume[]; chapters: LocalChapter[] }>>;
    readDirectory(input: { bookId: UUID }): Promise<StorageResult<{ book: LocalBook; volumes: LocalVolume[]; chapters: LocalChapter[]; bodyMode: 'directory' }>>;
    readChapter(input: { bookId: UUID; chapterId: UUID }): Promise<StorageResult<LocalChapter>>;
    createBook(input: { title: string; author: string; coverColor: string }): Promise<StorageResult<LocalBook>>;
    createVolume(input: { bookId: UUID; title: string; expectedBookVersion: DatabaseVersion }): Promise<StorageResult<{ volume: LocalVolume; book: LocalBook }>>;
    createChapter(input: { bookId: UUID; volumeId: UUID; title: string; expectedVolumeVersion: DatabaseVersion }): Promise<StorageResult<{ chapter: LocalChapter; volume: LocalVolume }>>;
    saveChapter(input: SaveChapterRequest): Promise<StorageResult<{ chapter: LocalChapter; sessionKey: string; revision: number }>>;
    rename(input: ExpectedTarget & { title: string }): Promise<StorageResult<LocalRecord>>;
    updateBook(input: { bookId: UUID; expectedDatabaseVersion: DatabaseVersion; title?: string; status?: 'serializing' | 'completed' }): Promise<StorageResult<LocalBook>>;
    setReadOnly(input: ExpectedTarget & { isReadOnly: boolean }): Promise<StorageResult<LocalRecord>>;
    reorder(input: {
        parent: null | ExpectedTarget;
        items: Array<ExpectedTarget & { expectedPosition: number }>;
    }): Promise<StorageResult<LocalRecord[]>>;
    delete(input: ExpectedTarget & { expectedParentVersion?: DatabaseVersion }): Promise<StorageResult<{ deletedId: UUID; parent: LocalRecord | null }>>;
}
