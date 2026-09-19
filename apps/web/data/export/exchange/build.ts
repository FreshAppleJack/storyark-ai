import { parseBrainstormGenerationMetadata } from '../../brainstormMapping';
import type { LocalChapter, StoredContent } from '../../local/contracts';
import type { LocalWorkExportSnapshot } from '../../local/exportRepository';
import {
    STORYARK_EXPORT_CONTENT_VERSION,
    STORYARK_EXPORT_SCHEMA_VERSION,
} from './limits';
import type {
    ExchangeBrainstormGenerationMetadata,
    ExchangeChapter,
    ExchangeContentBody,
    ExchangeForeshadowing,
    ExchangePlanning,
    ExchangeProducer,
    StoryArkWorkExport,
    TiptapDocument,
} from './types';

export class WorkExportBuildError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkExportBuildError';
    }
}

export interface WorkExportBuildOptions {
    exportId?: string;
    exportedAt?: string;
    producer?: ExchangeProducer;
}

export interface WorkExportSummary {
    schemaVersion: number;
    bookTitle: string;
    counts: {
        volumes: number;
        chapters: number;
        characters: number;
        graphs: number;
        graphNodes: number;
        graphEdges: number;
        foreshadowings: number;
        brainstormWorkspaces: number;
        brainstormOptions: number;
    };
    supportedAssetCount: number;
    derivedIndexesRebuildable: boolean;
    exclusions: string[];
}

const compareStrings = (left: string, right: string): number => (
    left < right ? -1 : left > right ? 1 : 0
);

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTiptapDocument(content: string, chapterId: string): TiptapDocument {
    let parsed: unknown;
    try {
        parsed = JSON.parse(content);
    } catch {
        throw new WorkExportBuildError(`Chapter ${chapterId} contains invalid Tiptap JSON; export was stopped.`);
    }
    if (!isJsonObject(parsed) || parsed.type !== 'doc') {
        throw new WorkExportBuildError(`Chapter ${chapterId} does not contain a valid Tiptap document; export was stopped.`);
    }
    return parsed as TiptapDocument;
}

function buildContentBody(chapter: LocalChapter): ExchangeContentBody {
    const stored: StoredContent = chapter.body;
    if (stored.format === 'tiptap-json') {
        if (stored.version !== STORYARK_EXPORT_CONTENT_VERSION || typeof stored.content !== 'string') {
            throw new WorkExportBuildError(`Chapter ${chapter.id} has an unsupported Tiptap version; export was stopped.`);
        }
        if ((stored.originalContent === null) !== (stored.originalFormat === null)) {
            throw new WorkExportBuildError(`Chapter ${chapter.id} has an incomplete legacy source; export was stopped.`);
        }
        return {
            format: 'tiptap-json',
            version: STORYARK_EXPORT_CONTENT_VERSION,
            content: readTiptapDocument(stored.content, chapter.id),
            contentState: stored.contentState ?? 'editable',
            ...(stored.originalContent === null || stored.originalFormat === null ? {} : {
                originalContent: stored.originalContent,
                originalFormat: stored.originalFormat,
            }),
        };
    }

    if (!['legacy-json', 'legacy-html', 'unrecognized'].includes(stored.format)
        || stored.version !== 0
        || typeof stored.content !== 'string'
        || typeof stored.originalContent !== 'string'
        || !stored.originalFormat) {
        throw new WorkExportBuildError(`Chapter ${chapter.id} has legacy content without its original source; export was stopped.`);
    }
    return {
        format: stored.format,
        version: 0,
        content: stored.content,
        contentState: stored.contentState === 'editable' ? 'pending-migration' : (stored.contentState ?? 'pending-migration'),
        originalContent: stored.originalContent,
        originalFormat: stored.originalFormat,
    };
}

