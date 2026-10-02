import React, { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, Panel } from '@xyflow/react';
import { MousePointer2 } from 'lucide-react';
import CharacterNode from '../../../components/flow/CharacterNode';
import NodeContextMenu from '../../../components/flow/NodeContextMenu';
import RelationshipEditDialog from '../../../components/flow/RelationshipEditDialog';
import type { RelationshipGraphEditor } from '../hooks/useRelationshipGraph';
const nodeTypes = { character: CharacterNode };
type Props = Pick<RelationshipGraphEditor, 'reactFlowWrapper' | 'nodes' | 'edges' | 'onNodesChange' | 'onEdgesChange' | 'onConnect' | 'onEdgeClick' | 'setReactFlowInstance' | 'onDrop' | 'onDragOver' | 'onNodeContextMenu' | 'onPaneClick' | 'menu' | 'setMenu' | 'updateNodeConfig' | 'dialogOpen' | 'dialogData' | 'setDialogOpen' | 'handleDialogSave' | 'editingEdgeId' | 'handleDialogDelete'> & { isDarkMode: boolean };
export function RelationshipCanvas({ reactFlowWrapper, nodes, edges, onNodesChange, onEdgesChange, onConnect, onEdgeClick, setReactFlowInstance, onDrop, onDragOver, onNodeContextMenu, onPaneClick, menu, setMenu, updateNodeConfig, dialogOpen, dialogData, setDialogOpen, handleDialogSave, editingEdgeId, handleDialogDelete, isDarkMode }: Props) {
    const [showTips, setShowTips] = useState(true);
    useEffect(() => { const timer = setTimeout(() => setShowTips(false), 8000); return () => clearTimeout(timer); }, []);
    return (
        <div className="flex-1 relative h-full" ref={reactFlowWrapper}>
            <ReactFlow
                colorMode={isDarkMode ? 'dark' : 'light'}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeClick={onEdgeClick}
                onInit={setReactFlowInstance}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onNodeContextMenu={onNodeContextMenu}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                fitView={nodes.length > 0 && !nodes.some(n => n.position.x !== 0)}
                attributionPosition="bottom-right"
            >
                <Background color={isDarkMode ? '#1e293b' : '#f1f5f9'} gap={20} size={1} />
                <Controls showInteractive={false} />
                <MiniMap
                    nodeColor={(n) => typeof n.data.color === 'string' ? n.data.color : '#eee'}
                    maskColor={isDarkMode ? 'rgba(15, 23, 42, 0.75)' : 'rgba(241, 245, 249, 0.7)'}
                    style={{ border: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0', background: isDarkMode ? '#0f172a' : '#ffffff' }}
                />

                {menu && (
                    <NodeContextMenu
                        id={menu.id}
                        top={menu.top}
                        left={menu.left}
                        config={menu.config}
                        onClose={() => setMenu(null)}
                        onChange={updateNodeConfig}
                    />
                )}

                <RelationshipEditDialog
                    isOpen={dialogOpen}
                    initialLabel={dialogData.label}
                    sourceName={dialogData.sourceName}
                    targetName={dialogData.targetName}
                    onClose={() => setDialogOpen(false)}
                    onSave={handleDialogSave}
                    onDelete={editingEdgeId ? handleDialogDelete : undefined}
                />

                <Panel
                    position="top-right"
                    className={`
                bg-white/90 dark:bg-slate-900/90 backdrop-blur p-3 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm text-xs text-slate-500 dark:text-slate-400 max-w-xs space-y-2
                transition-opacity duration-1000 ease-in-out
                ${showTips ? 'opacity-100' : 'opacity-0 pointer-events-none'}
            `}
                >
                    <div className="flex items-start gap-2">
                        <MousePointer2 size={16} className="mt-0.5 text-blue-500 shrink-0" />
                        <div className="leading-relaxed">
                            <p className="font-bold text-slate-700 dark:text-slate-200">Tips:</p>
                            <ul className="list-disc list-inside space-y-1 mt-1">
                                <li>Right-Click Node to edit ports.</li>
                                <li>Port changes ask before removing connections.</li>
                                <li>Click Line to edit label.</li>
                            </ul>
                        </div>
                    </div>
                </Panel>
            </ReactFlow>
        </div>

    );
}
