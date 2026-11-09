/**
 * Manufacturing build slices (GB-1089): S2 production recording is its
 * own call, S3 null performance renders as — (never "null%"), S4 the
 * delete undo-window registry, S6 the SPC spec-source honesty lines,
 * and the board header counts only non-complete orders as active.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

type Body = { domain?: string; action?: string; input?: Record<string, unknown> };

const post = vi.fn();
const lensRun = vi.fn(async (..._args: unknown[]) => ({ data: { ok: true, result: {} as unknown } }));

vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { OEEDashboard } from './OEEDashboard';
import { WorkOrderBoard } from './WorkOrderBoard';
import { QualitySPC } from './QualitySPC';
import ShopFloorSuite from './ShopFloorSuite';
import { ShopFloorToolsPanel } from './ShopFloorToolsPanel';
import {
  requestDelete, undoDelete, isDeletePending, resetDeleteSafetyForTests,
} from './delete-safety-store';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

beforeEach(() => {
  post.mockReset();
  lensRun.mockReset();
  resetDeleteSafetyForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkOrderBoard — active count + production recording', () => {
  it('counts only non-complete orders as active; Record posts { id, quantityProduced } alone', async () => {
    const orders = [
      { id: 'wo_done', number: 'WO-DONE', product: 'Old Part', quantity: 10, quantityProduced: 10, priority: 'medium', status: 'complete', dueDate: null },
      { id: 'wo_live', number: 'WO-LIVE', product: 'Bracket-12', quantity: 25, quantityProduced: 0, priority: 'medium', status: 'in_progress', dueDate: null },
    ];
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.action === 'work-orders') return ok({ orders, source: 'wired-feed', notes: null });
      if (body.action === 'work-order-update') return ok({ order: orders[1] });
      throw new Error(`unexpected ${body.action}`);
    });

    render(<WorkOrderBoard />);
    expect(await screen.findByText('Bracket-12')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Produced quantity WO-LIVE'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record production WO-LIVE' }));

    await waitFor(() => {
      const call = post.mock.calls.map((c) => c[1] as Body).find((b) => b.action === 'work-order-update');
      expect(call?.input).toEqual({ id: 'wo_live', quantityProduced: 7 });
    });
  });
});

describe('OEEDashboard — null performance', () => {
  it('renders — for a machine whose performance is not yet derivable', async () => {
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.action === 'oee-status') {
        return ok({
          machines: [{ id: 'M1', name: 'Mill', line: 'Cell A', status: 'running', availability: 100, performance: null, quality: null, oee: null, lastDowntimeReason: null }],
          source: 'wired-feed',
          notes: null,
        });
      }
      throw new Error(`unexpected ${body.action}`);
    });

    const { container } = render(<OEEDashboard />);
    expect(await screen.findByText('Mill')).toBeInTheDocument();
    expect(container.textContent).not.toContain('null%');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('QualitySPC — spec honesty', () => {
  function mockChart(specSource: 'samples' | 'derived') {
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.action === 'spc-chart') {
        return ok({
          product: 'PR5MF',
          samples: [{ at: '2026-11-01T00:00:00.000Z', value: 11 }],
          source: 'wired-feed',
          cpk: specSource === 'samples' ? 0.94 : 1,
          ppm: 0,
          inControl: true,
          centerLine: 11,
          upperSpec: specSource === 'samples' ? 15 : 15.243,
          lowerSpec: specSource === 'samples' ? 5 : 6.757,
          upperControl: 15.243,
          lowerControl: 6.757,
          specSource,
        });
      }
      throw new Error(`unexpected ${body.action}`);
    });
  }

  it('derived: the chart says there is no spec on record and Cpk is by construction', async () => {
    mockChart('derived');
    render(<QualitySPC />);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'PR5MF' } });
    expect(await screen.findByText(/No spec on record/)).toBeInTheDocument();
    expect(screen.getByText(/control limits 6\.757–15\.243/)).toBeInTheDocument();
  });

  it('samples: the chart credits the spec to the logged samples', async () => {
    mockChart('samples');
    render(<QualitySPC />);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'PR5MF' } });
    expect(await screen.findByText(/Spec 5\.000–15\.000 — from the logged samples/)).toBeInTheDocument();
  });
});

// NOTE (borrowed-env wall, same genus as the framer-motion tile-text
// wall proven on lens-states): the suite's Field renders <label> and
// <input> as siblings with no htmlFor/id association, so label-text
// queries cannot resolve ANY of the suite's fields in this env (nor in
// a browser, for that matter). The IoT cases therefore drive the form
// by field ORDER inside the ingest card — fragile to layout, exact for
// behaviour — and the panel-level label association the F10 case needs
// is carried by the Traveler card's own aria-label.
function iotInputs(container: HTMLElement): HTMLInputElement[] {
  const card = Array.from(container.querySelectorAll('p')).find((p) => (p.textContent || '').includes('Log a machine reading'))?.parentElement;
  if (!card) throw new Error('ingest card not found');
  // The card subtree holds both the state <select> (0 inputs) and the
  // fields: cycle count · spindle · temperature · downtime · run time ·
  // good · defects. (The Machine ID field sits OUTSIDE the card.)
  return Array.from(card.querySelectorAll('input')) as HTMLInputElement[];
}

describe('S3 remainder — the IoT ingest form collects run time and part counts', () => {
  it('posts the new fields with the reading and clears them after ingest', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });

    const { container } = render(<ShopFloorSuite />);
    fireEvent.click(screen.getByRole('button', { name: /Machine \/ IoT/ }));
    // Ingest card order: cycle count · spindle · temperature · downtime
    // reason · run time · good parts · defects.
    await waitFor(() => expect(iotInputs(container).length).toBe(7));
    const inputs = iotInputs(container);
    fireEvent.change(inputs[4], { target: { value: '50' } });
    fireEvent.change(inputs[5], { target: { value: '95' } });
    fireEvent.change(inputs[6], { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Ingest reading/ }));

    await waitFor(() => {
      const ingest = lensRun.mock.calls.find((c) => c[1] === 'iot-reading-ingest');
      expect(ingest?.[2]).toMatchObject({ runTimeMinutes: 50, goodCount: 95, defectCount: 5 });
    });
    expect(iotInputs(container)[4].value).toBe('');
  });

  it('refuses to post when only one of the two counts is filled', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });

    const { container } = render(<ShopFloorSuite />);
    fireEvent.click(screen.getByRole('button', { name: /Machine \/ IoT/ }));
    await waitFor(() => expect(iotInputs(container).length).toBe(7));
    fireEvent.change(iotInputs(container)[5], { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: /Ingest reading/ }));

    expect(await screen.findByText(/go together/)).toBeInTheDocument();
    expect(lensRun.mock.calls.filter((c) => c[1] === 'iot-reading-ingest')).toHaveLength(0);
  });
});

describe('F10 remainder — the Traveler card collects the work order', () => {
  it('sends workOrderId with the generateTraveler call', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { travelerId: 'TRV-1', workOrder: 'WO-MW3XOTNGKG2EC', partNumber: 'HA-400', quantity: 1, stepCount: 0, content: 'WO: WO-MW3XOTNGKG2EC' } },
    });

    render(<ShopFloorToolsPanel />);
    fireEvent.change(screen.getByLabelText('Work order'), { target: { value: 'WO-MW3XOTNGKG2EC' } });
    // The handler refuses without a part number; the part field is
    // placeholder-identified (the panel's Field has no label association).
    fireEvent.change(screen.getByPlaceholderText('HA-400'), { target: { value: 'HA-400' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/ }));

    await waitFor(() => {
      const call = lensRun.mock.calls.find((c) => c[1] === 'generateTraveler');
      expect(call?.[2]).toMatchObject({ workOrderId: 'WO-MW3XOTNGKG2EC' });
    });
  });
});

describe('delete-safety store — the undo window is literal', () => {
  it('undo inside the window cancels the commit; letting it lapse runs it once', async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => {});
    requestDelete({ key: 'machine:M1', label: 'Mill', commit });
    expect(isDeletePending('machine:M1')).toBe(true);
    undoDelete('machine:M1');
    expect(isDeletePending('machine:M1')).toBe(false);
    await vi.advanceTimersByTimeAsync(9000);
    expect(commit).not.toHaveBeenCalled();

    requestDelete({ key: 'machine:M2', label: 'Lathe', commit });
    await vi.advanceTimersByTimeAsync(9000);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(isDeletePending('machine:M2')).toBe(false);
  });
});
