/**
 * MeshSendDtu — the mesh lens's namesake capability (Wave 4 gap-closure,
 * docs/lens-specs/mesh-capability-map.md): pick a peer + a real DTU and
 * transmit it through the 7-transport routing substrate.
 *
 * Mocked at the `apiHelpers.lens.runDomain` boundary only (the real
 * POST /api/lens/run surface) — no network. Pins:
 *   1. destination options come from the real mesh.listNodes shape
 *   2. picking a DTU (via the shared DTUPickerModal) + Transmit calls the
 *      real mesh.send macro with the exact { dtuId, destination, proximity }
 *      shape
 *   3. the result panel renders EXACTLY what the macro returned — direct
 *      ("Transmitted via <channel>"), store_forward ("Queued for
 *      store-and-forward"), and failure (role=alert) — never a fabricated
 *      "sent!" success when the macro didn't report one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));

// Stand-in for the shared cross-lens DTU picker: captures onSelect so a test
// can simulate the user choosing a DTU, and exposes a close button.
let capturedOnSelect: ((dtu: unknown) => void) | null = null;
vi.mock('@/components/dtu/DTUPickerModal', () => ({
  DTUPickerModal: ({ onSelect, onClose }: { onSelect: (dtu: unknown) => void; onClose: () => void }) => {
    capturedOnSelect = onSelect;
    return (
      <div data-testid="dtu-picker">
        <button onClick={onClose}>close-picker</button>
      </div>
    );
  },
}));

import { MeshSendDtu } from '@/components/mesh/MeshSendDtu';

const NODES = {
  nodes: [
    { id: 'node-1', name: 'Repeater-Hill', online: true },
    { id: 'node-2', name: 'Basement-Relay', online: false },
  ],
};

const PICKED_DTU = { id: 'dtu-abc', title: 'Field report #4' };

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MeshSendDtu />
    </QueryClientProvider>,
  );
}

async function pickDtu() {
  fireEvent.click(screen.getByRole('button', { name: /Choose a DTU/i }));
  expect(screen.getByTestId('dtu-picker')).toBeInTheDocument();
  await act(async () => { capturedOnSelect?.(PICKED_DTU); });
}

beforeEach(() => {
  runDomainMock.mockReset();
  capturedOnSelect = null;
  // listNodes is queried on mount; default to a real two-node shape.
  runDomainMock.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'mesh' && action === 'listNodes') {
      return { data: { ok: true, result: NODES } };
    }
    return { data: { ok: true, result: null } };
  });
});

describe('MeshSendDtu', () => {
  it('lists real destinations from mesh.listNodes, including broadcast', async () => {
    renderPanel();
    await waitFor(() => expect(runDomainMock).toHaveBeenCalledWith('mesh', 'listNodes', {}));
    const select = screen.getByLabelText(/Destination/i) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    expect(select.options[0].value).toBe('broadcast');
    expect(Array.from(select.options).some((o) => o.textContent?.includes('Repeater-Hill'))).toBe(true);
    expect(Array.from(select.options).some((o) => o.textContent?.includes('Basement-Relay'))).toBe(true);
  });

  it('disables Transmit until a DTU is chosen, then sends the real mesh.send shape', async () => {
    renderPanel();
    const transmitBtn = screen.getByRole('button', { name: /Transmit over mesh/i });
    expect(transmitBtn).toBeDisabled();

    await pickDtu();
    expect(screen.getByTestId('mesh-send-selected-dtu').textContent).toBe('Field report #4');
    expect(transmitBtn).not.toBeDisabled();

    const select = screen.getByLabelText(/Destination/i) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(3));
    fireEvent.change(select, { target: { value: 'node-1' } });
    expect(select.value).toBe('node-1');

    runDomainMock.mockImplementationOnce(async () => ({
      data: { ok: true, result: { ok: true, mode: 'direct', channel: 'internet', transmissionId: 'tx-1', totalBytes: 128 } },
    }));

    await act(async () => { fireEvent.click(transmitBtn); });

    await waitFor(() => expect(runDomainMock).toHaveBeenCalledWith('mesh', 'send', {
      dtuId: 'dtu-abc',
      destination: 'node-1',
      proximity: 'unknown',
    }));
  });

  it('renders a direct transmission as a real status, not a generic "sent!" toast', async () => {
    renderPanel();
    await pickDtu();
    runDomainMock.mockImplementationOnce(async () => ({
      data: { ok: true, result: { ok: true, mode: 'direct', channel: 'internet', transmissionId: 'tx-2', totalBytes: 256 } },
    }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Transmit over mesh/i })); });

    const status = await screen.findByTestId('mesh-send-result');
    expect(status).toHaveAttribute('role', 'status');
    expect(status.textContent).toMatch(/Transmitted via internet/);
    expect(status.textContent).toMatch(/256 bytes/);
  });

  it('renders store_forward as an honest "queued" state, not a delivered claim', async () => {
    renderPanel();
    await pickDtu();
    runDomainMock.mockImplementationOnce(async () => ({
      data: { ok: true, result: { ok: true, mode: 'store_forward', channel: null, relayId: 'relay-1', reason: 'no_channels_available' } },
    }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Transmit over mesh/i })); });

    const status = await screen.findByTestId('mesh-send-result');
    expect(status.textContent).toMatch(/Queued for store-and-forward/);
    expect(status.textContent).toMatch(/no_channels_available/);
    expect(status.textContent).not.toMatch(/Transmitted via/);
  });

  it('renders a macro failure as role=alert with the real error, never a fabricated success', async () => {
    renderPanel();
    await pickDtu();
    runDomainMock.mockImplementationOnce(async () => ({
      data: { ok: true, result: { ok: false, error: 'not_your_dtu' } },
    }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Transmit over mesh/i })); });

    const alert = await screen.findByTestId('mesh-send-result');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert.textContent).toMatch(/not_your_dtu/);
  });
});
