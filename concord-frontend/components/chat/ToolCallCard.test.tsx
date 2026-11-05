import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToolCallCard, lensActionLabel, type ToolCall } from './ToolCallCard';

// "It keeps saying lens.action undefined": cards for records without
// params (saved messages, chat.respond results) used to render
// "Lens Action undefined.undefined".
describe('ToolCallCard lens label', () => {
  it('labels from params, top-level domain/action, or key', () => {
    expect(lensActionLabel({ tool: 'run_lens_action', ok: true, result: null, params: { domain: 'fitness', action: 'plan-list' } })).toBe('fitness.plan-list');
    expect(lensActionLabel({ tool: 'run_lens_action', ok: true, result: null, params: {}, domain: 'fitness', action: 'plan-create' } as ToolCall)).toBe('fitness.plan-create');
    expect(lensActionLabel({ tool: 'run_lens_action', ok: true, result: null, key: 'fitness.workout-plan-generate' } as unknown as ToolCall)).toBe('fitness.workout-plan-generate');
    expect(lensActionLabel({ tool: 'run_lens_action', ok: false, result: null } as unknown as ToolCall)).toBe('');
  });

  it('never renders "undefined" for a saved record with no params', () => {
    const { container } = render(<ToolCallCard call={{ tool: 'run_lens_action', ok: true } as unknown as ToolCall} />);
    expect(container.textContent).not.toMatch(/undefined/);
    expect(screen.getByText('Lens Action')).toBeTruthy();
  });

  it('shows the lens action when the record has it', () => {
    render(<ToolCallCard call={{ tool: 'run_lens_action', ok: true, result: null, params: { domain: 'realestate', action: 'cap-rate' } }} />);
    expect(screen.getByText('realestate.cap-rate')).toBeTruthy();
  });
});
