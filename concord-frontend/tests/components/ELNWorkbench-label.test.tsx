// Behavior test for ELNWorkbench's barcode/2D-barcode label printing —
// closes docs/WAVE4_INVENTORY.md row 206 (lab lens: "No barcode/2D-barcode
// label printing for samples/reagents"). Covers: the Label button renders
// per reagent/construct("sample") row, clicking it calls the real
// `lab.label-generate` macro with the right { recordType, id }, the
// returned payload is rendered into a real QR-code image (via the
// already-installed `qrcode` package — the same approach used by
// components/crypto/QRCodeReceive.tsx), and macro failure surfaces
// honestly instead of a fake success.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

const toDataURL = vi.fn();
vi.mock('qrcode', () => ({ toDataURL: (...args: unknown[]) => toDataURL(...args) }));

// ChartKit is used by the QC-trend tab (not rendered in these tests) but is
// imported at module scope — stub it so it never touches real chart libs.
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { ELNWorkbench } from '@/components/lab/ELNWorkbench';

const reagentItem = {
  id: 'rgt_1', name: 'Taq polymerase', lot: 'L2024-09', vendor: 'NEB',
  catalogNumber: 'M0273', location: 'Unassigned', freezerBox: '-20 / A1',
  quantity: 5, unit: 'units', lowThreshold: 1, expiry: null,
  daysToExpiry: null, expiryStatus: 'ok', lowStock: false,
};

const constructItem = {
  id: 'dna_1', name: 'pTest-GFP', type: 'plasmid', length: 4200, gcContent: 52.3,
  resistance: 'AmpR', backbone: '', notes: '', createdAt: '2026-01-01T00:00:00.000Z',
};

const okResponse = (result: unknown) => ({ data: { ok: true, result } });

