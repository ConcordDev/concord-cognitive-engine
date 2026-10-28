import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReceiptsStrip, { receiptVerdict } from './ReceiptsStrip';

// F2/A6 (Product Chat review 2026-10-28): every assistant reply carries a
// receipts verdict — including the honest "nothing was checked" state the
// old surfaces hid by rendering nothing at all.

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

  it('is model when nothing was sourced or computed (the fallback-reply shape)', () => {
    expect(receiptVerdict({})).toBe('model');
    expect(receiptVerdict({ computed: null, sources: [], dtuRefs: [] })).toBe('model');
    expect(receiptVerdict({ computed: { capabilities: [] } })).toBe('model');
  });
});

describe('ReceiptsStrip', () => {
  it('renders the explicit no-sources / not-computed labels for a plain model answer', () => {
    render(<ReceiptsStrip message={{}} />);
    expect(screen.getByText('No external sources — model answer')).toBeTruthy();
    expect(screen.getByText('Not computed')).toBeTruthy();
    expect(screen.getByTestId('receipts-strip').getAttribute('data-verdict')).toBe('model');
  });

  it('renders the computed verdict for a solver-checked answer', () => {
    render(<ReceiptsStrip message={{ computed: { capabilities: [{ key: 'math.eval' }] } }} />);
    expect(screen.getByText(/Computed — checked by Concord's solvers/)).toBeTruthy();
    expect(screen.queryByText('Not computed')).toBeNull();
  });

  it('renders the sourced verdict with a count for a cited answer', () => {
    render(<ReceiptsStrip message={{ sources: [{ url: 'https://a.example' }, { url: 'https://b.example' }], dtuRefs: [{ id: 'dtu-9' }] }} />);
    expect(screen.getByText(/Sourced — 3 sources below/)).toBeTruthy();
    expect(screen.getByTestId('receipts-strip').getAttribute('data-verdict')).toBe('sourced');
  });
});
