// Grounding full-build FE tests (B6, F-C row 22) — the Reality Anchor's
// exits (S2), the calendar form's own outcome line (S3), and the whole-ID
// ground receipt (S1). react-query is mocked at the hook boundary (the
// affect-lens-states pattern): useQuery is routed by queryKey and
// useMutation runs the panel's real mutationFn + callbacks against the
// apiHelpers spies.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const q: Record<string, unknown> = vi.hoisted(() => ({
  'grounding-status': { sensors: 1, readings: 1, groundedDtus: 0, pendingActions: 1, calendarEvents: 0, invariants: { ACTION_CONSENT: true } },
  'grounding-sensors': [{ id: 'sensor_1', name: 'PR2 Grounding Sensor 1031', type: 'temperature', unit: 'C', lastReading: 21.5, status: 'active' }],
  'grounding-readings': [{ id: 'reading_1', sensorId: 'sensor_1', sensorName: 'PR2 Grounding Sensor 1031', value: 21.5, unit: 'C', timestamp: '2026-10-31T12:00:00.000Z' }],
  'grounding-context': {},
  'grounding-pending-actions': [{ id: 'action_1', type: 'notification', description: 'PR2 pending action', proposedAt: '2026-10-31T12:00:00.000Z' }],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = String((opts.queryKey || [])[0] || '');
    return { data: q[key], isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
  useMutation: (opts: {
    mutationFn: (arg: never) => Promise<unknown>;
    onMutate?: (arg: never) => void;
    onSuccess?: (r: unknown, arg: never) => void;
    onError?: (e: unknown, arg: never) => void;
    onSettled?: () => void;
  }) => ({
    mutate: (arg: never) => {
      opts.onMutate?.(arg);
      Promise.resolve()
        .then(() => opts.mutationFn(arg))
        .then((r) => { opts.onSuccess?.(r, arg); opts.onSettled?.(); })
        .catch((e) => { opts.onError?.(e, arg); opts.onSettled?.(); });
    },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const groundingApi = vi.hoisted(() => ({
  status: vi.fn(() => Promise.resolve({ data: {} })),
  sensors: vi.fn(() => Promise.resolve({ data: { sensors: [] } })),
  readings: vi.fn(() => Promise.resolve({ data: { readings: [] } })),
  context: vi.fn(() => Promise.resolve({ data: { context: {} } })),
  registerSensor: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  addReading: vi.fn(() => Promise.resolve({ data: { ok: true } })),
  ground: vi.fn(() => Promise.resolve({ data: { ok: true, grounding: { groundedAt: '2026-10-31T12:00:00.000Z', confidence: 0.7, sensorReadings: [] } } })),
  linkCalendar: vi.fn(() => Promise.resolve({ data: { ok: true, event: { title: 'Check-in', startTime: '2026-11-01T09:00' } } })),
  proposeAction: vi.fn(() => Promise.resolve({ data: { ok: true, requiresConsent: true } })),
  approveAction: vi.fn(() => Promise.resolve({ data: { ok: true, action: { status: 'completed' } } })),
  removeSensor: vi.fn(() => Promise.resolve({ data: { ok: true, removed: { sensorId: 'sensor_1', readingsRemoved: 1 } } })),
  removeReading: vi.fn(() => Promise.resolve({ data: { ok: true, removed: { readingId: 'reading_1' } } })),
  withdrawAction: vi.fn(() => Promise.resolve({ data: { ok: true, action: { id: 'action_1', status: 'withdrawn' } } })),
  actions: { pending: vi.fn(() => Promise.resolve({ data: { actions: [] } })) },
}));
vi.mock('@/lib/api/client', () => ({ apiHelpers: { grounding: groundingApi } }));

import { SensorGroundingPanel } from '@/components/grounding/SensorGroundingPanel';

beforeEach(() => { vi.clearAllMocks(); });

describe('grounding full build — Reality Anchor exits (S2)', () => {
  it('sensor removal is two-step: arming calls nothing, confirming calls removeSensor', async () => {
    render(<SensorGroundingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove sensor PR2 Grounding Sensor 1031' }));
    expect(groundingApi.removeSensor).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove “PR2 Grounding Sensor 1031” and its readings\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(groundingApi.removeSensor).toHaveBeenCalledWith('sensor_1'));
    await screen.findByText(/Sensor removed \(with its 1 reading\)\./);
  });

  it('reading removal is two-step and addresses the reading by its id', async () => {
    render(<SensorGroundingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove reading 21.5 C' }));
    expect(groundingApi.removeReading).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(groundingApi.removeReading).toHaveBeenCalledWith('reading_1'));
    await screen.findByText('Reading removed.');
  });

  it('action withdrawal is two-step beside Approve', async () => {
    render(<SensorGroundingPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(groundingApi.withdrawAction).not.toHaveBeenCalled();
    expect(screen.getByText('Withdraw this action?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(groundingApi.withdrawAction).toHaveBeenCalledWith('action_1'));
    await screen.findByText('Action withdrawn.');
  });
});

describe('grounding full build — calendar outcome + whole IDs (S3 + S1)', () => {
  it('a calendar failure is stated at the form itself, not only in the shared banner', async () => {
    groundingApi.linkCalendar.mockResolvedValueOnce({ data: { ok: false, error: 'DTU not found' } } as never);
    render(<SensorGroundingPanel />);
    fireEvent.change(screen.getByLabelText('DTU id to link'), { target: { value: 'dtu_missing' } });
    fireEvent.click(screen.getByRole('button', { name: /Link calendar event/ }));
    // banner + the form's own outcome line = two renderings of the error
    await waitFor(() => expect(screen.getAllByText('DTU not found').length).toBeGreaterThanOrEqual(2));
  });

  it('the ground receipt names the whole DTU id', async () => {
    render(<SensorGroundingPanel />);
    fireEvent.change(screen.getByLabelText('DTU id to ground'), { target: { value: 'dtu_2dac1234567890abcdef1234567890' } });
    fireEvent.click(screen.getByRole('button', { name: /Ground DTU/ }));
    await screen.findByText('DTU dtu_2dac1234567890abcdef1234567890 grounded.');
  });
});
