// ChemMWStaleResponse.test.tsx
//
// FIX-chem-004: the Molar Mass tab auto-calculates the default
// compound on mount; a user's Calc for a new formula could be painted
// over by the earlier request resolving late, so the first click
// appeared to show the previous compound's result and only the second
// click updated. A sequence guard now lets only the latest issued
// request paint. This pin resolves two requests out of order.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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

interface Deferred { promise: Promise<unknown>; resolve: (v: unknown) => void }
function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}
const mwResponse = (formula: string, molecularWeight: number) => ({
  data: { ok: true, result: { formula, molecularWeight, units: 'g/mol', components: [] } },
});

describe('Chem MW tab stale-response guard (FIX-chem-004)', () => {
  beforeEach(() => postMock.mockReset());
  afterEach(() => cleanup());

  it('a late mount response cannot paint over the user\u2019s newer result', async () => {
    const mountCall = deferred();
    const clickCall = deferred();
    postMock
      .mockImplementationOnce(() => mountCall.promise)
      .mockImplementationOnce(() => clickCall.promise);

    render(React.createElement(ChemWorkbench, { open: true, onClose: () => {} }));
    const input = screen.getByLabelText('Formula');
    fireEvent.change(input, { target: { value: 'NaCl' } });
    fireEvent.click(screen.getByText('Calc'));

    // The user's (newer) request resolves first and paints NaCl.
    await act(async () => { clickCall.resolve(mwResponse('NaCl', 58.44)); });
    expect(screen.getByText('58.44')).toBeTruthy();
    expect(screen.getByText('NaCl')).toBeTruthy();

    // The mount (older) request resolves late — it must NOT repaint.
    await act(async () => { mountCall.resolve(mwResponse('C6H12O6', 180.156)); });
    expect(screen.getByText('58.44')).toBeTruthy();
    expect(screen.queryByText('180.156')).toBeNull();
  });
});
