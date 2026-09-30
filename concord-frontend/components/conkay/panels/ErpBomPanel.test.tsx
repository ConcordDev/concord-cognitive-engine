/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * ErpBomPanel — ERP-shaped BOM export panel for ConKay. The previous version
 * of this file only did a `?raw` source-text scan (checked testids/strings
 * exist in the source, never actually rendered or executed the component —
 * 0% real behavioral coverage despite "having a test"). Replaced with real
 * render/interaction tests: load/reload, create-assembly, JSON/CSV export,
 * filter + sort + row selection, and the honest failure paths (never a
 * fabricated success).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const fetchErpBom = vi.fn();
const createAssembly = vi.fn();
const downloadErpBomJson = vi.fn();
const downloadErpBomCsv = vi.fn();
vi.mock('@/lib/conkay/assembly-to-world', () => ({
  fetchErpBom: (...a: unknown[]) => fetchErpBom(...a),
  createAssembly: (...a: unknown[]) => createAssembly(...a),
  downloadErpBomJson: (...a: unknown[]) => downloadErpBomJson(...a),
  downloadErpBomCsv: (...a: unknown[]) => downloadErpBomCsv(...a),
}));
const mintConkayArtifactDtu = vi.fn();
vi.mock('@/lib/conkay/mint-artifact-dtu', () => ({ mintConkayArtifactDtu: (...a: unknown[]) => mintConkayArtifactDtu(...a) }));

import { ErpBomPanel } from './ErpBomPanel';

const BOM = {
  ok: true,
  assemblyId: 'asm_1',
  totalParts: 2,
  lines: [
    { partId: 'p1', partNumber: 'PN-100', revision: 'A', qty: 4, material: 'Steel', massKg: 1.5, vendorId: 'v1', extendedCostUsd: 40 },
    { partId: 'p2', partNumber: 'PN-050', revision: 'B', qty: 1, material: 'Aluminum', massKg: 0.2, vendorId: 'v2', extendedCostUsd: 10, vendorName: 'Acme Vendor', leadTimeDays: 5, volumeM3: 0.0001, unitCostUsd: 10 },
  ],
  rollup: { totalMassKg: 1.7, materialCostUsd: 50, overheadPct: 0.1, overheadUsd: 5, rollupCostUsd: 55, currency: 'USD' },
};

beforeEach(() => {
  fetchErpBom.mockReset();
  createAssembly.mockReset();
  downloadErpBomJson.mockReset();
  downloadErpBomCsv.mockReset();
  mintConkayArtifactDtu.mockReset().mockResolvedValue({ ok: true, id: 'dtu_erpbom1' });
  try { sessionStorage.clear(); } catch { /* jsdom always has it */ }
});

