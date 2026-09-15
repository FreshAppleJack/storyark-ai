import { STORYARK_EXPORT_CONTENT_VERSION, STORYARK_EXPORT_SCHEMA_VERSION } from './limits';
import type { StoryArkWorkExport } from './types';
import { validateAssets } from './validation/assets';
import { validateBook, validateChapters, validateCharacters, validateVolumes } from './validation/library';
import { validateBrainstormWorkspaces, validatePlanning } from './validation/planning';
import { validateForeshadowings, validateGraphs } from './validation/relations';
import { validateReferences } from './validation/references';
import {
    PLATFORM_VALUES,
    TOP_LEVEL_FIELDS,
    ValidationContext,
    type AnyRecord,
    type ExchangeValidationIssue,
} from './validation/core';

export type { ExchangeValidationCode, ExchangeValidationIssue } from './validation/core';

export type StoryArkWorkExportValidationResult =
    | { valid: true; value: StoryArkWorkExport; warnings: string[] }
    | { valid: false; errors: ExchangeValidationIssue[] };

function validateProducer(context: ValidationContext, value: AnyRecord | undefined, path: string): void {
    context.unknownFields(value, new Set(['appVersion', 'platform', 'extensions']), path);
    context.requiredString(value, 'appVersion', path, 64, 1);
    context.enumValue(value, 'platform', path, PLATFORM_VALUES);
}

function validateSnapshot(context: ValidationContext, value: AnyRecord | undefined, path: string): void {
    context.unknownFields(value, new Set(['databaseVersion', 'contentVersion', 'extensions']), path);
    context.requiredInteger(value, 'databaseVersion', path, 0, Number.MAX_SAFE_INTEGER);
    const contentVersion = context.requiredInteger(value, 'contentVersion', path, 0, Number.MAX_SAFE_INTEGER);
    if (contentVersion !== undefined && contentVersion !== STORYARK_EXPORT_CONTENT_VERSION) context.add(`${path}.contentVersion`, 'UNSUPPORTED_VERSION', `Only contentVersion ${STORYARK_EXPORT_CONTENT_VERSION} is supported.`);
}

export function validateStoryArkWorkExport(value: unknown): StoryArkWorkExportValidationResult {
    const context = new ValidationContext();
    const root = context.requiredObjectValue(value, '$');
    if (!root) return { valid: false, errors: context.errors };

    context.unknownFields(root, TOP_LEVEL_FIELDS, '$', true);
    const schemaVersion = context.requiredInteger(root, 'schemaVersion', '$', 0, Number.MAX_SAFE_INTEGER);
    if (schemaVersion !== undefined && schemaVersion !== STORYARK_EXPORT_SCHEMA_VERSION) context.add('$.schemaVersion', 'UNSUPPORTED_VERSION', `Only schemaVersion ${STORYARK_EXPORT_SCHEMA_VERSION} is supported.`);
    context.requiredUuid(root, 'exportId', '$');
    context.requiredIsoDate(root, 'exportedAt', '$');
    validateProducer(context, context.requiredObject(root, 'producer', '$'), '$.producer');
    validateSnapshot(context, context.requiredObject(root, 'snapshot', '$'), '$.snapshot');

    const book = validateBook(context, context.requiredObject(root, 'book', '$'), '$.book');
    const volumes = validateVolumes(context, context.requiredArray(root, 'volumes', '$'), '$.volumes');
    const chapters = validateChapters(context, context.requiredArray(root, 'chapters', '$'), '$.chapters');
    const characters = validateCharacters(context, context.requiredArray(root, 'characters', '$'), '$.characters');
    const graphs = validateGraphs(context, context.requiredArray(root, 'graphs', '$'), '$.graphs');
    const foreshadowings = validateForeshadowings(context, context.requiredArray(root, 'foreshadowings', '$'), '$.foreshadowings');
    const planning = validatePlanning(context, context.requiredObject(root, 'planning', '$'), '$.planning');
    const brainstormWorkspaces = validateBrainstormWorkspaces(context, context.requiredArray(root, 'brainstormWorkspaces', '$'), '$.brainstormWorkspaces');
    validateAssets(context, context.requiredArray(root, 'assets', '$'), '$.assets');

    if (book && volumes && chapters && characters && graphs && foreshadowings && planning && brainstormWorkspaces) {
        validateReferences(context, book, volumes, chapters, characters, graphs, foreshadowings, planning, brainstormWorkspaces);
    }
    if (context.errors.length > 0) return { valid: false, errors: context.errors };
    return { valid: true, value: root as unknown as StoryArkWorkExport, warnings: context.warnings };
}

export function isStoryArkWorkExport(value: unknown): value is StoryArkWorkExport {
    return validateStoryArkWorkExport(value).valid;
}

