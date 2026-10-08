/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

import FabricationExportPanel from '@/components/world-lens/FabricationExportPanel';

beforeEach(() => {
  lensRunMock.mockReset();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

describe('FabricationExportPanel', () => {
  it('exports a real STL from engineering.partStl in metres and shows its hash', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { base64: btoa('abc'), sha256: 'f'.repeat(64), byteLength: 3, triangleCount: 12, filename: 'box-part.stl' } } });
    render(<FabricationExportPanel />);
    await act(async () => { fireEvent.click(screen.getByText('Export and download STL')); });
    await waitFor(() => expect(screen.getByText(/Downloaded box-part.stl/)).toBeInTheDocument());
    const [domain, action, input] = lensRunMock.mock.calls[0];
    expect([domain, action]).toEqual(['engineering', 'partStl']);
    expect(input.params).toEqual({ width: 0.04, height: 0.02, length: 0.06 });
    expect(screen.getByText(`sha256:${'f'.repeat(64)}`)).toBeInTheDocument();
  });

  it('lists formats without an exporter as unavailable and never fakes them', () => {
    render(<FabricationExportPanel />);
    for (const f of ['G-code', 'DXF', 'STEP', 'IGES']) {
      expect(screen.getByText(f).closest('button')).toBeDisabled();
    }
  });

  it('shows a real error when the export fails', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'empty_mesh' } });
    render(<FabricationExportPanel />);
    await act(async () => { fireEvent.click(screen.getByText('Export and download STL')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('empty_mesh');
  });
});
