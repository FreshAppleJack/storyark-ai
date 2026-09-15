import { EXCHANGE_LIMITS } from '../limits';
import type {
    ExchangeBook,
    ExchangeChapter,
    ExchangeCharacter,
    ExchangeVolume,
} from '../types';
import {
    CHARACTER_ROLES,
    comparePositionAndId,
    type ValidationContext,
} from './core';
import { validateContentBody } from './content';

export function validateBook(context: ValidationContext, value: Record<string, unknown> | undefined, path: string): ExchangeBook | undefined {
    if (!value) return undefined;
    context.unknownFields(value, new Set(['id', 'title', 'author', 'status', 'position', 'isReadOnly', 'coverColor', 'databaseVersion', 'createdAt', 'updatedAt', 'extensions']), path);
    const metadata = context.validateMetadata(value, path);
    const id = context.requiredUuid(value, 'id', path);
    const title = context.requiredString(value, 'title', path, EXCHANGE_LIMITS.maxTitleChars, 1);
    const author = context.requiredString(value, 'author', path, EXCHANGE_LIMITS.maxAuthorChars);
    const status = context.enumValue(value, 'status', path, ['serializing', 'completed'] as const);
    const position = context.requiredInteger(value, 'position', path, 0, EXCHANGE_LIMITS.maxPosition);
    const isReadOnly = context.requiredBoolean(value, 'isReadOnly', path);
    const coverColor = context.optionalString(value, 'coverColor', path, EXCHANGE_LIMITS.maxColorChars);
    if (!metadata || !id || title === undefined || author === undefined || !status || position === undefined || isReadOnly === undefined) return undefined;
    return { ...metadata, id, title, author, status, position, isReadOnly, ...(coverColor === undefined ? {} : { coverColor }) };
}

function validateVolume(context: ValidationContext, value: unknown, path: string): ExchangeVolume | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'bookId', 'title', 'status', 'position', 'isReadOnly', 'databaseVersion', 'createdAt', 'updatedAt', 'extensions']), path);
    const metadata = context.validateMetadata(object, path);
    const id = context.requiredUuid(object, 'id', path);
    const bookId = context.requiredUuid(object, 'bookId', path);
    const title = context.requiredString(object, 'title', path, EXCHANGE_LIMITS.maxTitleChars, 1);
    const status = context.enumValue(object, 'status', path, ['draft', 'published'] as const);
    const position = context.requiredInteger(object, 'position', path, 0, EXCHANGE_LIMITS.maxPosition);
    const isReadOnly = context.requiredBoolean(object, 'isReadOnly', path);
    if (!metadata || !id || !bookId || title === undefined || !status || position === undefined || isReadOnly === undefined) return undefined;
    return { ...metadata, id, bookId, title, status, position, isReadOnly };
}

export function validateVolumes(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeVolume[] | undefined {
    if (!values) return undefined;
    const result = values.map((value, index) => validateVolume(context, value, `${path}[${index}]`)).filter((value): value is ExchangeVolume => value !== undefined);
    context.unique(result, path, item => item.id);
    context.sortedBy(result, path, comparePositionAndId, 'position then id');
    return result;
}

function validateChapter(context: ValidationContext, value: unknown, path: string): ExchangeChapter | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'bookId', 'volumeId', 'title', 'status', 'position', 'isReadOnly', 'wordCount', 'body', 'foreshadowingIds', 'databaseVersion', 'createdAt', 'updatedAt', 'extensions']), path);
    const metadata = context.validateMetadata(object, path);
    const id = context.requiredUuid(object, 'id', path);
    const bookId = context.requiredUuid(object, 'bookId', path);
    const volumeId = context.requiredUuid(object, 'volumeId', path);
    const title = context.requiredString(object, 'title', path, EXCHANGE_LIMITS.maxTitleChars, 1);
    const status = context.enumValue(object, 'status', path, ['draft', 'published'] as const);
    const position = context.requiredInteger(object, 'position', path, 0, EXCHANGE_LIMITS.maxPosition);
    const isReadOnly = context.requiredBoolean(object, 'isReadOnly', path);
    const wordCount = context.requiredInteger(object, 'wordCount', path, 0, Number.MAX_SAFE_INTEGER);
    const foreshadowingIds = context.requiredStringArray(object, 'foreshadowingIds', path, EXCHANGE_LIMITS.maxNotes, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const body = validateContentBody(context, object.body, `${path}.body`, id ?? '');
    if (foreshadowingIds) context.sortedStrings(foreshadowingIds, `${path}.foreshadowingIds`);
    if (!metadata || !id || !bookId || !volumeId || title === undefined || !status || position === undefined || isReadOnly === undefined || wordCount === undefined || !foreshadowingIds || !body) return undefined;
    return { ...metadata, id, bookId, volumeId, title, status, position, isReadOnly, wordCount, body, foreshadowingIds };
}

