import type { Edge } from '@xyflow/react';
import type { Character } from '../../types';
import type { LocalGraph, LocalGraphEdge, LocalGraphNode } from '../../data/local/graphRepository';
import { createCharacterNode, normalizeHandleConfig, relationshipEdgeStyle, type RelationshipNode } from './graphModel';

export function projectLocalGraph(graph: LocalGraph, characters: Character[]) {
    return {
        nodes: graph.nodes.map(node => {
            const character = characters.find(item => item.id === node.characterId);
            if (!character) throw new Error('A graph character is unavailable. Reload before editing.');
            return createCharacterNode({ ...character, handleConfig: normalizeHandleConfig(node.handleConfig ?? character.handleConfig) },
                node.nodeKey, { x: node.positionX, y: node.positionY });
        }),
        edges: graph.edges.map(edge => ({ ...relationshipEdgeStyle, id: edge.id,
            source: edge.sourceNodeKey, target: edge.targetNodeKey, sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle, label: edge.label })),
    };
}

export function graphSnapshot(nodes: RelationshipNode[], edges: Edge[]): { nodes: LocalGraphNode[]; edges: LocalGraphEdge[] } {
    return {
        // A saved node owns a complete override. Character defaults are copied
        // when adding/loading a node, never written back from the graph.
        nodes: nodes.map(node => ({ nodeKey: node.id, characterId: node.data.id,
            positionX: node.position.x, positionY: node.position.y,
            handleConfig: normalizeHandleConfig(node.data.handleConfig) })),
        edges: edges.map(edge => ({ id: edge.id, sourceNodeKey: edge.source, targetNodeKey: edge.target,
            sourceHandle: edge.sourceHandle ?? '', targetHandle: edge.targetHandle ?? '',
            label: typeof edge.label === 'string' ? edge.label : '' })),
    };
}
