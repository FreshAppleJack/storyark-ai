import { EXCHANGE_LIMITS } from '../limits';
import type {
    ExchangeRecordMetadata,
} from '../types';
import type { HandleConfig } from '../../../../types';

export type AnyRecord = Record<string, unknown>;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export const MIME_PATTERN = /^[\x21-\x7e]+\/[\x21-\x7e]+$/;
export const HANDLE_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export const HANDLE_MODES = ['source', 'target', 'both', 'none'] as const;
export const CHARACTER_ROLES = ['protagonist', 'antagonist', 'supporting', 'mob'] as const;
export const CONTENT_FORMATS = ['tiptap-json', 'legacy-json', 'legacy-html', 'unrecognized'] as const;
export const LEGACY_CONTENT_FORMATS = ['legacy-json', 'legacy-html', 'unrecognized'] as const;
export const CONTENT_STATES = ['editable', 'read-only', 'pending-migration'] as const;
export const PLATFORM_VALUES = ['windows', 'macos', 'linux', 'unknown'] as const;
export const TOP_LEVEL_FIELDS = new Set([
    'schemaVersion', 'exportId', 'exportedAt', 'producer', 'snapshot', 'book',
    'volumes', 'chapters', 'characters', 'graphs', 'foreshadowings', 'planning',
    'brainstormWorkspaces', 'assets', 'extensions',
]);
export const FORBIDDEN_TOP_LEVEL_FIELDS = new Set([
    'preferences', 'applicationPreferences', 'aiModels', 'aiSettings', 'credentials',
    'apiKeys', 'apiKey', 'credentialRef', 'secrets', 'secret', 'password', 'authorization',
    'temporaryCandidates', 'runningTasks', 'activeRequests', 'indexes', 'indexTasks',
    'embeddings', 'embeddingModel', 'absolutePaths',
]);
export const SENSITIVE_EXTENSION_KEYS = new Set([
    'apikey', 'credentials', 'credential', 'credentialref', 'secret', 'password',
    'authorization', 'accesstoken', 'privatekey',
]);

export type ExchangeValidationCode =
    | 'MISSING_FIELD'
    | 'INVALID_TYPE'
    | 'INVALID_VALUE'
    | 'UNSUPPORTED_VERSION'
    | 'LIMIT_EXCEEDED'
    | 'UNSORTED'
    | 'REFERENCE_NOT_FOUND'
    | 'REFERENCE_MISMATCH'
    | 'UNSAFE_CONTENT'
    | 'FORBIDDEN_FIELD';

export interface ExchangeValidationIssue {
    path: string;
    code: ExchangeValidationCode;
    message: string;
}

export interface CapturedReference {
    id: string;
    chapterId: string;
    path: string;
}

export function isRecord(value: unknown): value is AnyRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function textLength(value: string): number {
    return Array.from(value).length;
}

export function isCanonicalUuid(value: string): boolean {
    return UUID_PATTERN.test(value) && value === value.toLowerCase();
}

