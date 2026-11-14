/**
 * GB-1538 / FIX-cri-003 — the Crisis panel's event-type select was
 * controlled with state '' but had no placeholder option, so the browser
 * displayed 'outage' while the state stayed empty and Severity answered
 * 'Event type required.' against a visibly selected type. The combined
 * numeric check also blamed both fields when only one was missing, and
 * the duration input was placeholder-only. Pins: the select starts on a
 * real placeholder, and Severity names the one field actually missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({ children, ...p }: Record<string, unknown>) => React.createElement('div', p, children as React.ReactNode),
  },
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import { CrisisActionPanel } from '@/components/cri/CrisisActionPanel';

function setup() {
  const utils = render(<CrisisActionPanel />);
  const name = screen.getByPlaceholderText(/Crisis name/);
  const select = utils.container.querySelector('select') as HTMLSelectElement;
  const affected = screen.getByPlaceholderText('affected count');
  const duration = screen.getByPlaceholderText('duration hours');
  const severityBtn = Array.from(utils.container.querySelectorAll('button'))
    .find((b) => b.textContent?.includes('Severity')) as HTMLButtonElement;
  return { ...utils, name, select, affected, duration, severityBtn };
}

describe('CrisisActionPanel event-type + field validation (FIX-cri-003)', () => {
  beforeEach(() => { runDomainMock.mockReset(); });
  afterEach(() => { cleanup(); });

  it('the event-type select starts on the placeholder, not a phantom first option', () => {
    const { select } = setup();
    expect(select.value).toBe('');
    expect(select.selectedOptions[0]?.textContent).toMatch(/Select event type/);
  });

  it('Severity with only duration missing names duration alone', () => {
    const { name, select, affected, severityBtn } = setup();
    fireEvent.change(name, { target: { value: 'east-region power outage' } });
    fireEvent.change(select, { target: { value: 'outage' } });
    fireEvent.change(affected, { target: { value: '1200' } });
    fireEvent.click(severityBtn);
    expect(screen.getByText('Duration hours required.')).toBeTruthy();
    expect(screen.queryByText('Affected count required.')).toBeNull();
    expect(runDomainMock).not.toHaveBeenCalled();
  });

  it('Severity with only the affected count missing names it alone', () => {
    const { name, select, duration, severityBtn } = setup();
    fireEvent.change(name, { target: { value: 'east-region power outage' } });
    fireEvent.change(select, { target: { value: 'outage' } });
    fireEvent.change(duration, { target: { value: '6' } });
    fireEvent.click(severityBtn);
    expect(screen.getByText('Affected count required.')).toBeTruthy();
    expect(screen.queryByText(/Duration hours required/)).toBeNull();
  });

  it('the duration input carries a persistent label', () => {
    const { container } = setup();
    expect(container.textContent).toContain('Duration hours');
    expect(screen.getByLabelText('Event type')).toBeTruthy();
  });
});
