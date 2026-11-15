// The signed/unsigned verdict must render inline with the molecular-weight
// answer, read from the lens/run envelope (siblings of `result`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', () => {
  const createIcon = (name: string) => {
    const Component = (props: Record<string, unknown>) => React.createElement('span', { 'data-testid': `icon-${name}`, ...props });
    Component.displayName = name;
    return Component;
  };
  return {
    X: createIcon('X'), Loader2: createIcon('Loader2'), Beaker: createIcon('Beaker'),
    Atom: createIcon('Atom'), Calculator: createIcon('Calculator'), Activity: createIcon('Activity'),
    FlaskConical: createIcon('FlaskConical'),
  };
});

const postMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ api: { post: (...a: unknown[]) => postMock(...a) } }));

import { ChemWorkbench } from '@/components/chem/ChemWorkbench';
import { SigningStatus, signingInfoFrom, describeUnsignedReason } from '@/components/chem/SigningStatus';

const mw = { formula: 'H2O', molecularWeight: 18.015, units: 'g/mol', components: [] };
const envelope = (extra: Record<string, unknown>) => ({ data: { ok: true, result: { ok: true, result: mw, ...extra } } });

describe('chem signing status, inline with the answer', () => {
  beforeEach(() => postMock.mockReset());
  afterEach(() => cleanup());

  it('unsigned envelope: warning + reason shown next to the number', async () => {
    postMock.mockResolvedValue(envelope({ signed: false, saved: false, reason: 'outside_envelope:no_standard_atomic_weight:Tc' }));
    render(React.createElement(ChemWorkbench, { open: true, onClose: () => {} }));
    const warn = await screen.findByTestId('signing-status-unsigned');
    expect(warn.textContent).toContain("Unsigned — no verified reference; don't rely on this for sign-off");
    expect(warn.textContent).toContain('no standard atomic weight');
    expect(warn.textContent).toContain('Tc');
    expect(screen.queryByTestId('signing-status-signed')).toBeNull();
    // same result card as the number
    expect(warn.closest('div.p-3')?.textContent).toContain('18.015');
  });

  it('signed envelope: signed marker shown, no unsigned warning', async () => {
    postMock.mockResolvedValue(envelope({ signed: true, saved: true, receiptId: 'rcpt_abc12345' }));
    render(React.createElement(ChemWorkbench, { open: true, onClose: () => {} }));
    const ok = await screen.findByTestId('signing-status-signed');
    expect(ok.textContent).toContain('Signed');
    expect(ok.textContent).toContain('rcpt_abc12345');
    expect(screen.queryByTestId('signing-status-unsigned')).toBeNull();
    expect(screen.queryByText(/Unsigned/)).toBeNull();
  });

  it('an envelope with no signing fields is treated as unsigned, never as signed', async () => {
    postMock.mockResolvedValue({ data: { ok: true, result: { ok: true, result: mw } } });
    render(React.createElement(ChemWorkbench, { open: true, onClose: () => {} }));
    await waitFor(() => expect(screen.getByTestId('signing-status-unsigned')).toBeTruthy());
  });

  it('SigningStatus unit: reasons are human-readable and null info renders nothing', () => {
    expect(describeUnsignedReason('missing_reference')).toBe('no verified reference for this calculation');
    expect(signingInfoFrom({ signed: 'yes' }).signed).toBe(false);
    const { container } = render(React.createElement(SigningStatus, { info: null }));
    expect(container.textContent).toBe('');
  });
});
