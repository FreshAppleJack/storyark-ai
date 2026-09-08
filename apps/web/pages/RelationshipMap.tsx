import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ReactFlow,
    useNodesState,
    useEdgesState,
    addEdge,
    useUpdateNodeInternals, //Key import: to refresh node internal Handle status
    Connection,
    Edge,
    Background,
    Controls,
    MiniMap,
    MarkerType,
    Panel,
    ReactFlowProvider,
    ReactFlowInstance,
    Node,
    NodeMouseHandler,
    EdgeMouseHandler
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useApp } from '../InteractionContent/AppContext';
import CharacterNode from '../components/flow/CharacterNode';
import NodeContextMenu from '../components/flow/NodeContextMenu';
import RelationshipEditDialog from '../components/flow/RelationshipEditDialog';
import { getLayoutedElements } from '../utils/flowLayout';
import { Button } from '../components/ui/Button';
import {
    ArrowLeft,
    Wand2,
    Save,
    GripVertical,
    MousePointer2,
    Loader2,
    PanelLeftClose,
    PanelLeftOpen,
    CheckCircle2,
    HistoryIcon,
    Search
} from 'lucide-react';
import { Character, HandleConfig } from '../types';
import { getFuzzyScore } from '../utils/search';

const nodeTypes = { character: CharacterNode };

interface CharacterSearchResult {
    character: Character;
    score: number;
}

// --- Helper Function: Safe Parse JSON ---
// This prevents white screen due to invalid JSON strings from backend
const safeJsonParse = (jsonString: any, fallback: any) => {
    if (typeof jsonString !== 'string') return jsonString || fallback;
    try {
        return JSON.parse(jsonString);
    } catch (e) {
        console.warn('Failed to parse JSON:', jsonString, e);
        return fallback;
    }
};

