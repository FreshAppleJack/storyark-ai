import { EXCHANGE_LIMITS } from '../limits';
import type {
    ExchangeChapterSummaryGenerationMetadata,
    ExchangeChapterSummaryGenerationSource,
    ExchangeChapterSummaryRetrievalBudget,
    ExchangeChapterSummaryRetrievalScope,
    ExchangeChapterSummarySourceSnapshot,
    ExchangeBrainstormGenerationMetadata,
    ExchangeBrainstormOption,
    ExchangeBrainstormWorkspace,
    ExchangePlanning,
    ExchangePlotSetting,
    JsonObject,
} from '../types';
import { compareStrings, CONTENT_FORMATS, type AnyRecord, type ValidationContext } from './core';

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

const SUMMARY_FINGERPRINT = /^[0-9a-f]{16}$/;

function validateSummarySourceSnapshot(
    context: ValidationContext,
    value: unknown,
    path: string,
): ExchangeChapterSummarySourceSnapshot | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set([
        'chapterId', 'chapterDatabaseVersion', 'chapterTitle', 'contentFormat', 'contentVersion',
        'fingerprintAlgorithm', 'bodyFingerprint', 'structuredFingerprint', 'blockFingerprints',
        'mentionedCharacterIds', 'foreshadowingIds', 'foreshadowingNoteFingerprints', 'capturedAt', 'extensions',
    ]), path);
    const chapterId = context.requiredUuid(object, 'chapterId', path);
    const chapterDatabaseVersion = object.chapterDatabaseVersion === null
        ? null
        : context.requiredInteger(object, 'chapterDatabaseVersion', path, 1, Number.MAX_SAFE_INTEGER);
    const chapterTitle = context.requiredString(object, 'chapterTitle', path, EXCHANGE_LIMITS.maxTitleChars);
    const contentFormat = context.enumValue(object, 'contentFormat', path, CONTENT_FORMATS);
    const contentVersion = object.contentVersion === null
        ? null
        : context.requiredInteger(object, 'contentVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const fingerprintAlgorithm = context.requiredString(object, 'fingerprintAlgorithm', path, 64, 1);
    const bodyFingerprint = context.requiredString(object, 'bodyFingerprint', path, 16, 16);
    const structuredFingerprint = context.requiredString(object, 'structuredFingerprint', path, 16, 16);
    const blockFingerprints = context.requiredStringArray(object, 'blockFingerprints', path, EXCHANGE_LIMITS.maxSummarySnapshotBlocks, 16, 16, false);
    const mentionedCharacterIds = context.requiredUuidArray(object, 'mentionedCharacterIds', path, EXCHANGE_LIMITS.maxSummarySourceVersions);
    const foreshadowingIds = context.requiredStringArray(object, 'foreshadowingIds', path, EXCHANGE_LIMITS.maxNotes, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const noteValues = context.requiredArray(object, 'foreshadowingNoteFingerprints', path);
    if (noteValues && noteValues.length > EXCHANGE_LIMITS.maxNotes) {
        context.add(`${path}.foreshadowingNoteFingerprints`, 'LIMIT_EXCEEDED', `A source snapshot cannot contain more than ${EXCHANGE_LIMITS.maxNotes} notes.`);
    }
    const foreshadowingNoteFingerprints = noteValues?.map((note, index) => validateSummaryNoteFingerprint(context, note, `${path}.foreshadowingNoteFingerprints[${index}]`))
        .filter((note): note is NonNullable<ExchangeChapterSummarySourceSnapshot['foreshadowingNoteFingerprints'][number]> => note !== undefined);
    if (foreshadowingNoteFingerprints) context.unique(foreshadowingNoteFingerprints, `${path}.foreshadowingNoteFingerprints`, note => note.noteId);
    const capturedAt = context.requiredTimestamp(object, 'capturedAt', path);
    if (!chapterId || chapterDatabaseVersion === undefined || chapterTitle === undefined || !contentFormat
        || contentVersion === undefined || fingerprintAlgorithm === undefined || bodyFingerprint === undefined
        || structuredFingerprint === undefined || !blockFingerprints || !mentionedCharacterIds
        || !foreshadowingIds || !foreshadowingNoteFingerprints || capturedAt === undefined) return undefined;
    if (fingerprintAlgorithm !== 'fnv1a64-utf16-v1') context.add(`${path}.fingerprintAlgorithm`, 'UNSUPPORTED_VERSION', 'Unsupported chapter source fingerprint algorithm.');
    if (!SUMMARY_FINGERPRINT.test(bodyFingerprint)) context.add(`${path}.bodyFingerprint`, 'INVALID_VALUE', 'Expected a 64-bit lowercase hexadecimal fingerprint.');
    if (!SUMMARY_FINGERPRINT.test(structuredFingerprint)) context.add(`${path}.structuredFingerprint`, 'INVALID_VALUE', 'Expected a 64-bit lowercase hexadecimal fingerprint.');
    blockFingerprints.forEach((fingerprint, index) => {
        if (!SUMMARY_FINGERPRINT.test(fingerprint)) context.add(`${path}.blockFingerprints[${index}]`, 'INVALID_VALUE', 'Expected a 64-bit lowercase hexadecimal fingerprint.');
    });
    return {
        chapterId, chapterDatabaseVersion, chapterTitle, contentFormat, contentVersion,
        fingerprintAlgorithm: 'fnv1a64-utf16-v1', bodyFingerprint, structuredFingerprint,
        blockFingerprints, mentionedCharacterIds, foreshadowingIds, foreshadowingNoteFingerprints, capturedAt,
    };
}

function validateSummaryNoteFingerprint(
    context: ValidationContext,
    value: unknown,
    path: string,
): ExchangeChapterSummarySourceSnapshot['foreshadowingNoteFingerprints'][number] | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['noteId', 'fingerprint', 'extensions']), path);
    const noteId = context.requiredString(object, 'noteId', path, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const fingerprint = context.requiredString(object, 'fingerprint', path, 16, 16);
    if (fingerprint !== undefined && !SUMMARY_FINGERPRINT.test(fingerprint)) context.add(`${path}.fingerprint`, 'INVALID_VALUE', 'Expected a 64-bit lowercase hexadecimal fingerprint.');
    if (noteId === undefined || fingerprint === undefined) return undefined;
    return { noteId, fingerprint };
}

