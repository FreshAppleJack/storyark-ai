import { EXCHANGE_LIMITS } from '../limits';
import type {
    ExchangeBrainstormGenerationMetadata,
    ExchangeBrainstormOption,
    ExchangeBrainstormWorkspace,
    ExchangePlanning,
    ExchangePlotSetting,
    JsonObject,
} from '../types';
import { compareStrings, type AnyRecord, type ValidationContext } from './core';

export function validatePlanning(context: ValidationContext, value: AnyRecord | undefined, path: string): ExchangePlanning | undefined {
    if (!value) return undefined;
    context.unknownFields(value, new Set(['bookId', 'databaseVersion', 'storySummary', 'storyBackground', 'chapterSummaries', 'plotSettings', 'updatedAt', 'extensions']), path);
    const bookId = context.requiredUuid(value, 'bookId', path);
    const databaseVersion = context.requiredInteger(value, 'databaseVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const storySummary = context.requiredString(value, 'storySummary', path, EXCHANGE_LIMITS.maxSummaryChars);
    const storyBackground = context.requiredString(value, 'storyBackground', path, EXCHANGE_LIMITS.maxSummaryChars);
    const summariesValue = context.requiredArray(value, 'chapterSummaries', path);
    const plotsValue = context.requiredArray(value, 'plotSettings', path);
    if (summariesValue && summariesValue.length > EXCHANGE_LIMITS.maxPlanningItems) context.add(`${path}.chapterSummaries`, 'LIMIT_EXCEEDED', `Planning cannot contain more than ${EXCHANGE_LIMITS.maxPlanningItems} chapter summaries.`);
    if (plotsValue && plotsValue.length > EXCHANGE_LIMITS.maxPlanningItems) context.add(`${path}.plotSettings`, 'LIMIT_EXCEEDED', `Planning cannot contain more than ${EXCHANGE_LIMITS.maxPlanningItems} plot settings.`);
    const chapterSummaries = summariesValue?.map((item, index) => validateChapterSummary(context, item, `${path}.chapterSummaries[${index}]`)).filter((item): item is ExchangePlanning['chapterSummaries'][number] => item !== undefined);
    const plotSettings = plotsValue?.map((item, index) => validatePlotSetting(context, item, `${path}.plotSettings[${index}]`)).filter((item): item is ExchangePlotSetting => item !== undefined);
    const updatedAt = context.optionalTimestamp(value, 'updatedAt', path);
    if (chapterSummaries) context.unique(chapterSummaries, `${path}.chapterSummaries`, item => item.chapterId);
    if (plotSettings) context.unique(plotSettings, `${path}.plotSettings`, item => item.id);
    if (!bookId || databaseVersion === undefined || storySummary === undefined || storyBackground === undefined || !chapterSummaries || !plotSettings) return undefined;
    return { bookId, databaseVersion, storySummary, storyBackground, chapterSummaries, plotSettings, ...(updatedAt === undefined ? {} : { updatedAt }) };
}

function validateChapterSummary(context: ValidationContext, value: unknown, path: string): ExchangePlanning['chapterSummaries'][number] | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['chapterId', 'summary', 'sourceChapterVersion', 'updatedAt', 'extensions']), path);
    const chapterId = context.requiredUuid(object, 'chapterId', path);
    const summary = context.requiredString(object, 'summary', path, EXCHANGE_LIMITS.maxSummaryChars);
    const sourceChapterVersion = context.optionalInteger(object, 'sourceChapterVersion', path, 1, Number.MAX_SAFE_INTEGER);
    const updatedAt = context.requiredTimestamp(object, 'updatedAt', path);
    if (!chapterId || summary === undefined || updatedAt === undefined) return undefined;
    return { chapterId, summary, ...(sourceChapterVersion === undefined ? {} : { sourceChapterVersion }), updatedAt };
}

