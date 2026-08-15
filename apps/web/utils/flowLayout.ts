import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

// Define node width and height for Dagre layout calculation
// Corresponds to CharacterNode.tsx actual render size
const NODE_WIDTH = 220; // Slightly increased for extra space
const NODE_HEIGHT = 100;

export const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({
        rankdir: direction,
        // Optimization strategy 2: Significantly increase spacing to reduce line crossing nodes
        nodesep: 80, // Same layer node spacing (original 50)
        ranksep: 150, // Level spacing (original 100)
        // Try different alignment options
        align: 'DL' // Down Left
    });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);

        node.position = {
            x: nodeWithPosition.x - NODE_WIDTH / 2,
            y: nodeWithPosition.y - NODE_HEIGHT / 2,
        };

        return node;
    });

    return { nodes: layoutedNodes, edges };
};