function validateSummaryGenerationMetadata(
    context: ValidationContext,
    value: unknown,
    path: string,
): ExchangeChapterSummaryGenerationMetadata | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['providerId', 'configId', 'protocol', 'modelId', 'generatedAt', 'promptVersion', 'source', 'extensions']), path);
    const providerId = context.requiredString(object, 'providerId', path, 128, 1);
    const configId = context.requiredUuid(object, 'configId', path);
    const protocol = context.requiredString(object, 'protocol', path, 128, 1);
    const modelId = context.requiredString(object, 'modelId', path, EXCHANGE_LIMITS.maxModelIdChars, 1);
    const generatedAt = context.requiredTimestamp(object, 'generatedAt', path);
    const promptVersion = context.requiredString(object, 'promptVersion', path, EXCHANGE_LIMITS.maxPromptVersionChars, 1);
    const source = validateSummaryGenerationSource(context, context.requiredObject(object, 'source', path), `${path}.source`);
    if (providerId === undefined || !configId || protocol === undefined || modelId === undefined || generatedAt === undefined || promptVersion === undefined || !source) return undefined;
    return { providerId, configId, protocol, modelId, generatedAt, promptVersion, source };
}

function validateSummaryGenerationSource(
    context: ValidationContext,
    value: AnyRecord | undefined,
    path: string,
): ExchangeChapterSummaryGenerationSource | undefined {
    if (!value) return undefined;
    context.unknownFields(value, new Set([
        'bookId', 'chapterId', 'chapterDatabaseVersion', 'sourceBodyFingerprint', 'planningDatabaseVersion',
        'allowedSources', 'retrievalTrace', 'includesFuturePlan', 'extensions',
    ]), path);
    const bookId = context.requiredUuid(value, 'bookId', path);
    const chapterId = context.requiredUuid(value, 'chapterId', path);
    const chapterDatabaseVersion = context.requiredInteger(value, 'chapterDatabaseVersion', path, 1, Number.MAX_SAFE_INTEGER);
    const sourceBodyFingerprint = context.requiredString(value, 'sourceBodyFingerprint', path, 16, 16);
    const planningDatabaseVersion = value.planningDatabaseVersion === null
        ? null
        : context.requiredInteger(value, 'planningDatabaseVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const sourceValues = context.requiredArray(value, 'allowedSources', path);
    if (sourceValues && sourceValues.length > EXCHANGE_LIMITS.maxSummarySourceVersions) {
        context.add(`${path}.allowedSources`, 'LIMIT_EXCEEDED', `Summary generation cannot record more than ${EXCHANGE_LIMITS.maxSummarySourceVersions} allowed sources.`);
    }
    const allowedSources = sourceValues?.map((source, index) => validateSummaryAllowedSource(context, source, `${path}.allowedSources[${index}]`))
        .filter((source): source is ExchangeChapterSummaryGenerationSource['allowedSources'][number] => source !== undefined);
    if (allowedSources) context.unique(allowedSources, `${path}.allowedSources`, source => source.sourceId);
    const retrievalTrace = validateSummaryRetrievalTrace(context, value, path);
    const includesFuturePlan = context.requiredBoolean(value, 'includesFuturePlan', path);
    if (!bookId || !chapterId || chapterDatabaseVersion === undefined || sourceBodyFingerprint === undefined
        || planningDatabaseVersion === undefined || !allowedSources || retrievalTrace === undefined || includesFuturePlan === undefined) return undefined;
    if (!SUMMARY_FINGERPRINT.test(sourceBodyFingerprint)) context.add(`${path}.sourceBodyFingerprint`, 'INVALID_VALUE', 'Expected a 64-bit lowercase hexadecimal fingerprint.');
    if (includesFuturePlan) context.add(`${path}.includesFuturePlan`, 'UNSAFE_CONTENT', 'Chapter summaries cannot use future-plan sources.');
    return { bookId, chapterId, chapterDatabaseVersion, sourceBodyFingerprint, planningDatabaseVersion, allowedSources, retrievalTrace, includesFuturePlan: false };
}

function validateSummaryAllowedSource(
    context: ValidationContext,
    value: unknown,
    path: string,
): ExchangeChapterSummaryGenerationSource['allowedSources'][number] | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['sourceId', 'entityId', 'sourceKind', 'sourceVersion', 'indexVersion', 'extensions']), path);
    const sourceId = context.requiredString(object, 'sourceId', path, 512, 1);
    const sourceKind = context.enumValue(object, 'sourceKind', path, ['planning', 'confirmed_setting', 'character', 'relationship', 'foreshadowing_note'] as const);
    const entityId = sourceKind === 'character'
        ? context.requiredUuid(object, 'entityId', path)
        : context.requiredString(object, 'entityId', path, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const sourceVersion = context.requiredInteger(object, 'sourceVersion', path, 1, Number.MAX_SAFE_INTEGER);
    const indexVersion = object.indexVersion === null
        ? null
        : context.requiredInteger(object, 'indexVersion', path, 1, Number.MAX_SAFE_INTEGER);
    if (sourceId === undefined || entityId === undefined || !sourceKind || sourceVersion === undefined || indexVersion === undefined) return undefined;
    return { sourceId, entityId, sourceKind, sourceVersion, indexVersion };
}

