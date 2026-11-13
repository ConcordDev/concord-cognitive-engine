import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmCard } from './ConfirmCard';
import type { ConfirmCardData } from '@/lib/cockpit/run-client';

const card = (over: Partial<ConfirmCardData> = {}): ConfirmCardData => ({
  runId: 'run_1', stepId: 'stp_1', kind: 'confirm', label: 'Save a note', goal: 'Save the design', risk: 'write',
  changes: ['This saves or changes something in your account.'], args: [{ name: 'Title', value: 'Garage beam' }], ...over,
});
const noop = () => {};

describe('ConfirmCard', () => {
  it('has the don\'t-ask-again box for write but not for high risk', () => {
    const { unmount } = render(<ConfirmCard card={card()} busy={false} onApprove={noop} onReject={noop} onAnswer={noop} />);
    expect(screen.queryByLabelText(/don.t ask again/i)).not.toBeNull();
    unmount();
    render(<ConfirmCard card={card({ risk: 'high' })} busy={false} onApprove={noop} onReject={noop} onAnswer={noop} />);
    expect(screen.queryByLabelText(/don.t ask again/i)).toBeNull();
  });

  it('editing a value and approving sends the edited value by arg name', () => {
    const onApprove = vi.fn();
    render(<ConfirmCard card={card()} busy={false} onApprove={onApprove} onReject={noop} onAnswer={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Shed beam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith({ Title: 'Shed beam' }, false);
  });

  it('plain approve sends no edits', () => {
    const onApprove = vi.fn();
    render(<ConfirmCard card={card()} busy={false} onApprove={onApprove} onReject={noop} onAnswer={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(undefined, false);
  });

  it('every button is disabled while busy', () => {
    render(<ConfirmCard card={card()} busy onApprove={noop} onReject={noop} onAnswer={noop} />);
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('a question card renders an input and calls onAnswer', () => {
    const onAnswer = vi.fn();
    render(<ConfirmCard card={card({ kind: 'question', label: 'Which span?' })} busy={false} onApprove={noop} onReject={noop} onAnswer={onAnswer} />);
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: '12 feet' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith('12 feet');
  });

  it('shows no JSON and no tool id', () => {
    const { container } = render(<ConfirmCard card={card()} busy={false} onApprove={noop} onReject={noop} onAnswer={noop} />);
    expect(container.textContent).not.toMatch(/[{}]|create_dtu|lens:/);
  });
});
