import { MarkerType, type Edge, type Node, type XYPosition } from '@xyflow/react';
import type { Character, HandleConfig } from '../../types';
import type { GraphData } from '../../data/dto';
import { normalizeHandleConfig } from '../../domain/relationshipHandles';
export { normalizeHandleConfig } from '../../domain/relationshipHandles';

export type RelationshipNode = Node<Character & Record<string, unknown>, 'character'>;
export const relationshipEdgeStyle = {
    type: 'smoothstep', animated: true, markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#64748b', strokeWidth: 2 }, labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 12 },
    labelBgStyle: { fill: '#f1f5f9', fillOpacity: 0.9 }, labelBgPadding: [4, 2] as [number, number], labelBgBorderRadius: 4,
};

export function createCharacterNode(character: Character, id: string, position: XYPosition): RelationshipNode {
    return { id, type: 'character', position, data: { ...character, handleConfig: normalizeHandleConfig(character.handleConfig) } };
}

/** A null response is a load failure, never a request to seed a new graph. */
export function toRelationshipGraph(graph: GraphData | null, characters: Character[]): { nodes: RelationshipNode[]; edges: Edge[] } {
    if (!graph) throw new Error('Relationship graph is unavailable');
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error('Invalid relationship graph response');
    if (!graph.nodes.length) return {
        nodes: characters.map((character, index) => createCharacterNode(character, character.id,
            { x: character.positionX ?? index * 250, y: character.positionY ?? 50 })), edges: [],
    };
    return {
        nodes: graph.nodes.map(node => {
            const character = characters.find(item => item.id === String(node.characterId));
            return {
                id: node.nodeKey, type: 'character', position: { x: node.positionX, y: node.positionY },
                data: {
                    id: String(node.characterId), bookId: character?.bookId || '',
                    name: node.name || character?.name || 'Unknown', role: node.role || character?.role || 'supporting',
                    color: node.color || character?.color || '#3b82f6', avatar: node.avatar || character?.avatar,
                    aliases: character?.aliases || [], tags: character?.tags || [], description: character?.description || '',
                    handleConfig: normalizeHandleConfig(node.handleConfig)
                }
            };
        }),
        edges: graph.edges.map(edge => ({
            ...relationshipEdgeStyle,
            id: edge.id ? String(edge.id) : `e-${edge.sourceNodeKey}-${edge.targetNodeKey}-${edge.sourceHandle || 'null'}-${edge.targetHandle || 'null'}`,
            source: edge.sourceNodeKey || String(edge.sourceCharId), target: edge.targetNodeKey || String(edge.targetCharId),
            sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, label: edge.label,
        })),
    };
}

export function filterEdgesForHandles(edges: Edge[], nodeId: string, config: HandleConfig): Edge[] {
    return edges.filter(edge => {
        if (edge.source === nodeId && edge.sourceHandle) {
            const mode = config[edge.sourceHandle.split('-')[0] as keyof HandleConfig];
            if (mode !== 'source' && mode !== 'both') return false;
        }
        if (edge.target === nodeId && edge.targetHandle) {
            const mode = config[edge.targetHandle.split('-')[0] as keyof HandleConfig];
            if (mode !== 'target' && mode !== 'both') return false;
        }
        return true;
    });
}
