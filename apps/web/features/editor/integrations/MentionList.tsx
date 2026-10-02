import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { Character } from '../../../types';

export interface MentionListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface MentionListProps {
    items: Character[];
    command: (attrs: { id: string; label: string; color?: string }) => void;
}

/**
 * Keyboard-navigable suggestion list rendered inside the mention popup.
 * The editor drives it through the imperative onKeyDown handle.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>((props, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = (index: number) => {
        const item = props.items[index];
        if (item) {
            props.command({ id: item.id, label: item.name, color: item.color });
        }
    };

    const upHandler = () => {
        setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
    };

    const downHandler = () => {
        setSelectedIndex((selectedIndex + 1) % props.items.length);
    };

    const enterHandler = () => {
        selectItem(selectedIndex);
    };

    useEffect(() => setSelectedIndex(0), [props.items]);

    useImperativeHandle(ref, () => ({
        onKeyDown: ({ event }: { event: KeyboardEvent }) => {
            if (event.key === 'ArrowUp') {
                upHandler();
                return true;
            }
            if (event.key === 'ArrowDown') {
                downHandler();
                return true;
            }
            if (event.key === 'Enter') {
                enterHandler();
                return true;
            }
            return false;
        },
    }));

    return (
        <div className="bg-white dark:bg-slate-900 rounded-md shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden min-w-[180px] py-1 z-50 animate-in fade-in zoom-in duration-75">
            {props.items.length ? (
                props.items.map((item: Character, index: number) => (
                    <button
                        key={item.id}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                            index === selectedIndex ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                        }`}
                        onClick={() => selectItem(index)}
                    >
                        <div
                            className="w-4 h-4 rounded-full flex-shrink-0 border border-slate-100 dark:border-slate-700 shadow-sm"
                            style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate font-medium">{item.name}</span>
                        {item.role && <span className="text-[10px] text-slate-400 uppercase ml-auto">{item.role}</span>}
                    </button>
                ))
            ) : (
                <div className="px-3 py-2 text-sm text-slate-400">No characters found</div>
            )}
        </div>
    );
});

MentionList.displayName = 'MentionList';