function validateSummaryRetrievalTrace(
    context: ValidationContext,
    parent: AnyRecord,
    path: string,
): ExchangeChapterSummaryGenerationSource['retrievalTrace'] | undefined {
    if (!Object.prototype.hasOwnProperty.call(parent, 'retrievalTrace')) {
        context.add(`${path}.retrievalTrace`, 'MISSING_FIELD', 'Retrieval trace must be recorded, or explicitly set to null when no retrieval was used.');
        return undefined;
    }
    if (parent.retrievalTrace === null) return null;
    const object = context.requiredObjectValue(parent.retrievalTrace, `${path}.retrievalTrace`);
    if (!object) return undefined;
    context.unknownFields(object, new Set([
        'searchId', 'retrievalVersion', 'task', 'requestedAt', 'scope', 'excludedHitIds',
        'sourceVersions', 'includedHitIds', 'omittedHitIds', 'budget', 'indexVersion',
        'embeddingFingerprint', 'extensions',
    ]), `${path}.retrievalTrace`);
    const tracePath = `${path}.retrievalTrace`;
    const searchId = context.requiredString(object, 'searchId', tracePath, 128, 1);
    const retrievalVersion = context.requiredString(object, 'retrievalVersion', tracePath, EXCHANGE_LIMITS.maxPromptVersionChars, 1);
    const task = context.enumValue(object, 'task', tracePath, ['chapter_summary'] as const);
    const requestedAt = context.requiredTimestamp(object, 'requestedAt', tracePath);
    const scope = validateSummaryRetrievalScope(context, object.scope, `${tracePath}.scope`, parent.bookId, parent.chapterId);
    const excludedHitIds = context.requiredStringArray(object, 'excludedHitIds', tracePath, EXCHANGE_LIMITS.maxBrainstormRetrievalHits, 8192, 1);
    const versionsValue = context.requiredArray(object, 'sourceVersions', tracePath);
    if (versionsValue && versionsValue.length > EXCHANGE_LIMITS.maxBrainstormRetrievalSources) {
        context.add(`${tracePath}.sourceVersions`, 'LIMIT_EXCEEDED', 'Summary retrieval trace contains too many sources.');
    }
    const sourceVersions = versionsValue?.map((item, index) => validateSummaryRetrievalSourceVersion(context, item, `${tracePath}.sourceVersions[${index}]`))
        .filter((item): item is NonNullable<ExchangeChapterSummaryGenerationSource['retrievalTrace']>['sourceVersions'][number] => item !== undefined);
    sourceVersions?.forEach((item, index) => {
        if (item.sourceId.split(':')[1] === 'future_plan') {
            context.add(`${tracePath}.sourceVersions[${index}].sourceId`, 'UNSAFE_CONTENT', 'Summary retrieval cannot use future-plan sources.');
        }
    });
    if (sourceVersions) context.unique(sourceVersions, `${tracePath}.sourceVersions`, item => item.sourceId);
    const includedHitIds = context.requiredStringArray(object, 'includedHitIds', tracePath, EXCHANGE_LIMITS.maxBrainstormRetrievalHits, 8192, 1);
    const omittedHitIds = context.requiredStringArray(object, 'omittedHitIds', tracePath, EXCHANGE_LIMITS.maxBrainstormRetrievalHits, 8192, 1);
    const budgetObject = context.requiredObject(object, 'budget', tracePath);
    const budget = budgetObject ? validateSummaryRetrievalBudget(context, budgetObject, `${tracePath}.budget`) : undefined;
    const indexVersion = object.indexVersion === null
        ? null
        : context.requiredInteger(object, 'indexVersion', tracePath, 1, Number.MAX_SAFE_INTEGER);
    const embeddingFingerprint = object.embeddingFingerprint === null
        ? null
        : context.requiredString(object, 'embeddingFingerprint', tracePath, 1024, 1);
    if (searchId === undefined || retrievalVersion === undefined || !task || requestedAt === undefined || !scope
        || !excludedHitIds || !sourceVersions || !includedHitIds || !omittedHitIds || !budget
        || indexVersion === undefined || embeddingFingerprint === undefined) return undefined;
    if (new Set(excludedHitIds).size !== excludedHitIds.length) context.add(`${tracePath}.excludedHitIds`, 'INVALID_VALUE', 'Hit IDs must be unique.');
    if (new Set(includedHitIds).size !== includedHitIds.length) context.add(`${tracePath}.includedHitIds`, 'INVALID_VALUE', 'Hit IDs must be unique.');
    if (new Set(omittedHitIds).size !== omittedHitIds.length) context.add(`${tracePath}.omittedHitIds`, 'INVALID_VALUE', 'Hit IDs must be unique.');
    return { searchId, retrievalVersion, task, requestedAt, scope, excludedHitIds, sourceVersions, includedHitIds, omittedHitIds, budget, indexVersion, embeddingFingerprint };
}

