import { describe, expect, it } from 'vitest';
import { getSidebarLayout, readSidebarWidths, MIN_WRITING_WIDTH } from '../../../features/editor/sidebarLayout';

describe('editor sidebar layout', () => {
    it('keeps the existing desktop defaults when space permits', () => {
        expect(getSidebarLayout(1920, { left: null, right: 288 }, true, true))
            .toMatchObject({ leftWidth: 384, rightWidth: 288, leftOverlay: false, rightOverlay: false });
        expect(getSidebarLayout(1200, { left: null, right: 288 }, true, false).leftWidth).toBe(320);
    });

    it('allows both panels to reach their maximum on a wide window', () => {
        expect(getSidebarLayout(1920, { left: 560, right: 480 }, true, true))
            .toMatchObject({ leftWidth: 560, rightWidth: 480, leftMax: 560, rightMax: 480 });
    });

    it('preserves writing space for all supported desktop sizes and panel states', () => {
        for (let width = 900; width <= 2400; width += 10) {
            for (const leftExpanded of [false, true]) {
                for (const rightOpen of [false, true]) {
                    const layout = getSidebarLayout(width, { left: 560, right: 480 }, leftExpanded, rightOpen);
                    const writingWidth = width - (layout.leftOverlay ? 0 : layout.leftWidth)
                        - (rightOpen && !layout.rightOverlay ? layout.rightWidth : 0);
                    expect(writingWidth).toBeGreaterThanOrEqual(MIN_WRITING_WIDTH);
                    expect(layout.leftWidth).toBeGreaterThanOrEqual(leftExpanded ? 280 : 64);
                    if (rightOpen) expect(layout.rightWidth).toBeGreaterThanOrEqual(240);
                }
            }
        }
    });

    it('uses an overlay when three usable columns cannot fit', () => {
        expect(getSidebarLayout(1000, { left: null, right: 288 }, true, true))
            .toMatchObject({ leftWidth: 320, rightWidth: 288, rightOverlay: true });
        expect(getSidebarLayout(1080, { left: null, right: 288 }, true, true))
            .toMatchObject({ leftWidth: 280, rightWidth: 240, rightOverlay: false });
    });

    it('restores preferred widths after the window grows or panels reopen', () => {
        const preferred = { left: 500, right: 420 };
        expect(getSidebarLayout(1200, preferred, true, true).leftWidth).toBeLessThan(500);
        expect(getSidebarLayout(1920, preferred, false, false).leftWidth).toBe(64);
        expect(getSidebarLayout(1920, preferred, true, true))
            .toMatchObject({ leftWidth: 500, rightWidth: 420 });
        expect(preferred).toEqual({ left: 500, right: 420 });
    });

    it('treats invalid saved preferences as defaults and clamps out-of-range values', () => {
        for (const raw of [null, '', 'invalid', 'null', '{"left":"500","right":"400"}']) {
            expect(readSidebarWidths(raw)).toEqual({ left: null, right: 288 });
        }
        expect(readSidebarWidths('{"left":9999,"right":-50}')).toEqual({ left: 560, right: 240 });
        expect(readSidebarWidths('{"left":null,"right":400}')).toEqual({ left: null, right: 400 });
    });
});
