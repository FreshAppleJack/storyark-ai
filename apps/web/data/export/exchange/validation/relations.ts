import { EXCHANGE_LIMITS } from '../limits';
import type { ExchangeForeshadowing, ExchangeGraph, ExchangeGraphEdge, ExchangeGraphNode } from '../types';
import { compareStrings, type ValidationContext } from './core';

function validateGraphNode(context: ValidationContext, value: unknown, path: string): ExchangeGraphNode | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['nodeKey', 'characterId', 'positionX', 'positionY', 'handleConfig', 'createdAt', 'updatedAt', 'extensions']), path);
    const nodeKey = context.requiredUuid(object, 'nodeKey', path);
    const characterId = context.requiredUuid(object, 'characterId', path);
    const positionX = context.requiredNumber(object, 'positionX', path, -EXCHANGE_LIMITS.maxCoordinate, EXCHANGE_LIMITS.maxCoordinate);
    const positionY = context.requiredNumber(object, 'positionY', path, -EXCHANGE_LIMITS.maxCoordinate, EXCHANGE_LIMITS.maxCoordinate);
    const handleConfig = context.validateHandleConfig(object.handleConfig, `${path}.handleConfig`);
    const createdAt = context.optionalTimestamp(object, 'createdAt', path);
    const updatedAt = context.optionalTimestamp(object, 'updatedAt', path);
    if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) context.add(path, 'INVALID_VALUE', 'updatedAt cannot be earlier than createdAt.');
    if (!nodeKey || !characterId || positionX === undefined || positionY === undefined) return undefined;
    return { nodeKey, characterId, positionX, positionY, handleConfig, ...(createdAt === undefined ? {} : { createdAt }), ...(updatedAt === undefined ? {} : { updatedAt }) };
}

function validateGraphEdge(context: ValidationContext, value: unknown, path: string): ExchangeGraphEdge | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'sourceNodeKey', 'targetNodeKey', 'sourceHandle', 'targetHandle', 'label', 'createdAt', 'updatedAt', 'extensions']), path);
    const id = context.requiredUuid(object, 'id', path);
    const sourceNodeKey = context.requiredUuid(object, 'sourceNodeKey', path);
    const targetNodeKey = context.requiredUuid(object, 'targetNodeKey', path);
    const sourceHandle = context.requiredString(object, 'sourceHandle', path, EXCHANGE_LIMITS.maxReferenceChars);
    const targetHandle = context.requiredString(object, 'targetHandle', path, EXCHANGE_LIMITS.maxReferenceChars);
    const label = context.requiredString(object, 'label', path, EXCHANGE_LIMITS.maxLabelChars);
    const createdAt = context.optionalTimestamp(object, 'createdAt', path);
    const updatedAt = context.optionalTimestamp(object, 'updatedAt', path);
    if (createdAt !== undefined && updatedAt !== undefined && updatedAt < createdAt) context.add(path, 'INVALID_VALUE', 'updatedAt cannot be earlier than createdAt.');
    if (!id || !sourceNodeKey || !targetNodeKey || sourceHandle === undefined || targetHandle === undefined || label === undefined) return undefined;
    if (sourceNodeKey === targetNodeKey) context.add(path, 'INVALID_VALUE', 'Graph edges cannot connect a node to itself.');
    return { id, sourceNodeKey, targetNodeKey, sourceHandle, targetHandle, label, ...(createdAt === undefined ? {} : { createdAt }), ...(updatedAt === undefined ? {} : { updatedAt }) };
}