function buildChapter(chapter: LocalChapter, notes: ExchangeForeshadowing[]): ExchangeChapter {
    const chapterNotes = notes.filter(note => note.chapterId === chapter.id);
    return {
        id: chapter.id,
        bookId: chapter.bookId,
        volumeId: chapter.volumeId,
        title: chapter.title,
        status: chapter.status,
        position: chapter.position,
        isReadOnly: chapter.isReadOnly,
        databaseVersion: chapter.databaseVersion,
        createdAt: chapter.createdAt,
        updatedAt: chapter.updatedAt,
        wordCount: chapter.wordCount,
        body: buildContentBody(chapter),
        foreshadowingIds: chapterNotes.map(note => note.id).sort(compareStrings),
    };
}

function buildForeshadowings(snapshot: LocalWorkExportSnapshot): ExchangeForeshadowing[] {
    const chapterOrder = new Map(snapshot.chapters.map((chapter, index) => [chapter.id, index]));
    return snapshot.chapters.flatMap(chapter => chapter.foreshadowings.map(note => ({
        ...note,
        id: note.id,
        chapterId: chapter.id,
        databaseVersion: chapter.databaseVersion,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        excerpt: note.excerpt,
        note: note.note,
    }))).sort((left, right) => (
        (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER)
        || compareStrings(left.id, right.id)
    ));
}

function buildPlanning(snapshot: LocalWorkExportSnapshot): ExchangePlanning {
    const chapterOrder = new Map(snapshot.chapters.map((chapter, index) => [chapter.id, index]));
    const planning = snapshot.planning;
    return {
        bookId: planning.bookId,
        databaseVersion: planning.databaseVersion,
        storySummary: planning.storySummary,
        storyBackground: planning.storyBackground,
        ...(planning.updatedAt === undefined ? {} : { updatedAt: planning.updatedAt }),
        chapterSummaries: planning.chapterSummaries.map(summary => ({ ...summary })).sort((left, right) => (
            (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) - (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER)
            || compareStrings(left.chapterId, right.chapterId)
        )),
        plotSettings: planning.plotSettings.map(plot => ({
            ...plot,
            // Chapter order inside a plot is author-facing information; only
            // the plot records themselves need deterministic ordering.
            chapterIds: [...plot.chapterIds],
            ...(plot.missingChapterIds === undefined ? {} : { missingChapterIds: [...plot.missingChapterIds] }),
        })).sort((left, right) => left.createdAt - right.createdAt || compareStrings(left.id, right.id)),
    };
}

function buildGenerationMetadata(snapshot: LocalWorkExportSnapshot): ExchangeBrainstormGenerationMetadata | undefined {
    const workspace = snapshot.brainstormWorkspace;
    if (!workspace) return undefined;
    const context = workspace.contextSnapshot as Record<string, unknown>;
    const raw = workspace.generationMetadata ?? context.generationMetadata;
    if (raw === undefined || raw === null) return undefined;
    const metadata = parseBrainstormGenerationMetadata(raw);
    if (!metadata) {
        throw new WorkExportBuildError('Saved brainstorm generation metadata is invalid; export was stopped.');
    }
    return metadata as unknown as ExchangeBrainstormGenerationMetadata;
}

function buildBrainstorm(snapshot: LocalWorkExportSnapshot): StoryArkWorkExport['brainstormWorkspaces'] {
    const workspace = snapshot.brainstormWorkspace;
    if (!workspace) return [];
    const generationMetadata = buildGenerationMetadata(snapshot);
    return [{
        bookId: workspace.bookId,
        databaseVersion: workspace.databaseVersion,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
        selectedChapterIds: [...workspace.selectedChapterIds],
        contextSnapshot: workspace.contextSnapshot as StoryArkWorkExport['brainstormWorkspaces'][number]['contextSnapshot'],
        generatedOptions: workspace.generatedOptions.map(option => ({ ...option })),
        selectedOptionId: workspace.selectedOptionId ?? null,
        finalContent: workspace.finalContent,
        ...(generationMetadata === undefined ? {} : { generationMetadata }),
    }];
}