describe('ErpBomPanel', () => {
  it('renders the honest ERP-not-SAP/Oracle disclaimer and the idle status', () => {
    render(<ErpBomPanel />);
    expect(screen.getByTestId('ck-erp-bom-honesty')).toHaveTextContent(/not SAP\/Oracle/i);
    expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent('Idle');
  });

  it('Reload with no assemblyId shows the honest "enter an assemblyId" prompt, no fetch', () => {
    render(<ErpBomPanel />);
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));
    expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/Enter an assemblyId/i);
    expect(fetchErpBom).not.toHaveBeenCalled();
  });

  it('loads a real BOM, renders the rollup + table rows, and mints a real DTU summary', async () => {
    fetchErpBom.mockResolvedValue(BOM);
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));

    await waitFor(() => expect(fetchErpBom).toHaveBeenCalledWith('asm_1'));
    expect(await screen.findByTestId('ck-erp-bom-rollup')).toHaveTextContent('rollup $55.00 USD');
    expect(screen.getByText('PN-100')).toBeInTheDocument();
    expect(screen.getByText('PN-050')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/ERP BOM LIVE — 2 parts/));
    await waitFor(() =>
      expect(mintConkayArtifactDtu).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'ERP BOM load', tags: ['erp-bom'] }),
      ),
    );
  });

  it('an ok:false BOM response shows the real honest failure reason, not fabricated rows', async () => {
    fetchErpBom.mockResolvedValue({ ok: false, reason: 'assembly_not_found' });
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_missing' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));

    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/ERP BOM failed — assembly_not_found/));
    expect(screen.getByTestId('ck-erp-bom-empty')).toHaveTextContent(/No ERP BOM lines yet/i);
    expect(mintConkayArtifactDtu).not.toHaveBeenCalled();
  });

  it('a thrown fetch reports the real error message', async () => {
    fetchErpBom.mockRejectedValue(new Error('network down'));
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/ERP BOM failed — network down/));
  });

  it('filter narrows visible rows by part number / material / vendor', async () => {
    fetchErpBom.mockResolvedValue(BOM);
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));
    await screen.findByText('PN-100');

    fireEvent.change(screen.getByTestId('ck-erp-bom-filter'), { target: { value: 'aluminum' } });
    expect(screen.queryByText('PN-100')).not.toBeInTheDocument();
    expect(screen.getByText('PN-050')).toBeInTheDocument();
  });

  it('an all-filtered-out result shows the "no lines match filter" honest message (not the create-one message)', async () => {
    fetchErpBom.mockResolvedValue(BOM);
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));
    await screen.findByText('PN-100');

    fireEvent.change(screen.getByTestId('ck-erp-bom-filter'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByTestId('ck-erp-bom-empty')).toHaveTextContent(/No lines match filter/i);
  });

  it('sorting by Qty re-orders the visible rows', async () => {
    fetchErpBom.mockResolvedValue(BOM);
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));
    await screen.findByText('PN-100');

    fireEvent.change(screen.getByTestId('ck-erp-bom-sort'), { target: { value: 'qty' } });
    const rows = screen.getAllByRole('row').slice(1); // drop header row
    expect(rows[0]).toHaveTextContent('PN-050'); // qty 1 sorts before qty 4
  });

  it('clicking a row selects it and shows the real detail panel', async () => {
    fetchErpBom.mockResolvedValue(BOM);
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-reload'));
    await screen.findByText('PN-100');

    // Default sort is by partNumber (string) — "PN-050" sorts before "PN-100",
    // so row-0 is PN-050 here, not row-1.
    fireEvent.click(screen.getByTestId('ck-erp-bom-row-0'));
    expect(screen.getByTestId('ck-erp-bom-selection')).toHaveTextContent(/PN-050 rev B/);
    expect(screen.getByTestId('ck-erp-bom-selection')).toHaveTextContent(/vendor Acme Vendor/);
  });

  it('New asm creates a real assembly, persists the id, and dispatches conkay:assembly (which auto-reloads it)', async () => {
    createAssembly.mockResolvedValue({ assembly: { id: 'asm_new_123' } });
    // ensureAssembly() dispatches 'conkay:assembly', which this component's
    // own listener catches and immediately calls load() with — a real fresh
    // assembly has 0 parts, so give the auto-triggered reload an honest
    // empty-but-ok response rather than leaving fetchErpBom unmocked
    // (which would resolve undefined and read as a load failure).
    fetchErpBom.mockResolvedValue({ ok: true, totalParts: 0, lines: [] });
    render(<ErpBomPanel />);
    fireEvent.click(screen.getByTestId('ck-erp-bom-create-asm'));

    await waitFor(() => expect(createAssembly).toHaveBeenCalledWith('erp-bom-panel'));
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-assembly-id')).toHaveValue('asm_new_123'));
    expect(sessionStorage.getItem('conkay.assemblyId')).toBe('asm_new_123');
    // the auto-triggered reload for the brand-new (empty) assembly follows.
    await waitFor(() => expect(fetchErpBom).toHaveBeenCalledWith('asm_new_123'));
  });

  it('a failed assembly creation shows the real error', async () => {
    createAssembly.mockResolvedValue({ error: 'quota exceeded' });
    render(<ErpBomPanel />);
    fireEvent.click(screen.getByTestId('ck-erp-bom-create-asm'));
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/Create assembly failed — quota exceeded/));
  });

  it('Export JSON/CSV are disabled with no assemblyId, and call the real download helpers once one is set', async () => {
    downloadErpBomJson.mockResolvedValue({ ok: true, filename: 'bom.json' });
    downloadErpBomCsv.mockResolvedValue({ ok: true, filename: 'bom.csv', size: 512 });
    render(<ErpBomPanel />);
    expect(screen.getByTestId('ck-erp-bom-export-json')).toBeDisabled();
    expect(screen.getByTestId('ck-erp-bom-export-csv')).toBeDisabled();

    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-export-json'));
    await waitFor(() => expect(downloadErpBomJson).toHaveBeenCalledWith('asm_1'));
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/JSON download LIVE — bom\.json/));

    fireEvent.click(screen.getByTestId('ck-erp-bom-export-csv'));
    await waitFor(() => expect(downloadErpBomCsv).toHaveBeenCalledWith('asm_1'));
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/CSV download LIVE — bom\.csv \(512 bytes\)/));
  });

  it('a failed JSON export shows the real error, not a fabricated success', async () => {
    downloadErpBomJson.mockResolvedValue({ ok: false, error: 'server error' });
    render(<ErpBomPanel />);
    fireEvent.change(screen.getByTestId('ck-erp-bom-assembly-id'), { target: { value: 'asm_1' } });
    fireEvent.click(screen.getByTestId('ck-erp-bom-export-json'));
    await waitFor(() => expect(screen.getByTestId('ck-erp-bom-status')).toHaveTextContent(/JSON export failed — server error/));
  });

  it('restores a previously-persisted assemblyId from sessionStorage and auto-loads it', async () => {
    sessionStorage.setItem('conkay.assemblyId', 'asm_persisted');
    fetchErpBom.mockResolvedValue(BOM);
    render(<ErpBomPanel />);
    await waitFor(() => expect(fetchErpBom).toHaveBeenCalledWith('asm_persisted'));
    expect(screen.getByTestId('ck-erp-bom-assembly-id')).toHaveValue('asm_persisted');
  });
});