export function validateChapters(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeChapter[] | undefined {
    if (!values) return undefined;
    const result = values.map((value, index) => validateChapter(context, value, `${path}[${index}]`)).filter((value): value is ExchangeChapter => value !== undefined);
    context.unique(result, path, item => item.id);
    return result;
}

function validateCharacter(context: ValidationContext, value: unknown, path: string): ExchangeCharacter | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'bookId', 'name', 'aliases', 'role', 'description', 'color', 'tags', 'avatar', 'handleConfig', 'isArchived', 'position', 'databaseVersion', 'createdAt', 'updatedAt', 'extensions']), path);
    const metadata = context.validateMetadata(object, path);
    const id = context.requiredUuid(object, 'id', path);
    const bookId = context.requiredUuid(object, 'bookId', path);
    const name = context.requiredString(object, 'name', path, EXCHANGE_LIMITS.maxTitleChars, 1);
    const aliases = context.requiredStringArray(object, 'aliases', path, EXCHANGE_LIMITS.maxAliases, EXCHANGE_LIMITS.maxAliasChars);
    const role = context.enumValue(object, 'role', path, CHARACTER_ROLES);
    const description = context.requiredString(object, 'description', path, EXCHANGE_LIMITS.maxDescriptionChars);
    const color = context.requiredString(object, 'color', path, EXCHANGE_LIMITS.maxColorChars, 1);
    const tags = context.requiredStringArray(object, 'tags', path, EXCHANGE_LIMITS.maxTags, EXCHANGE_LIMITS.maxTagChars);
    const avatarValue = context.read(object, 'avatar', path);
    const avatar = avatarValue === null ? null : typeof avatarValue === 'string' ? avatarValue : undefined;
    if (avatarValue !== null && avatar === undefined) context.add(`${path}.avatar`, 'INVALID_TYPE', 'avatar must be text or null.');
    if (typeof avatar === 'string' && avatar.length > EXCHANGE_LIMITS.maxAvatarChars) context.add(`${path}.avatar`, 'LIMIT_EXCEEDED', `Text length cannot exceed ${EXCHANGE_LIMITS.maxAvatarChars} characters.`);
    const handleConfig = context.validateHandleConfig(object.handleConfig, `${path}.handleConfig`);
    const isArchived = context.requiredBoolean(object, 'isArchived', path);
    const position = context.requiredInteger(object, 'position', path, 0, EXCHANGE_LIMITS.maxPosition);
    if (!metadata || !id || !bookId || name === undefined || !aliases || !role || description === undefined || color === undefined || !tags || avatar === undefined || isArchived === undefined || position === undefined) return undefined;
    return { ...metadata, id, bookId, name, aliases, role, description, color, tags, avatar, handleConfig, isArchived, position };
}

export function validateCharacters(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeCharacter[] | undefined {
    if (!values) return undefined;
    const result = values.map((value, index) => validateCharacter(context, value, `${path}[${index}]`)).filter((value): value is ExchangeCharacter => value !== undefined);
    context.unique(result, path, item => item.id);
    context.sortedBy(result, path, comparePositionAndId, 'position then id');
    return result;
}
