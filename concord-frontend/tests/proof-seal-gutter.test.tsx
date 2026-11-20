/**
 * Proof's signature marks: the seal draws one segment per check in that
 * check's own state and only stamps PROVED when the ledger is green; the
 * gutter marks exactly the lines the proved diff adds or removes.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProofSeal } from '@/components/code/proof/ProofSeal';
import { gutterMarks } from '@/components/code/proof/proofGutter';
import type { CheckKey, CheckStatus } from '@/components/code/proof/proofApi';

const order: CheckKey[] = ['types', 'lint', 'tests', 'run', 'review'];
const states = (s: CheckStatus[]) => Object.fromEntries(order.map((k, i) => [k, s[i]])) as Record<CheckKey, CheckStatus>;

describe('the seal', () => {
  it('one segment per check, in its own state, with a count when open', () => {
    render(<ProofSeal order={order} states={states(['proved', 'failed', 'stale', 'not_run', 'not_applicable'])} green={false} />);
    const segs = screen.getByTestId('pf-ring').querySelectorAll('path.pf-ring-seg');
    expect([...segs].map((p) => p.getAttribute('data-s'))).toEqual(['proved', 'failed', 'stale', 'not_run', 'not_applicable']);
    expect(screen.getByRole('img', { name: '2 of 5 checks proved' })).toBeTruthy();
    expect(screen.queryByText('PROVED')).toBeNull();
  });
  it('stamps PROVED only when the ledger says green', () => {
    const all = states(['proved', 'proved', 'proved', 'not_applicable', 'proved']);
    const { rerender } = render(<ProofSeal order={order} states={all} green={false} />);
    expect(screen.queryByText('PROVED')).toBeNull();
    rerender(<ProofSeal order={order} states={all} green />);
    expect(screen.getByText('PROVED')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Proved' })).toBeTruthy();
  });
});

describe('the gutter', () => {
  it('marks added lines and where lines were removed', () => {
    const m = gutterMarks([
      { type: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { type: 'del', text: 'b', oldLine: 2 },
      { type: 'add', text: 'B', newLine: 2 },
      { type: 'context', text: 'c', oldLine: 3, newLine: 3 },
      { type: 'add', text: 'd', newLine: 4 },
    ], 4);
    expect(m).toEqual({ added: [2, 4], removedAbove: [2] });
  });
  it('a removal at the end sits on the last line; no hunks, no marks; never past the file', () => {
    expect(gutterMarks([{ type: 'context', text: 'a', oldLine: 1, newLine: 1 }, { type: 'del', text: 'z', oldLine: 2 }], 1)).toEqual({ added: [], removedAbove: [1] });
    expect(gutterMarks([], 10)).toEqual({ added: [], removedAbove: [] });
    expect(gutterMarks([{ type: 'add', text: 'x', newLine: 9 }], 3)).toEqual({ added: [], removedAbove: [] });
  });
});