describe('ELNWorkbench — label printing', () => {
  beforeEach(() => {
    lensRun.mockReset();
    toDataURL.mockReset();
    toDataURL.mockResolvedValue('data:image/png;base64,FAKE');
  });

  it('renders a Label button per reagent row in the Inventory tab', async () => {
    lensRun.mockResolvedValue(okResponse({
      items: [reagentItem], total: 1, alerts: [], expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0,
    }));
    render(<ELNWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Inventory/i }));
    await screen.findByText('Taq polymerase', { exact: false });
    expect(screen.getByRole('button', { name: /Print label/i })).toBeInTheDocument();
  });

  it('clicking Label calls lab.label-generate with recordType "reagent" and the row id, then renders the QR + metadata', async () => {
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'inventory-list') {
        return Promise.resolve(okResponse({
          items: [reagentItem], total: 1, alerts: [], expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0,
        }));
      }
      if (name === 'label-generate') {
        return Promise.resolve(okResponse({
          label: {
            id: 'lbl_1', recordType: 'reagent', recordId: 'rgt_1',
            payload: 'LAB:REAGENT:rgt_1:L2024-09',
            name: 'Taq polymerase', lot: 'L2024-09', catalogNumber: 'M0273',
            vendor: 'NEB', location: '-20 / A1', expiry: null, hazard: 'none',
            generatedAt: '2026-07-16T00:00:00.000Z', generatedBy: 'u1',
          },
        }));
      }
      return Promise.resolve(okResponse({}));
    });

    render(<ELNWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Inventory/i }));
    await screen.findByText('Taq polymerase', { exact: false });

    fireEvent.click(screen.getByRole('button', { name: /Print label/i }));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('lab', 'label-generate', { recordType: 'reagent', id: 'rgt_1' });
    });

    // The real payload string is rendered, and the real `qrcode` lib is
    // invoked with that exact payload — not a fabricated barcode-looking
    // placeholder.
    await screen.findByText('LAB:REAGENT:rgt_1:L2024-09');
    await waitFor(() => expect(toDataURL).toHaveBeenCalledWith(
      'LAB:REAGENT:rgt_1:L2024-09',
      expect.objectContaining({ errorCorrectionLevel: 'M' }),
    ));
    const img = await screen.findByAltText(/Barcode for Taq polymerase/i);
    expect(img).toHaveAttribute('src', 'data:image/png;base64,FAKE');
    expect(screen.getByText(/Lot L2024-09/)).toBeInTheDocument();
    expect(screen.getByText(/Cat# M0273/)).toBeInTheDocument();
  });

  it('renders a Label button per construct row in the Constructs tab and calls label-generate with recordType "sample"', async () => {
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'construct-list') {
        return Promise.resolve(okResponse({ constructs: [constructItem], total: 1, totalBases: 4200 }));
      }
      if (name === 'label-generate') {
        return Promise.resolve(okResponse({
          label: {
            id: 'lbl_2', recordType: 'sample', recordId: 'dna_1',
            payload: 'LAB:SAMPLE:dna_1:plasmid',
            name: 'pTest-GFP', constructType: 'plasmid', resistance: 'AmpR',
            lengthBp: 4200, gcContent: 52.3,
            generatedAt: '2026-07-16T00:00:00.000Z', generatedBy: 'u1',
          },
        }));
      }
      return Promise.resolve(okResponse({}));
    });

    render(<ELNWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Constructs/i }));
    await screen.findByText('pTest-GFP', { exact: false });

    fireEvent.click(screen.getByRole('button', { name: /Print label/i }));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('lab', 'label-generate', { recordType: 'sample', id: 'dna_1' });
    });
    await screen.findByText('LAB:SAMPLE:dna_1:plasmid');
    // "4200 bp · GC 52.3%" appears both in the row and in the label —
    // assert it rendered at least twice rather than requiring uniqueness.
    expect(screen.getAllByText(/4200 bp/).length).toBeGreaterThanOrEqual(2);
  });

  it('surfaces a macro failure honestly instead of a fake success', async () => {
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'inventory-list') {
        return Promise.resolve(okResponse({
          items: [reagentItem], total: 1, alerts: [], expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0,
        }));
      }
      if (name === 'label-generate') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'reagent not found' } });
      }
      return Promise.resolve(okResponse({}));
    });

    render(<ELNWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Inventory/i }));
    await screen.findByText('Taq polymerase', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /Print label/i }));

    await screen.findByText(/reagent not found/i);
    // No barcode image and no payload text should render on failure.
    expect(screen.queryByAltText(/Barcode for/i)).not.toBeInTheDocument();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it('closes the label modal without calling the macro again', async () => {
    lensRun.mockImplementation((domain: string, name: string) => {
      if (name === 'inventory-list') {
        return Promise.resolve(okResponse({
          items: [reagentItem], total: 1, alerts: [], expiredCount: 0, expiringSoonCount: 0, lowStockCount: 0,
        }));
      }
      if (name === 'label-generate') {
        return Promise.resolve(okResponse({
          label: {
            id: 'lbl_1', recordType: 'reagent', recordId: 'rgt_1', payload: 'LAB:REAGENT:rgt_1:L2024-09',
            name: 'Taq polymerase', lot: 'L2024-09', generatedAt: '2026-07-16T00:00:00.000Z', generatedBy: 'u1',
          },
        }));
      }
      return Promise.resolve(okResponse({}));
    });

    render(<ELNWorkbench />);
    fireEvent.click(screen.getByRole('button', { name: /Inventory/i }));
    await screen.findByText('Taq polymerase', { exact: false });
    fireEvent.click(screen.getByRole('button', { name: /Print label/i }));
    const closeBtn = await screen.findByRole('button', { name: /Close/i });
    const callsAfterOpen = lensRun.mock.calls.length;
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('button', { name: /^Print$/i })).not.toBeInTheDocument();
    expect(lensRun.mock.calls.length).toBe(callsAfterOpen);
  });
});
