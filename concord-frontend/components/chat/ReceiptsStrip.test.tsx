import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ReceiptsStrip, { receiptVerdict, type ReverifyResult } from './ReceiptsStrip';

// F2/S2 (Product Chat review 2026-10-28): every assistant reply carries a
// receipts verdict in ConKay's vocabulary — sourced / computed / estimated
// / not computed — with a designed confidence element and tap-to-open
// detail. The honest "nothing was checked" state renders out loud; the
// old surfaces hid it by rendering nothing at all.

describe('receiptVerdict', () => {
  it('is computed when a solver capability ran', () => {
    expect(receiptVerdict({ computed: { capabilities: [{ key: 'physics.kinematics' }] } })).toBe('computed');
  });

  it('computed wins over sourced when both are present', () => {
    expect(receiptVerdict({
      computed: { capabilities: [{ key: 'math.eval' }] },
      sources: [{ url: 'https://example.com' }],
    })).toBe('computed');
  });

  it('is sourced with web sources, DTU refs, or web augmentation', () => {
    expect(receiptVerdict({ sources: [{ url: 'https://example.com' }] })).toBe('sourced');
    expect(receiptVerdict({ dtuRefs: [{ id: 'dtu-1' }] })).toBe('sourced');
    expect(receiptVerdict({ webAugmented: true })).toBe('sourced');
  });

  it('is estimated when the server flagged the answer low-confidence (backup model)', () => {
    expect(receiptVerdict({ confidence: 'low', confidenceReason: 'GPU brain offline' })).toBe('estimated');
  });

  it('sourced wins over estimated — checking state is the headline, confidence rides along', () => {
    expect(receiptVerdict({ sources: [{ url: 'https://example.com' }], confidence: 'low' })).toBe('sourced');
  });

  it('is not-computed when nothing was sourced, computed, or flagged', () => {
    expect(receiptVerdict({})).toBe('not-computed');
    expect(receiptVerdict({ computed: null, sources: [], dtuRefs: [] })).toBe('not-computed');
    expect(receiptVerdict({ computed: { capabilities: [] } })).toBe('not-computed');
  });
});

describe('ReceiptsStrip', () => {
  it('renders the explicit no-sources / not-computed labels for a plain model answer', () => {
    render(<ReceiptsStrip message={{}} />);
    expect(screen.getByText('No external sources — model answer')).toBeTruthy();
    expect(screen.getByText('Not computed')).toBeTruthy();
    expect(screen.getByTestId('receipts-strip').getAttribute('data-verdict')).toBe('not-computed');
  });

  it('renders the computed verdict for a solver-checked answer', () => {
    render(<ReceiptsStrip message={{ computed: { capabilities: [{ key: 'math.eval' }] } }} />);
    expect(screen.getByText(/Computed — checked by Concord's solvers/)).toBeTruthy();
    expect(screen.queryByText('No external sources — model answer')).toBeNull();
  });

  it('renders the sourced verdict with a count for a cited answer', () => {
    render(<ReceiptsStrip message={{ sources: [{ url: 'https://a.example' }, { url: 'https://b.example' }], dtuRefs: [{ id: 'dtu-9' }] }} />);
    expect(screen.getByText(/Sourced — 3 sources/)).toBeTruthy();
    expect(screen.getByTestId('receipts-strip').getAttribute('data-verdict')).toBe('sourced');
  });

  it('renders the estimated verdict + designed confidence meter for a backup-model answer', () => {
    render(<ReceiptsStrip message={{ confidence: 'low', confidenceReason: 'GPU brain offline — answered by small local model' }} />);
    expect(screen.getByText(/Estimated — not checked/)).toBeTruthy();
    expect(screen.getByTestId('receipts-confidence')).toBeTruthy();
    expect(screen.getByTestId('receipts-strip').getAttribute('data-verdict')).toBe('estimated');
  });

  it('tap-to-open detail shows clickable sources (spec d)', () => {
    render(<ReceiptsStrip message={{ sources: [{ title: 'Docs page', url: 'https://a.example/x', source: 'web' }] }} />);
    expect(screen.queryByTestId('receipts-detail')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    const detail = screen.getByTestId('receipts-detail');
    const link = detail.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://a.example/x');
    expect(link?.textContent).toBe('Docs page');
  });

  it('tap-to-open detail on a plain answer explains that nothing was checked', () => {
    render(<ReceiptsStrip message={{}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Nothing was checked for this answer/)).toBeTruthy();
  });

  it('tap-to-open detail on a computed answer names the solver check', () => {
    render(<ReceiptsStrip message={{ computed: { capabilities: [{ key: 'math.eval', description: 'exact arithmetic' }], engineCount: 2 } }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Solver check: exact arithmetic \(2 engines\)/)).toBeTruthy();
  });

  it('offers no re-verify control when no handler is wired', () => {
    render(<ReceiptsStrip message={{}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByTestId('receipts-reverify')).toBeNull();
  });

  it('re-verify runs the handler and renders the leg results', async () => {
    const result: ReverifyResult = {
      found: true,
      verifiedAt: new Date(2000).toISOString(),
      legs: [
        { leg: 'solver', status: 'reproduced', detail: 'Re-ran symbolic.evaluate on the stored question — same result (408).' },
        { leg: 'sources', status: 'all-resolve', detail: '1/1 cited source still resolve.' },
      ],
      summary: 'Re-ran symbolic.evaluate on the stored question — same result (408). 1/1 cited source still resolve.',
    };
    const onReverify = vi.fn(async () => result);
    render(<ReceiptsStrip message={{ computed: { capabilities: [{ key: 'math.eval' }] } }} onReverify={onReverify} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('receipts-reverify'));
    expect(await screen.findByTestId('receipts-reverify-result')).toBeTruthy();
    expect(onReverify).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/solver:/)).toBeTruthy();
    expect(screen.getByText(/sources:/)).toBeTruthy();
  });

  it('re-verify shows an honest error line when the record cannot be read', async () => {
    const onReverify = vi.fn(async () => null);
    render(<ReceiptsStrip message={{}} onReverify={onReverify} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('receipts-reverify'));
    expect(await screen.findByTestId('receipts-reverify-error')).toBeTruthy();
  });
});