function validatePlotSetting(context: ValidationContext, value: unknown, path: string): ExchangePlotSetting | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'title', 'details', 'chapterIds', 'missingChapterIds', 'createdAt', 'updatedAt', 'extensions']), path);
    const id = context.requiredString(object, 'id', path, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const title = context.requiredString(object, 'title', path, EXCHANGE_LIMITS.maxTitleChars, 1);
    const details = context.requiredString(object, 'details', path, EXCHANGE_LIMITS.maxDetailsChars);
    const chapterIds = context.requiredUuidArray(object, 'chapterIds', path, EXCHANGE_LIMITS.maxPlanningItems);
    const missingChapterIds = object.missingChapterIds === undefined ? undefined : context.requiredUuidArray(object, 'missingChapterIds', path, EXCHANGE_LIMITS.maxPlanningItems);
    const createdAt = context.requiredTimestamp(object, 'createdAt', path);
    const updatedAt = context.requiredTimestamp(object, 'updatedAt', path);
    if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) context.add(path, 'INVALID_VALUE', 'updatedAt cannot be earlier than createdAt.');
    if (id === undefined || title === undefined || details === undefined || !chapterIds || createdAt === undefined || updatedAt === undefined) return undefined;
    return { id, title, details, chapterIds, ...(missingChapterIds === undefined ? {} : { missingChapterIds }), createdAt, updatedAt };
}

function validateBrainstormOption(context: ValidationContext, value: unknown, path: string): ExchangeBrainstormOption | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'title', 'conflict', 'motivation', 'consequences', 'development', 'extensions']), path);
    const id = context.requiredString(object, 'id', path, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const title = context.requiredString(object, 'title', path, EXCHANGE_LIMITS.maxBrainstormTitleChars, 1);
    const conflict = context.requiredString(object, 'conflict', path, EXCHANGE_LIMITS.maxBrainstormDetailChars, 1);
    const motivation = context.requiredString(object, 'motivation', path, EXCHANGE_LIMITS.maxBrainstormDetailChars, 1);
    const consequences = context.requiredString(object, 'consequences', path, EXCHANGE_LIMITS.maxBrainstormDetailChars, 1);
    const development = context.requiredString(object, 'development', path, EXCHANGE_LIMITS.maxBrainstormDetailChars, 1);
    if (id === undefined || title === undefined || conflict === undefined || motivation === undefined || consequences === undefined || development === undefined) return undefined;
    return { id, title, conflict, motivation, consequences, development };
}

function validateGenerationMetadata(context: ValidationContext, value: unknown, path: string): ExchangeBrainstormGenerationMetadata | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['configId', 'modelId', 'generatedAt', 'promptVersion', 'includesPlanning', 'retrieval', 'source', 'extensions']), path);
    const configId = context.requiredUuid(object, 'configId', path);
    const modelId = context.requiredString(object, 'modelId', path, EXCHANGE_LIMITS.maxModelIdChars, 1);
    const generatedAt = context.requiredTimestamp(object, 'generatedAt', path);
    const promptVersion = context.requiredString(object, 'promptVersion', path, EXCHANGE_LIMITS.maxPromptVersionChars, 1);
    const source = validateGenerationSource(context, context.requiredObject(object, 'source', path), `${path}.source`);
    const includesPlanning = Object.prototype.hasOwnProperty.call(object, 'includesPlanning')
        ? context.requiredBoolean(object, 'includesPlanning', path)
        : undefined;
    const retrieval = validateGenerationRetrieval(context, object, path);
    if (!configId || modelId === undefined || generatedAt === undefined || promptVersion === undefined || !source) return undefined;
    return {
        configId,
        modelId,
        generatedAt,
        promptVersion,
        ...(includesPlanning === undefined ? {} : { includesPlanning }),
        ...(retrieval === undefined ? {} : { retrieval }),
        source,
    };
}

