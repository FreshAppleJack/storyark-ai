import React, { useRef, useLayoutEffect, useState } from 'react';
import type { HandleConfig } from '../../types';
import { X, ArrowRightFromLine, ArrowLeftToLine, RefreshCw, Ban } from 'lucide-react';

interface NodeContextMenuProps {
    id: string;
    top: number;
    left: number;
    config: HandleConfig;
    onClose: () => void;
    onChange: (newConfig: HandleConfig) => void;
}

const NodeContextMenu: React.FC<NodeContextMenuProps> = ({ top, left, config, onClose, onChange }) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [adjustedPos, setAdjustedPos] = useState({ top, left });
    const [isFlipped, setIsFlipped] = useState(false); // To control the animation origin direction

    const positions = ['top', 'right', 'bottom', 'left'] as const;

    // use useLayoutEffect to calculate position after DOM update but before screen draw, to avoid flickering
    useLayoutEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            let newTop = top;
            let newLeft = left;
            let flipped = false;

            // 1. Check bottom overflow (keep 20px margin)
            // If menu bottom exceeds viewport height, move top to move up the height of the menu
            if (rect.bottom > viewportHeight - 20) {
                newTop = top - rect.height;
                flipped = true;
            }

            // 2. Check right overflow (keep 20px margin)
            // If menu right exceeds viewport width, move left to move left the width of the menu
            if (rect.right > viewportWidth - 20) {
                newLeft = left - rect.width;
            }

            setAdjustedPos({ top: newTop, left: newLeft });
            setIsFlipped(flipped);
        }
    }, [top, left]); // Only recalculate position when the original coordinates change

    const handleChange = (pos: keyof HandleConfig, type: HandleConfig['top']) => {
        onChange({ ...config, [pos]: type });
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'source': return <ArrowRightFromLine size={14} className="text-blue-500" />;
            case 'target': return <ArrowLeftToLine size={14} className="text-slate-500" />;
            case 'both': return <RefreshCw size={14} className="text-purple-500" />;
            default: return <Ban size={14} className="text-slate-300" />;
        }
    };

    return (
        <div
            ref={menuRef}
            style={{ top: adjustedPos.top, left: adjustedPos.left }}
            className={`
                absolute z-50 bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-800 w-64 overflow-hidden 
                animate-in fade-in zoom-in-95 duration-100
                ${isFlipped ? 'origin-bottom-left' : 'origin-top-left'}
            `}
        >
            <div className="bg-slate-50 dark:bg-slate-950 px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Connection Points</span>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                    <X size={14} />
                </button>
            </div>
            <div className="p-2 space-y-1">
                {positions.map((pos) => (
                    <div key={pos} className="flex items-center justify-between p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-md group">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 capitalize w-16">{pos}</span>
                        <div className="flex gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded">
                            {(['none', 'target', 'source', 'both'] as const).map((type) => (
                                <button
                                    key={type}
                                    onClick={() => handleChange(pos, type)}
                                    title={type}
                                    className={`
                                        p-1.5 rounded transition-all
                                        ${config[pos] === type ? 'bg-white dark:bg-slate-800 shadow text-slate-800 dark:text-slate-100' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800'}
                                    `}
                                >
                                    {getIcon(type)}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default NodeContextMenu;
