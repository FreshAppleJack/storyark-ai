import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { installNativeContextMenuPolicy } from '../../src/nativeContextMenu';

const native = vi.hoisted(() => ({ isTauri: vi.fn(() => true) }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: native.isTauri }));

let removePolicy: (() => void) | undefined;
afterEach(() => {
    removePolicy?.();
    removePolicy = undefined;
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    native.isTauri.mockReturnValue(true);
});

function rightClick(target: Element, clientX = 10, clientY = 10): MouseEvent {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY });
    target.dispatchEvent(event);
    return event;
}

describe('desktop native context menus', () => {
    it('suppresses the default menu on blank areas without stopping propagation', () => {
        const { container } = render(<main><div>Blank area</div></main>);
        removePolicy = installNativeContextMenuPolicy();
        const observer = vi.fn();
        window.addEventListener('contextmenu', observer, { once: true });
        expect(rightClick(container.querySelector('main')!).defaultPrevented).toBe(true);
        expect(observer).toHaveBeenCalledOnce();
    });

    it('keeps application menus, including editor mention and selection menus, responsive', () => {
        const openMenu = vi.fn();
        const { getByText } = render(<div contentEditable suppressContentEditableWarning onContextMenu={event => {
            event.preventDefault();
            openMenu();
        }}><span>Character name</span></div>);
        removePolicy = installNativeContextMenuPolicy();
        fireEvent.contextMenu(getByText('Character name'));
        expect(openMenu).toHaveBeenCalledOnce();
    });

    it('preserves native editing menus in form controls and editable descendants', () => {
        const { container } = render(<><input /><textarea /><select /><div contentEditable><span>Draft</span></div></>);
        removePolicy = installNativeContextMenuPolicy();
        for (const target of container.querySelectorAll('input, textarea, select, span')) {
            expect(rightClick(target).defaultPrevented).toBe(false);
        }
    });

    it('keeps copying selected text available but still suppresses clicks outside the selection', () => {
        const { getByText, container } = render(<main><p>Selected text</p></main>);
        const range = document.createRange();
        range.selectNodeContents(getByText('Selected text'));
        window.getSelection()!.addRange(range);
        // JSDOM has no layout API; supply the bounds of the selected passage.
        Object.defineProperty(range, 'getClientRects', { value: () => [
            { left: 10, right: 100, top: 10, bottom: 30 },
        ] });
        removePolicy = installNativeContextMenuPolicy();
        expect(rightClick(getByText('Selected text'), 20, 20).defaultPrevented).toBe(false);
        expect(rightClick(container.querySelector('main')!, 200, 200).defaultPrevented).toBe(true);
        const keyboardMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        getByText('Selected text').dispatchEvent(keyboardMenu);
        expect(keyboardMenu.defaultPrevented).toBe(false);
    });

    it('leaves browser preview untouched and removes the listener on cleanup', () => {
        native.isTauri.mockReturnValue(false);
        removePolicy = installNativeContextMenuPolicy();
        expect(rightClick(document.body).defaultPrevented).toBe(false);
        native.isTauri.mockReturnValue(true);
        removePolicy = installNativeContextMenuPolicy();
        expect(rightClick(document.body).defaultPrevented).toBe(true);
        removePolicy();
        expect(rightClick(document.body).defaultPrevented).toBe(false);
    });
});
