export type ChapterSummaryProvenance = 'author' | 'ai-adopted';
export type ChapterSummaryContentFormat = 'tiptap-json' | 'legacy-json' | 'legacy-html' | 'unrecognized';
export type ChapterSummaryAllowedSourceKind = 'planning' | 'confirmed_setting' | 'character' | 'relationship' | 'foreshadowing_note';

export interface ChapterSummarySourceSnapshot {
    chapterId: string;
    chapterDatabaseVersion: number | null;
    chapterTitle: string;
    contentFormat: ChapterSummaryContentFormat;
    contentVersion: number | null;
    fingerprintAlgorithm: 'fnv1a64-utf16-v1';
    bodyFingerprint: string;
    structuredFingerprint: string;
    blockFingerprints: string[];
    mentionedCharacterIds: string[];
    foreshadowingIds: string[];
    foreshadowingNoteFingerprints: Array<{ noteId: string; fingerprint: string }>;
    capturedAt: number;
}

export interface ChapterSummaryAllowedSource {
    sourceId: string;
    entityId: string;
    sourceKind: ChapterSummaryAllowedSourceKind;
    sourceVersion: number;
    indexVersion: number | null;
}

export interface ChapterSummaryRetrievalTrace {
    searchId: string;
    retrievalVersion: string;
    requestedAt: number;
    sourceVersions: Array<{
        sourceId: string;
        chapterId: string | null;
        sourceVersion: number;
        indexVersion: number;
    }>;
    includedHitIds: string[];
    indexVersion: number | null;
    embeddingFingerprint: string | null;
}

export interface ChapterSummaryGenerationMetadata {
    providerId: string;
    configId: string;
    protocol: string;
    modelId: string;
    generatedAt: number;
    promptVersion: string;
    source: {
        bookId: string;
        chapterId: string;
        chapterDatabaseVersion: number;
        sourceBodyFingerprint: string;
        planningDatabaseVersion: number | null;
        allowedSources: ChapterSummaryAllowedSource[];
        retrievalTrace: ChapterSummaryRetrievalTrace | null;
        includesFuturePlan: false;
    };
}

/** Ephemeral state only. Suggestions are not part of persisted StoryPlanning until explicitly adopted. */
export interface ChapterSummarySuggestion {
    status: 'starting' | 'streaming' | 'candidate' | 'invalid' | 'failed' | 'stale';
    chapterId: string;
    rawText: string;
    suggestedSummary: string | null;
    errorMessage: string | null;
    sourceSnapshot: ChapterSummarySourceSnapshot | null;
    generationMetadata: ChapterSummaryGenerationMetadata | null;
}

export interface ChapterSummaryFreshness {
    status: 'missing' | 'current' | 'possibly-stale' | 'needs-review';
    sourceVersionChanged: boolean;
    changedBlocks: number;
    addedBlocks: number;
    removedBlocks: number;
    addedCharacterIds: string[];
    removedCharacterIds: string[];
    addedForeshadowingIds: string[];
    removedForeshadowingIds: string[];
    changedForeshadowingNoteIds: string[];
    changedAllowedSourceIds: string[];
    reasons: string[];
}

export interface ChapterSummarySourceInput {
    id: string;
    title: string;
    databaseVersion?: number;
    contentFormat?: ChapterSummaryContentFormat;
    contentVersion?: number;
    content: string;
    foreshadowings?: Array<{
        id: string;
        excerpt?: string;
        note?: string;
        isRecovered?: boolean;
    }>;
}

export interface ChapterSummaryCurrentSourceSet {
    bookId: string;
    planningDatabaseVersion?: number;
    characters: Array<{ id: string; databaseVersion?: number }>;
    chapters: ChapterSummarySourceInput[];
}

export interface ChapterSummaryForFreshness {
    chapterId: string;
    summary: string;
    sourceChapterVersion?: number;
    provenance?: ChapterSummaryProvenance;
    sourceSnapshot?: ChapterSummarySourceSnapshot;
    generationMetadata?: ChapterSummaryGenerationMetadata;
}

