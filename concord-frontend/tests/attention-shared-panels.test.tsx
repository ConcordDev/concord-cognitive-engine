/**
 * S-ATT-4 (shared emergent panels) — the Cognition view's panels must
 * load deterministically or say they failed:
 *  - the allocator coerces a map-shaped allocation (the x.slice crash)
 *    and a failed (owner-gated) load renders an honest state;
 *  - the Forgetting Engine renders FAILED, not "Loading..." forever;
 *  - Dream Capture surfaces a non-ok response and keeps the text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  allocStatus: vi.fn(),
  dreamHistory: vi.fn(),
  dreamCapture: vi.fn(),
  forgettingStatus: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    attentionAlloc: { status: mocks.allocStatus, unfocus: vi.fn() },
    dream: { history: mocks.dreamHistory, capture: mocks.dreamCapture },
    forgetting: { status: mocks.forgettingStatus, history: vi.fn(), run: vi.fn(), candidates: vi.fn() },
  },
}));
vi.mock('@/lib/realtime/socket', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
vi.mock('@/components/common/ErrorBoundary', () => ({
  withErrorBoundary: (C: unknown) => C,
}));

import { AttentionPanel } from '@/components/emergent/AttentionPanel';
import { DreamPanel } from '@/components/emergent/DreamPanel';
import { ForgettingPanel } from '@/components/emergent/ForgettingPanel';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dreamHistory.mockResolvedValue({ data: { dreams: [] } });
});

describe('emergent AttentionPanel (allocator)', () => {
  it('renders a MAP-shaped allocation without crashing', async () => {
    mocks.allocStatus.mockResolvedValue({
      data: {
        lastAllocation: {
          allocation: {
            reasoning: { domain: 'reasoning', budget: 40, urgency: 0.5 },
            memory: { domain: 'memory', budget: 60, urgency: 0.25 },
          },
        },
      },
    });
    render(<AttentionPanel />);
    expect(await screen.findByText('reasoning')).toBeTruthy();
    expect(await screen.findByText('memory')).toBeTruthy();
  });

  it('a failed (owner-gated) load renders the honest operator-view state', async () => {
    mocks.allocStatus.mockRejectedValue(new Error('403'));
    render(<AttentionPanel />);
    expect(await screen.findByText(/operator view of how the engine divides its attention/)).toBeTruthy();
  });
});

describe('ForgettingPanel', () => {
  it('a failed status load renders FAILED with a retry, not eternal Loading', async () => {
    mocks.forgettingStatus.mockRejectedValue(new Error('boom'));
    render(<ForgettingPanel />);
    expect(await screen.findByText('The forgetting status could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText('Loading...')).toBeNull();
  });
});

describe('DreamPanel capture honesty', () => {
  it('a non-ok capture surfaces the failure and keeps the text', async () => {
    mocks.dreamCapture.mockResolvedValue({ data: { ok: false } });
    render(<DreamPanel />);
    const box = screen.getByPlaceholderText(/Describe your derivation/);
    fireEvent.change(box, { target: { value: 'a dream about tides and ledgers' } });
    fireEvent.click(screen.getByText('Capture Dream'));
    expect(await screen.findByText(/That capture was not saved/)).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe('a dream about tides and ledgers');
  });

  it('the ten-character floor is stated before it blocks', async () => {
    render(<DreamPanel />);
    const box = screen.getByPlaceholderText(/Describe your derivation/);
    fireEvent.change(box, { target: { value: 'short' } });
    expect(await screen.findByText(/5 to go/)).toBeTruthy();
  });
});
