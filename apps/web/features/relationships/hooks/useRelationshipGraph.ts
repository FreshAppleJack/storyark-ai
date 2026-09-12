import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    useNodesState, useEdgesState, useUpdateNodeInternals, addEdge,
    type Connection, type Edge, type ReactFlowInstance, type NodeMouseHandler, type EdgeMouseHandler,
    type OnNodesChange, type OnEdgesChange
} from '@xyflow/react';
import { toast } from 'react-hot-toast';
import type { Book, HandleConfig } from '../../../types';
import { useBooks } from '../../../InteractionContent/BooksContext';
import { getLayoutedElements } from '../../../utils/flowLayout';
import { asRecord } from '../../../utils/serialization';
import {
    createCharacterNode, filterEdgesForHandles, normalizeHandleConfig, relationshipEdgeStyle,
    toRelationshipGraph, type RelationshipNode
} from '../graphModel';

export interface GraphPersistence {
    load: () => Promise<{ nodes: RelationshipNode[]; edges: Edge[] }>;
    save: (nodes: RelationshipNode[], edges: Edge[], revision: number) => Promise<boolean>;
}

/** One graph draft for the canvas and its persistence. Mount under ReactFlowProvider. */
export function useRelationshipGraph(bookId: string, book: Book | undefined, persistence?: GraphPersistence) {
    const { fetchGraphData, saveGraphData } = useBooks();
    const source = useRef({ fetchGraphData, book, persistence });
    useEffect(() => { source.current = { fetchGraphData, book, persistence }; }, [fetchGraphData, book, persistence]);
    const [nodes, setNodes, applyNodeChanges] = useNodesState<RelationshipNode>([]);
    const [edges, setEdges, applyEdgeChanges] = useEdgesState<Edge>([]);
    const [isGraphLoaded, setIsGraphLoaded] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaved, setLastSaved] = useState<number | null>(null);
    const [menu, setMenu] = useState<{ id: string; top: number; left: number; config: HandleConfig } | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
    const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
    const [dialogData, setDialogData] = useState({ label: '', sourceName: '', targetName: '' });
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<RelationshipNode, Edge> | null>(null);
    const updateNodeInternals = useUpdateNodeInternals();
    const revision = useRef(0);
    const pendingSave = useRef<Promise<boolean> | null>(null);
    const savedRevision = useRef(0);
    const [isDirty, setIsDirty] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const latest = useRef({ nodes, edges });
    useLayoutEffect(() => { latest.current = { nodes, edges }; }, [nodes, edges]);
    const mounted = useRef(false);
    const handleTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
    const layoutFrame = useRef<number | undefined>(undefined);
    useEffect(() => {
        mounted.current = true;
        const timers = handleTimers.current;
        return () => {
            mounted.current = false;
            timers.forEach(clearTimeout);
            if (layoutFrame.current !== undefined) cancelAnimationFrame(layoutFrame.current);
        };
    }, []);
    const hasBook = !!book;
    useEffect(() => {
        if (!hasBook) return;
        let active = true;
        const load = async () => {
            setLoadError(false);
            try {
                const graph = source.current.persistence
                    ? await source.current.persistence.load()
                    : toRelationshipGraph(await source.current.fetchGraphData(bookId), source.current.book?.characters || []);
                if (!active) return;
                setNodes(graph.nodes);
                setEdges(graph.edges);
                setIsGraphLoaded(true);
            } catch {
                if (active) setLoadError(true);
            }
        };
        void load();
        return () => { active = false; };
    }, [bookId, hasBook, loadAttempt, setNodes, setEdges]);

    const markEdited = useCallback(() => { revision.current++; setIsDirty(true); setLastSaved(null); }, []);
    const onNodesChange: OnNodesChange<RelationshipNode> = useCallback(changes => {
        if (changes.some(change => change.type !== 'select' && change.type !== 'dimensions')) markEdited();
        const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));
        if (removed.size) setEdges(previous => previous.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
        applyNodeChanges(changes);
    }, [applyNodeChanges, markEdited, setEdges]);
    const onEdgesChange: OnEdgesChange = useCallback(changes => {
        if (changes.some(change => change.type !== 'select')) markEdited();
        applyEdgeChanges(changes);
    }, [applyEdgeChanges, markEdited]);
    const flush = useCallback((force = false): Promise<boolean> => {
        if (pendingSave.current) return pendingSave.current;
        if (!isGraphLoaded) return Promise.resolve(false);
        const operation = async () => {
            setIsSaving(true);
            setSaveError(null);
            try {
                do {
                    const snapshotRevision = revision.current;
                    const snapshot = latest.current;
                    const adapter = source.current.persistence;
                    const ok = adapter
                        ? await adapter.save(snapshot.nodes, snapshot.edges, snapshotRevision)
                        : await saveGraphData(bookId, snapshot.nodes, snapshot.edges);
                    if (!mounted.current) return false;
                    if (!ok) throw new Error('Failed to save the relationship map. Your draft is retained.');
                    savedRevision.current = snapshotRevision;
                    if (revision.current === snapshotRevision) {
                        setIsDirty(false);
                        setLastSaved(Date.now());
                    }
                    // Local flush drains edits made while the previous commit was pending.
                    if (!adapter) break;
                } while (savedRevision.current !== revision.current);
                return true;
            } catch (error) {
                if (mounted.current) {
                    const message = error instanceof Error ? error.message : 'Graph save failed.';
                    setSaveError(message);
                    toast.error(message);
                }
                return false;
            } finally {
                pendingSave.current = null;
                if (mounted.current) setIsSaving(false);
            }
        };
        if (!force && savedRevision.current === revision.current) return Promise.resolve(true);
        pendingSave.current = operation();
        return pendingSave.current;
    }, [bookId, isGraphLoaded, saveGraphData]);
    const handleSave = async () => { await flush(true); };
    const onNodeContextMenu: NodeMouseHandler<RelationshipNode> = useCallback((event, node) => {
        event.preventDefault();
        if (!reactFlowWrapper.current) return;
        const pane = reactFlowWrapper.current.getBoundingClientRect();
        setMenu({
            id: node.id, top: event.clientY - pane.top, left: event.clientX - pane.left,
            config: normalizeHandleConfig(node.data.handleConfig)
        });
    }, []);
    const onPaneClick = useCallback(() => setMenu(null), []);
    const updateNodeConfig = (config: HandleConfig) => {
        if (!menu) return;
        const retained = filterEdgesForHandles(edges, menu.id, config);
        const removed = edges.length - retained.length;
        if (removed && !window.confirm(`This port change removes ${removed} connection(s). Continue?`)) return;
        markEdited();
        const id = menu.id;
        setMenu({ ...menu, config });
        setNodes(previous => previous.map(node => node.id === id ? { ...node, data: { ...node.data, handleConfig: config } } : node));
        setEdges(previous => filterEdgesForHandles(previous, id, config));
        const timer = setTimeout(() => { handleTimers.current.delete(timer); updateNodeInternals(id); }, 0);
        handleTimers.current.add(timer);
    };

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
        markEdited();
        if (pendingConnection) {
            setEdges((eds) => addEdge({
                ...pendingConnection,
                id: crypto.randomUUID(),
                label: label,
                ...relationshipEdgeStyle,
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
        markEdited();
        if (editingEdgeId) {
            setEdges((eds) => eds.filter(e => e.id !== editingEdgeId));
        }
        setDialogOpen(false);
        setEditingEdgeId(null);
    }



    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    }, []);
    const onDrop = (event: React.DragEvent) => {
        event.preventDefault();
        if (!reactFlowInstance || !book || !isGraphLoaded) return;
        try {
            const data = asRecord(JSON.parse(event.dataTransfer.getData('application/reactflow')));
            const character = book.characters.find(item => item.id === String(data.id));
            if (!character || character.isArchived) return;
            const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const id = crypto.randomUUID();
            markEdited();
            setNodes(previous => [...previous, createCharacterNode(character, id, position)]);
        } catch (error) {
            // Unrelated or malformed drag data is ignored, but never silently:
            // a no-op drop with no visible cause is undebuggable otherwise.
            console.warn('Drop on the relationship map was ignored:', error);
        }
    };
    const onLayout = (direction = 'TB') => {
        if (!isGraphLoaded) return;
        // The existing layout helper mutates positions, so pass detached nodes.
        const graph = getLayoutedElements(nodes.map(node => ({ ...node, position: { ...node.position } })), edges, direction);
        markEdited();
        setNodes(graph.nodes as RelationshipNode[]);
        setEdges(graph.edges);
        if (layoutFrame.current !== undefined) cancelAnimationFrame(layoutFrame.current);
        layoutFrame.current = requestAnimationFrame(() => reactFlowInstance?.fitView({ padding: 0.2 }));
    };
    return {
        isDirty, saveError, flush, nodes, edges, onNodesChange, onEdgesChange, reactFlowWrapper, setReactFlowInstance,
        isGraphLoaded, loadError, retry: () => setLoadAttempt(attempt => attempt + 1), isSaving, lastSaved, handleSave,
        menu, setMenu, onNodeContextMenu, onPaneClick, updateNodeConfig, dialogOpen, setDialogOpen, dialogData,
        editingEdgeId, onConnect, onEdgeClick, handleDialogSave, handleDialogDelete, onDragOver, onDrop, onLayout
    };
}
export type RelationshipGraphEditor = ReturnType<typeof useRelationshipGraph>;
