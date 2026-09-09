import { AutoHighlight, CustomFontFamily, CustomMention, FontSize, forceDowngradeMentions, ForeshadowingMark, IgnoreAutoHighlight, PasteAutoFormat, TabIndent, transformPastedHtml } from '../features/editor/extensions';
import { dlog } from '../features/editor/debug/editorDebug';
import { createMentionSuggestion } from '../features/editor/integrations/mentionSuggestion';
import { createCharacterTooltipHandler } from '../features/editor/integrations/characterTooltip';
import { escapeRegex, getCharacterDisplayTerms, getCharacterMatchTerms, getValidNamedCharacters } from '../domain/characters';
import React, {useEffect, useState, useImperativeHandle, forwardRef, useMemo, useRef} from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import { TextStyle } from '@tiptap/extension-text-style';
//import { FontFamily } from '@tiptap/extension-font-family';
import { TextSelection } from '@tiptap/pm/state';
import { Node as PMNode } from '@tiptap/pm/model';
import 'tippy.js/dist/tippy.css';
import 'tippy.js/animations/shift-away.css';

import {
    Bold, Italic, Underline as UnderlineIcon, Strikethrough,
    AlignLeft, AlignCenter, AlignRight,
    Undo, Redo, Loader2,
    RemoveFormatting,
    Lock, Unlock,
    MessageSquarePlus
} from 'lucide-react';
import { Character, EDITOR_SPACING_LIMITS, ForeshadowingNote } from '../types';
import { calculateMixedWordCount } from '../utils/textUtils'; // Import common utility function

export interface TiptapEditorRef {
    insertContent: (content: string) => void;
    editor: any;
    getHTML: () => string; // Allow parent component to directly get latest updated HTML content
    /** Force refresh all character highlights in the editor (use after character settings change) */
    forceRefreshHighlights: () => void;
    removeForeshadowing: (id: string) => void;
    focusForeshadowing: (id: string) => boolean;
}

interface TiptapEditorProps {
    contentId: string; // Unique identifier (ChapterID)
    content: string;
    onUpdate: (html: string, wordCount: number) => void;
    isEditable?: boolean;
    placeholder?: string;
    className?: string;
    characters?: Character[];
    autoHighlightCharacters?: Character[];
    editorMarginPx?: number;
    editorLineHeight?: number;
    onForeshadowingCreate?: (note: ForeshadowingNote) => void;
    onForeshadowingClick?: (id: string) => void;
    // Callback function for character click
    onCharacterClick?: (charId: string) => void;
    // Callback function for parent component to toggle read only state
    onToggleReadOnly?: () => void;
}

