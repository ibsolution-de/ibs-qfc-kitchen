import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from './Modal';

const TestModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => (
  <Modal isOpen={isOpen} onClose={onClose} title="Test Modal">
    <button type="button" onClick={onClose}>Confirm</button>
    <input type="text" placeholder="Enter value" />
    <a href="https://example.com">Link</a>
  </Modal>
);

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const onClose = vi.fn();
    render(<TestModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has required aria attributes when open', () => {
    render(<TestModal isOpen={true} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');

    const title = dialog.querySelector('h3');
    expect(title).toHaveAttribute('id', dialog.getAttribute('aria-labelledby'));
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);
    const backdrop = screen.getByRole('presentation');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close on panel click', () => {
    const onClose = vi.fn();
    render(<TestModal isOpen={true} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses the first focusable element on open', async () => {
    const { rerender } = render(<TestModal isOpen={false} onClose={vi.fn()} />);

    rerender(<TestModal isOpen={true} onClose={vi.fn()} />);
    // Let React effects flush
    await new Promise(resolve => setTimeout(resolve, 0));

    const closeButton = document.querySelector('button[aria-label="Close"]');
    expect(closeButton).toHaveFocus();
  });

  it('cycles focus within the modal with Tab', async () => {
    const user = userEvent.setup();
    render(<TestModal isOpen={true} onClose={vi.fn()} />);

    // Initial focus from the trap is the close button
    const closeButton = document.querySelector('button[aria-label="Close"]');
    expect(closeButton).toHaveFocus();

    await user.tab();
    expect(screen.getByText('Confirm')).toHaveFocus();

    await user.tab();
    expect(screen.getByPlaceholderText('Enter value')).toHaveFocus();

    await user.tab();
    expect(screen.getByText('Link')).toHaveFocus();

    await user.tab();
    expect(closeButton).toHaveFocus();
  });

  it('cycles focus backwards with Shift+Tab', async () => {
    const user = userEvent.setup();
    render(<TestModal isOpen={true} onClose={vi.fn()} />);

    const closeButton = document.querySelector('button[aria-label="Close"]') as HTMLElement;
    await user.click(closeButton);
    expect(closeButton).toHaveFocus();

    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByText('Link')).toHaveFocus();
  });
});
