import { EXCHANGE_LIMITS } from './limits';
import type { StoryArkWorkExport } from './types';
import {
    validateStoryArkWorkExport,
    type ExchangeValidationIssue,
    type StoryArkWorkExportValidationResult,
} from './validation';

export class StoryArkWorkExportValidationError extends Error {
    constructor(public readonly issues: ExchangeValidationIssue[]) {
        super(issues.map(issue => `${issue.path}: ${issue.message}`).join('\n'));
        this.name = 'StoryArkWorkExportValidationError';
    }
}

export function parseStoryArkWorkExport(raw: string): StoryArkWorkExportValidationResult {
    if (typeof raw !== 'string') {
        return { valid: false, errors: [{ path: '$', code: 'INVALID_TYPE', message: 'The export must be UTF-8 JSON text.' }] };
    }
    if (new TextEncoder().encode(raw).byteLength > EXCHANGE_LIMITS.maxExportBytes) {
        return { valid: false, errors: [{ path: '$', code: 'LIMIT_EXCEEDED', message: `The export cannot exceed ${EXCHANGE_LIMITS.maxExportBytes} bytes.` }] };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { valid: false, errors: [{ path: '$', code: 'INVALID_VALUE', message: 'The export is not valid JSON.' }] };
    }
    return validateStoryArkWorkExport(parsed);
}

export function serializeStoryArkWorkExport(value: unknown): string {
    const result = validateStoryArkWorkExport(value);
    if (!result.valid) throw new StoryArkWorkExportValidationError(result.errors);
    let raw: string;
    try {
        raw = JSON.stringify(result.value, null, 2);
    } catch {
        throw new StoryArkWorkExportValidationError([{ path: '$', code: 'INVALID_VALUE', message: 'The export contains a value that cannot be serialized as JSON.' }]);
    }
    if (new TextEncoder().encode(raw).byteLength > EXCHANGE_LIMITS.maxExportBytes) {
        throw new StoryArkWorkExportValidationError([{ path: '$', code: 'LIMIT_EXCEEDED', message: `The export cannot exceed ${EXCHANGE_LIMITS.maxExportBytes} bytes.` }]);
    }
    return raw;
}

export function assertStoryArkWorkExport(value: unknown): asserts value is StoryArkWorkExport {
    const result = validateStoryArkWorkExport(value);
    if (!result.valid) throw new StoryArkWorkExportValidationError(result.errors);
}

