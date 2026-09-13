import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AiModels } from '../../../features/settings/components/AiModels';

const mocks = vi.hoisted(() => ({ useAiSettings: vi.fn() }));

vi.mock('../../../features/settings/useAiSettings', () => ({ useAiSettings: mocks.useAiSettings }));

function createSettings(overrides: Record<string, unknown> = {}) {
    return {
        data: null,
        editing: true,
        selected: null,
        form: {
            name: 'Test',
            protocol: 'openai-chat-completions' as const,
            baseUrl: 'https://example.com/v1',
            modelId: 'model',
            timeoutMs: 60000,
            maxOutputTokens: 100000,
        },
        key: '',
        remember: false,
        dirty: false,
        busy: false,
        error: '',
        saved: false,
        testStatus: '',
        reload: vi.fn(),
        edit: vi.fn(),
        cancel: vi.fn(),
        save: vi.fn(),
        test: vi.fn(),
        change: vi.fn(),
        changeKey: vi.fn(),
        changeRemember: vi.fn(),
        makeDefault: vi.fn(),
        remove: vi.fn(),
        ...overrides,
    };
}

describe('AiModels', () => {
    it('allows a numeric limit to be cleared before entering a replacement value', async () => {
        const user = userEvent.setup();
        const settings = createSettings();
        mocks.useAiSettings.mockReturnValue(settings);
        render(<AiModels />);

        const outputLimit = screen.getByLabelText('Provider output cap (tokens)');
        expect(outputLimit).toHaveAttribute('type', 'text');
        expect(outputLimit).toHaveAttribute('inputmode', 'numeric');

        await user.clear(outputLimit);
        expect(outputLimit).toHaveValue('');

        await user.type(outputLimit, '4096');
        expect(outputLimit).toHaveValue('100000');
        expect(settings.change).toHaveBeenLastCalledWith({ maxOutputTokens: 4096 });
    });

    it('restores the previous value when a numeric limit is left blank', async () => {
        const user = userEvent.setup();
        const settings = createSettings();
        mocks.useAiSettings.mockReturnValue(settings);
        render(<AiModels />);

        const outputLimit = screen.getByLabelText('Provider output cap (tokens)');
        await user.clear(outputLimit);
        await user.tab();

        expect(outputLimit).toHaveValue('4096');
        expect(settings.change).not.toHaveBeenCalled();
    });

    it('keeps model actions in equal-sized button slots', () => {
        const settings = createSettings({
            editing: false,
            data: {
                configs: [{
                    id: 'config-1',
                    config: { name: 'Test', modelId: 'model', baseUrl: 'https://example.com/v1' },
                    configVersion: 1,
                    credentialMode: 'system',
                    credentialStatus: 'configured',
                }],
                defaultConfigId: 'config-1',
                databaseVersion: 2,
                cleanupPending: false,
            },
        });
        mocks.useAiSettings.mockReturnValue(settings);
        render(<AiModels />);

        for (const label of ['Edit', 'Test connection', 'Clear default', 'Delete']) {
            expect(screen.getByRole('button', { name: label })).toHaveClass('h-9', 'w-full');
        }
    });
});
