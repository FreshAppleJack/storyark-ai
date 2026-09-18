import { EXCHANGE_LIMITS } from './exchange/limits';
import {
    parseStoryArkWorkExport,
    type ExchangeValidationIssue,
    type StoryArkWorkExport,
} from './exchange';

export interface WorkImportPreflightWarning {
    path: string;
    message: string;
}

export interface WorkImportPreflightSummary {
    schemaVersion: number;
    contentVersion: number;
    bookTitle: string;
    volumes: number;
    chapters: number;
    characters: number;
    graphNodes: number;
    graphEdges: number;
    foreshadowings: number;
    planningSummaries: number;
    plotSettings: number;
    brainstormWorkspaces: number;
    brainstormOptions: number;
    assets: number;
    assetBytes: number;
    readOnlyChapters: number;
    pendingMigrationChapters: number;
    legacyChapters: number;
}

export type WorkImportPreflightReport =
    | {
        status: 'valid';
        fileName: string;
        byteLength: number;
        value: StoryArkWorkExport;
        summary: WorkImportPreflightSummary;
        warnings: WorkImportPreflightWarning[];
    }
    | {
        status: 'invalid';
        fileName: string;
        byteLength: number;
        errors: ExchangeValidationIssue[];
    };

function sizeIssue(byteLength: number): ExchangeValidationIssue {
    return {
        path: '$',
        code: 'LIMIT_EXCEEDED',
        message: `The export cannot exceed ${EXCHANGE_LIMITS.maxExportBytes} bytes; the selected file is ${byteLength} bytes.`,
    };
}

function failureIssue(message: string): ExchangeValidationIssue {
    return { path: '$', code: 'INVALID_VALUE', message };
}

function summaryFor(value: StoryArkWorkExport): WorkImportPreflightSummary {
    const graph = value.graphs[0];
    const assetBytes = value.assets.reduce((total, asset) => total + asset.size, 0);
    return {
        schemaVersion: value.schemaVersion,
        contentVersion: value.snapshot.contentVersion,
        bookTitle: value.book.title,
        volumes: value.volumes.length,
        chapters: value.chapters.length,
        characters: value.characters.length,
        graphNodes: graph?.nodes.length ?? 0,
        graphEdges: graph?.edges.length ?? 0,
        foreshadowings: value.foreshadowings.length,
        planningSummaries: value.planning.chapterSummaries.length,
        plotSettings: value.planning.plotSettings.length,
        brainstormWorkspaces: value.brainstormWorkspaces.length,
        brainstormOptions: value.brainstormWorkspaces.reduce((total, workspace) => total + workspace.generatedOptions.length, 0),
        assets: value.assets.length,
        assetBytes,
        readOnlyChapters: value.chapters.filter(chapter => chapter.body.contentState === 'read-only').length,
        pendingMigrationChapters: value.chapters.filter(chapter => chapter.body.contentState === 'pending-migration').length,
        legacyChapters: value.chapters.filter(chapter => chapter.body.format !== 'tiptap-json').length,
    };
}

function warningsFor(value: StoryArkWorkExport): WorkImportPreflightWarning[] {
    const warnings: WorkImportPreflightWarning[] = [];
    value.chapters.forEach((chapter, index) => {
        const path = `chapters[${index}].body`;
        if (chapter.body.format !== 'tiptap-json') {
            warnings.push({
                path,
                message: 'Legacy content will remain preserved and must stay in safe read-only handling until it is migrated.',
            });
        } else if (chapter.body.contentState === 'read-only') {
            warnings.push({
                path,
                message: 'This chapter contains content that is valid to preserve but is not currently safe to edit.',
            });
        } else if (chapter.body.contentState === 'pending-migration') {
            warnings.push({
                path,
                message: 'This chapter contains content that requires a later editor migration before it can be edited.',
            });
        }
    });
    return warnings;
}

export function preflightWorkImportSize(fileName: string, byteLength: number): WorkImportPreflightReport {
    return {
        status: 'invalid',
        fileName,
        byteLength,
        errors: [sizeIssue(byteLength)],
    };
}

export function preflightWorkImportFailure(fileName: string, message = 'The selected file could not be read as a StoryArk work export.'): WorkImportPreflightReport {
    return {
        status: 'invalid',
        fileName,
        byteLength: 0,
        errors: [failureIssue(message)],
    };
}

export function preflightWorkImportText(fileName: string, raw: string, byteLength = new TextEncoder().encode(raw).byteLength): WorkImportPreflightReport {
    if (byteLength > EXCHANGE_LIMITS.maxExportBytes) return preflightWorkImportSize(fileName, byteLength);

    const result = parseStoryArkWorkExport(raw);
    if (!result.valid) {
        return { status: 'invalid', fileName, byteLength, errors: result.errors };
    }
    return {
        status: 'valid',
        fileName,
        byteLength,
        value: result.value,
        summary: summaryFor(result.value),
        warnings: [
            ...result.warnings.map(message => ({ path: '$', message })),
            ...warningsFor(result.value),
        ],
    };
}

export function preflightWorkImportBytes(fileName: string, bytes: Uint8Array): WorkImportPreflightReport {
    if (bytes.byteLength > EXCHANGE_LIMITS.maxExportBytes) return preflightWorkImportSize(fileName, bytes.byteLength);

    let raw: string;
    try {
        raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return preflightWorkImportFailure(fileName, 'The selected file is not valid UTF-8 JSON.');
    }
    return preflightWorkImportText(fileName, raw, bytes.byteLength);
}
