import { EXCHANGE_LIMITS, STORYARK_EXPORT_CONTENT_VERSION } from '../limits';
import type { ExchangeContentBody, TiptapDocument } from '../types';
import {
    CONTENT_FORMATS,
    CONTENT_STATES,
    fieldPath,
    isCanonicalUuid,
    isRecord,
    LEGACY_CONTENT_FORMATS,
    type AnyRecord,
    type ValidationContext,
} from './core';

const NODE_TYPES = new Set([
    'doc', 'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList',
    'listItem', 'codeBlock', 'horizontalRule', 'text', 'mention', 'hardBreak',
]);
const BLOCK_TYPES = new Set([
    'paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList',
    'codeBlock', 'horizontalRule',
]);
const INLINE_TYPES = new Set(['text', 'mention', 'hardBreak']);
const NODE_ATTRIBUTES: Record<string, readonly string[]> = {
    doc: [], paragraph: ['textAlign'], heading: ['level', 'textAlign'],
    blockquote: [], bulletList: [], orderedList: ['start', 'type'], listItem: [],
    codeBlock: ['language'], horizontalRule: [], text: [], mention: ['id', 'label', 'color', 'mentionSuggestionChar', 'characterId'],
    hardBreak: [],
};
const MARK_ATTRIBUTES: Record<string, readonly string[]> = {
    bold: [], italic: [], strike: [], underline: [], code: [], ignoreAutoHighlight: [],
    textStyle: ['fontFamily', 'fontSize'], foreshadowing: ['id'],
    link: ['href', 'target', 'rel', 'class'],
};

export const validateContentBody = (
    context: ValidationContext,
    value: unknown,
    path: string,
    chapterId: string,
): ExchangeContentBody | undefined => {
    if (value === undefined) {
        context.add(path, 'MISSING_FIELD', 'Required field is missing.');
        return undefined;
    }
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['format', 'version', 'content', 'contentState', 'originalContent', 'originalFormat', 'extensions']), path);
    const format = context.enumValue(object, 'format', path, CONTENT_FORMATS);
    const version = context.requiredInteger(object, 'version', path, 0, 1);
    const contentState = context.enumValue(object, 'contentState', path, CONTENT_STATES);
    if (!format || version === undefined || !contentState) return undefined;

    const originalContent = context.optionalString(object, 'originalContent', path, EXCHANGE_LIMITS.maxContentBytes);
    const originalFormat = object.originalFormat === undefined
        ? undefined
        : context.enumValue(object, 'originalFormat', path, LEGACY_CONTENT_FORMATS);
    if ((originalContent === undefined) !== (originalFormat === undefined)) {
        context.add(path, 'INVALID_VALUE', 'originalContent and originalFormat must be supplied together.');
    }

    if (format === 'tiptap-json') {
        if (version !== STORYARK_EXPORT_CONTENT_VERSION) context.add(`${path}.version`, 'UNSUPPORTED_VERSION', 'tiptap-json requires version 1.');
        const content = context.requiredObject(object, 'content', path);
        if (!content) return undefined;
        context.validateJson(content, `${path}.content`, 0, EXCHANGE_LIMITS.maxContentBytes);
        const scan = scanTiptapDocument(context, content, `${path}.content`, chapterId);
        if (scan.unsafe && contentState === 'editable') {
            context.add(`${path}.contentState`, 'UNSAFE_CONTENT', 'Unknown Tiptap nodes, marks or attributes require read-only or pending-migration state.');
        }
        return {
            format, version: 1, content: content as TiptapDocument, contentState,
            ...(originalContent === undefined ? {} : { originalContent }),
            ...(originalFormat === undefined ? {} : { originalFormat }),
        };
    }

    if (version !== 0) context.add(`${path}.version`, 'UNSUPPORTED_VERSION', 'Legacy content requires version 0.');
    const content = context.requiredString(object, 'content', path, EXCHANGE_LIMITS.maxContentBytes);
    const requiredOriginalContent = context.requiredString(object, 'originalContent', path, EXCHANGE_LIMITS.maxContentBytes);
    const requiredOriginalFormat = context.enumValue(object, 'originalFormat', path, LEGACY_CONTENT_FORMATS);
    if (contentState === 'editable') context.add(`${path}.contentState`, 'UNSAFE_CONTENT', 'Legacy content cannot be marked editable.');
    if (requiredOriginalFormat !== undefined && requiredOriginalFormat !== format) context.add(`${path}.originalFormat`, 'INVALID_VALUE', 'Legacy originalFormat must match format.');
    if (content === undefined || requiredOriginalContent === undefined || !requiredOriginalFormat) return undefined;
    return {
        format, version: 0, content,
        contentState: contentState as 'read-only' | 'pending-migration',
        originalContent: requiredOriginalContent,
        originalFormat: requiredOriginalFormat,
    };
};