interface CachedSnapshotEntry {
    title: string;
    databaseVersion?: number;
    contentFormat?: ChapterSummaryContentFormat;
    contentVersion?: number;
    content: string;
    foreshadowings?: ChapterSummarySourceInput['foreshadowings'];
    snapshot: ChapterSummarySourceSnapshot;
}

const freshnessSnapshotCache = new WeakMap<object, CachedSnapshotEntry>();

export function createCurrentAllowedSourceVersions(sources: ChapterSummaryCurrentSourceSet): Map<string, number> {
    const versions = new Map<string, number>();
    for (const character of sources.characters) {
        if (character.databaseVersion !== undefined) {
            versions.set(`${sources.bookId}:character:${character.id}`, character.databaseVersion);
        }
    }
    if (sources.planningDatabaseVersion !== undefined) {
        versions.set(`${sources.bookId}:planning:story-summary`, sources.planningDatabaseVersion);
        versions.set(`${sources.bookId}:planning:story-background`, sources.planningDatabaseVersion);
    }
    for (const chapter of sources.chapters) {
        if (chapter.databaseVersion === undefined) continue;
        for (const note of chapter.foreshadowings ?? []) {
            versions.set(`${sources.bookId}:foreshadowing_note:${chapter.id}:${note.id}`, chapter.databaseVersion);
        }
    }
    return versions;
}