export function fieldPath(path: string, key: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

export function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function comparePositionAndId(left: { position: number; id: string }, right: { position: number; id: string }): number {
    return left.position - right.position || compareStrings(left.id, right.id);
}

function normalizeSensitiveKey(key: string): string {
    return key.replace(/[-_\s]/g, '').toLowerCase();
}

export class ValidationContext {
    readonly errors: ExchangeValidationIssue[] = [];
    readonly warnings: string[] = [];
    readonly foreshadowingMarks: CapturedReference[] = [];
    readonly canonicalMentionIds: CapturedReference[] = [];
    private objectCount = 0;

    add(path: string, code: ExchangeValidationCode, message: string): void {
        if (this.errors.length < 100) this.errors.push({ path, code, message });
    }

    requiredObjectValue(value: unknown, path: string): AnyRecord | undefined {
        if (!isRecord(value)) {
            this.add(path, 'INVALID_TYPE', 'Expected a JSON object.');
            return undefined;
        }
        this.objectCount += 1;
        if (this.objectCount > EXCHANGE_LIMITS.maxJsonObjects) {
            this.add(path, 'LIMIT_EXCEEDED', `The export contains more than ${EXCHANGE_LIMITS.maxJsonObjects} JSON objects.`);
        }
        return value;
    }

    requiredObject(parent: AnyRecord | undefined, key: string, path: string): AnyRecord | undefined {
        const value = this.read(parent, key, path);
        return value === undefined ? undefined : this.requiredObjectValue(value, fieldPath(path, key));
    }

    requiredArray(parent: AnyRecord | undefined, key: string, path: string): unknown[] | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (!Array.isArray(value)) {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected a JSON array.');
            return undefined;
        }
        return value;
    }

    read(parent: AnyRecord | undefined, key: string, path: string): unknown {
        if (!parent || !Object.prototype.hasOwnProperty.call(parent, key)) {
            this.add(fieldPath(path, key), 'MISSING_FIELD', 'Required field is missing.');
            return undefined;
        }
        return parent[key];
    }

    requiredString(parent: AnyRecord | undefined, key: string, path: string, max: number, min = 0): string | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (typeof value !== 'string') {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected text.');
            return undefined;
        }
        const length = textLength(value);
        if (length < min || length > max) this.add(fieldPath(path, key), 'LIMIT_EXCEEDED', `Text length must be between ${min} and ${max} characters.`);
        return value;
    }

    optionalString(parent: AnyRecord | undefined, key: string, path: string, max: number, min = 0): string | undefined {
        if (!parent || !Object.prototype.hasOwnProperty.call(parent, key)) return undefined;
        return this.requiredString(parent, key, path, max, min);
    }

    requiredBoolean(parent: AnyRecord | undefined, key: string, path: string): boolean | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (typeof value !== 'boolean') {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected a boolean.');
            return undefined;
        }
        return value;
    }

    requiredInteger(parent: AnyRecord | undefined, key: string, path: string, min: number, max: number): number | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected a safe integer.');
            return undefined;
        }
        if (value < min || value > max) this.add(fieldPath(path, key), 'INVALID_VALUE', `Integer must be between ${min} and ${max}.`);
        return value;
    }

    optionalInteger(parent: AnyRecord | undefined, key: string, path: string, min: number, max: number): number | undefined {
        if (!parent || !Object.prototype.hasOwnProperty.call(parent, key)) return undefined;
        return this.requiredInteger(parent, key, path, min, max);
    }

    requiredNumber(parent: AnyRecord | undefined, key: string, path: string, min: number, max: number): number | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected a finite number.');
            return undefined;
        }
        if (value < min || value > max) this.add(fieldPath(path, key), 'INVALID_VALUE', `Number must be between ${min} and ${max}.`);
        return value;
    }

    requiredUuid(parent: AnyRecord | undefined, key: string, path: string): string | undefined {
        const value = this.requiredString(parent, key, path, 36, 36);
        if (value !== undefined && !isCanonicalUuid(value)) this.add(fieldPath(path, key), 'INVALID_VALUE', 'Expected a canonical lowercase UUID.');
        return value;
    }

    optionalUuid(parent: AnyRecord | undefined, key: string, path: string): string | undefined {
        if (!parent || !Object.prototype.hasOwnProperty.call(parent, key)) return undefined;
        return this.requiredUuid(parent, key, path);
    }

    requiredTimestamp(parent: AnyRecord | undefined, key: string, path: string): number | undefined {
        return this.requiredInteger(parent, key, path, 0, Number.MAX_SAFE_INTEGER);
    }

    optionalTimestamp(parent: AnyRecord | undefined, key: string, path: string): number | undefined {
        return this.optionalInteger(parent, key, path, 0, Number.MAX_SAFE_INTEGER);
    }

    requiredIsoDate(parent: AnyRecord | undefined, key: string, path: string): string | undefined {
        const value = this.requiredString(parent, key, path, 30, 20);
        if (value !== undefined && (!ISO_DATE_PATTERN.test(value) || Number.isNaN(Date.parse(value)))) this.add(fieldPath(path, key), 'INVALID_VALUE', 'Expected an ISO-8601 UTC timestamp.');
        return value;
    }

    enumValue<T extends string>(parent: AnyRecord | undefined, key: string, path: string, values: readonly T[]): T | undefined {
        const value = this.requiredString(parent, key, path, 128, 1);
        if (value !== undefined && !values.includes(value as T)) this.add(fieldPath(path, key), 'INVALID_VALUE', `Expected one of: ${values.join(', ')}.`);
        return values.includes(value as T) ? value as T : undefined;
    }

    validateMetadata(value: AnyRecord | undefined, path: string, minDatabaseVersion = 1): ExchangeRecordMetadata | undefined {
        if (!value) return undefined;
        const databaseVersion = this.requiredInteger(value, 'databaseVersion', path, minDatabaseVersion, Number.MAX_SAFE_INTEGER);
        const createdAt = this.requiredTimestamp(value, 'createdAt', path);
        const updatedAt = this.requiredTimestamp(value, 'updatedAt', path);
        if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) this.add(path, 'INVALID_VALUE', 'updatedAt cannot be earlier than createdAt.');
        return { databaseVersion: databaseVersion ?? minDatabaseVersion, createdAt: createdAt ?? 0, updatedAt: updatedAt ?? 0 };
    }

    unknownFields(parent: AnyRecord | undefined, known: Set<string>, path: string, root = false): void {
        if (!parent) return;
        for (const [key, value] of Object.entries(parent)) {
            if (known.has(key)) continue;
            if (root && (FORBIDDEN_TOP_LEVEL_FIELDS.has(key) || SENSITIVE_EXTENSION_KEYS.has(normalizeSensitiveKey(key)))) this.add(fieldPath(path, key), 'FORBIDDEN_FIELD', 'Application settings, credentials, runtime state and derived indexes do not belong in a work export.');
            this.validateJson(value, fieldPath(path, key), 0, EXCHANGE_LIMITS.maxSummaryChars);
        }
        this.validateExtensions(parent.extensions, fieldPath(path, 'extensions'));
    }

    validateExtensions(value: unknown, path: string): void {
        if (value === undefined) return;
        if (!isRecord(value)) {
            this.add(path, 'INVALID_TYPE', 'Extensions must be a JSON object.');
            return;
        }
        const visitKeys = (object: AnyRecord, objectPath: string) => {
            Object.entries(object).forEach(([key, child]) => {
                if (SENSITIVE_EXTENSION_KEYS.has(normalizeSensitiveKey(key))) this.add(fieldPath(objectPath, key), 'FORBIDDEN_FIELD', 'Secrets and credential references are not allowed in extensions.');
                if (isRecord(child)) visitKeys(child, fieldPath(objectPath, key));
                else if (Array.isArray(child)) child.forEach((item, index) => { if (isRecord(item)) visitKeys(item, `${fieldPath(objectPath, key)}[${index}]`); });
            });
        };
        visitKeys(value, path);
        this.validateJson(value, path, 0, EXCHANGE_LIMITS.maxSummaryChars);
    }

    validateJson(value: unknown, path: string, depth: number, maxStringChars: number): void {
        if (depth > EXCHANGE_LIMITS.maxJsonDepth) {
            this.add(path, 'LIMIT_EXCEEDED', `JSON nesting cannot exceed ${EXCHANGE_LIMITS.maxJsonDepth} levels.`);
            return;
        }
        if (value === null || typeof value === 'boolean') return;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) this.add(path, 'INVALID_VALUE', 'JSON numbers must be finite.');
            return;
        }
        if (typeof value === 'string') {
            if (textLength(value) > maxStringChars) this.add(path, 'LIMIT_EXCEEDED', `Text length cannot exceed ${maxStringChars} characters.`);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach((child, index) => this.validateJson(child, `${path}[${index}]`, depth + 1, maxStringChars));
            return;
        }
        if (!isRecord(value)) {
            this.add(path, 'INVALID_TYPE', 'Only JSON values are allowed.');
            return;
        }
        this.objectCount += 1;
        if (this.objectCount > EXCHANGE_LIMITS.maxJsonObjects) {
            this.add(path, 'LIMIT_EXCEEDED', `The export contains more than ${EXCHANGE_LIMITS.maxJsonObjects} JSON objects.`);
            return;
        }
        Object.entries(value).forEach(([key, child]) => {
            if (SENSITIVE_EXTENSION_KEYS.has(normalizeSensitiveKey(key))) {
                this.add(fieldPath(path, key), 'FORBIDDEN_FIELD', 'Secrets and credential references are not allowed in a work export.');
            }
            this.validateJson(child, fieldPath(path, key), depth + 1, maxStringChars);
        });
    }

    requiredStringArray(parent: AnyRecord | undefined, key: string, path: string, maxItems: number, maxChars: number, minChars = 0): string[] | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (!Array.isArray(value)) {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected a string array.');
            return undefined;
        }
        if (value.length > maxItems) this.add(fieldPath(path, key), 'LIMIT_EXCEEDED', `The array cannot contain more than ${maxItems} items.`);
        const result: string[] = [];
        value.forEach((item, index) => {
            const itemPath = `${fieldPath(path, key)}[${index}]`;
            if (typeof item !== 'string') this.add(itemPath, 'INVALID_TYPE', 'Expected text.');
            else {
                const length = textLength(item);
                if (length < minChars || length > maxChars) this.add(itemPath, 'LIMIT_EXCEEDED', `Text length must be between ${minChars} and ${maxChars} characters.`);
                result.push(item);
            }
        });
        this.unique(result.map(id => ({ id })), fieldPath(path, key), item => item.id);
        return result;
    }

    requiredUuidArray(parent: AnyRecord | undefined, key: string, path: string, maxItems: number): string[] | undefined {
        const value = this.read(parent, key, path);
        if (value === undefined) return undefined;
        if (!Array.isArray(value)) {
            this.add(fieldPath(path, key), 'INVALID_TYPE', 'Expected a UUID array.');
            return undefined;
        }
        if (value.length > maxItems) this.add(fieldPath(path, key), 'LIMIT_EXCEEDED', `The array cannot contain more than ${maxItems} items.`);
        const result: string[] = [];
        value.forEach((item, index) => {
            if (typeof item !== 'string' || !isCanonicalUuid(item)) this.add(`${fieldPath(path, key)}[${index}]`, 'INVALID_VALUE', 'Expected a canonical lowercase UUID.');
            else result.push(item);
        });
        this.unique(result.map(id => ({ id })), fieldPath(path, key), item => item.id);
        return result;
    }

    validateHandleConfig(value: unknown, path: string): Partial<HandleConfig> | null {
        if (value === null) return null;
        if (value === undefined) {
            this.add(path, 'MISSING_FIELD', 'Required field is missing.');
            return null;
        }
        if (!isRecord(value)) {
            this.add(path, 'INVALID_TYPE', 'handleConfig must be an object or null.');
            return null;
        }
        Object.entries(value).forEach(([side, mode]) => {
            if (!HANDLE_SIDES.includes(side as typeof HANDLE_SIDES[number])) this.add(fieldPath(path, side), 'INVALID_VALUE', 'Unknown handle side.');
            else if (typeof mode !== 'string' || !HANDLE_MODES.includes(mode as typeof HANDLE_MODES[number])) this.add(fieldPath(path, side), 'INVALID_VALUE', 'Unknown handle mode.');
        });
        return value as Partial<HandleConfig>;
    }

    sortedStrings(values: string[], path: string): void {
        for (let index = 1; index < values.length; index += 1) {
            if (compareStrings(values[index - 1], values[index]) > 0) {
                this.add(path, 'UNSORTED', 'IDs must be sorted lexicographically for deterministic exchange output.');
                return;
            }
        }
    }

    sortedBy<T>(values: T[], path: string, compare: (left: T, right: T) => number, description: string): void {
        for (let index = 1; index < values.length; index += 1) {
            if (compare(values[index - 1], values[index]) > 0) {
                this.add(path, 'UNSORTED', `Items must be sorted by ${description}.`);
                return;
            }
        }
    }

    unique<T>(values: T[], path: string, keyOf: (value: T) => string): void {
        const seen = new Set<string>();
        values.forEach((value, index) => {
            const key = keyOf(value);
            if (seen.has(key)) this.add(`${path}[${index}]`, 'INVALID_VALUE', `Duplicate ID ${key}.`);
            seen.add(key);
        });
    }
}
