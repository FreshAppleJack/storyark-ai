import { isTauri } from '@tauri-apps/api/core';

function isOverSelectedText(event: MouseEvent): boolean {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
    // Keyboard context-menu requests have no pointer position.
    if (event.clientX === 0 && event.clientY === 0 && event.button !== 2) return true;
    for (let index = 0; index < selection.rangeCount; index++) {
        for (const rect of selection.getRangeAt(index).getClientRects()) {
            if (event.clientX >= rect.left && event.clientX <= rect.right
                && event.clientY >= rect.top && event.clientY <= rect.bottom) return true;
        }
    }
    return false;
}

export function installNativeContextMenuPolicy(): () => void {
    if (!isTauri()) return () => {};
    const onContextMenu = (event: MouseEvent) => {
        if (event.defaultPrevented) return;
        const target = event.target instanceof Element
            ? event.target : event.target instanceof Node ? event.target.parentElement : null;
        if (target?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]')) return;
        if (isOverSelectedText(event)) return;
        // Bubble after application menus; suppress only the WebView's default action.
        event.preventDefault();
    };
    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
}
