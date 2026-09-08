import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../../components/ui/Button';

describe('Button', () => {
  it('calls its click handler when the user activates it', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<Button onClick={handleClick}>Create book</Button>);

    const button = screen.getByRole('button', { name: 'Create book' });
    expect(button).toBeEnabled();

    await user.click(button);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call its click handler while disabled', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <Button disabled onClick={handleClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();

    await user.click(button);

    expect(handleClick).not.toHaveBeenCalled();
  });
});
