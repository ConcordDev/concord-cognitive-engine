/**
 * Delete confirms must stay armed until the user confirms or cancels.
 * A 4s timeout raced the click (FIX-hvac-013).
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';

describe('StickyDeleteConfirm', () => {
  it('keeps itself armed until confirm, without a parent timer', () => {
    const onConfirm = vi.fn();
    render(<StickyDeleteConfirm onConfirm={onConfirm} confirmAriaLabel="Confirm delete world" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm delete world' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete world' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('arms on the first click and does not delete until confirm', () => {
    const onArm = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <StickyDeleteConfirm armed={false} onArm={onArm} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(<StickyDeleteConfirm armed onArm={onArm} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stays armed across the old 4s auto-dismiss window', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<StickyDeleteConfirm armed onArm={vi.fn()} onConfirm={onConfirm} onCancel={vi.fn()} />);
    vi.advanceTimersByTime(5000);
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('cancel disarms without deleting', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<StickyDeleteConfirm armed onArm={vi.fn()} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