const RelationshipMapContent = () => {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    // Use fetchGraphData instead of getGraphData
    const { getBook, fetchGraphData, saveGraphData, isDarkMode } = useApp();
    const book = getBook(bookId || '');

    // Get updateNodeInternals function to refresh node internal Handle status
    const updateNodeInternals = useUpdateNodeInternals();

    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<any, any> | null>(null);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Mark if the graph data has been loaded, prevent duplicate overwrite
    const [isGraphLoaded, setIsGraphLoaded] = useState(false);

    // UI State
    const [menu, setMenu] = useState<{ id: string; top: number; left: number; config: HandleConfig } | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<number | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [characterSearchQuery, setCharacterSearchQuery] = useState('');
    const [characterSearchMessage, setCharacterSearchMessage] = useState('');
    const [characterSearchTargetId, setCharacterSearchTargetId] = useState<string | null>(null);

    // Tips Visibility State
    const [showTips, setShowTips] = useState(true);

    // Dialog State
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
    const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
    const [dialogData, setDialogData] = useState({ label: '', sourceName: '', targetName: '' });
    const characters = book?.characters || [];
    const characterSearchResults = useMemo<CharacterSearchResult[]>(() => {
        const query = characterSearchQuery.trim();
        if (!query) return [];

        return characters
            .map((character) => {
                const fields = [
                    { value: character.name, weight: 0 },
                    { value: character.role, weight: 5 },
                    { value: character.tags.join(' '), weight: 8 },
                    { value: character.description, weight: 20 },
                ];
                const bestScore = fields.reduce<number | null>((best, field) => {
                    const score = getFuzzyScore(field.value, query);
                    if (score === null) return best;
                    const weightedScore = score + field.weight;
                    return best === null ? weightedScore : Math.min(best, weightedScore);
                }, null);

                return bestScore === null ? null : { character, score: bestScore };
            })
            .filter((result): result is CharacterSearchResult => Boolean(result))
            .sort((a, b) => a.score - b.score)
            .slice(0, 8);
    }, [characters, characterSearchQuery]);

    // --- Tips Timer ---
    useEffect(() => {
        const timer = setTimeout(() => {
            setShowTips(false);
        }, 5000); // Disappear after 5 seconds

        return () => clearTimeout(timer);
    }, []);

    // --- Initialization Logic ---
    useEffect(() => {
        const initGraph = async () => {
            if (!bookId || !book || isGraphLoaded) return;

            // 1. Try to fetch the complete graph data (node instances + edges) from the new GraphController
            const graphData = await fetchGraphData(bookId);

            if (graphData && graphData.nodes && graphData.nodes.length > 0) {
                // A. Load the saved graph data
                const flowNodes = graphData.nodes.map((n: any) => {
                    // Use safeJsonParse to parse the handleConfig string
                    const parsedConfig = safeJsonParse(
                        n.handleConfig,
                        { top: 'target', right: 'source', bottom: 'source', left: 'target' }
                    );

                    return {
                        id: n.nodeKey, // Use the database nodeKey (React Flow ID)
                        type: 'character',
                        position: { x: n.positionX, y: n.positionY },
                        data: {
                            id: n.characterId, // Original Character ID, used for data association
                            name: n.name,
                            role: n.role,
                            color: n.color,
                            avatar: n.avatar,
                            handleConfig: parsedConfig
                        },
                    };
                });
                setNodes(flowNodes);

                const flowEdges = graphData.edges.map((e: any) => ({
                    // If backend provides an ID, use the ID, otherwise generate a unique ID
                    id: e.id ? e.id.toString() : `e-${e.sourceNodeKey}-${e.targetNodeKey}-${e.sourceHandle || 'null'}-${e.targetHandle || 'null'}`,
                    source: e.sourceNodeKey, // Use the database source nodeKey (React Flow ID)
                    target: e.targetNodeKey,
                    // Restore sourceHandle and targetHandle
                    sourceHandle: e.sourceHandle,
                    targetHandle: e.targetHandle,
                    label: e.label,
                    type: 'smoothstep',
                    animated: true,
                    markerEnd: { type: MarkerType.ArrowClosed },
                    style: { stroke: '#64748b', strokeWidth: 2 },
                    labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 12 },
                    labelBgStyle: { fill: '#f1f5f9', fillOpacity: 0.9 },
                    labelBgPadding: [4, 2] as [number, number],
                    labelBgBorderRadius: 4,
                }));
                setEdges(flowEdges);

            } else {
                // B. Reverse scheme：If it is the first time opening (with no graph data), initialize from the character list
                // Create initial nodes for each character in the book.characters array
                if (book.characters.length > 0) {
                    const initialNodes = book.characters.map((char, index) => {
                        return {
                            id: char.id, // Initial ID (Character ID)
                            type: 'character',
                            position: {
                                x: char.positionX ?? index * 250,
                                y: char.positionY ?? 50
                            },
                            data: {
                                ...char,
                                handleConfig: char.handleConfig || { top: 'target', right: 'source', bottom: 'source', left: 'target' }
                            },
                        };
                    });
                    setNodes(initialNodes);
                    setEdges([]); // Initial edges are empty
                }
            }

            setIsGraphLoaded(true);
        };

        initGraph();
    }, [bookId, book, fetchGraphData, isGraphLoaded, setNodes, setEdges]);


    // --- Save Logic ---
    const handleSave = async () => {
        if (!bookId) return;
        setIsSaving(true);
        // Call the new saveGraphData, it will save all node instances and edges using nodeKey (React Flow ID)
        const success = await saveGraphData(bookId, nodes, edges);
        setIsSaving(false);
        if (success) {
            setLastSaved(Date.now());
        }
    };

    // --- Context Menu Logic ---
    const onNodeContextMenu: NodeMouseHandler = useCallback(
        (event, node) => {
            event.preventDefault();
            if (!reactFlowWrapper.current) return;
            const pane = reactFlowWrapper.current.getBoundingClientRect();
            const currentConfig = (node.data.handleConfig as HandleConfig | undefined) || {
                top: 'target', right: 'source', bottom: 'source', left: 'target'
            };
            setMenu({
                id: node.id,
                top: event.clientY - pane.top,
                left: event.clientX - pane.left,
                config: currentConfig
            });
        },
        []
    );

    const onPaneClick = useCallback(() => setMenu(null), []);

    // Update node Handle configuration
    const updateNodeConfig = (newConfig: HandleConfig) => {
        if (!menu) return;

        setMenu({ ...menu, config: newConfig });

        setNodes((nds) =>
            nds.map((node) => {
                if (node.id === menu.id) {
                    return {
                        ...node,
                        data: { ...node.data, handleConfig: newConfig },
                    };
                }
                return node;
            })
        );

        // Force React Flow to recompute Handle positions, eliminating ghost Handles
        setTimeout(() => updateNodeInternals(menu.id), 0);

        setEdges((eds) => {
            return eds.filter((edge) => {
                const isSource = edge.source === menu.id;
                const isTarget = edge.target === menu.id;

                if (!isSource && !isTarget) return true;

                if (isSource && edge.sourceHandle) {
                    const [pos] = edge.sourceHandle.split('-');
                    const newMode = newConfig[pos as keyof HandleConfig];
                    if (newMode !== 'source' && newMode !== 'both') return false;
                }

                if (isTarget && edge.targetHandle) {
                    const [pos] = edge.targetHandle.split('-');
                    const newMode = newConfig[pos as keyof HandleConfig];
                    if (newMode !== 'target' && newMode !== 'both') return false;
                }
                return true;
            });
        });
    };

    // --- Connection & Edge Editing Logic ---

    const onConnect = useCallback((params: Connection) => {
        if (params.source === params.target) return;

        const sourceNode = nodes.find(n => n.id === params.source);
        const targetNode = nodes.find(n => n.id === params.target);

        setPendingConnection(params);
        setEditingEdgeId(null);
        setDialogData({
            label: '',
            sourceName: sourceNode?.data.name || '?',
            targetName: targetNode?.data.name || '?'
        });
        setDialogOpen(true);
    }, [nodes]);

    const onEdgeClick: EdgeMouseHandler = useCallback((event, edge) => {
        event.preventDefault();
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);

        setEditingEdgeId(edge.id);
        setPendingConnection(null);
        setDialogData({
            label: typeof edge.label === 'string' ? edge.label : '',
            sourceName: sourceNode?.data.name || '?',
            targetName: targetNode?.data.name || '?'
        });
        setDialogOpen(true);
    }, [nodes]);

    const handleDialogSave = (label: string) => {
        if (pendingConnection) {
            setEdges((eds) => addEdge({
                ...pendingConnection,
                label: label,
                type: 'smoothstep',
                animated: true,
                markerEnd: { type: MarkerType.ArrowClosed },
                style: { stroke: '#64748b', strokeWidth: 2 },
                labelStyle: { fill: '#475569', fontWeight: 700, fontSize: 12 },
                labelBgStyle: { fill: '#f1f5f9', fillOpacity: 0.9 },
                labelBgPadding: [4, 2] as [number, number],
                labelBgBorderRadius: 4,
            }, eds));
        } else if (editingEdgeId) {
            setEdges((eds) => eds.map((e) => {
                if (e.id === editingEdgeId) {
                    return { ...e, label: label };
                }
                return e;
            }));
        }
        setDialogOpen(false);
        setPendingConnection(null);
        setEditingEdgeId(null);
    };

    const handleDialogDelete = () => {
        if (editingEdgeId) {
            setEdges((eds) => eds.filter(e => e.id !== editingEdgeId));
        }
        setDialogOpen(false);
        setEditingEdgeId(null);
    }

    const scrollCharacterIntoView = (characterId: string) => {
        requestAnimationFrame(() => {
            document.getElementById(`relationship-character-search-${characterId}`)?.scrollIntoView({
                block: 'center',
                behavior: 'smooth'
            });
        });
    };

    const selectCharacterSearchResult = (result: CharacterSearchResult) => {
        setCharacterSearchTargetId(result.character.id);
        setCharacterSearchMessage(`Found "${result.character.name}". Drag it onto the canvas to add another node.`);
        scrollCharacterIntoView(result.character.id);
    };

    const handleCharacterSearchSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (!characterSearchQuery.trim()) {
            setCharacterSearchMessage('Type a search term first.');
            return;
        }

        const firstResult = characterSearchResults[0];
        if (!firstResult) {
            setCharacterSearchMessage('No matching characters found.');
            return;
        }

        selectCharacterSearchResult(firstResult);
    };

    // --- Drag & Drop ---
    const onDragStart = (event: React.DragEvent, character: Character) => {
        event.dataTransfer.setData('application/reactflow', JSON.stringify(character));
        event.dataTransfer.effectAllowed = 'move';
    };

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            if (!reactFlowWrapper.current || !reactFlowInstance || !book) return;

            const charDataString = event.dataTransfer.getData('application/reactflow');
            if (!charDataString) return;

            const charData: Character = JSON.parse(charDataString);
            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            // Generate unique node ID (format: charId_timestamp)
            const newNodeId = `${charData.id}_${Date.now()}`;

            const newNode: Node = {
                id: newNodeId,
                type: 'character',
                position,
                data: {
                    ...charData,
                    handleConfig: charData.handleConfig || { top: 'target', right: 'source', bottom: 'source', left: 'target' }
                },
            };

            setNodes((nds) => nds.concat(newNode));
        },
        [reactFlowInstance, setNodes, book]
    );

    const onLayout = useCallback((direction = 'TB') => {
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges, direction);
        setNodes([...layoutedNodes]);
        setEdges([...layoutedEdges]);
        window.requestAnimationFrame(() => reactFlowInstance?.fitView({ padding: 0.2 }));
    }, [nodes, edges, setNodes, setEdges, reactFlowInstance]);

    if (!book) return <div className="p-8 bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400">Book not found</div>;

    return (
        <div className="h-screen w-full flex flex-col bg-slate-50 dark:bg-slate-950 transition-colors duration-300">
            {/* Header */}
            <header className="h-14 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 z-10 shadow-sm shrink-0">
                <div className="flex items-center gap-4">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-500 dark:text-slate-400">
                        <ArrowLeft size={20} />
                    </button>
                    <div className="h-6 w-px bg-slate-200 dark:bg-slate-800 mx-1"></div>
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 flex items-center gap-2 transition-colors"
                        title={isSidebarOpen ? "Collapse Sidebar" : "Expand Sidebar"}
                    >
                        {isSidebarOpen ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}
                    </button>
                    <h1 className="font-bold text-lg text-slate-800 dark:text-white">
                        Relationship Map:《{book.title}》
                    </h1>
                </div>

                {/* Status & Actions */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-xs font-medium transition-colors duration-300 min-w-[80px] justify-end">
                        {isSaving ? (
                            <><HistoryIcon size={14} className="text-brand-500 animate-spin" /><span className="text-brand-600">Saving...</span></>
                        ) : lastSaved ? (
                            <><CheckCircle2 size={14} className="text-emerald-500" /><span className="text-slate-400">Saved</span></>
                        ) : null}
                    </div>

                    <div className="h-4 mx-1 border-l border-slate-300 dark:border-slate-700" />

                    <Button size="sm" variant="secondary" onClick={() => onLayout('TB')}>
                        <Wand2 size={14} className="mr-2 text-brand-600"/>
                        Auto-Layout
                    </Button>

                    <Button size="sm" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 size={14} className="mr-2 animate-spin"/> : <Save size={14} className="mr-2"/>}
                        Save
                    </Button>
                </div>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar */}
                <div
                    className={`
                        bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-10 shadow-sm transition-all duration-300 ease-in-out overflow-hidden
                        ${isSidebarOpen ? 'w-64 opacity-100' : 'w-0 opacity-0 border-r-0'}
                    `}
                >
                    <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/60 whitespace-nowrap">
                        <div className="flex justify-between items-center">
                            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Characters</h2>
                        </div>
                        <form className="mt-4 space-y-2" onSubmit={handleCharacterSearchSubmit}>
                            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 dark:border-slate-800 dark:bg-slate-900 dark:focus-within:border-brand-500 dark:focus-within:ring-brand-950/60">
                                <Search size={15} className="flex-shrink-0 text-slate-400" />
                                <input
                                    value={characterSearchQuery}
                                    onChange={(event) => {
                                        setCharacterSearchQuery(event.target.value);
                                        setCharacterSearchMessage('');
                                    }}
                                    placeholder="Search characters"
                                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none dark:text-slate-100"
                                />
                                <button
                                    type="submit"
                                    className="rounded-md bg-brand-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-700"
                                >
                                    Go
                                </button>
                            </div>
                            {characterSearchQuery.trim() && characterSearchResults.length > 0 && (
                                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                                    {characterSearchResults.map((result) => (
                                        <button
                                            key={result.character.id}
                                            type="button"
                                            onClick={() => selectCharacterSearchResult(result)}
                                            className="w-full px-3 py-2 text-left text-xs transition hover:bg-brand-50 dark:hover:bg-brand-950/40"
                                        >
                                            <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                                                {result.character.name}
                                            </div>
                                            <div className="mt-0.5 truncate text-[11px] text-slate-400">
                                                {result.character.tags.length > 0 ? `${result.character.role} · ${result.character.tags.join(' ')}` : result.character.role}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {characterSearchMessage && (
                                <p className={`whitespace-normal text-xs leading-5 ${characterSearchMessage.startsWith('No ') || characterSearchMessage.startsWith('Type ') ? 'text-amber-600 dark:text-amber-300' : 'text-slate-500 dark:text-slate-400'}`}>
                                    {characterSearchMessage}
                                </p>
                            )}
                        </form>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 whitespace-nowrap">
                        {characters.map((char) => (
                            <div
                                id={`relationship-character-search-${char.id}`}
                                key={char.id}
                                onDragStart={(event) => onDragStart(event, char)}
                                draggable
                                className={`flex items-center gap-3 p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm cursor-grab hover:border-blue-400 dark:hover:border-blue-700 hover:shadow-md transition-all active:cursor-grabbing ${
                                    characterSearchTargetId === char.id ? 'ring-1 ring-brand-200 dark:ring-brand-800' : ''
                                }`}
                            >
                                <GripVertical size={16} className="text-slate-300 shrink-0" />
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: char.color }}>
                                    {char.name[0]}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{char.name}</div>
                                    <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{char.role}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* React Flow Canvas */}
                <div className="flex-1 relative h-full" ref={reactFlowWrapper}>
                    <ReactFlow
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
                                <MousePointer2 size={16} className="mt-0.5 text-blue-500 shrink-0"/>
                                <div className="leading-relaxed">
                                    <p className="font-bold text-slate-700 dark:text-slate-200">Tips:</p>
                                    <ul className="list-disc list-inside space-y-1 mt-1">
                                        <li>Right-Click Node to edit ports.</li>
                                        <li>Changing a port removes its connections.</li>
                                        <li>Click Line to edit label.</li>
                                    </ul>
                                </div>
                            </div>
                        </Panel>
                    </ReactFlow>
                </div>
            </div>
        </div>
    );
};

function RelationshipMap(): React.ReactElement {
    return (
        <ReactFlowProvider>
            <RelationshipMapContent />
        </ReactFlowProvider>
    );
}

export default RelationshipMap;
