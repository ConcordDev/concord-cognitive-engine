/**
 * INC-62: the three manufacturing boards post the write actions that fill
 * oee-status, work-orders, and spc-chart. The load path is the same
 * /api/lens/run envelope the panels already use.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

type Body = { domain?: string; action?: string; input?: Record<string, unknown> };

const post = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => post(...args) },
}));

import { OEEDashboard } from './OEEDashboard';
import { WorkOrderBoard } from './WorkOrderBoard';
import { QualitySPC } from './QualitySPC';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

beforeEach(() => {
  post.mockReset();
});

describe('manufacturing floor boards', () => {
  it('registers a machine through manufacturing.machine-register and reloads the board', async () => {
    let machines: unknown[] = [];
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.action === 'oee-status') {
        return ok({ machines, source: machines.length ? 'wired-feed' : 'empty', notes: machines.length ? null : 'POST via manufacturing.machine-register' });
      }
      if (body.action === 'machine-register') {
        machines = [{
          id: body.input?.machineId,
          name: body.input?.name,
          line: body.input?.line,
          status: 'idle',
          availability: 0,
          performance: 0,
          quality: null,
          oee: null,
        }];
        return ok({ machine: machines[0] });
      }
      throw new Error(`unexpected ${body.action}`);
    });

    render(<OEEDashboard />);
    expect(await screen.findByText(/No machines registered/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Machine id'), { target: { value: 'CNC-01' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Haas VF-2' } });
    fireEvent.change(screen.getByLabelText('Line'), { target: { value: 'Cell A' } });
    fireEvent.change(screen.getByLabelText('Ideal cycle (min)'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register machine' }));

    expect(await screen.findByText('Haas VF-2')).toBeInTheDocument();
    const registerCall = post.mock.calls.map((c) => c[1] as Body).find((b) => b.action === 'machine-register');
    expect(registerCall).toMatchObject({
      domain: 'manufacturing',
      action: 'machine-register',
      input: { machineId: 'CNC-01', name: 'Haas VF-2', line: 'Cell A', idealCycleTime: '1.5' },
    });
  });

  it('creates a work order through manufacturing.work-order-create', async () => {
    let orders: unknown[] = [];
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.action === 'work-orders') {
        return ok({ orders, source: orders.length ? 'wired-feed' : 'empty', notes: orders.length ? null : 'POST via manufacturing.work-order-create' });
      }
      if (body.action === 'work-order-create') {
        orders = [{
          id: 'wo_1',
          number: 'WO-1',
          product: body.input?.product,
          quantity: Number(body.input?.quantity),
          quantityProduced: 0,
          priority: body.input?.priority,
          status: 'queued',
          dueDate: body.input?.dueDate || null,
        }];
        return ok({ order: orders[0] });
      }
      if (body.action === 'work-order-update') {
        orders = orders.map((o) => ({ ...(o as object), status: body.input?.status }));
        return ok({ order: orders[0] });
      }
      throw new Error(`unexpected ${body.action}`);
    });

    render(<WorkOrderBoard />);
    expect(await screen.findByText(/No work orders/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Bracket-12' } });
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create work order' }));

    expect(await screen.findByText('Bracket-12')).toBeInTheDocument();
    const createCall = post.mock.calls.map((c) => c[1] as Body).find((b) => b.action === 'work-order-create');
    expect(createCall?.input).toMatchObject({ product: 'Bracket-12', quantity: '25', dueDate: '2026-12-01', priority: 'medium' });

    fireEvent.change(screen.getByLabelText('Status WO-1'), { target: { value: 'in_progress' } });
    await waitFor(() => {
      const update = post.mock.calls.map((c) => c[1] as Body).find((b) => b.action === 'work-order-update');
      expect(update?.input).toEqual({ id: 'wo_1', status: 'in_progress' });
    });
  });

  it('logs an SPC sample through manufacturing.spc-sample-log for the typed product', async () => {
    let samples: Array<{ at: string; value: number; subgroup: string | null }> = [];
    post.mockImplementation(async (_url: string, body: Body) => {
      if (body.action === 'spc-chart') {
        if (samples.length === 0) {
          return ok({ product: body.input?.product, samples: [], source: 'empty', notes: 'POST via manufacturing.spc-sample-log' });
        }
        return ok({
          product: body.input?.product,
          samples,
          source: 'wired-feed',
          cpk: 1,
          ppm: 0,
          inControl: true,
          centerLine: 10,
          upperSpec: 13,
          lowerSpec: 7,
          upperControl: 13,
          lowerControl: 7,
        });
      }
      if (body.action === 'spc-sample-log') {
        samples = [...samples, { at: '2026-10-11T00:00:00.000Z', value: Number(body.input?.value), subgroup: (body.input?.subgroup as string) || null }];
        return ok({ product: body.input?.product, sample: samples[0], count: samples.length });
      }
      throw new Error(`unexpected ${body.action}`);
    });

    render(<QualitySPC />);
    expect(screen.getByText(/Enter a product/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'Bracket-12' } });
    expect(await screen.findByText(/No SPC samples/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '10.5' } });
    fireEvent.change(screen.getByLabelText('Subgroup'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log sample' }));

    expect(await screen.findByText('1.00')).toBeInTheDocument();
    const logCall = post.mock.calls.map((c) => c[1] as Body).find((b) => b.action === 'spc-sample-log');
    expect(logCall).toMatchObject({
      domain: 'manufacturing',
      action: 'spc-sample-log',
      input: { product: 'Bracket-12', value: '10.5', subgroup: 'A' },
    });
  });
});
