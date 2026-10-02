import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import type { Character, HandleConfig } from '../../types';

// CharacterNodeData inherits handleConfig from Character now
type CharacterNodeData = Character & Record<string, unknown> & {
    isSelected?: boolean;
    // handleConfig is already in Character
};

type CharacterFlowNode = Node<CharacterNodeData, 'character'>;

const CharacterNode = ({ data, selected }: NodeProps<CharacterFlowNode>) => {
    // 1. Role Styles: define different color schemes for each role (border, background, glow)
    const getRoleStyle = (role: string) => {
        const normalizedRole = role?.toLowerCase() || 'mob';
        switch (normalizedRole) {
            case 'protagonist':
                return 'border-blue-500 bg-blue-50 ring-blue-200 dark:bg-blue-950 dark:ring-blue-900';
            case 'antagonist':
                return 'border-rose-500 bg-rose-50 ring-rose-200 dark:bg-rose-950 dark:ring-rose-900';
            case 'supporting':
                return 'border-amber-500 bg-amber-50 ring-amber-200 dark:bg-amber-950 dark:ring-amber-900';
            case 'mob':
            default:
                return 'border-slate-300 bg-slate-50 ring-slate-200 dark:border-slate-600 dark:bg-slate-900 dark:ring-slate-700';
        }
    };

    // Get the base style for the current role
    const roleStyle = getRoleStyle(data.role);

    // Default configuration if none exists
    const config: HandleConfig = data.handleConfig || {
        top: 'target',
        right: 'source',
        bottom: 'source',
        left: 'target'
    };

    // Helper to render handles for a specific position
    const renderHandle = (pos: Position, type: 'source' | 'target' | 'both' | 'none') => {
        if (type === 'none') return null;

        const commonClass = "!w-3 !h-3 !border-2 !border-white dark:!border-slate-800 transition-all hover:!w-4 hover:!h-4 z-50";
        const targetClass = `${commonClass} !bg-slate-400 hover:!bg-blue-500`;
        const sourceClass = `${commonClass} !bg-blue-500 hover:!bg-blue-600`;

        // If 'both', we render two handles side-by-side or offset
        if (type === 'both') {
            return (
                <>
                    <Handle
                        type="target"
                        position={pos}
                        id={`${pos}-target`}
                        className={targetClass}
                        style={pos === Position.Top || pos === Position.Bottom ? { left: '35%' } : { top: '35%' }}
                    />
                    <Handle
                        type="source"
                        position={pos}
                        id={`${pos}-source`}
                        className={sourceClass}
                        style={pos === Position.Top || pos === Position.Bottom ? { left: '65%' } : { top: '65%' }}
                    />
                </>
            );
        }

        // Single handle
        return (
            <Handle
                type={type}
                position={pos}
                id={`${pos}-${type}`} // Standardized ID: "top-source", "left-target"
                className={type === 'source' ? sourceClass : targetClass}
            />
        );
    };

    return (
        <div
            className={`
                relative flex items-center gap-3 px-4 py-3 rounded-xl shadow-sm transition-all duration-200
                border-[3px] min-w-[200px] group
                ${roleStyle}
                ${selected
                ? 'ring-4 shadow-xl scale-105 z-50' /* Selected: add glow, shadow, scale, and z-index, but not change color */
                : 'hover:shadow-md hover:scale-[1.02]' /* Unselected: simple hover effect */
            }
            `}
        >
            {/* --- Dynamic Handles --- */}
            {renderHandle(Position.Top, config.top)}
            {renderHandle(Position.Right, config.right)}
            {renderHandle(Position.Bottom, config.bottom)}
            {renderHandle(Position.Left, config.left)}

            {/* --- Content --- */}
            <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shadow-sm shrink-0 border-2 border-white dark:border-slate-700"
                style={{ backgroundColor: data.color || '#cbd5e1' }}
            >
                <span className="text-lg drop-shadow-md">{data.name?.charAt(0).toUpperCase()}</span>
            </div>

            <div className="flex flex-col min-w-0 flex-1">
                <div className="text-base font-bold text-slate-800 dark:text-slate-100 truncate leading-tight">
                    {data.name || 'Unnamed'}
                    {data.isArchived && <span className="ml-2 text-xs text-slate-500">Archived</span>}
                </div>
                <div className="flex items-center gap-1 mt-1">
                    <span className={`
                        text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded
                        ${data.role === 'protagonist' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200' :
                        data.role === 'antagonist' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200' :
                            'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}
                    `}>
                        {data.role || 'Unknown'}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default memo(CharacterNode);