function scanTiptapDocument(
    context: ValidationContext,
    document: AnyRecord,
    path: string,
    chapterId: string,
): { unsafe: boolean } {
    let unsafe = false;
    const visit = (nodeValue: unknown, nodePath: string, depth: number) => {
        if (!isRecord(nodeValue)) {
            context.add(nodePath, 'INVALID_TYPE', 'Tiptap content nodes must be objects.');
            return;
        }
        const type = nodeValue.type;
        if (typeof type !== 'string' || type.length === 0) {
            context.add(fieldPath(nodePath, 'type'), 'INVALID_TYPE', 'Tiptap nodes require a type.');
            return;
        }
        const knownNode = NODE_TYPES.has(type);
        if (!knownNode) unsafe = true;
        if (Object.keys(nodeValue).some(key => !['type', 'attrs', 'marks', 'content', 'text'].includes(key))) unsafe = true;

        const attrs = nodeValue.attrs;
        if (attrs !== undefined) {
            if (!isRecord(attrs)) context.add(fieldPath(nodePath, 'attrs'), 'INVALID_TYPE', 'Tiptap attrs must be an object.');
            else if (knownNode && Object.keys(attrs).some(key => !NODE_ATTRIBUTES[type].includes(key))) unsafe = true;
        }

        const marks = nodeValue.marks;
        if (marks !== undefined) {
            if (!Array.isArray(marks)) context.add(fieldPath(nodePath, 'marks'), 'INVALID_TYPE', 'Tiptap marks must be an array.');
            else {
                const seen = new Set<string>();
                marks.forEach((markValue, index) => {
                    const markPath = `${nodePath}.marks[${index}]`;
                    if (!isRecord(markValue)) {
                        context.add(markPath, 'INVALID_TYPE', 'Tiptap marks must be objects.');
                        return;
                    }
                    const markType = markValue.type;
                    if (typeof markType !== 'string' || markType.length === 0) {
                        context.add(fieldPath(markPath, 'type'), 'INVALID_TYPE', 'Tiptap marks require a type.');
                        return;
                    }
                    if (seen.has(markType)) context.add(markPath, 'INVALID_VALUE', 'A Tiptap node cannot repeat the same mark.');
                    seen.add(markType);
                    const knownMark = Object.prototype.hasOwnProperty.call(MARK_ATTRIBUTES, markType);
                    if (!knownMark) unsafe = true;
                    const markAttrs = markValue.attrs;
                    if (markAttrs !== undefined) {
                        if (!isRecord(markAttrs)) context.add(fieldPath(markPath, 'attrs'), 'INVALID_TYPE', 'Tiptap mark attrs must be an object.');
                        else if (knownMark && Object.keys(markAttrs).some(key => !MARK_ATTRIBUTES[markType].includes(key))) unsafe = true;
                    }
                    if (markType === 'foreshadowing') {
                        const id = isRecord(markAttrs) && typeof markAttrs.id === 'string' ? markAttrs.id : undefined;
                        if (!id || id.length === 0 || id.length > EXCHANGE_LIMITS.maxReferenceChars) context.add(`${markPath}.attrs.id`, 'INVALID_VALUE', 'A foreshadowing mark requires a non-empty note ID.');
                        else context.foreshadowingMarks.push({ id, chapterId, path: `${markPath}.attrs.id` });
                    }
                });
                if (!INLINE_TYPES.has(type) && knownNode) context.add(`${nodePath}.marks`, 'INVALID_VALUE', 'Only inline Tiptap nodes may carry marks.');
            }
        }

        if (type === 'mention') {
            const id = isRecord(attrs) && typeof attrs.id === 'string' ? attrs.id : undefined;
            if (!id || id.length === 0 || id.length > EXCHANGE_LIMITS.maxReferenceChars) context.add(`${nodePath}.attrs.id`, 'INVALID_VALUE', 'A mention requires a non-empty character association ID.');
            else if (isCanonicalUuid(id)) context.canonicalMentionIds.push({ id, chapterId, path: `${nodePath}.attrs.id` });
            if (isRecord(attrs) && attrs.characterId !== undefined && typeof attrs.characterId !== 'string') context.add(`${nodePath}.attrs.characterId`, 'INVALID_TYPE', 'Mention characterId must be a UUID when present.');
            else if (isRecord(attrs) && typeof attrs.characterId === 'string') {
                if (!isCanonicalUuid(attrs.characterId)) context.add(`${nodePath}.attrs.characterId`, 'INVALID_VALUE', 'Mention characterId must be a canonical UUID.');
                else context.canonicalMentionIds.push({ id: attrs.characterId, chapterId, path: `${nodePath}.attrs.characterId` });
            }
        }

        if (type === 'doc' && depth !== 0) context.add(nodePath, 'INVALID_VALUE', 'Only the root Tiptap node may have type doc.');
        if (type === 'heading' && isRecord(attrs) && attrs.level !== undefined
            && (typeof attrs.level !== 'number' || !Number.isInteger(attrs.level) || attrs.level < 1 || attrs.level > 6)) {
            context.add(`${nodePath}.attrs.level`, 'INVALID_VALUE', 'Heading level must be an integer from 1 to 6.');
        }
        if (type === 'text') {
            if (typeof nodeValue.text !== 'string' || nodeValue.text.length === 0) context.add(fieldPath(nodePath, 'text'), 'INVALID_VALUE', 'Text nodes require non-empty text.');
            if (nodeValue.content !== undefined) context.add(fieldPath(nodePath, 'content'), 'INVALID_VALUE', 'Text nodes cannot contain children.');
        } else if (nodeValue.text !== undefined) context.add(fieldPath(nodePath, 'text'), 'INVALID_VALUE', 'Only text nodes may contain text.');
        if (INLINE_TYPES.has(type) && nodeValue.content !== undefined) context.add(fieldPath(nodePath, 'content'), 'INVALID_VALUE', 'Inline nodes cannot contain children.');

        const children = nodeValue.content;
        if (children !== undefined) {
            if (!Array.isArray(children)) context.add(fieldPath(nodePath, 'content'), 'INVALID_TYPE', 'Tiptap content must be an array.');
            else {
                if (['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(type) && children.length === 0) context.add(fieldPath(nodePath, 'content'), 'INVALID_VALUE', 'This Tiptap container cannot be empty.');
                children.forEach((child, index) => {
                    if (knownNode && !allowedChild(type, child)) context.add(`${nodePath}.content[${index}]`, 'INVALID_VALUE', `Invalid child for Tiptap node ${type}.`);
                    visit(child, `${nodePath}.content[${index}]`, depth + 1);
                });
            }
        } else if (['doc', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(type)) {
            context.add(fieldPath(nodePath, 'content'), 'INVALID_VALUE', 'This Tiptap container requires children.');
        }
    };

    if (document.type !== 'doc') context.add(fieldPath(path, 'type'), 'INVALID_VALUE', 'Tiptap document root must have type doc.');
    visit(document, path, 0);
    return { unsafe };
}

function allowedChild(parentType: string, child: unknown): boolean {
    if (!isRecord(child) || typeof child.type !== 'string') return false;
    if (parentType === 'doc' || parentType === 'blockquote') return BLOCK_TYPES.has(child.type);
    if (parentType === 'paragraph' || parentType === 'heading') return INLINE_TYPES.has(child.type);
    if (parentType === 'codeBlock') return child.type === 'text' && child.marks === undefined;
    if (parentType === 'bulletList' || parentType === 'orderedList') return child.type === 'listItem';
    if (parentType === 'listItem') return child.type === 'paragraph' || BLOCK_TYPES.has(child.type);
    return true;
}
