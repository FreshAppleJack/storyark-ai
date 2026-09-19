import { EXCHANGE_LIMITS, MAX_ASSET_BASE64_CHARS } from '../limits';
import type { ExchangeAsset } from '../types';
import { MIME_PATTERN, SHA256_PATTERN, type ValidationContext } from './core';

export function validateAssets(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeAsset[] | undefined {
    if (!values) return undefined;
    if (values.length > 0) context.add(path, 'UNSUPPORTED_ASSET', 'Embedded assets are not supported by this importer yet.');
    if (values.length > EXCHANGE_LIMITS.maxAssets) context.add(path, 'LIMIT_EXCEEDED', `An export cannot contain more than ${EXCHANGE_LIMITS.maxAssets} assets.`);
    const result = values.map((value, index) => validateAsset(context, value, `${path}[${index}]`)).filter((value): value is ExchangeAsset => value !== undefined);
    context.unique(result, path, item => item.id);
    const totalSize = result.reduce((total, asset) => total + asset.size, 0);
    if (totalSize > EXCHANGE_LIMITS.maxTotalAssetBytes) context.add(path, 'LIMIT_EXCEEDED', `Embedded assets cannot exceed ${EXCHANGE_LIMITS.maxTotalAssetBytes} bytes in total.`);
    return result;
}

function validateAsset(context: ValidationContext, value: unknown, path: string): ExchangeAsset | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'name', 'mimeType', 'size', 'sha256', 'bytes', 'encoding', 'extensions']), path);
    if (Object.keys(object).some(key => /(?:path|url|uri)$/i.test(key))) context.add(path, 'FORBIDDEN_FIELD', 'Assets must not contain local paths or remote URLs.');
    const id = context.requiredUuid(object, 'id', path);
    const name = context.optionalString(object, 'name', path, EXCHANGE_LIMITS.maxAssetNameChars);
    const mimeType = context.requiredString(object, 'mimeType', path, EXCHANGE_LIMITS.maxMimeTypeChars, 3);
    if (mimeType !== undefined && (!MIME_PATTERN.test(mimeType) || mimeType.includes(';'))) context.add(`${path}.mimeType`, 'INVALID_VALUE', 'mimeType must be a simple media type without parameters.');
    const size = context.requiredInteger(object, 'size', path, 0, EXCHANGE_LIMITS.maxAssetBytes);
    const sha256 = context.requiredString(object, 'sha256', path, EXCHANGE_LIMITS.maxHashChars, EXCHANGE_LIMITS.maxHashChars);
    if (sha256 !== undefined && !SHA256_PATTERN.test(sha256)) context.add(`${path}.sha256`, 'INVALID_VALUE', 'sha256 must be 64 lowercase hexadecimal characters.');
    const bytes = context.requiredString(object, 'bytes', path, MAX_ASSET_BASE64_CHARS);
    const encoding = context.enumValue(object, 'encoding', path, ['base64'] as const);
    if (bytes !== undefined && !validBase64(bytes)) context.add(`${path}.bytes`, 'INVALID_VALUE', 'bytes must be valid base64 without a local path or URL.');
    if (bytes !== undefined && size !== undefined && base64Size(bytes) !== size) context.add(`${path}.size`, 'INVALID_VALUE', 'size must equal the decoded byte length of bytes.');
    if (!id || mimeType === undefined || size === undefined || sha256 === undefined || bytes === undefined || !encoding) return undefined;
    return { id, ...(name === undefined ? {} : { name }), mimeType, size, sha256, bytes, encoding };
}

function validBase64(value: string): boolean {
    if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
    try {
        atob(value);
        return true;
    } catch {
        return false;
    }
}

function base64Size(value: string): number {
    if (!value) return 0;
    const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
    return (value.length / 4) * 3 - padding;
}