function validateGraph(context: ValidationContext, value: unknown, path: string): ExchangeGraph | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['bookId', 'databaseVersion', 'createdAt', 'updatedAt', 'nodes', 'edges', 'extensions']), path);
    const metadata = context.validateMetadata(object, path);
    const bookId = context.requiredUuid(object, 'bookId', path);
    const nodesValue = context.requiredArray(object, 'nodes', path);
    const edgesValue = context.requiredArray(object, 'edges', path);
    if (nodesValue && nodesValue.length > EXCHANGE_LIMITS.maxGraphNodes) context.add(`${path}.nodes`, 'LIMIT_EXCEEDED', `A graph cannot contain more than ${EXCHANGE_LIMITS.maxGraphNodes} nodes.`);
    if (edgesValue && edgesValue.length > EXCHANGE_LIMITS.maxGraphEdges) context.add(`${path}.edges`, 'LIMIT_EXCEEDED', `A graph cannot contain more than ${EXCHANGE_LIMITS.maxGraphEdges} edges.`);
    const nodes = nodesValue?.map((item, index) => validateGraphNode(context, item, `${path}.nodes[${index}]`)).filter((item): item is ExchangeGraphNode => item !== undefined);
    const edges = edgesValue?.map((item, index) => validateGraphEdge(context, item, `${path}.edges[${index}]`)).filter((item): item is ExchangeGraphEdge => item !== undefined);
    if (nodes) { context.unique(nodes, `${path}.nodes`, item => item.nodeKey); context.sortedBy(nodes, `${path}.nodes`, (left, right) => compareStrings(left.nodeKey, right.nodeKey), 'nodeKey'); }
    if (edges) { context.unique(edges, `${path}.edges`, item => item.id); context.sortedBy(edges, `${path}.edges`, (left, right) => compareStrings(left.id, right.id), 'id'); }
    if (!metadata || !bookId || !nodes || !edges) return undefined;
    return { ...metadata, bookId, nodes, edges };
}

export function validateGraphs(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeGraph[] | undefined {
    if (!values) return undefined;
    const result = values.map((value, index) => validateGraph(context, value, `${path}[${index}]`)).filter((value): value is ExchangeGraph => value !== undefined);
    if (result.length > 1) context.add(path, 'INVALID_VALUE', 'Version 1 supports at most one graph per book.');
    context.unique(result, path, item => item.bookId);
    context.sortedBy(result, path, (left, right) => compareStrings(left.bookId, right.bookId), 'bookId');
    return result;
}

function validateForeshadowing(context: ValidationContext, value: unknown, path: string): ExchangeForeshadowing | undefined {
    const object = context.requiredObjectValue(value, path);
    if (!object) return undefined;
    context.unknownFields(object, new Set(['id', 'chapterId', 'excerpt', 'note', 'isRecovered', 'databaseVersion', 'createdAt', 'updatedAt', 'extensions']), path);
    const metadata = context.validateMetadata(object, path);
    const id = context.requiredString(object, 'id', path, EXCHANGE_LIMITS.maxReferenceChars, 1);
    const chapterId = context.requiredUuid(object, 'chapterId', path);
    const excerpt = context.requiredString(object, 'excerpt', path, EXCHANGE_LIMITS.maxSummaryChars);
    const note = context.requiredString(object, 'note', path, EXCHANGE_LIMITS.maxSummaryChars);
    const isRecoveredValue = object.isRecovered;
    const isRecovered = isRecoveredValue === undefined ? undefined : typeof isRecoveredValue === 'boolean' ? isRecoveredValue : undefined;
    if (isRecoveredValue !== undefined && isRecovered === undefined) context.add(`${path}.isRecovered`, 'INVALID_TYPE', 'isRecovered must be a boolean.');
    if (!metadata || id === undefined || !chapterId || excerpt === undefined || note === undefined) return undefined;
    return { ...metadata, id, chapterId, excerpt, note, ...(isRecovered === undefined ? {} : { isRecovered }) };
}

export function validateForeshadowings(context: ValidationContext, values: unknown[] | undefined, path: string): ExchangeForeshadowing[] | undefined {
    if (!values) return undefined;
    if (values.length > EXCHANGE_LIMITS.maxNotes) context.add(path, 'LIMIT_EXCEEDED', `An export cannot contain more than ${EXCHANGE_LIMITS.maxNotes} foreshadowing notes.`);
    const result = values.map((value, index) => validateForeshadowing(context, value, `${path}[${index}]`)).filter((value): value is ExchangeForeshadowing => value !== undefined);
    context.unique(result, path, item => item.id);
    return result;
}