function validateGenerationRetrieval(
    context: ValidationContext,
    parent: AnyRecord,
    path: string,
): ExchangeBrainstormGenerationMetadata['retrieval'] | undefined {
    if (!Object.prototype.hasOwnProperty.call(parent, 'retrieval')) return undefined;
    if (parent.retrieval === null) return null;
    const object = context.requiredObjectValue(parent.retrieval, `${path}.retrieval`);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['retrievalVersion', 'requestedAt', 'sourceVersions', 'includedHitIds', 'indexVersion', 'embeddingFingerprint', 'extensions']), `${path}.retrieval`);
    const retrievalPath = `${path}.retrieval`;
    const retrievalVersion = context.requiredString(object, 'retrievalVersion', retrievalPath, EXCHANGE_LIMITS.maxPromptVersionChars, 1);
    const requestedAt = context.requiredTimestamp(object, 'requestedAt', retrievalPath);
    const sourceValues = context.requiredArray(object, 'sourceVersions', retrievalPath);
    if (sourceValues && sourceValues.length > EXCHANGE_LIMITS.maxBrainstormRetrievalSources) {
        context.add(`${retrievalPath}.sourceVersions`, 'LIMIT_EXCEEDED', `Retrieval source versions cannot exceed ${EXCHANGE_LIMITS.maxBrainstormRetrievalSources}.`);
    }
    const sourceVersions = sourceValues?.map((value, index) => validateRetrievalSourceVersion(context, value, `${retrievalPath}.sourceVersions[${index}]`))
        .filter((value): value is NonNullable<ExchangeBrainstormGenerationMetadata['retrieval']>['sourceVersions'][number] => value !== undefined);
    if (sourceVersions) context.unique(sourceVersions, `${retrievalPath}.sourceVersions`, source => source.sourceId);
    const includedHitIds = context.requiredStringArray(object, 'includedHitIds', retrievalPath, EXCHANGE_LIMITS.maxBrainstormRetrievalHits, 512, 1);
    const indexVersion = object.indexVersion === null
        ? null
        : context.requiredInteger(object, 'indexVersion', retrievalPath, 1, Number.MAX_SAFE_INTEGER);
    const embeddingFingerprint = object.embeddingFingerprint === null
        ? null
        : context.requiredString(object, 'embeddingFingerprint', retrievalPath, 512, 1);
    if (retrievalVersion === undefined || requestedAt === undefined || !sourceVersions || !includedHitIds
        || indexVersion === undefined || embeddingFingerprint === undefined) return undefined;
    return { retrievalVersion, requestedAt, sourceVersions, includedHitIds, indexVersion, embeddingFingerprint };
}

function validateRetrievalSourceVersion(
    context: ValidationContext,
    value: unknown,
    path: string,
): NonNullable<ExchangeBrainstormGenerationMetadata['retrieval']>['sourceVersions'][number] | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['sourceId', 'chapterId', 'sourceVersion', 'indexVersion', 'extensions']), path);
    const sourceId = context.requiredString(object, 'sourceId', path, 512, 1);
    const chapterId = object.chapterId === null ? null : context.requiredUuid(object, 'chapterId', path);
    const sourceVersion = context.requiredInteger(object, 'sourceVersion', path, 1, Number.MAX_SAFE_INTEGER);
    const indexVersion = context.requiredInteger(object, 'indexVersion', path, 1, Number.MAX_SAFE_INTEGER);
    if (sourceId === undefined || chapterId === undefined || sourceVersion === undefined || indexVersion === undefined) return undefined;
    return { sourceId, chapterId, sourceVersion, indexVersion };
}

function validateGenerationSource(
    context: ValidationContext,
    value: AnyRecord | undefined,
    path: string,
): ExchangeBrainstormGenerationMetadata['source'] | undefined {
    if (!value) return undefined;
    context.unknownFields(value, new Set(['bookId', 'workspaceDatabaseVersion', 'planningDatabaseVersion', 'graphDatabaseVersion', 'selectedChapters', 'extensions']), path);
    const bookId = context.requiredUuid(value, 'bookId', path);
    const workspaceDatabaseVersion = context.requiredInteger(value, 'workspaceDatabaseVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const planningDatabaseVersion = context.requiredInteger(value, 'planningDatabaseVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const graphDatabaseVersion = context.requiredInteger(value, 'graphDatabaseVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const selectedValue = context.requiredArray(value, 'selectedChapters', path);
    const selectedChapters = selectedValue?.map((item, index) => validateGenerationChapter(context, item, `${path}.selectedChapters[${index}]`)).filter((item): item is ExchangeBrainstormGenerationMetadata['source']['selectedChapters'][number] => item !== undefined);
    if (selectedChapters) context.unique(selectedChapters, `${path}.selectedChapters`, item => item.chapterId);
    if (!bookId || workspaceDatabaseVersion === undefined || planningDatabaseVersion === undefined || graphDatabaseVersion === undefined || !selectedChapters) return undefined;
    return { bookId, workspaceDatabaseVersion, planningDatabaseVersion, graphDatabaseVersion, selectedChapters };
}

function validateGenerationChapter(context: ValidationContext, value: unknown, path: string): ExchangeBrainstormGenerationMetadata['source']['selectedChapters'][number] | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['chapterId', 'databaseVersion', 'extensions']), path);
    const chapterId = context.requiredUuid(object, 'chapterId', path);
    const databaseVersion = context.requiredInteger(object, 'databaseVersion', path, 1, Number.MAX_SAFE_INTEGER);
    if (!chapterId || databaseVersion === undefined) return undefined;
    return { chapterId, databaseVersion };
}

