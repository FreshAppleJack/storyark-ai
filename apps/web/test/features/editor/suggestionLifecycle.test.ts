import { beforeEach, describe, expect, it, vi } from 'vitest';

const tippyInstance = () => ({ destroy: vi.fn(), hide: vi.fn(), setProps: vi.fn() });
const tippyMock = vi.hoisted(() => ({ instances: [] as ReturnType<typeof tippyInstance>[] }));

vi.mock('tippy.js', () => ({
    default: vi.fn(() => {
        const instance = tippyInstance();
        tippyMock.instances.push(instance);
        return [instance];
    }),
}));

const rendererMock = vi.hoisted(() => ({ instances: [] as Array<{ updateProps: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> }));

vi.mock('@tiptap/react', () => ({
    // A plain function (not an arrow) so `new ReactRenderer(...)` works.
    ReactRenderer: function MockRenderer(this: Record<string, unknown>) {
        const instance = { updateProps: vi.fn(), destroy: vi.fn(), ref: null, element: document.createElement('div') };
        rendererMock.instances.push(instance);
        Object.assign(this, instance);
    },
}));

import { createMentionSuggestion } from '../../../features/editor/integrations/mentionSuggestion';

beforeEach(() => {
    tippyMock.instances.length = 0;
    rendererMock.instances.length = 0;
});

function createRender() {
    const suggestion = createMentionSuggestion(() => []);
    const render = suggestion!.render!;
    return render();
}

const rect = () => vi.fn(() => new DOMRect());

describe('mention suggestion popup lifecycle', () => {
    it('destroys the ReactRenderer even when no popup was created (missing clientRect)', () => {
        const lifecycle = createRender();
        lifecycle.onStart({ editor: {} as never, clientRect: undefined } as never);

        expect(() => lifecycle.onExit({} as never)).not.toThrow();
        expect(rendererMock.instances[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('destroys both the popup and the renderer on a normal exit', () => {
        const lifecycle = createRender();
        lifecycle.onStart({ editor: {} as never, clientRect: rect() } as never);
        lifecycle.onExit({} as never);

        expect(tippyMock.instances[0].destroy).toHaveBeenCalledTimes(1);
        expect(rendererMock.instances[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('tolerates updates and Escape before the popup exists', () => {
        const lifecycle = createRender();
        lifecycle.onStart({ editor: {} as never, clientRect: undefined } as never);

        expect(() => lifecycle.onUpdate({ clientRect: rect() } as never)).not.toThrow();
        expect(lifecycle.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) } as never)).toBe(true);
        expect(() => lifecycle.onExit({} as never)).not.toThrow();
    });

    it('hides the popup on Escape and updates its position while open', () => {
        const lifecycle = createRender();
        lifecycle.onStart({ editor: {} as never, clientRect: rect() } as never);

        lifecycle.onUpdate({ clientRect: rect() } as never);
        expect(tippyMock.instances[0].setProps).toHaveBeenCalledTimes(1);

        expect(lifecycle.onKeyDown({ event: new KeyboardEvent('keydown', { key: 'Escape' }) } as never)).toBe(true);
        expect(tippyMock.instances[0].hide).toHaveBeenCalledTimes(1);
    });
});
