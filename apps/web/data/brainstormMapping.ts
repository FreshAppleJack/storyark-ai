import type { BrainstormGenerationMetadata, BrainstormWorkspace } from '../types';
import type { BrainstormDto } from './dto';
import { asRecord, parseJsonSafe } from '../utils/serialization';

export const createEmptyBrainstorm = (): BrainstormWorkspace => ({
    selectedChapterIds: [], contextSnapshot: {}, generatedOptions: [], selectedOptionId: null, finalContent: '',
});
const text = (value: unknown) => typeof value === 'string' ? value : '';

export function parseBrainstormGenerationMetadata(value: unknown): BrainstormGenerationMetadata | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const metadata = value as Record<string, unknown>;
    const source = metadata.source;
    if (typeof metadata.configId !== 'string' || typeof metadata.modelId !== 'string'
        || typeof metadata.generatedAt !== 'number' || typeof metadata.promptVersion !== 'string'
        || !source || typeof source !== 'object' || Array.isArray(source)) return undefined;
    const sourceValue = source as Record<string, unknown>;
    const chapters = sourceValue.selectedChapters;
    if (typeof sourceValue.bookId !== 'string'
        || !Number.isSafeInteger(sourceValue.workspaceDatabaseVersion)
        || !Number.isSafeInteger(sourceValue.planningDatabaseVersion)
        || !Number.isSafeInteger(sourceValue.graphDatabaseVersion)
        || !Array.isArray(chapters)
        || chapters.some(chapter => !chapter || typeof chapter !== 'object'
            || typeof (chapter as Record<string, unknown>).chapterId !== 'string'
            || !Number.isSafeInteger((chapter as Record<string, unknown>).databaseVersion))) return undefined;
    if (Object.prototype.hasOwnProperty.call(metadata, 'includesPlanning') && typeof metadata.includesPlanning !== 'boolean') return undefined;
    if (Object.prototype.hasOwnProperty.call(metadata, 'retrieval')) {
        if (metadata.retrieval !== null) {
            const retrieval = metadata.retrieval;
            if (!retrieval || typeof retrieval !== 'object' || Array.isArray(retrieval)) return undefined;
            const retrievalValue = retrieval as Record<string, unknown>;
            const versions = retrievalValue.sourceVersions;
            const indexVersion = retrievalValue.indexVersion;
            if (typeof retrievalValue.retrievalVersion !== 'string' || !retrievalValue.retrievalVersion
                || !Number.isSafeInteger(retrievalValue.requestedAt)
                || !Array.isArray(versions)
                || versions.some(version => !version || typeof version !== 'object' || Array.isArray(version)
                    || typeof (version as Record<string, unknown>).sourceId !== 'string'
                    || !((version as Record<string, unknown>).chapterId === null || typeof (version as Record<string, unknown>).chapterId === 'string')
                    || !Number.isSafeInteger((version as Record<string, unknown>).sourceVersion)
                    || !Number.isSafeInteger((version as Record<string, unknown>).indexVersion))
                || !Array.isArray(retrievalValue.includedHitIds)
                || retrievalValue.includedHitIds.some(hitId => typeof hitId !== 'string')
                || !(indexVersion === null || (Number.isSafeInteger(indexVersion) && Number(indexVersion) > 0))
                || !(retrievalValue.embeddingFingerprint === null || typeof retrievalValue.embeddingFingerprint === 'string')) return undefined;
        }
    }
    return metadata as unknown as BrainstormGenerationMetadata;
}

export function mapBrainstormResponse(data: BrainstormDto): BrainstormWorkspace {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid brainstorm response');
    const chapterIds = parseJsonSafe(data.selectedChapterIds, []);
    const options = parseJsonSafe(data.generatedOptions, []);
    const updatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : undefined;
    const contextSnapshot = asRecord(parseJsonSafe(data.contextSnapshot, {}));
    const generationMetadata = parseBrainstormGenerationMetadata(contextSnapshot.generationMetadata);
    return {
        selectedChapterIds: Array.isArray(chapterIds) ? chapterIds.filter(id => typeof id === 'string' || typeof id === 'number').map(String) : [],
        contextSnapshot,
        generatedOptions: Array.isArray(options) ? options.map(asRecord).filter(option => option.id).map(option => ({
            id: String(option.id), title: text(option.title), conflict: text(option.conflict), motivation: text(option.motivation),
            consequences: text(option.consequences), development: text(option.development),
        })) : [],
        generationMetadata,
        selectedOptionId: data.selectedOptionId || null, finalContent: data.finalContent || '',
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : undefined,
    };
}

export const toBrainstormPayload = (workspace: BrainstormWorkspace) => {
    const contextSnapshot = { ...workspace.contextSnapshot };
    const metadata = workspace.generationMetadata ?? parseBrainstormGenerationMetadata(contextSnapshot.generationMetadata);
    if (metadata) contextSnapshot.generationMetadata = metadata;
    else delete contextSnapshot.generationMetadata;
    return {
        selectedChapterIds: JSON.stringify(workspace.selectedChapterIds), contextSnapshot: JSON.stringify(contextSnapshot),
        generatedOptions: JSON.stringify(workspace.generatedOptions), selectedOptionId: workspace.selectedOptionId || null, finalContent: workspace.finalContent,
    };
};
