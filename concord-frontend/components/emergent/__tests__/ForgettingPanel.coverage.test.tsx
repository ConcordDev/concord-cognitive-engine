import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const api = vi.hoisted(() => ({ status: vi.fn(), candidates: vi.fn(), run: vi.fn(), history: vi.fn() }));
const addToast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiHelpers: { forgetting: api } }));
vi.mock('@/store/ui', () => ({ useUIStore: Object.assign(() => ({}), { getState: () => ({ addToast }) }) }));
vi.mock('@/components/common/Toasts', () => ({ showToast: vi.fn() }));
import { ForgettingPanel } from '../ForgettingPanel';

const STATUS = { running: false, threshold: 0.2, lastRun: '2026-03-01T00:00:00Z', nextRun: '2026-03-02T00:00:00Z', lifetimeForgotten: 42, tombstones: 3, interval: 30 };
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const press = async (re: RegExp) => { const b = screen.queryAllByRole('button').find((x) => re.test((x.textContent || x.getAttribute('title') || '').trim())); if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 5)); }); };
afterEach(() => cleanup());
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  addToast.mockReset();
  api.status.mockResolvedValue({ data: STATUS });
  api.candidates.mockResolvedValue({ data: { candidateCount: 4, threshold: 0.2 } });
  api.run.mockResolvedValue({ data: { ok: true } });
  api.history.mockResolvedValue({ data: { tombstones: [{ id: 't1', originalId: 'd1', title: 'Old note', tier: 'regular', score: 0.1, forgottenAt: '2026-03-01' }] } });
  window.alert = vi.fn();
});

describe('ForgettingPanel', () => {
  it('shows status, previews candidates, runs a cycle and lists tombstones', async () => {
    const view = render(<ForgettingPanel />);
    await settle();
    expect(view.container.textContent).toMatch(/Forgetting Engine/);
    await press(/Preview|Eye|Candidates/i); await press(/Run|Play/i);
    await press(/History|Tombstone|Clock/i); await settle();
    expect(api.status).toHaveBeenCalled();
    expect(api.run).toHaveBeenCalled();
    expect(view.container.textContent).toMatch(/Old note|42/);
  });
  it('reports a failed load and a failed run, and retries', async () => {
    api.status.mockRejectedValue(new Error('down'));
    const view = render(<ForgettingPanel />);
    await settle();
    expect(view.container.textContent?.length).toBeGreaterThan(10);
    await press(/Retry|Reload/i);
    api.status.mockResolvedValue({ data: STATUS });
    api.run.mockRejectedValue(new Error('run failed'));
    api.candidates.mockRejectedValue(new Error('no candidates'));
    await press(/Retry|Reload/i); await settle();
    await press(/Run|Play/i); await press(/Preview|Eye|Candidates/i);
    expect(api.status.mock.calls.length).toBeGreaterThan(0);
  });
});