const MenuBar = ({ editor, isEditable, onToggleReadOnly }: { editor: any, isEditable: boolean, onToggleReadOnly?: () => void }) => {
    if (!editor) return null;
    const [, forceUpdate] = useState({});
    useEffect(() => {
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
        const chain = editor.chain().focus();
        if (sel) chain.setTextSelection(sel);
        return chain;
    };

    // Multiple fallback font families for Mac and Windows users
    const fontFamilies = [
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
    const fontSizes = [
        { name: 'Small (16px)', value: '16px' },
        { name: 'Medium (18px)', value: '18px' },
        { name: 'Large (20px)', value: '20px' },
        { name: 'Ex-Large (24px)', value: '24px' },
        { name: 'Ex-Ex-Large (30px)', value: '30px' },
    ];
    const currentFont = editor.getAttributes('textStyle').fontFamily || '"Songti SC", "SimSun", serif';
    const currentSize = editor.getAttributes('textStyle').fontSize || '20px';

    const Button = ({ onClick, isActive, disabled, children, title }: any) => (
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

    return (
        <div className="sticky top-0 z-20 h-12 flex items-center px-4 gap-1 select-none overflow-x-auto bg-white/85 dark:bg-slate-950/85 backdrop-blur transition-all border-b border-slate-100 dark:border-slate-800">
            <select
                className="h-8 text-xs border border-slate-200 dark:border-slate-700 rounded px-2 text-slate-600 dark:text-slate-300 outline-none focus:border-brand-500 bg-transparent w-24 truncate mr-1"
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
                {fontFamilies.map((font) => (
                    <option key={font.value} value={font.value}>{font.name}</option>
                ))}
            </select>

            <select
                className="h-8 text-xs border border-slate-200 dark:border-slate-700 rounded px-2 text-slate-600 dark:text-slate-300 outline-none focus:border-brand-500 bg-transparent w-24 truncate mr-2"
                onMouseDown={saveSelection}
                onKeyDown={saveSelection}
                onChange={(e) => {
                    const value = e.target.value;
                    withRestoredSelection().setFontSize(value).run();
                }}
                value={currentSize}
            >
                {fontSizes.map((size) => (
                    <option key={size.value} value={size.value}>{size.name}</option>
                ))}
            </select>
            <div className="h-4 mx-1 border-l border-slate-200 dark:border-slate-800" />
            <Button onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Bold"><Bold size={16} /></Button>
            <Button onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Italic"><Italic size={16} /></Button>
            <Button onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Underline"><UnderlineIcon size={16} /></Button>
            <Button onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} title="Strike"><Strikethrough size={16} /></Button>
            <div className="h-4 mx-1 border-l border-slate-200 dark:border-slate-800" />
            <Button onClick={() => editor.chain().focus().setTextAlign('left').run()} isActive={editor.isActive({ textAlign: 'left' })} title="Left"><AlignLeft size={16} /></Button>
            <Button onClick={() => editor.chain().focus().setTextAlign('center').run()} isActive={editor.isActive({ textAlign: 'center' })} title="Center"><AlignCenter size={16} /></Button>
            <Button onClick={() => editor.chain().focus().setTextAlign('right').run()} isActive={editor.isActive({ textAlign: 'right' })} title="Right"><AlignRight size={16} /></Button>
            <div className="h-4 mx-1 border-l border-slate-200 dark:border-slate-800" />
            <Button onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo"><Undo size={16} /></Button>
            <Button onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo"><Redo size={16} /></Button>

            {/* Lock/Unlock Button - Pushed to right */}
            <div className="ml-auto pl-2 flex items-center border-l border-slate-200 dark:border-slate-800 h-6">
                <Button
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
                </Button>
            </div>
        </div>
    );
};

const TiptapEditor = forwardRef<TiptapEditorRef, TiptapEditorProps>(({
                                                                         contentId, // Key parameter
                                                                         content,
                                                                         onUpdate,
                                                                         isEditable = true,
                                                                         placeholder = "Start writing...",
                                                                         className,
                                                                         characters = [],
                                                                         autoHighlightCharacters = characters,
                                                                         editorMarginPx = EDITOR_SPACING_LIMITS.marginPx.default,
                                                                         editorLineHeight = EDITOR_SPACING_LIMITS.lineHeight.default,
                                                                         onForeshadowingCreate,
                                                                         onForeshadowingClick,
                                                                         onCharacterClick,
                                                                         onToggleReadOnly
                                                                     }, ref) => {

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<
        | {
            type: 'mention';
            x: number;
            y: number;
            pos: number;
            node: PMNode;
        }
        | {
            type: 'selection';
            x: number;
            y: number;
            from: number;
            to: number;
            text: string;
        }
        | null
    >(null);

    // Use Ref to save latest callbacks and state, preventing stale closures
    const isEditableRef = useRef(isEditable);
    const onCharacterClickRef = useRef(onCharacterClick);
    const onForeshadowingClickRef = useRef(onForeshadowingClick);
    const onForeshadowingCreateRef = useRef(onForeshadowingCreate);
    const onUpdateRef = useRef(onUpdate);
    const lastContentIdRef = useRef<string>(contentId);

    // Track last emitted content from editor, preventing circular updates
    const lastEmittedContentRef = useRef<string | null>(null);

    // Introduce a lock to prevent onUpdate from sending data to parent component when switching chapters
    const isSilentUpdateRef = useRef(false);
    const normalizedEditorMarginPx = Math.min(
        EDITOR_SPACING_LIMITS.marginPx.max,
        Math.max(EDITOR_SPACING_LIMITS.marginPx.min, Number(editorMarginPx) || EDITOR_SPACING_LIMITS.marginPx.default)
    );
    const normalizedEditorLineHeight = Math.min(
        EDITOR_SPACING_LIMITS.lineHeight.max,
        Math.max(EDITOR_SPACING_LIMITS.lineHeight.min, Number(editorLineHeight) || EDITOR_SPACING_LIMITS.lineHeight.default)
    );

    useEffect(() => { isEditableRef.current = isEditable; }, [isEditable]);
    useEffect(() => { onCharacterClickRef.current = onCharacterClick; }, [onCharacterClick]);
    useEffect(() => { onForeshadowingClickRef.current = onForeshadowingClick; }, [onForeshadowingClick]);
    useEffect(() => { onForeshadowingCreateRef.current = onForeshadowingCreate; }, [onForeshadowingCreate]);
    useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

    const extensions = useMemo(() => {
        return [
            StarterKit,
            Underline,
            TextAlign.configure({ types: ['heading', 'paragraph'] }),
            TextStyle,
            CustomFontFamily,
            FontSize,
            TabIndent,
            PasteAutoFormat,
            IgnoreAutoHighlight, // Add new Mark extension
            ForeshadowingMark,
            Placeholder.configure({
                placeholder: placeholder,
                emptyEditorClass: 'is-editor-empty',
            }),
            CustomMention.configure({
                HTMLAttributes: {
                    class: 'mention',
                },
                suggestion: createMentionSuggestion(() => characters),
            }),
            AutoHighlight.configure({
                characters: autoHighlightCharacters,
                allCharacters: characters,
            })
        ];
    }, [characters, autoHighlightCharacters, placeholder]);

    const editor = useEditor({
        extensions: extensions,
        editorProps: {
            attributes: {
                style: `font-family: "Songti SC", "SimSun", serif; font-size: 20px; line-height: ${normalizedEditorLineHeight}; padding-left: ${normalizedEditorMarginPx}px; padding-right: ${normalizedEditorMarginPx}px; padding-bottom: 96px;`,
                class: `prose prose-slate max-w-none focus:outline-none min-h-[500px] outline-none ${className || ''}`,
            },
            handleKeyDown: (view, event) => {
                if (event.key === 'Tab') return false;
                return false;
            },
            // Handle click events for character mentions
            handleClick: (view, pos, event) => {
                const eventTarget = event.target as HTMLElement;
                const foreshadowingElement = eventTarget.closest('[data-foreshadowing-id]');
                if (foreshadowingElement) {
                    const id = foreshadowingElement.getAttribute('data-foreshadowing-id');
                    if (id && onForeshadowingClickRef.current) {
                        onForeshadowingClickRef.current(id);
                        return false;
                    }
                }

                const target = eventTarget.closest('.mention');

                // 3. Get latest function and state from Ref to prevent stale closures
                const clickHandler = onCharacterClickRef.current;
                const currentIsEditable = isEditableRef.current;

                if (target && clickHandler) {
                    const isModifierPressed = event.ctrlKey || event.metaKey;

                    // 4. Use latest state from Ref to determine if click should be handled
                    if (isModifierPressed || !currentIsEditable) {
                        const id = target.getAttribute('data-id');
                        if (id) {
                            clickHandler(id);
                            return true; // Prevent default behavior
                        }
                    }
                }
                return false;
            },
            // Handle context menu events for character mentions
            handleDOMEvents: {
                contextmenu: (view, event) => {
                    const target = event.target as HTMLElement;
                    // Detect if clicked on mention element
                    const mentionElement = target.closest('.mention');

                    if (mentionElement) {
                        event.preventDefault();

                        // Get position of mention element in document
                        const pos = view.posAtDOM(mentionElement, 0);
                        const node = view.state.doc.nodeAt(pos);

                        if (node && node.type.name === 'mention') {
                            setContextMenu({
                                type: 'mention',
                                x: event.clientX,
                                y: event.clientY,
                                pos: pos,
                                node: node
                            });
                            return true; // Prevent default menu behavior
                        }
                    }

                    const { from, to, empty } = view.state.selection;
                    if (!empty && isEditableRef.current) {
                        const selectedText = view.state.doc.textBetween(from, to, ' ').trim();
                        if (selectedText) {
                            event.preventDefault();
                            setContextMenu({
                                type: 'selection',
                                x: event.clientX,
                                y: event.clientY,
                                from,
                                to,
                                text: selectedText
                            });
                            return true;
                        }
                    }
                    return false;
                }
            },
            transformPastedHTML: transformPastedHtml,
        },
        // Initial content setup
        content: (() => {
            try { return JSON.parse(content); } catch (e) { return content; }
        })(),
        editable: isEditable,
        onUpdate: ({ editor }) => {
            // Core lock: if in silent update mode (like loading new chapter), return without triggering update callback
            if (isSilentUpdateRef.current) return;
            const json = editor.getJSON();
            const jsonString = JSON.stringify(json);
            // Record last emitted content from editor
            lastEmittedContentRef.current = jsonString;
            const text = editor.getText();
            const wordCount = calculateMixedWordCount(text);
            if (onUpdateRef.current) {
                onUpdateRef.current(jsonString, wordCount);
            }
        },
    }, [characters, autoHighlightCharacters]); // When characters change causing re-render, useEditor will automatically reinitialize with latest content property

    useEffect(() => {
        if (!editor || editor.isDestroyed) return;
        const editorElement = editor.view.dom;
        editorElement.style.lineHeight = String(normalizedEditorLineHeight);
        editorElement.style.paddingLeft = `${normalizedEditorMarginPx}px`;
        editorElement.style.paddingRight = `${normalizedEditorMarginPx}px`;
        editorElement.style.paddingBottom = '96px';
    }, [editor, normalizedEditorLineHeight, normalizedEditorMarginPx]);

    // Reference to store the last character data snapshot, to prevent frequent shuffling causing cursor jumps
    const prevCharactersStrRef = useRef<string | null>(null);

    // Whenever the character set changes (color, name, add, remove) — or whenever
    // the editor instance becomes available for the first time — fire a single
    // refresh transaction so AutoHighlight reconciles the document against the
    // latest character data.
    //
    // Important fix vs. the previous version: we only update `prevCharactersStrRef`
    // AFTER we've successfully run the refresh. Otherwise the very first render
    // (where `editor` is still null) would set the snapshot but skip the work,
    // and the subsequent render with the real editor would early-return because
    // the snapshot already matches.
    useEffect(() => {
        if (!editor || editor.isDestroyed) return;

        const currentCharsStr = JSON.stringify(
            characters.map(c => ({ id: c.id, name: c.name, aliases: c.aliases || [], color: c.color, role: c.role }))
        );
        const currentAutoHighlightCharsStr = JSON.stringify(autoHighlightCharacters.map(c => c.id));
        const currentHighlightSnapshot = `${currentCharsStr}|auto:${currentAutoHighlightCharsStr}`;
        if (prevCharactersStrRef.current === currentHighlightSnapshot) return;

        dlog('character-change effect: refreshing highlights', {
            previous: prevCharactersStrRef.current,
            next: currentHighlightSnapshot,
        });

        // Use the same meta-tagged transaction that the imperative
        // forceRefreshHighlights() uses, so AutoHighlight runs both reconcile
        // and pattern-match passes.
        try {
            const tr = editor.state.tr.setMeta('forceRefreshHighlights', true);
            editor.view.dispatch(tr);
        } catch (e) {
            dlog('character-change effect: dispatch failed', e);
        }

        prevCharactersStrRef.current = currentHighlightSnapshot;
    }, [editor, characters, autoHighlightCharacters]);


    // --- Content synchronization logic ---
    useEffect(() => {
        if (!editor) return;

        const isContentIdChanged = contentId !== lastContentIdRef.current;

        // Scenario 1: Switch chapter (ContentId change)
        if (isContentIdChanged) {
            isSilentUpdateRef.current = true; // Start silent update mode: all subsequent operations will not trigger onUpdate
            try {
                lastContentIdRef.current = contentId;
                lastEmittedContentRef.current = null;

                let newContentParsed;
                try { newContentParsed = JSON.parse(content); } catch (e) { newContentParsed = content; }

                // Force unlock to write content (even if current is read-only mode)
                const wasEditable = editor.isEditable;
                if (!wasEditable) editor.setEditable(true);

                // Write content to editor
                editor.commands.setContent(newContentParsed);

                // Key patch: immediately shuffling after content injection to ensure old JSON data is corrected
                forceDowngradeMentions(editor, characters);

                // Restore lock status
                if (!wasEditable) editor.setEditable(false);

                // Clear history to reset editor state (prevent undo to previous chapter)
                (editor.commands as any).clearHistory?.();
            } finally {
                // Always ensure silent update mode is disabled after operation
                isSilentUpdateRef.current = false;
            }
            return;
        }

        // Scenario 2: Same-chapter Props update (like AI continuation return)
        if (content === lastEmittedContentRef.current) return;

        const currentJSON = JSON.stringify(editor.getJSON());
        if (currentJSON !== content) {
            isSilentUpdateRef.current = true; // Start silent update mode: all subsequent operations will not trigger onUpdate
            try {
                let newContentParsed;
                try { newContentParsed = JSON.parse(content); } catch (e) { newContentParsed = content; }

                const wasEditable = editor.isEditable;
                if (!wasEditable) editor.setEditable(true);
                editor.commands.setContent(newContentParsed);

                // Key patch: immediately shuffling after content injection to ensure old JSON data is corrected
                forceDowngradeMentions(editor, characters);

                if (!wasEditable) editor.setEditable(false);
            } finally {
                isSilentUpdateRef.current = false;
            }
        }
    }, [content, contentId, editor]);

    // Sync Editable status (separate from content sync)
    useEffect(() => {
        if (editor && typeof isEditable === 'boolean') {
            if (editor.isEditable !== isEditable) {
                // Here, we don't need to be silent as the lock status change itself may require notification but not content change
                editor.setEditable(isEditable);
            }
        }
    }, [isEditable, editor]);

    useImperativeHandle(ref, () => ({
        // Low-level force style application
        insertContent: (text: string) => {
            if (editor) {
                // 1. Get current style attributes (snapshot)
                // This is the style at the current cursor position, which is the expected style for the new content to have
                const currentAttrs = editor.getAttributes('textStyle');
                const { fontFamily, fontSize } = currentAttrs;

                // 2. Record insertion position before content is inserted
                const start = editor.state.selection.from;

                // 3. Execute insertion (Tiptap will parse HTML/Text based on Schema)
                editor.commands.insertContent(text);

                // 4. Get new insertion position after content is inserted
                const end = editor.state.selection.from;

                // 5. If content is inserted, force apply style to the range inserted
                if (end > start && (fontFamily || fontSize)) {
                    // Build the style object to force apply
                    const stylesToApply: Record<string, any> = {};
                    if (fontFamily) stylesToApply.fontFamily = fontFamily;
                    if (fontSize) stylesToApply.fontSize = fontSize;

                    editor.chain()
                        // A. Select the range inserted just
                        .setTextSelection({ from: start, to: end })
                        // B. Force apply style mark (setMark will merge or overwrite existing marks)
                        .setMark('textStyle', stylesToApply)
                        // C. Restore cursor to the end of the inserted content range
                        .setTextSelection(end)
                        .run();
                }
            }
        },
        editor: editor,
        // Fix: Add getHTML method implementation to avoid error in parent component call
        getHTML: () => {
            return editor ? editor.getHTML() : '';
        },
        /**
         * Force refresh all character highlights in the editor.
         *
         * Strategy:
         *   1. Save the current selection so the cursor doesn't jump.
         *   2. Dispatch a single transaction carrying the
         *      `forceRefreshHighlights` meta. The AutoHighlight plugin watches
         *      for this meta and will then run BOTH passes:
         *        - reconcile existing mention attrs (color/label) against the
         *          latest character data, downgrading deleted ones to text;
         *        - pattern-match plain text and create fresh mention nodes
         *          (covers the case where a character was just renamed and the
         *          new name appears in the doc as plain text).
         *   3. Restore the saved selection.
         *
         * NB: we do NOT use editor.commands.setContent() anymore. setContent
         * resets ProseMirror history, fires onUpdate, and is heavy; a single
         * meta-tagged transaction is enough.
         */
        forceRefreshHighlights: () => {
            if (!editor || editor.isDestroyed) {
                dlog('forceRefreshHighlights: skipped (editor missing)');
                return;
            }

            const savedFrom = editor.state.selection.from;
            const savedTo = editor.state.selection.to;

            isSilentUpdateRef.current = true;
            try {
                dlog('forceRefreshHighlights: dispatching meta tx', {
                    characters: characters.map(c => ({ id: c.id, name: c.name, aliases: c.aliases || [], color: c.color })),
                });

                // A meta-only tx is NOT docChanged, so AutoHighlight checks for
                // the meta flag too (see plugin code).
                const tr = editor.state.tr.setMeta('forceRefreshHighlights', true);
                editor.view.dispatch(tr);

                // Restore selection (clamped to current doc size).
                try {
                    const docSize = editor.state.doc.content.size;
                    const from = Math.min(savedFrom, docSize);
                    const to = Math.min(savedTo, docSize);
                    editor.commands.setTextSelection({ from, to });
                } catch (e) {
                    dlog('forceRefreshHighlights: selection restore failed', e);
                }
            } finally {
                // Drop the silent flag on the next tick so any transactions
                // queued by ProseMirror finish first without re-emitting.
                setTimeout(() => { isSilentUpdateRef.current = false; }, 0);
            }
        },
        removeForeshadowing: (id: string) => {
            if (!editor || editor.isDestroyed) return;
            const markType = editor.state.schema.marks.foreshadowing;
            if (!markType) return;

            const tr = editor.state.tr;
            let modified = false;
            const targetMark = markType.create({ id });
            editor.state.doc.descendants((node: any, pos: number) => {
                if (!node.isInline) return;
                node.marks.forEach((mark: any) => {
                    if (mark.type === markType && mark.attrs.id === id) {
                        tr.removeMark(pos, pos + node.nodeSize, targetMark);
                        modified = true;
                    }
                });
            });
            if (modified) editor.view.dispatch(tr);
        },
        focusForeshadowing: (id: string) => {
            // Lowest-level approach: mimic how the browser's native Find works.
            // We do NOT touch ProseMirror selection/focus here — doing so was
            // fighting with chapter-switch "remember scroll position" logic and
            // with Tiptap's own scrollIntoView side-effect on focus.
            //
            // Foreshadowing mark renders as <span data-foreshadowing-id="...">,
            // so we can just locate it in the DOM and scroll its real scroll
            // ancestor to center on it.
            if (!editor || editor.isDestroyed) return false;
            const editorDom = editor.view.dom as HTMLElement;
            // CSS.escape guards against ids that contain special chars.
            const safeId = (typeof CSS !== 'undefined' && (CSS as any).escape)
                ? (CSS as any).escape(id)
                : id.replace(/["\\]/g, '\\$&');
            const target = editorDom.querySelector(
                `[data-foreshadowing-id="${safeId}"]`
            ) as HTMLElement | null;
            if (!target) {
                dlog('focusForeshadowing: target span not found in DOM', id);
                return false;
            }

            // Find the nearest scrollable ancestor of the editor. The actual
            // scroll container is the outer `overflow-y-auto` page region,
            // not the contenteditable itself.
            const findScrollParent = (el: HTMLElement | null): HTMLElement | null => {
                let cur: HTMLElement | null = el;
                while (cur && cur !== document.body && cur !== document.documentElement) {
                    const style = window.getComputedStyle(cur);
                    const overflowY = style.overflowY;
                    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')
                        && cur.scrollHeight > cur.clientHeight) {
                        return cur;
                    }
                    cur = cur.parentElement;
                }
                return null;
            };

            const scrollParent = findScrollParent(target.parentElement);
            const targetRect = target.getBoundingClientRect();
            const targetCenterY = targetRect.top + targetRect.height / 2;

            if (scrollParent) {
                const parentRect = scrollParent.getBoundingClientRect();
                // How far the target center is from the container's center (in viewport space).
                const delta = targetCenterY - (parentRect.top + scrollParent.clientHeight / 2);
                const maxTop = scrollParent.scrollHeight - scrollParent.clientHeight;
                const nextTop = Math.max(0, Math.min(maxTop, scrollParent.scrollTop + delta));
                scrollParent.scrollTo({ top: nextTop, behavior: 'smooth' });
            } else {
                // Fallback: scroll the window.
                const delta = targetCenterY - window.innerHeight / 2;
                window.scrollTo({ top: window.scrollY + delta, behavior: 'smooth' });
            }
            return true;
        }
    }));

    // Tooltip logic
    useEffect(() => {
        if (!editor || !characters) return;
        const editorElement = editor.options.element;
        // If a context menu is displayed, the tooltip is suppressed to avoid visual interference
        const handleMouseOver = createCharacterTooltipHandler({
            getCharacter: (charId) => characters.find(c => c.id === charId),
            shouldSuppress: () => !!contextMenu,
        });

        if ("addEventListener" in editorElement) {
            editorElement.addEventListener('mouseover', handleMouseOver);
        }

        return () => {
            if ("removeEventListener" in editorElement) {
                editorElement.removeEventListener('mouseover', handleMouseOver);
            }
        };
    }, [editor, characters, contextMenu, isEditable]);

    // NOTE: A duplicate content-sync useEffect previously lived here. It was the
    // root cause of the highlight-color bug: it ran AFTER the character-change
    // reconciliation effect and re-applied the OLD `content` prop (which still
    // carries old `data-color` mention attributes) via setContent() without
    // re-running forceDowngradeMentions afterward. AutoHighlight only converts
    // text→mention, so the stale mention attributes were never cleaned up.
    // The robust content-sync logic at line ~880 (which DOES re-downgrade after
    // setContent) is sufficient on its own, so this duplicate was removed.

    // Close menu when clicking elsewhere
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, []);

    // -----------------------------------------------------------------------
    // Debug helpers — enable by running `window.__DEBUG_HIGHLIGHTS__ = true`
    // in the browser console, then:
    //   - Cmd/Ctrl+Shift+H : force refresh highlights
    //   - Cmd/Ctrl+Shift+M : dump all mention nodes to console
    //   - window.__debugTiptap.getEditor()        : get editor instance
    //   - window.__debugTiptap.getCharacters()    : get current characters prop
    //   - window.__debugTiptap.inspectMentions()  : list mention nodes
    //   - window.__debugTiptap.forceRefresh()     : same as Cmd+Shift+H
    //   - window.__debugTiptap.diffMentions()     : show drift between mention
    //                                              attrs and the latest chars
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!editor || typeof window === 'undefined') return;

        const inspectMentions = () => {
            if (!editor || editor.isDestroyed) return [];
            const out: any[] = [];
            editor.state.doc.descendants((node: any, pos: number) => {
                if (node.type.name === 'mention') {
                    out.push({
                        pos,
                        id: node.attrs.id,
                        label: node.attrs.label,
                        color: node.attrs.color,
                    });
                }
            });
            return out;
        };

        const diffMentions = () => {
            const mentions = inspectMentions();
            const charById = new Map(characters.map(c => [c.id, c]));
            return mentions.map((m: any) => {
                const c = charById.get(m.id);
                if (!c) return { ...m, status: 'CHAR_DELETED' };
                const drifts: string[] = [];
                const displayTerms = getCharacterDisplayTerms(c);
                if (!displayTerms.includes(m.label)) drifts.push(`label "${m.label}" -> "${c.name}"`);
                if (c.color !== m.color) drifts.push(`color "${m.color}" -> "${c.color}"`);
                return drifts.length
                    ? { ...m, status: 'DRIFT', drifts, expected: { labels: displayTerms, color: c.color } }
                    : { ...m, status: 'OK' };
            });
        };

        const forceRefresh = () => {
            try {
                const tr = editor.state.tr.setMeta('forceRefreshHighlights', true);
                editor.view.dispatch(tr);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn('[TiptapHL] forceRefresh failed', e);
            }
        };

        (window as any).__debugTiptap = {
            getEditor: () => editor,
            getCharacters: () => characters,
            inspectMentions,
            diffMentions,
            forceRefresh,
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const mod = e.ctrlKey || e.metaKey;
            if (!mod || !e.shiftKey) return;
            if (e.key === 'H' || e.key === 'h') {
                e.preventDefault();
                // eslint-disable-next-line no-console
                console.log('[TiptapHL] manual refresh (Cmd/Ctrl+Shift+H)');
                forceRefresh();
            } else if (e.key === 'M' || e.key === 'm') {
                e.preventDefault();
                // eslint-disable-next-line no-console
                console.table(diffMentions());
            }
        };
        window.addEventListener('keydown', onKeyDown);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            if ((window as any).__debugTiptap?.getEditor?.() === editor) {
                delete (window as any).__debugTiptap;
            }
        };
    }, [editor, characters]);

    // Handle unmarking of mention nodes
    const handleUnmark = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent triggering close menu from clicking on mention node
        if (!editor || !contextMenu || contextMenu.type !== 'mention') return;
        const { pos, node } = contextMenu;

        // Extract text displayed by mention node (label priority, then id)
        const text = node.attrs.label || node.attrs.id;

        editor.chain()
            .focus()
            .command(({ tr, state }) => {
                // 1. Create a new text node with the mention text
                // 2. Inherit existing marks (like bold, italic, etc)
                // 3. Add ignoreAutoHighlight mark to prevent immediate re-highlighting
                const textNode = state.schema.text(text, [
                    ...node.marks,
                    state.schema.marks.ignoreAutoHighlight.create()
                ]);

                // Replace existing mention node with new text node
                tr.replaceWith(pos, pos + node.nodeSize, textNode);
                return true;
            })
            .run();

        setContextMenu(null);
    };

    const getForeshadowingSelection = (from: number, to: number) => {
        if (!editor) return null;
        const isSkippable = (char: string) => /[\s\u3000\u200B]/.test(char);
        const ranges: { from: number; to: number }[] = [];

        const getRangeText = (rangeFrom: number, rangeTo: number) => {
            const parts: string[] = [];
            editor.state.doc.nodesBetween(rangeFrom, rangeTo, (node: any, pos: number) => {
                if (node.isText && node.text) {
                    const localFrom = Math.max(0, rangeFrom - pos);
                    const localTo = Math.min(node.text.length, rangeTo - pos);
                    parts.push(node.text.slice(localFrom, localTo));
                    return false;
                }

                if (node.type.name === 'mention') {
                    parts.push(node.attrs.label || node.attrs.id || '');
                    return false;
                }

                if (node.type.name === 'hardBreak') {
                    parts.push(' ');
                    return false;
                }

                return true;
            });
            return parts.join('');
        };

        editor.state.doc.nodesBetween(from, to, (node: any, pos: number) => {
            if (!node.isTextblock) return;

            const blockStart = pos + 1;
            const blockEnd = pos + node.nodeSize - 1;
            const selectedFrom = Math.max(from, blockStart);
            const selectedTo = Math.min(to, blockEnd);
            if (selectedFrom >= selectedTo) return false;

            let atLineStart = true;
            node.descendants((child: any, childPos: number) => {
                const childFrom = blockStart + childPos;
                const childTo = childFrom + child.nodeSize;
                if (childTo <= selectedFrom || childFrom >= selectedTo) {
                    if (child.type.name === 'hardBreak') {
                        atLineStart = true;
                    } else if (child.isText && child.text && [...child.text].some(char => !isSkippable(char))) {
                        atLineStart = false;
                    } else if (child.isInline && !child.isText) {
                        atLineStart = false;
                    }
                    return false;
                }

                if (child.type.name === 'hardBreak') {
                    atLineStart = true;
                    return false;
                }

                if (child.isText && child.text) {
                    const rangeFrom = Math.max(selectedFrom, childFrom);
                    const rangeTo = Math.min(selectedTo, childTo);
                    const localFrom = Math.max(0, rangeFrom - childFrom);
                    const localTo = Math.min(child.text.length, rangeTo - childFrom);
                    const prefix = child.text.slice(0, localFrom);
                    if (atLineStart && [...prefix].some(char => !isSkippable(char))) {
                        atLineStart = false;
                    }

                    let trimStart = localFrom;
                    let trimEnd = localTo;
                    if (atLineStart) {
                        while (trimStart < trimEnd && isSkippable(child.text[trimStart])) trimStart++;
                    }
                    while (trimEnd > trimStart && isSkippable(child.text[trimEnd - 1])) trimEnd--;

                    if (trimStart < trimEnd) {
                        ranges.push({ from: childFrom + trimStart, to: childFrom + trimEnd });
                    }
                    if ([...child.text].some(char => !isSkippable(char))) {
                        atLineStart = false;
                    }
                    return false;
                }

                if (child.isInline) {
                    ranges.push({
                        from: Math.max(selectedFrom, childFrom),
                        to: Math.min(selectedTo, childTo)
                    });
                    atLineStart = false;
                    return false;
                }

                return true;
            });

            return false;
        });

        if (ranges.length === 0) return null;
        const text = ranges
            .map(range => getRangeText(range.from, range.to))
            .join(' ')
            .replace(/[\s\u3000]+/g, ' ')
            .trim();
        if (!text) return null;
        return { ranges, text };
    };

    const handleAddForeshadowing = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!editor || !contextMenu || contextMenu.type !== 'selection') return;

        const foreshadowingSelection = getForeshadowingSelection(contextMenu.from, contextMenu.to);
        if (!foreshadowingSelection) {
            setContextMenu(null);
            return;
        }

        const id = `fs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const excerpt = foreshadowingSelection.text.length > 120
            ? `${foreshadowingSelection.text.slice(0, 120)}...`
            : foreshadowingSelection.text;
        const now = Date.now();
        const mark = editor.state.schema.marks.foreshadowing.create({ id });
        const tr = editor.state.tr;
        foreshadowingSelection.ranges.forEach(range => {
            tr.addMark(range.from, range.to, mark);
        });
        tr.setSelection(TextSelection.near(tr.doc.resolve(foreshadowingSelection.ranges[0].from)));

        editor.commands.focus();
        editor.view.dispatch(tr);

        onForeshadowingCreateRef.current?.({
            id,
            excerpt,
            note: '',
            isRecovered: false,
            createdAt: now,
            updatedAt: now,
        });
        setContextMenu(null);
    };

    if (!editor) return <div className="flex items-center justify-center p-12"><Loader2 className="animate-spin text-slate-400" /></div>;

    return (
        <div className="w-full flex flex-col relative">
            <style>{`
                .tippy-box {
                    background-color: transparent !important;
                    box-shadow: none !important;
                    color: inherit !important;
                }
                .tippy-content {
                    padding: 0 !important;
                }
                .tippy-arrow {
                    color: white !important;
                }
                .mention {
                    cursor: pointer;
                    font-size: inherit; 
                    font-family: inherit;
                }
                .foreshadowing-mark {
                    text-decoration-line: underline;
                    text-decoration-style: dashed;
                    text-decoration-color: #94a3b8;
                    text-underline-offset: 4px;
                    cursor: pointer;
                    border-radius: 2px;
                }
                .foreshadowing-mark:hover {
                    background: rgba(148, 163, 184, 0.12);
                }
                .ProseMirror p.is-editor-empty:first-child::before {
                    color: #94a3b8;
                    content: attr(data-placeholder);
                    float: left;
                    height: 0;
                    pointer-events: none;
                }
                .ProseMirror p {
                    margin-top: 0em; 
                    margin-bottom: 0em;
                }
                .dark .ProseMirror {
                    color: #e2e8f0;
                }
                .ProseMirror h1, .ProseMirror h2, .ProseMirror h3 {
                    margin-top: 1em;
                    margin-bottom: 0.5em;
                    line-height: 1.2;
                }
            `}</style>

            <MenuBar editor={editor} isEditable={isEditable} onToggleReadOnly={onToggleReadOnly} />
            <div className="mt-4 h-px w-full"></div>
            <div className="flex-1 cursor-text" onClick={() => editor.chain().focus().run()}>
                <EditorContent editor={editor} />
            </div>

            {/* Custom Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl rounded-md py-1 min-w-[150px] animate-in fade-in zoom-in duration-100"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()} // Prevent closing menu when clicking inside
                >
                    {contextMenu.type === 'mention' ? (
                        <button
                            onClick={handleUnmark}
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                        >
                            <RemoveFormatting size={14} className="text-slate-400" />
                            <span>Unmark</span>
                        </button>
                    ) : (
                        <button
                            onClick={handleAddForeshadowing}
                            className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                        >
                            <MessageSquarePlus size={14} className="text-slate-400" />
                            <span>Add Foreshadowing</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});

export default TiptapEditor;
