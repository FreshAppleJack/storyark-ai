import { MessageSquarePlus, RemoveFormatting } from 'lucide-react';

export interface EditorContextMenuState {
    type: 'mention' | 'selection';
    x: number;
    y: number;
}

interface EditorContextMenuProps {
    menu: EditorContextMenuState | null;
    onUnmark: (event: React.MouseEvent) => void;
    onAddForeshadowing: (event: React.MouseEvent) => void;
}

/**
 * Right-click popup inside the editor: "Unmark" for character mentions,
 * "Add Foreshadowing" for text selections. The parent owns the handlers
 * (they need the editor selection) and closes the menu on outside clicks.
 */
export function EditorContextMenu({ menu, onUnmark, onAddForeshadowing }: EditorContextMenuProps): React.ReactElement | null {
    if (!menu) return null;

    return (
        <div
            className="fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-md py-1 min-w-[150px] animate-in fade-in zoom-in duration-100"
            style={{ top: menu.y, left: menu.x }}
            onClick={(e) => e.stopPropagation()} // Prevent closing menu when clicking inside
        >
            {menu.type === 'mention' ? (
                <button
                    onClick={onUnmark}
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                >
                    <RemoveFormatting size={14} className="text-slate-400" />
                    <span>Unmark</span>
                </button>
            ) : (
                <button
                    onClick={onAddForeshadowing}
                    className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                >
                    <MessageSquarePlus size={14} className="text-slate-400" />
                    <span>Add Foreshadowing</span>
                </button>
            )}
        </div>
    );
}
