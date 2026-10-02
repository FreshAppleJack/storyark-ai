import { useEffect, useId, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { OverlayHorizontalScrollbar } from '../../../components/ui/OverlayHorizontalScrollbar';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    Bold,
    Italic,
    Lock,
    Redo,
    Strikethrough,
    Underline as UnderlineIcon,
    Undo,
    Unlock,
} from 'lucide-react';

// Multiple fallback font families for Mac and Windows users
const FONT_FAMILIES = [
    { name: '默认宋体', value: '"Songti SC", "宋体-简", "STSong", "华文宋体", "SimSun", "宋体", serif' },
    { name: '黑体', value: '"PingFang SC", "Heiti SC", "黑体-简", "Microsoft YaHei", "微软雅黑", "黑体", sans-serif' },
    { name: '楷体', value: '"Kaiti SC", "STKaiti", "KaiTi", "楷体", serif' },
    { name: '思源宋体', value: '"Source Han Serif SC", "Noto Serif CJK SC", serif' },
    { name: '思源黑体', value: '"Source Han Sans SC", "Noto Sans CJK SC", sans-serif' },
    { name: '苹方', value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif' },
    { name: '仿宋', value: '"STFangsong", "华文仿宋", "FangSong", "仿宋", serif' },
    { name: '华文细黑', value: '"STHeiti", "华文细黑", "Microsoft YaHei", "Heiti SC", sans-serif' },
    { name: 'Times New Roman', value: '"Times New Roman", Times, serif' },
    { name: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
    { name: 'Helvetica', value: 'Helvetica, "Arial", sans-serif' },
    { name: 'Courier New', value: '"Courier New", Courier, monospace' },
    { name: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
    { name: 'Arial', value: 'Arial, sans-serif' },
];

const FONT_SIZES = [
    { name: 'Small (16px)', value: '16px' },
    { name: 'Medium (18px)', value: '18px' },
    { name: 'Large (20px)', value: '20px' },
    { name: 'Ex-Large (24px)', value: '24px' },
    { name: 'Ex-Ex-Large (30px)', value: '30px' },
];

interface ToolbarButtonProps {
    onClick: () => void;
    isActive?: boolean;
    disabled?: boolean;
    title?: string;
    children: React.ReactNode;
}

const ToolbarButton = ({ onClick, isActive, disabled, children, title }: ToolbarButtonProps) => (
    <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`p-1.5 rounded transition-colors flex-shrink-0 ${
            isActive ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
        {children}
    </button>
);

interface EditorToolbarProps {
    editor: Editor | null;
    isEditable: boolean;
    onToggleReadOnly?: () => void;
}

/**
 * Formatting toolbar for the editor. Subscribes to editor transactions to
 * keep button states in sync, and stages/restores the selection around
 * the font dropdowns (Safari clears the contentEditable selection when a
 * native select pops up, so setMark would otherwise hit a collapsed cursor).
 */
export function EditorToolbar({ editor, isEditable, onToggleReadOnly }: EditorToolbarProps): React.ReactElement | null {
    const [, forceUpdate] = useState({});
    const toolbarScrollId = useId();
    const toolbarScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!editor) return;
        const handler = () => forceUpdate({});
        editor.on('transaction', handler);
        editor.on('selectionUpdate', handler);
        return () => {
            editor.off('transaction', handler);
            editor.off('selectionUpdate', handler);
        };
    }, [editor]);

    // Safari fix: Native WebKit empties the selection of contentEditable when popping up (Chrome/FF will not).
    // In the mousedown phase, the current selection of Tiptap is staged, onChange, otherwise setMark will only work on the collapsed cursor.
    const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
    const saveSelection = () => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        savedSelectionRef.current = { from, to };
    };
    const withRestoredSelection = () => {
        const sel = savedSelectionRef.current;
        savedSelectionRef.current = null;
        const chain = editor!.chain().focus();
        if (sel) chain.setTextSelection(sel);
        return chain;
    };

    if (!editor) return null;

    const currentFont = editor.getAttributes('textStyle').fontFamily || '"Songti SC", "SimSun", serif';
    const currentSize = editor.getAttributes('textStyle').fontSize || '20px';

    return (
        <div className="sticky top-0 z-20 h-12">
        <div
            id={toolbarScrollId}
            ref={toolbarScrollRef}
            className="flex h-full items-center gap-1 overflow-x-auto border-b border-slate-100 bg-white/85 px-4 select-none backdrop-blur transition-all scrollbar-hidden-x dark:border-slate-800 dark:bg-slate-950/85"
        >
            <select
                className="editor-toolbar-select h-8 text-xs border border-slate-200 dark:border-slate-700 rounded px-2 text-slate-600 dark:text-slate-300 outline-none focus:border-brand-500 bg-transparent w-24 truncate mr-1"
                onMouseDown={saveSelection}
                onKeyDown={saveSelection}
                onChange={(e) => {
                    const value = e.target.value;
                    const chain = withRestoredSelection();
                    if (value) chain.setFontFamily(value).run();
                    else chain.unsetFontFamily().run();
                }}
                value={currentFont}
            >
                {FONT_FAMILIES.map((font) => (
                    <option key={font.value} value={font.value}>{font.name}</option>
                ))}
            </select>

            <select
                className="editor-toolbar-select h-8 text-xs border border-slate-200 dark:border-slate-700 rounded px-2 text-slate-600 dark:text-slate-300 outline-none focus:border-brand-500 bg-transparent w-24 truncate mr-2"
                onMouseDown={saveSelection}
                onKeyDown={saveSelection}
                onChange={(e) => {
                    const value = e.target.value;
                    withRestoredSelection().setFontSize(value).run();
                }}
                value={currentSize}
            >
                {FONT_SIZES.map((size) => (
                    <option key={size.value} value={size.value}>{size.name}</option>
                ))}
            </select>
            <div className="h-4 mx-1 border-l border-slate-200 dark:border-slate-800" />
            <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Bold"><Bold size={16} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Italic"><Italic size={16} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Underline"><UnderlineIcon size={16} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} title="Strike"><Strikethrough size={16} /></ToolbarButton>
            <div className="h-4 mx-1 border-l border-slate-200 dark:border-slate-800" />
            <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} title="Left"><AlignLeft size={16} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} title="Center"><AlignCenter size={16} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} title="Right"><AlignRight size={16} /></ToolbarButton>
            <div className="h-4 mx-1 border-l border-slate-200 dark:border-slate-800" />
            <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo size={16} /></ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo size={16} /></ToolbarButton>

            {/* Lock/Unlock Button - Pushed to right */}
            <div className="ml-auto pl-2 flex items-center border-l border-slate-200 dark:border-slate-800 h-6">
                <ToolbarButton
                    onClick={() => {
                        if (onToggleReadOnly) {
                            onToggleReadOnly();
                        } else {
                            // Fallback for independent usage
                            editor.setEditable(!editor.isEditable);
                        }
                    }}
                    // Use passed React Prop `isEditable` instead of `editor.isEditable`
                    isActive={!isEditable}
                    title={isEditable ? "Unlock (Editable)" : "Lock (view only)"}
                >
                    {isEditable ? <Unlock size={16} className="text-slate-500 dark:text-slate-400"/> : <Lock size={16} className="text-rose-500"/>}
                </ToolbarButton>
            </div>
        </div>
        <OverlayHorizontalScrollbar
            scrollElementRef={toolbarScrollRef}
            scrollElementId={toolbarScrollId}
            ariaLabel="Editor formatting toolbar"
        />
        </div>
    );
}
