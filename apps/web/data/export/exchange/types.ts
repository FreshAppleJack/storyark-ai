import type { CharacterRole, HandleConfig } from '../../../types';
import type { ChapterSummarySourceSnapshot } from '../../../domain/chapterSummarySource';
import {
    STORYARK_EXPORT_CONTENT_VERSION,
    STORYARK_EXPORT_SCHEMA_VERSION,
} from './limits';

export type UUID = string;
export type Timestamp = number;
export type JsonPrimitive = null | boolean | number | string;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

export type ExchangeContentFormat = 'tiptap-json' | 'legacy-json' | 'legacy-html' | 'unrecognized';
export type LegacyContentFormat = Exclude<ExchangeContentFormat, 'tiptap-json'>;
export type ContentState = 'editable' | 'read-only' | 'pending-migration';
export type TiptapNode = { [key: string]: JsonValue };
export type TiptapDocument = TiptapNode & { type: 'doc'; content?: TiptapNode[] };

export interface ExchangeExtensions {
    [key: string]: JsonValue;
}

export interface ExchangeSnapshot {
    /** SQLite PRAGMA user_version; this is a migration snapshot, not a merge token. */
    databaseVersion: number;
    /** StoryArk content representation used by this exchange contract. */
    contentVersion: typeof STORYARK_EXPORT_CONTENT_VERSION;
}

export interface ExchangeProducer {
    appVersion: string;
    platform: 'windows' | 'macos' | 'linux' | 'unknown';
    extensions?: ExchangeExtensions;
}

export interface ExchangeRecordMetadata {
    databaseVersion: number;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    extensions?: ExchangeExtensions;
}

export interface ExchangeBook extends ExchangeRecordMetadata {
    id: UUID;
    title: string;
    author: string;
    status: 'serializing' | 'completed';
    position: number;
    isReadOnly: boolean;
    coverColor?: string;
}

export interface ExchangeVolume extends ExchangeRecordMetadata {
    id: UUID;
    bookId: UUID;
    title: string;
    status: 'draft' | 'published';
    position: number;
    isReadOnly: boolean;
}

export interface TiptapContentBody {
    format: 'tiptap-json';
    version: 1;
    content: TiptapDocument;
    /** Safe editor support for this document, independent of chapter lock state. */
    contentState: ContentState;
    originalContent?: string;
    originalFormat?: LegacyContentFormat;
    extensions?: ExchangeExtensions;
}

export interface LegacyContentBody {
    format: LegacyContentFormat;
    version: 0;
    /** The raw legacy value, never an empty replacement for failed conversion. */
    content: string;
    contentState: 'read-only' | 'pending-migration';
    originalContent: string;
    originalFormat: LegacyContentFormat;
    extensions?: ExchangeExtensions;
}

export type ExchangeContentBody = TiptapContentBody | LegacyContentBody;

export interface ExchangeChapter extends ExchangeRecordMetadata {
    id: UUID;
    bookId: UUID;
    volumeId: UUID;
    title: string;
    status: 'draft' | 'published';
    position: number;
    isReadOnly: boolean;
    wordCount: number;
    body: ExchangeContentBody;
    foreshadowingIds: string[];
}

export interface ExchangeCharacter extends ExchangeRecordMetadata {
    id: UUID;
    bookId: UUID;
    name: string;
    aliases: string[];
    role: CharacterRole;
    description: string;
    color: string;
    tags: string[];
    avatar: string | null;
    handleConfig: Partial<HandleConfig> | null;
    isArchived: boolean;
    position: number;
}

export interface ExchangeGraphNode {
    /** A graph node instance ID. It is not a character ID. */
    nodeKey: UUID;
    characterId: UUID;
    positionX: number;
    positionY: number;
    handleConfig: Partial<HandleConfig> | null;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
    extensions?: ExchangeExtensions;
}