export function validateBrainstormWorkspaces(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeBrainstormWorkspace[] | undefined {
    if (!values) return undefined;
    const result = values.map((value, index) => validateBrainstormWorkspace(context, value, `${path}[${index}]`)).filter((value): value is ExchangeBrainstormWorkspace => value !== undefined);
    if (result.length > 1) context.add(path, 'INVALID_VALUE', 'Version 1 supports at most one brainstorm workspace per book.');
    context.unique(result, path, item => item.bookId);
    context.sortedBy(result, path, (left, right) => compareStrings(left.bookId, right.bookId), 'bookId');
    return result;
}

function validateBrainstormWorkspace(context: ValidationContext, value: unknown, path: string): ExchangeBrainstormWorkspace | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['bookId', 'databaseVersion', 'createdAt', 'updatedAt', 'selectedChapterIds', 'contextSnapshot', 'generatedOptions', 'selectedOptionId', 'finalContent', 'generationMetadata', 'extensions']), path);
    const metadata = context.validateMetadata(object, path);
    const bookId = context.requiredUuid(object, 'bookId', path);
    const selectedChapterIds = context.requiredUuidArray(object, 'selectedChapterIds', path, EXCHANGE_LIMITS.maxPlanningItems);
    const contextSnapshotValue = context.requiredObject(object, 'contextSnapshot', path);
    if (contextSnapshotValue) context.validateJson(contextSnapshotValue, `${path}.contextSnapshot`, 0, EXCHANGE_LIMITS.maxContextSnapshotChars);
    const generatedValue = context.requiredArray(object, 'generatedOptions', path);
    if (generatedValue && generatedValue.length > EXCHANGE_LIMITS.maxBrainstormOptions) context.add(`${path}.generatedOptions`, 'LIMIT_EXCEEDED', `A brainstorm workspace cannot contain more than ${EXCHANGE_LIMITS.maxBrainstormOptions} options.`);
    const generatedOptions = generatedValue?.map((item, index) => validateBrainstormOption(context, item, `${path}.generatedOptions[${index}]`)).filter((item): item is ExchangeBrainstormOption => item !== undefined);
    if (generatedOptions) context.unique(generatedOptions, `${path}.generatedOptions`, item => item.id);
    const selectedOptionIdValue = object.selectedOptionId;
    const selectedOptionId = selectedOptionIdValue === null || selectedOptionIdValue === undefined
        ? selectedOptionIdValue === null ? null : undefined
        : typeof selectedOptionIdValue === 'string' ? selectedOptionIdValue : undefined;
    if (selectedOptionIdValue !== null && selectedOptionIdValue !== undefined && selectedOptionId === undefined) context.add(`${path}.selectedOptionId`, 'INVALID_TYPE', 'selectedOptionId must be text or null.');
    if (selectedOptionId !== undefined && selectedOptionId !== null && selectedOptionId.length > EXCHANGE_LIMITS.maxReferenceChars) context.add(`${path}.selectedOptionId`, 'LIMIT_EXCEEDED', `Reference length cannot exceed ${EXCHANGE_LIMITS.maxReferenceChars} characters.`);
    const finalContent = context.requiredString(object, 'finalContent', path, EXCHANGE_LIMITS.maxFinalContentChars);
    const generationMetadata = object.generationMetadata === undefined ? undefined : validateGenerationMetadata(context, object.generationMetadata, `${path}.generationMetadata`);
    if (!metadata || !bookId || !selectedChapterIds || !contextSnapshotValue || !generatedOptions || finalContent === undefined) return undefined;
    return { ...metadata, bookId, selectedChapterIds, contextSnapshot: contextSnapshotValue as JsonObject, generatedOptions, ...(selectedOptionId === undefined ? {} : { selectedOptionId }), finalContent, ...(generationMetadata === undefined ? {} : { generationMetadata }) };
}