function defaultProducer(): ExchangeProducer {
    const configuredVersion = import.meta.env.VITE_APP_VERSION;
    const userAgentData = typeof navigator !== 'undefined'
        ? (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
        : undefined;
    const platformValue = (userAgentData || (typeof navigator !== 'undefined' ? navigator.platform : '')).toLowerCase();
    const platform = platformValue.includes('win')
        ? 'windows'
        : platformValue.includes('mac')
            ? 'macos'
            : platformValue.includes('linux')
                ? 'linux'
                : 'unknown';
    return {
        appVersion: typeof configuredVersion === 'string' && configuredVersion.trim() ? configuredVersion : '0.1.0',
        platform,
    };
}

export function buildStoryArkWorkExport(
    snapshot: LocalWorkExportSnapshot,
    options: WorkExportBuildOptions = {},
): StoryArkWorkExport {
    const foreshadowings = buildForeshadowings(snapshot);
    const chapters = snapshot.chapters.map(chapter => buildChapter(chapter, foreshadowings));
    const graph = snapshot.graph ? [{
        bookId: snapshot.graph.bookId,
        databaseVersion: snapshot.graph.databaseVersion,
        createdAt: snapshot.graph.createdAt,
        updatedAt: snapshot.graph.updatedAt,
        nodes: snapshot.graph.nodes.map(node => ({ ...node })),
        edges: snapshot.graph.edges.map(edge => ({ ...edge })),
    }] : [];
    const book = snapshot.book;
    const value: StoryArkWorkExport = {
        schemaVersion: STORYARK_EXPORT_SCHEMA_VERSION,
        exportId: options.exportId ?? crypto.randomUUID(),
        exportedAt: options.exportedAt ?? new Date().toISOString(),
        producer: options.producer ?? defaultProducer(),
        snapshot: { databaseVersion: snapshot.databaseVersion, contentVersion: STORYARK_EXPORT_CONTENT_VERSION },
        book: {
            id: book.id,
            title: book.title,
            author: book.author,
            status: book.status,
            position: book.position,
            isReadOnly: book.isReadOnly,
            databaseVersion: book.databaseVersion,
            createdAt: book.createdAt,
            updatedAt: book.updatedAt,
            ...(book.coverColor === undefined ? {} : { coverColor: book.coverColor }),
        },
        volumes: snapshot.volumes.map(volume => ({
            id: volume.id,
            bookId: volume.bookId,
            title: volume.title,
            status: volume.status,
            position: volume.position,
            isReadOnly: volume.isReadOnly,
            databaseVersion: volume.databaseVersion,
            createdAt: volume.createdAt,
            updatedAt: volume.updatedAt,
        })),
        chapters,
        characters: snapshot.characters.map(character => ({ ...character })),
        graphs: graph,
        foreshadowings,
        planning: buildPlanning(snapshot),
        brainstormWorkspaces: buildBrainstorm(snapshot),
        assets: [],
        extensions: {
            exportPolicy: {
                derivedIndexes: { included: false, rebuildable: true },
                unsupportedAssets: { included: false, requirePreflight: true },
            },
        },
    };
    return value;
}

export function summarizeStoryArkWorkExport(value: StoryArkWorkExport): WorkExportSummary {
    const graph = value.graphs[0];
    return {
        schemaVersion: value.schemaVersion,
        bookTitle: value.book.title,
        counts: {
            volumes: value.volumes.length,
            chapters: value.chapters.length,
            characters: value.characters.length,
            graphs: value.graphs.length,
            graphNodes: graph?.nodes.length ?? 0,
            graphEdges: graph?.edges.length ?? 0,
            foreshadowings: value.foreshadowings.length,
            brainstormWorkspaces: value.brainstormWorkspaces.length,
            brainstormOptions: value.brainstormWorkspaces.reduce((total, workspace) => total + workspace.generatedOptions.length, 0),
        },
        supportedAssetCount: value.assets.length,
        derivedIndexesRebuildable: true,
        exclusions: [
            'Application preferences and editor UI settings',
            'AI model configurations, credentials and API keys',
            'Temporary candidates, running tasks and request state',
            'Absolute machine paths and derived retrieval indexes',
            'Unsupported attachments and local-path assets (preflight required)',
        ],
    };
}
