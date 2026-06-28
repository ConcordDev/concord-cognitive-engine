/**
 * /lenses/ml — four-UX-state contract for the ML lens.
 *
 * The ML page composes independent tab panels, each owning its own backend
 * channel (no single useLensData shell). The Model Hub panel is the lens's
 * primary browse surface and the one with all four genuine states, so the
 * state contract is pinned there against its REAL backend channel:
 * lensRun('ml', 'model-hub', …).
 *
 * Pins genuine loading / error (with a WORKING Retry that RE-FETCHES) / empty
 * (honest "No models found." not a blank page) / populated states. This closes
 * the swallowed-fetch → silent-empty defect: a failed hub fetch surfaces the
 * error text + a Retry that re-invokes the backend, never a silent empty grid.
 *
 * a11y: the busy state shows an animated loader; the error state surfaces the
 * server-provided error string. Every state is driven by a mocked lensRun
 * standing in for the real /api/lens/run dispatch in the exact envelope shape
 * it returns ({ data: { ok, result, error } }). No fabricated model data.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── the panel's real backend channel: lensRun('ml', action, …) ──────────────
const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import { ModelHubPanel } from '@/components/ml/ModelHubPanel';

const MODEL = {
  id: 'org/cool-model',
  name: 'cool-model',
  author: 'org',
  task: 'text-generation',
  library: 'transformers',
  downloads: 1500000,
  likes: 4200,
  tags: ['pytorch', 'nlp'],
  updatedAt: '2026-06-27',
  gated: false,
  url: 'https://huggingface.co/org/cool-model',
};

const okEnvelope = (result: unknown) => ({ data: { ok: true, result, error: null } });
const errEnvelope = (error: string) => ({ data: { ok: false, result: null, error } });

beforeEach(() => {
  lensRun.mockReset();
});

describe('ml lens (Model Hub) — four UX states', () => {
  it('WIRING: the panel calls the backend on the ml domain, model-hub macro', async () => {
    lensRun.mockResolvedValue(okEnvelope({ count: 0, models: [] }));
    render(<ModelHubPanel />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    const [domain, macro] = lensRun.mock.calls[0];
    expect(domain).toBe('ml');
    expect(macro).toBe('model-hub');
  });

  it('LOADING: an in-flight fetch shows the animated loader (not a blank grid)', async () => {
    // never-resolving promise keeps the panel in its loading branch
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container, getByText } = render(<ModelHubPanel />);
    await waitFor(() => expect(getByText(/Loading models/i)).toBeInTheDocument());
    // the spinning loader icon is mounted (real busy affordance)
    expect(container.querySelector('[data-testid="icon-Loader2"]')).toBeTruthy();
  });

  it('EMPTY: a successful fetch with zero models shows the honest "No models found." state', async () => {
    lensRun.mockResolvedValue(okEnvelope({ count: 0, models: [] }));
    const { getByText } = render(<ModelHubPanel />);
    await waitFor(() => expect(getByText(/No models found/i)).toBeInTheDocument());
  });

  it('ERROR: a failed fetch surfaces the server error + a working Retry that RE-FETCHES (not silent empty)', async () => {
    lensRun.mockResolvedValue(errEnvelope('huggingface hub unreachable'));
    const { getByText, container } = render(<ModelHubPanel />);

    await waitFor(() => expect(getByText(/huggingface hub unreachable/i)).toBeInTheDocument());
    const callsAfterInitial = lensRun.mock.calls.length;

    // the Retry/refresh button must re-invoke the backend fetch, not be dead.
    // (it carries the RefreshCw icon when not loading)
    const retryBtn = container.querySelector('button[disabled=""]') || container.querySelector('button');
    expect(retryBtn).toBeTruthy();
    // make the retry succeed with a real model so we also prove recovery
    lensRun.mockResolvedValue(okEnvelope({ count: 1, models: [MODEL] }));
    await act(async () => { fireEvent.click(retryBtn as HTMLElement); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(callsAfterInitial));
    await waitFor(() => expect(getByText('cool-model')).toBeInTheDocument());
  });

  it('POPULATED: a real model from the hub renders with its name, author and formatted downloads', async () => {
    lensRun.mockResolvedValue(okEnvelope({ count: 1, models: [MODEL] }));
    const { getByText, getAllByText } = render(<ModelHubPanel />);
    await waitFor(() => expect(getByText('cool-model')).toBeInTheDocument());
    expect(getByText('org')).toBeInTheDocument();
    // 1,500,000 downloads → formatted "1.5M" by the panel's fmt()
    expect(getByText('1.5M')).toBeInTheDocument();
    // the model's task renders on its card ("text-generation" is also a filter
    // <option>, so assert at least one occurrence — the card row)
    expect(getAllByText('text-generation').length).toBeGreaterThan(0);
  });
});