export interface ExchangeGraphEdge {
    id: UUID;
    /** Edge endpoints reference graph node instances, never character IDs. */
    sourceNodeKey: UUID;
    targetNodeKey: UUID;
    sourceHandle: string;
    targetHandle: string;
    label: string;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
    extensions?: ExchangeExtensions;
}

export interface ExchangeGraph extends ExchangeRecordMetadata {
    bookId: UUID;
    nodes: ExchangeGraphNode[];
    edges: ExchangeGraphEdge[];
}

export interface ExchangeForeshadowing extends ExchangeRecordMetadata {
    /** Legacy note IDs are intentionally opaque and need not be UUIDs. */
    id: string;
    chapterId: UUID;
    excerpt: string;
    note: string;
    isRecovered?: boolean;
}

export interface ExchangeChapterSummary {
    chapterId: UUID;
    summary: string;
    sourceChapterVersion?: number;
    updatedAt: Timestamp;
    provenance?: 'author' | 'ai-adopted';
    sourceSnapshot?: ExchangeChapterSummarySourceSnapshot;
    freshnessAcknowledgement?: ExchangeChapterSummaryFreshnessAcknowledgement;
    generationMetadata?: ExchangeChapterSummaryGenerationMetadata;
    extensions?: ExchangeExtensions;
}

export interface ExchangeChapterSummarySourceSnapshot {
    chapterId: UUID;
    chapterDatabaseVersion: number | null;
    chapterTitle: string;
    contentFormat: ExchangeContentFormat;
    contentVersion: number | null;
    fingerprintAlgorithm: 'fnv1a64-utf16-v1';
    bodyFingerprint: string;
    structuredFingerprint: string;
    blockFingerprints: string[];
    mentionedCharacterIds: UUID[];
    foreshadowingIds: string[];
    foreshadowingNoteFingerprints: Array<{ noteId: string; fingerprint: string }>;
    capturedAt: Timestamp;
    copyReferences?: ChapterSummarySourceSnapshot['copyReferences'];
    copySourceVersions?: ChapterSummarySourceSnapshot['copySourceVersions'];
    extensions?: ExchangeExtensions;
}

export interface ExchangeChapterSummaryFreshnessAcknowledgement {
    acknowledgedSourceSnapshot: ExchangeChapterSummarySourceSnapshot;
    allowedSourceVersions: Array<number | null>;
    acknowledgedAt: Timestamp;
}

export type ExchangeChapterSummarySourceKind = 'planning' | 'confirmed_setting' | 'character' | 'relationship' | 'foreshadowing_note';

export interface ExchangeChapterSummaryRetrievalScope {
    bookId: UUID;
    allowedSourceKinds: Array<Extract<ExchangeChapterSummarySourceKind, 'confirmed_setting' | 'character'>>;
    allowedChapterIds: UUID[];
    beforeChapterOrder: number | null;
    beforeAnchor: { chapterId: UUID; paragraphOrdinal?: number | null; textOffset?: number | null } | null;
    includeFuturePlan: false;
    includeGenerated: false;
    includeStale: false;
    timeRange: { updatedAfter?: Timestamp | null; updatedBefore?: Timestamp | null } | null;
}

export interface ExchangeChapterSummaryRetrievalBudget {
    charBudget: number;
    tokenBudget: number | null;
}

export interface ExchangeChapterSummaryGenerationSource {
    bookId: UUID;
    chapterId: UUID;
    chapterDatabaseVersion: number;
    sourceBodyFingerprint: string;
    planningDatabaseVersion: number | null;
    allowedSources: Array<{
        sourceId: string;
        entityId: string;
        sourceKind: ExchangeChapterSummarySourceKind;
        sourceVersion: number;
        indexVersion: number | null;
    }>;
    retrievalTrace: {
        searchId: string;
        retrievalVersion: string;
        task: 'chapter_summary';
        requestedAt: Timestamp;
        scope: ExchangeChapterSummaryRetrievalScope;
        excludedHitIds: string[];
        sourceVersions: Array<{
            sourceId: string;
            chapterId: UUID | null;
            sourceVersion: number;
            indexVersion: number;
        }>;
        includedHitIds: string[];
        omittedHitIds: string[];
        budget: ExchangeChapterSummaryRetrievalBudget;
        indexVersion: number | null;
        embeddingFingerprint: string | null;
    } | null;
    includesFuturePlan: false;
}

