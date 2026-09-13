import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RangeControl } from '../../../features/settings/components/SettingControls';

describe('RangeControl', () => {
    it('places the Default marker at the configured default value', () => {
        render(
            <RangeControl
                label="Context length"
                valueLabel="2000 chars"
                minLabel="500"
                maxLabel="6000"
                defaultValue={2000}
                value={2000}
                min={500}
                max={6000}
                step={250}
                onChange={vi.fn()}
            />,
        );

        expect(screen.getByText('Default')).toHaveStyle({ left: `${((2000 - 500) / (6000 - 500)) * 100}%` });
    });
});