function validateSummaryRetrievalScope(
    context: ValidationContext,
    value: unknown,
    path: string,
    expectedBookId: unknown,
    expectedChapterId: unknown,
): ExchangeChapterSummaryRetrievalScope | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set([
        'bookId', 'allowedSourceKinds', 'allowedChapterIds', 'beforeChapterOrder', 'beforeAnchor',
        'includeFuturePlan', 'includeGenerated', 'includeStale', 'timeRange', 'extensions',
    ]), path);
    const bookId = context.requiredUuid(object, 'bookId', path);
    const kindsValue = context.requiredArray(object, 'allowedSourceKinds', path);
    const allowedKinds = ['confirmed_setting', 'character'] as const;
    const allowedSourceKinds = kindsValue?.map((kind, index) => {
        if (typeof kind !== 'string' || !allowedKinds.includes(kind as typeof allowedKinds[number])) {
            context.add(`${path}.allowedSourceKinds[${index}]`, 'UNSAFE_CONTENT', 'Chapter summary retrieval cannot include manuscript, planning, or future-plan sources.');
            return undefined;
        }
        return kind as typeof allowedKinds[number];
    }).filter((kind): kind is typeof allowedKinds[number] => kind !== undefined);
    const allowedChapterIds = context.requiredUuidArray(object, 'allowedChapterIds', path, 1);
    const includeFuturePlan = context.requiredBoolean(object, 'includeFuturePlan', path);
    const includeGenerated = context.requiredBoolean(object, 'includeGenerated', path);
    const includeStale = context.requiredBoolean(object, 'includeStale', path);
    for (const field of ['beforeChapterOrder', 'beforeAnchor', 'timeRange'] as const) {
        if (!Object.prototype.hasOwnProperty.call(object, field)) {
            context.add(`${path}.${field}`, 'MISSING_FIELD', 'Summary retrieval must record empty range and anchor filters explicitly as null.');
        } else if (object[field] !== null) {
            context.add(`${path}.${field}`, 'UNSAFE_CONTENT', 'Chapter summary retrieval must not use range or anchor filters from another chapter.');
        }
    }
    if (!bookId || !allowedKinds || !allowedSourceKinds || !allowedChapterIds
        || includeFuturePlan === undefined || includeGenerated === undefined || includeStale === undefined) return undefined;
    if (bookId !== expectedBookId || allowedChapterIds.length !== 1 || allowedChapterIds[0] !== expectedChapterId
        || allowedSourceKinds.length === 0 || includeFuturePlan || includeGenerated || includeStale) {
        context.add(path, 'REFERENCE_MISMATCH', 'Chapter summary retrieval must be limited to this book and chapter, with future, generated, and stale sources excluded.');
    }
    return {
        bookId, allowedSourceKinds, allowedChapterIds,
        beforeChapterOrder: null,
        beforeAnchor: null,
        includeFuturePlan: false,
        includeGenerated: false,
        includeStale: false,
        timeRange: null,
    };
}