export interface ExchangeChapterSummaryGenerationMetadata {
    providerId: string;
    configId: UUID;
    protocol: string;
    modelId: string;
    generatedAt: Timestamp;
    promptVersion: string;
    source: ExchangeChapterSummaryGenerationSource;
    extensions?: ExchangeExtensions;
}

export interface ExchangePlotSetting {
    id: string;
    title: string;
    details: string;
    chapterIds: UUID[];
    missingChapterIds?: UUID[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
    extensions?: ExchangeExtensions;
}

export interface ExchangePlanning {
    bookId: UUID;
    databaseVersion: number;
    storySummary: string;
    storyBackground: string;
    chapterSummaries: ExchangeChapterSummary[];
    plotSettings: ExchangePlotSetting[];
    updatedAt?: Timestamp;
    extensions?: ExchangeExtensions;
}

export interface ExchangeBrainstormGenerationSource {
    bookId: UUID;
    workspaceDatabaseVersion: number;
    planningDatabaseVersion: number;
    graphDatabaseVersion: number;
    selectedChapters: Array<{ chapterId: UUID; databaseVersion: number; extensions?: ExchangeExtensions }>;
    extensions?: ExchangeExtensions;
}

export interface ExchangeBrainstormGenerationMetadata {
    configId: UUID;
    modelId: string;
    generatedAt: Timestamp;
    promptVersion: string;
    includesPlanning?: boolean;
    retrieval?: ExchangeBrainstormRetrievalMetadata | null;
    source: ExchangeBrainstormGenerationSource;
    extensions?: ExchangeExtensions;
}

export interface ExchangeBrainstormRetrievalMetadata {
    retrievalVersion: string;
    requestedAt: Timestamp;
    sourceVersions: Array<{
        sourceId: string;
        chapterId: UUID | null;
        sourceVersion: number;
        indexVersion: number;
        extensions?: ExchangeExtensions;
    }>;
    includedHitIds: string[];
    indexVersion: number | null;
    embeddingFingerprint: string | null;
    extensions?: ExchangeExtensions;
}

export interface ExchangeBrainstormOption {
    id: string;
    title: string;
    conflict: string;
    motivation: string;
    consequences: string;
    development: string;
    extensions?: ExchangeExtensions;
}

export interface ExchangeBrainstormWorkspace extends ExchangeRecordMetadata {
    bookId: UUID;
    selectedChapterIds: UUID[];
    contextSnapshot: JsonObject;
    generatedOptions: ExchangeBrainstormOption[];
    selectedOptionId?: string | null;
    finalContent: string;
    generationMetadata?: ExchangeBrainstormGenerationMetadata;
}

export interface ExchangeAsset {
    id: UUID;
    name?: string;
    mimeType: string;
    size: number;
    sha256: string;
    /** Base64-encoded bytes; local paths and remote URLs are not valid assets. */
    bytes: string;
    encoding: 'base64';
    extensions?: ExchangeExtensions;
}

export interface StoryArkWorkExport {
    schemaVersion: typeof STORYARK_EXPORT_SCHEMA_VERSION;
    exportId: UUID;
    exportedAt: string;
    producer: ExchangeProducer;
    snapshot: ExchangeSnapshot;
    book: ExchangeBook;
    volumes: ExchangeVolume[];
    chapters: ExchangeChapter[];
    characters: ExchangeCharacter[];
    graphs: ExchangeGraph[];
    foreshadowings: ExchangeForeshadowing[];
    planning: ExchangePlanning;
    brainstormWorkspaces: ExchangeBrainstormWorkspace[];
    assets: ExchangeAsset[];
    extensions?: ExchangeExtensions;
}
