// Behavior test for ExportToolkit's ImportDtuPanel (FIX-export-002).
// The .dtu round trip was one-way: lenses download real binary .dtu
// exports and the server validates/imports them at
// POST /api/lens/:domain/import-dtu, but no surface called it. Following
// the DecryptedArchive seam pattern, the panel is exported and rendered
// standalone with the api client mocked at the network boundary. Pins:
// a valid file posts as octet-stream to the import route and reports
// the created DTU; a too-small file is refused client-side with no
// request; a server rejection surfaces its error instead of a success.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const apiPost = vi.fn();
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));

import { ImportDtuPanel } from '@/components/export/ExportToolkit';

function dtuFile(size = 128, name = 'music-1730000000000.dtu') {
  return new File([new Uint8Array(size)], name, { type: 'application/octet-stream' });
}

describe('export lens — ImportDtuPanel (FIX-export-002)', () => {
  beforeEach(() => {
    apiPost.mockReset();
    lensRun.mockReset();
  });

  it('posts the file to the import route and reports the created DTU', async () => {
    apiPost.mockResolvedValue({ data: { imported: true, dtuId: 'dtu_42', metadata: { title: 'Music export', domain: 'music' } } });
    render(<ImportDtuPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [dtuFile()] } });
    await waitFor(() => expect(screen.getByText(/Loaded: music-1730000000000\.dtu/)).toBeTruthy());
    fireEvent.click(screen.getByText('Import + validate'));
    await waitFor(() => expect(apiPost).toHaveBeenCalled());
    const [url, body, cfg] = apiPost.mock.calls[0];
    expect(url).toBe('/api/lens/export/import-dtu');
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect((body as ArrayBuffer).byteLength).toBe(128);
    expect(cfg.headers['Content-Type']).toBe('application/octet-stream');
    await waitFor(() => expect(screen.getByText(/Imported "Music export" as DTU dtu_42/)).toBeTruthy());
  });

  it('refuses a too-small file client-side and sends nothing', async () => {
    render(<ImportDtuPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [dtuFile(10, 'tiny.dtu')] } });
    await waitFor(() => expect(screen.getByText(/too small to be a Concord .dtu export/)).toBeTruthy());
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('surfaces a server rejection instead of declaring success', async () => {
    apiPost.mockRejectedValue({ response: { data: { error: 'Invalid DTU: bad header' } } });
    render(<ImportDtuPanel />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [dtuFile()] } });
    await waitFor(() => expect(screen.getByText(/Loaded:/)).toBeTruthy());
    fireEvent.click(screen.getByText('Import + validate'));
    await waitFor(() => expect(screen.getByText(/Import refused: Invalid DTU: bad header/)).toBeTruthy());
  });
});