function validateSummaryRetrievalBudget(
    context: ValidationContext,
    value: AnyRecord,
    path: string,
): ExchangeChapterSummaryRetrievalBudget | undefined {
    const charBudget = context.requiredInteger(value, 'charBudget', path, 1, EXCHANGE_LIMITS.maxContextSnapshotChars);
    const tokenBudget = value.tokenBudget === null
        ? null
        : context.requiredInteger(value, 'tokenBudget', path, 1, Number.MAX_SAFE_INTEGER);
    if (charBudget === undefined || tokenBudget === undefined) return undefined;
    return { charBudget, tokenBudget };
}

function validateSummaryRetrievalSourceVersion(
    context: ValidationContext,
    value: unknown,
    path: string,
): NonNullable<ExchangeChapterSummaryGenerationSource['retrievalTrace']>['sourceVersions'][number] | undefined {
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

function validateChapterSummary(context: ValidationContext, value: unknown, path: string): ExchangePlanning['chapterSummaries'][number] | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set([
        'chapterId', 'summary', 'sourceChapterVersion', 'updatedAt', 'provenance',
        'sourceSnapshot', 'generationMetadata', 'extensions',
    ]), path);
    const chapterId = context.requiredUuid(object, 'chapterId', path);
    const summary = context.requiredString(object, 'summary', path, EXCHANGE_LIMITS.maxSummaryChars);
    const sourceChapterVersion = context.optionalInteger(object, 'sourceChapterVersion', path, 1, Number.MAX_SAFE_INTEGER);
    const updatedAt = context.requiredTimestamp(object, 'updatedAt', path);
    const provenance = Object.prototype.hasOwnProperty.call(object, 'provenance')
        ? context.enumValue(object, 'provenance', path, ['author', 'ai-adopted'] as const)
        : undefined;
    const sourceSnapshot = Object.prototype.hasOwnProperty.call(object, 'sourceSnapshot')
        ? validateSummarySourceSnapshot(context, object.sourceSnapshot, `${path}.sourceSnapshot`)
        : undefined;
    const generationMetadata = Object.prototype.hasOwnProperty.call(object, 'generationMetadata')
        ? validateSummaryGenerationMetadata(context, object.generationMetadata, `${path}.generationMetadata`)
        : undefined;
    if (!chapterId || summary === undefined || updatedAt === undefined) return undefined;
    if (provenance === 'ai-adopted' && !generationMetadata) {
        context.add(`${path}.generationMetadata`, 'MISSING_FIELD', 'An adopted AI summary requires generation metadata.');
    }
    if (generationMetadata && provenance !== 'ai-adopted') {
        context.add(`${path}.provenance`, 'REFERENCE_MISMATCH', 'Generation metadata is only valid for an adopted AI summary.');
    }
    if (sourceSnapshot && sourceSnapshot.chapterId !== chapterId) {
        context.add(`${path}.sourceSnapshot.chapterId`, 'REFERENCE_MISMATCH', 'The source snapshot must belong to the summary chapter.');
    }
    if (generationMetadata && generationMetadata.source.chapterId !== chapterId) {
        context.add(`${path}.generationMetadata.source.chapterId`, 'REFERENCE_MISMATCH', 'Generation metadata must belong to the summary chapter.');
    }
    if (generationMetadata && sourceSnapshot
        && generationMetadata.source.sourceBodyFingerprint !== sourceSnapshot.bodyFingerprint) {
        context.add(`${path}.generationMetadata.source.sourceBodyFingerprint`, 'REFERENCE_MISMATCH', 'Generation metadata must refer to the saved summary source snapshot.');
    }
    if (generationMetadata && sourceSnapshot
        && sourceSnapshot.chapterDatabaseVersion !== null
        && generationMetadata.source.chapterDatabaseVersion !== sourceSnapshot.chapterDatabaseVersion) {
        context.add(`${path}.generationMetadata.source.chapterDatabaseVersion`, 'REFERENCE_MISMATCH', 'Generation metadata and source snapshot must freeze the same chapter version.');
    }
    return {
        chapterId,
        summary,
        ...(sourceChapterVersion === undefined ? {} : { sourceChapterVersion }),
        updatedAt,
        ...(provenance === undefined ? {} : { provenance }),
        ...(sourceSnapshot === undefined ? {} : { sourceSnapshot }),
        ...(generationMetadata === undefined ? {} : { generationMetadata }),
    };
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