const STYLE_ONLY_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'textStyle', 'textAlign']);
const PRESENTATION_ATTRIBUTES = new Set(['textAlign', 'fontFamily', 'fontSize', 'color', 'backgroundColor', 'fontWeight', 'fontStyle']);
const SOURCE_KINDS = new Set<ChapterSummaryAllowedSourceKind>([
    'planning', 'confirmed_setting', 'character', 'relationship', 'foreshadowing_note',
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fingerprint(value: string): string {
    // FNV-1a is a compact change detector, not a cryptographic integrity check.
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index++) {
        hash ^= BigInt(value.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return hash.toString(16).padStart(16, '0');
}

function normalizeNode(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizeNode).filter(item => item !== null);
    if (!isRecord(value)) return value;
    const normalized: JsonRecord = {};
    Object.keys(value).sort().forEach(key => {
        if (key === 'marks' && Array.isArray(value[key])) {
            const marks = (value[key] as unknown[])
                .filter(mark => !(isRecord(mark) && typeof mark.type === 'string' && STYLE_ONLY_MARKS.has(mark.type)))
                .map(normalizeNode)
                .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
            if (marks.length) normalized[key] = marks;
            return;
        }
        if (key === 'attrs' && isRecord(value[key])) {
            const attributes = value[key] as JsonRecord;
            const kept = Object.fromEntries(Object.keys(attributes).sort()
                .filter(attribute => !PRESENTATION_ATTRIBUTES.has(attribute))
                .map(attribute => [attribute, normalizeNode(attributes[attribute])]));
            if (Object.keys(kept).length) normalized[key] = kept;
            return;
        }
        normalized[key] = normalizeNode(value[key]);
    });
    return normalized;
}

function collectEntities(value: unknown, mentions: Set<string>, notes: Set<string>): void {
    if (Array.isArray(value)) {
        value.forEach(child => collectEntities(child, mentions, notes));
        return;
    }
    if (!isRecord(value)) return;
    if (value.type === 'mention' && isRecord(value.attrs) && typeof value.attrs.id === 'string') {
        mentions.add(value.attrs.id);
    }
    if (Array.isArray(value.marks)) {
        value.marks.forEach(mark => {
            if (isRecord(mark) && mark.type === 'foreshadowing' && isRecord(mark.attrs) && typeof mark.attrs.id === 'string') {
                notes.add(mark.attrs.id);
            }
        });
    }
    Object.values(value).forEach(child => collectEntities(child, mentions, notes));
}

function bodyText(value: unknown): string {
    if (Array.isArray(value)) return value.map(bodyText).join('');
    if (!isRecord(value)) return '';
    if (value.type === 'text') return typeof value.text === 'string' ? value.text : '';
    if (value.type === 'mention' && isRecord(value.attrs)) {
        return typeof value.attrs.label === 'string' ? value.attrs.label : typeof value.attrs.id === 'string' ? value.attrs.id : '';
    }
    if (value.type === 'hardBreak') return '\n';
    const children = Array.isArray(value.content) ? value.content.map(bodyText).join('') : '';
    return ['paragraph', 'heading', 'blockquote', 'codeBlock'].includes(String(value.type)) ? `${children}\n` : children;
}

function sorted(values: Iterable<string>): string[] {
    return [...new Set(values)].sort();
}

function contentFormat(content: string, parsed: unknown, declared?: ChapterSummaryContentFormat): ChapterSummaryContentFormat {
    if (declared === 'tiptap-json') return isRecord(parsed) && parsed.type === 'doc' ? declared : 'unrecognized';
    if (declared) return declared;
    if (isRecord(parsed) && parsed.type === 'doc') return 'tiptap-json';
    if (/^\s*</.test(content)) return 'legacy-html';
    if (parsed !== null) return 'legacy-json';
    return 'unrecognized';
}

export function createChapterSummarySourceSnapshot(
    chapter: ChapterSummarySourceInput,
    capturedAt = Date.now(),
): ChapterSummarySourceSnapshot {
    let parsed: unknown = null;
    try { parsed = JSON.parse(chapter.content); } catch { /* Legacy HTML or unrecognized source. */ }
    const format = contentFormat(chapter.content, parsed, chapter.contentFormat);
    const root = format === 'tiptap-json' && isRecord(parsed) ? parsed : null;
    const blocks = root && Array.isArray(root.content)
        ? root.content
        : bodyText(parsed || chapter.content).split(/\n+/).filter(Boolean).map(text => ({ type: 'legacyText', text }));
    const blockFingerprints = blocks.map(block => fingerprint(JSON.stringify(normalizeNode(block))));
    const mentions = new Set<string>();
    const markedNotes = new Set<string>();
    collectEntities(parsed, mentions, markedNotes);
    const noteFingerprints = (chapter.foreshadowings ?? [])
        .filter(note => typeof note.id === 'string' && note.id.length > 0)
        .map(note => ({
            noteId: note.id,
            fingerprint: fingerprint(JSON.stringify({
                excerpt: note.excerpt ?? '',
                note: note.note ?? '',
                isRecovered: note.isRecovered ?? false,
            })),
        }))
        .sort((left, right) => left.noteId.localeCompare(right.noteId));
    const foreshadowingIds = sorted([...markedNotes, ...noteFingerprints.map(note => note.noteId)]);
    const contentVersion = Number.isSafeInteger(chapter.contentVersion) && (chapter.contentVersion ?? -1) >= 0
        ? chapter.contentVersion as number
        : format === 'tiptap-json' ? 1 : null;
    const chapterDatabaseVersion = Number.isSafeInteger(chapter.databaseVersion) && (chapter.databaseVersion ?? 0) > 0
        ? chapter.databaseVersion as number
        : null;
    return {
        chapterId: chapter.id,
        chapterDatabaseVersion,
        chapterTitle: chapter.title,
        contentFormat: format,
        contentVersion,
        fingerprintAlgorithm: 'fnv1a64-utf16-v1',
        bodyFingerprint: fingerprint(chapter.content),
        structuredFingerprint: fingerprint(JSON.stringify({
            chapterTitle: chapter.title,
            contentFormat: format,
            documentAttributes: root?.attrs ? normalizeNode(root.attrs) : null,
            blockFingerprints,
            mentionedCharacterIds: sorted(mentions),
            foreshadowingIds,
            foreshadowingNoteFingerprints: noteFingerprints,
        })),
        blockFingerprints,
        mentionedCharacterIds: sorted(mentions),
        foreshadowingIds,
        foreshadowingNoteFingerprints: noteFingerprints,
        capturedAt,
    };
}

function difference(previous: string[], current: string[]): { added: string[]; removed: string[] } {
    const previousSet = new Set(previous);
    const currentSet = new Set(current);
    return {
        added: current.filter(value => !previousSet.has(value)),
        removed: previous.filter(value => !currentSet.has(value)),
    };
}

function sourceVersionChanges(
    metadata: ChapterSummaryGenerationMetadata | undefined,
    currentVersions: ReadonlyMap<string, number> | undefined,
): string[] {
    if (!metadata || !currentVersions) return [];
    return metadata.source.allowedSources
        .filter(source => currentVersions.get(source.sourceId) !== source.sourceVersion)
        .map(source => source.sourceId);
}

export function assessChapterSummaryFreshness(
    summary: ChapterSummaryForFreshness | undefined,
    chapter: ChapterSummarySourceInput,
    currentAllowedSourceVersions?: ReadonlyMap<string, number>,
): ChapterSummaryFreshness {
    if (!summary?.summary.trim()) {
        return {
            status: 'missing', sourceVersionChanged: false, changedBlocks: 0, addedBlocks: 0, removedBlocks: 0,
            addedCharacterIds: [], removedCharacterIds: [], addedForeshadowingIds: [], removedForeshadowingIds: [],
            changedForeshadowingNoteIds: [], changedAllowedSourceIds: [], reasons: [],
        };
    }
    if (summary.provenance === 'ai-adopted' && !summary.generationMetadata) {
        return {
            status: 'needs-review', sourceVersionChanged: summary.sourceChapterVersion !== chapter.databaseVersion,
            changedBlocks: 0, addedBlocks: 0, removedBlocks: 0,
            addedCharacterIds: [], removedCharacterIds: [], addedForeshadowingIds: [], removedForeshadowingIds: [],
            changedForeshadowingNoteIds: [], changedAllowedSourceIds: [], reasons: ['generation-metadata-unavailable'],
        };
    }
    const baseline = summary.sourceSnapshot;
    if (!baseline || baseline.chapterId !== chapter.id) {
        return {
            status: 'needs-review', sourceVersionChanged: summary.sourceChapterVersion !== chapter.databaseVersion,
            changedBlocks: 0, addedBlocks: 0, removedBlocks: 0,
            addedCharacterIds: [], removedCharacterIds: [], addedForeshadowingIds: [], removedForeshadowingIds: [],
            changedForeshadowingNoteIds: [], changedAllowedSourceIds: [],
            reasons: [baseline ? 'snapshot-chapter-mismatch' : 'source-snapshot-unavailable'],
        };
    }
    let cached = freshnessSnapshotCache.get(chapter);
    if (!cached || cached.title !== chapter.title || cached.databaseVersion !== chapter.databaseVersion
        || cached.contentFormat !== chapter.contentFormat || cached.contentVersion !== chapter.contentVersion
        || cached.content !== chapter.content || cached.foreshadowings !== chapter.foreshadowings) {
        cached = {
            title: chapter.title,
            databaseVersion: chapter.databaseVersion,
            contentFormat: chapter.contentFormat,
            contentVersion: chapter.contentVersion,
            content: chapter.content,
            foreshadowings: chapter.foreshadowings,
            snapshot: createChapterSummarySourceSnapshot(chapter, baseline.capturedAt),
        };
        freshnessSnapshotCache.set(chapter, cached);
    }
    const current = cached.snapshot;
    let commonPrefix = 0;
    while (commonPrefix < baseline.blockFingerprints.length
        && commonPrefix < current.blockFingerprints.length
        && baseline.blockFingerprints[commonPrefix] === current.blockFingerprints[commonPrefix]) commonPrefix++;
    let commonSuffix = 0;
    while (commonSuffix < baseline.blockFingerprints.length - commonPrefix
        && commonSuffix < current.blockFingerprints.length - commonPrefix
        && baseline.blockFingerprints[baseline.blockFingerprints.length - 1 - commonSuffix]
            === current.blockFingerprints[current.blockFingerprints.length - 1 - commonSuffix]) commonSuffix++;
    const oldChangedRange = baseline.blockFingerprints.length - commonPrefix - commonSuffix;
    const newChangedRange = current.blockFingerprints.length - commonPrefix - commonSuffix;
    const changedBlocks = Math.min(oldChangedRange, newChangedRange);
    const addedBlocks = Math.max(0, newChangedRange - oldChangedRange);
    const removedBlocks = Math.max(0, oldChangedRange - newChangedRange);
    const mentionDiff = difference(baseline.mentionedCharacterIds, current.mentionedCharacterIds);
    const foreshadowingDiff = difference(baseline.foreshadowingIds, current.foreshadowingIds);
    const oldNotes = new Map(baseline.foreshadowingNoteFingerprints.map(item => [item.noteId, item.fingerprint]));
    const newNotes = new Map(current.foreshadowingNoteFingerprints.map(item => [item.noteId, item.fingerprint]));
    const changedForeshadowingNoteIds = [...new Set([...oldNotes.keys(), ...newNotes.keys()])]
        .filter(noteId => oldNotes.get(noteId) !== newNotes.get(noteId))
        .sort();
    const changedAllowedSourceIds = sourceVersionChanges(summary.generationMetadata, currentAllowedSourceVersions);
    const sourceVersionChanged = baseline.chapterDatabaseVersion !== current.chapterDatabaseVersion;
    const reasons: string[] = [];
    if (changedBlocks) reasons.push('paragraph-content-or-structure-changed');
    if (addedBlocks) reasons.push('paragraphs-added');
    if (removedBlocks) reasons.push('paragraphs-removed');
    if (mentionDiff.added.length || mentionDiff.removed.length) reasons.push('character-mentions-changed');
    if (foreshadowingDiff.added.length || foreshadowingDiff.removed.length) reasons.push('foreshadowing-links-changed');
    if (changedForeshadowingNoteIds.length) reasons.push('foreshadowing-note-content-changed');
    if (baseline.chapterTitle !== current.chapterTitle) reasons.push('chapter-title-changed');
    if (baseline.contentFormat !== current.contentFormat) reasons.push('content-format-changed');
    if (baseline.contentVersion !== current.contentVersion) reasons.push('content-format-version-changed');
    if (baseline.structuredFingerprint !== current.structuredFingerprint && reasons.length === 0) {
        reasons.push('structured-source-metadata-changed');
    }
    if (changedAllowedSourceIds.length) reasons.push('allowed-setting-or-character-source-changed');
    if (summary.generationMetadata && !currentAllowedSourceVersions) reasons.push('allowed-source-baseline-unavailable');
    const changed = reasons.length > 0;
    return {
        status: changed ? 'possibly-stale' : 'current',
        sourceVersionChanged,
        changedBlocks,
        addedBlocks,
        removedBlocks,
        addedCharacterIds: mentionDiff.added,
        removedCharacterIds: mentionDiff.removed,
        addedForeshadowingIds: foreshadowingDiff.added,
        removedForeshadowingIds: foreshadowingDiff.removed,
        changedForeshadowingNoteIds,
        changedAllowedSourceIds,
        reasons,
    };
}

export function parseChapterSummarySourceSnapshot(value: unknown, chapterId: string): ChapterSummarySourceSnapshot | undefined {
    if (!isRecord(value) || value.chapterId !== chapterId
        || !['tiptap-json', 'legacy-json', 'legacy-html', 'unrecognized'].includes(String(value.contentFormat))
        || value.fingerprintAlgorithm !== 'fnv1a64-utf16-v1'
        || typeof value.chapterTitle !== 'string'
        || typeof value.bodyFingerprint !== 'string'
        || typeof value.structuredFingerprint !== 'string'
        || !/^[0-9a-f]{16}$/.test(value.bodyFingerprint)
        || !/^[0-9a-f]{16}$/.test(value.structuredFingerprint)
        || !Array.isArray(value.blockFingerprints) || value.blockFingerprints.length > 50_000
        || value.blockFingerprints.some(hash => typeof hash !== 'string' || !/^[0-9a-f]{16}$/.test(hash))
        || !Array.isArray(value.mentionedCharacterIds) || value.mentionedCharacterIds.some(id => typeof id !== 'string')
        || !Array.isArray(value.foreshadowingIds) || value.foreshadowingIds.length > 100_000
        || value.foreshadowingIds.some(id => typeof id !== 'string')
        || !Array.isArray(value.foreshadowingNoteFingerprints)
        || value.foreshadowingNoteFingerprints.length > 100_000
        || value.foreshadowingNoteFingerprints.some(note => !isRecord(note) || typeof note.noteId !== 'string' || typeof note.fingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(note.fingerprint))
        || new Set(value.foreshadowingNoteFingerprints.filter(isRecord).map(note => note.noteId)).size !== value.foreshadowingNoteFingerprints.length
        || !(value.chapterDatabaseVersion === null || (Number.isSafeInteger(value.chapterDatabaseVersion) && Number(value.chapterDatabaseVersion) > 0))
        || !(value.contentVersion === null || (Number.isSafeInteger(value.contentVersion) && Number(value.contentVersion) >= 0))
        || !Number.isSafeInteger(value.capturedAt) || Number(value.capturedAt) < 0) return undefined;
    return value as unknown as ChapterSummarySourceSnapshot;
}

export function parseChapterSummaryGenerationMetadata(value: unknown, chapterId: string): ChapterSummaryGenerationMetadata | undefined {
    if (!isRecord(value) || !nonEmptyText(value.providerId, 128) || !nonEmptyText(value.configId, 128)
        || !nonEmptyText(value.protocol, 128) || !nonEmptyText(value.modelId, 512) || !nonEmptyText(value.promptVersion, 128)
        || !nonNegativeInteger(value.generatedAt) || !isRecord(value.source)) return undefined;
    const source = value.source;
    if (source.chapterId !== chapterId || !nonEmptyText(source.bookId, 128)
        || !positiveInteger(source.chapterDatabaseVersion)
        || typeof source.sourceBodyFingerprint !== 'string' || !/^[0-9a-f]{16}$/.test(source.sourceBodyFingerprint)
        || !(source.planningDatabaseVersion === null || nonNegativeInteger(source.planningDatabaseVersion))
        || source.includesFuturePlan !== false || !Array.isArray(source.allowedSources) || source.allowedSources.length > 512) return undefined;
    const allowedSources = source.allowedSources as unknown[];
    if (allowedSources.some(item => !isRecord(item) || !nonEmptyText(item.sourceId, 512)
        || !nonEmptyText(item.entityId, 4096) || !SOURCE_KINDS.has(item.sourceKind as ChapterSummaryAllowedSourceKind)
        || !positiveInteger(item.sourceVersion) || !(item.indexVersion === null || positiveInteger(item.indexVersion)))) return undefined;
    if (new Set(allowedSources.map(item => (item as JsonRecord).sourceId)).size !== allowedSources.length) return undefined;
    const trace = source.retrievalTrace;
    if (trace !== null && (!isRecord(trace) || !nonEmptyText(trace.searchId, 128) || !nonEmptyText(trace.retrievalVersion, 128)
        || !nonNegativeInteger(trace.requestedAt) || !Array.isArray(trace.sourceVersions) || trace.sourceVersions.length > 512
        || !Array.isArray(trace.includedHitIds) || trace.includedHitIds.length > 200
        || trace.includedHitIds.some(id => !nonEmptyText(id, 8192))
        || !(trace.indexVersion === null || positiveInteger(trace.indexVersion))
        || !(trace.embeddingFingerprint === null || nonEmptyText(trace.embeddingFingerprint, 1024))
        || trace.sourceVersions.some(item => !isRecord(item) || !nonEmptyText(item.sourceId, 512)
            || item.sourceId.split(':')[1] === 'future_plan'
            || !(item.chapterId === null || nonEmptyText(item.chapterId, 128))
            || !positiveInteger(item.sourceVersion) || !positiveInteger(item.indexVersion)))) return undefined;
    const traceSourceVersions = isRecord(trace) && Array.isArray(trace.sourceVersions) ? trace.sourceVersions : [];
    if (trace && isRecord(trace) && new Set(traceSourceVersions.filter(isRecord).map(item => item.sourceId)).size !== traceSourceVersions.length) return undefined;
    return value as unknown as ChapterSummaryGenerationMetadata;
}

function nonEmptyText(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function nonNegativeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}
