/**
 * /lenses/photography — rolls of real uploaded photos.
 *
 * Import a roll uploads a real file via POST /api/media/upload-raw, then
 * calls photography.shoot-create with the resulting mediaId. A roll (and
 * its frame) renders only after shoot-list contains it back with the
 * same name and mediaId. Add photo / Delete roll / remove-frame each
 * call their own real macro and re-read the list before updating state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const { lensRun, apiPost, authUser } = vi.hoisted(() => ({
  lensRun: vi.fn(),
  apiPost: vi.fn(),
  authUser: { current: null as { username: string } | null },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));
vi.mock('@/components/lens/DTUExportButton', () => ({
  DTUExportButton: () => React.createElement('button', null, '\u2193 .dtu'),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authUser.current, isLoading: false, isAuthenticated: !!authUser.current }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: (...args: unknown[]) => apiPost(...args) },
}));

import PhotographyLens from '@/app/lenses/photography/page';

function listed(shoots: { id: string; name: string; frames?: { id: string; filename: string; mediaId?: string | null }[]; date?: string | null; location?: string | null; client?: string | null }[]) {
  return { data: { ok: true, result: { shoots, count: shoots.length }, error: null } };
}

function makeImageFile(name = 'door.jpg', type = 'image/jpeg', content = 'fake-jpeg-bytes') {
  return new File([content], name, { type });
}

beforeEach(() => {
  lensRun.mockReset();
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: { mediaDTU: { id: 'media_1' } } });
  authUser.current = null;
});

describe('photography card', () => {
  it('EMPTY: says no roll is loaded and offers Import a roll', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
    expect(view.getByRole('heading', { name: 'Photography' })).toBeInTheDocument();
    expect(view.getByRole('button', { name: 'Import a roll' })).toBeEnabled();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.queryByText('Catalog')).toBeNull();
    expect(view.queryByText('Develop')).toBeNull();
  });

  it('WARMING: a shed shoot-list retries and then shows the empty card', async () => {
    lensRun
      .mockResolvedValueOnce({ data: { ok: false, result: null, error: 'service_overloaded' } })
      .mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    expect(await view.findByText('No roll loaded.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(view.queryByRole('alert')).toBeNull();
    expect(lensRun).toHaveBeenCalledTimes(2);
  });

  it('ERROR: a failed list shows role=alert and Retry reloads', async () => {
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'state_unavailable' } });
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('alert')).toHaveTextContent(/state_unavailable/);
    lensRun.mockResolvedValue(listed([]));
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
  });

  it('ROLL: a blank name does not call shoot-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    expect(view.queryByText('No roll loaded.')).toBeNull();
    const fileInput = view.getByTestId('ph-file');
    fireEvent.change(fileInput, { target: { files: [makeImageFile()] } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A name is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('shoot-create');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ROLL: no photo selected does not call shoot-create or upload', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Door roll' } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/A photo is required/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('shoot-create');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('ROLL: uploads the real file, then shows the name and a real thumbnail only after shoot-list matches', async () => {
    const shoots: { id: string; name: string; frames: { id: string; filename: string; mediaId: string | null }[] }[] = [];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { name?: string; frames?: { mediaId?: string }[] }) => {
      if (action === 'shoot-list') return listed(shoots);
      if (action === 'shoot-create') {
        const mediaId = input?.frames?.[0]?.mediaId || null;
        shoots.unshift({ id: 'sht_1', name: input?.name || '', frames: [{ id: 'img_1', filename: 'door.jpg', mediaId }] });
        return { data: { ok: true, result: { shoot: { id: 'sht_1', name: input?.name } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: '  Door roll  ' } });
    fireEvent.change(view.getByTestId('ph-file'), { target: { files: [makeImageFile()] } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('heading', { name: 'Door roll' })).toBeInTheDocument();
    await waitFor(() => expect(view.getByAltText('door.jpg')).toBeInTheDocument());
    expect(view.getByAltText('door.jpg')).toHaveAttribute('src', '/api/media/media_1/stream');
    expect(view.queryByText('No roll loaded.')).toBeNull();

    // the upload goes to the real binary transport, not a JSON base64 body
    const [url, body, config] = apiPost.mock.calls[0];
    expect(url).toMatch(/^\/api\/media\/upload-raw\?/);
    expect(body).toBeInstanceOf(File);
    expect((config as { headers?: Record<string, string> }).headers?.['Content-Type']).toBe('image/jpeg');

    const save = lensRun.mock.calls.find((call) => call[1] === 'shoot-create');
    expect(save?.[0]).toBe('photography');
    expect(save?.[2]).toEqual({ name: 'Door roll', frames: [{ mediaId: 'media_1' }] });
  });

  it('ROLL: an upload failure never calls shoot-create', async () => {
    lensRun.mockResolvedValue(listed([]));
    apiPost.mockRejectedValue({ response: { status: 413, data: { error: 'payload_too_large' } } });
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Door roll' } });
    fireEvent.change(view.getByTestId('ph-file'), { target: { files: [makeImageFile()] } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/File too large/);
    expect(lensRun.mock.calls.map((call) => call[1])).not.toContain('shoot-create');
  });

  it('ROLL: a list miss does not show the name', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'shoot-list') return listed([]);
      if (action === 'shoot-create') {
        return { data: { ok: true, result: { shoot: { id: 'sht_missing', name: 'Lost roll' } }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Lost roll' } });
    fireEvent.change(view.getByTestId('ph-file'), { target: { files: [makeImageFile('lost.jpg')] } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/did not read it back/);
    expect(view.queryByRole('heading', { name: 'Lost roll' })).toBeNull();
  });

  it('HEADER: shows the lens name signed-in', async () => {
    authUser.current = { username: 'ramaj' };
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'Photography' })).toBeInTheDocument();
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
  });

  it('LOAD: shows a stored name and a real thumbnail, and hides date, location, and client', async () => {
    lensRun.mockResolvedValue(listed([
      {
        id: 'sht_a',
        name: 'First roll',
        frames: [{ id: 'img_a', filename: 'first.jpg', mediaId: 'media_a' }],
        date: '1999-01-01',
        location: 'Lisbon',
        client: 'Acme Client',
      },
      { id: 'sht_b', name: '   ', frames: [] },
    ]));
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'First roll' })).toBeInTheDocument();
    expect(view.getByAltText('first.jpg')).toHaveAttribute('src', '/api/media/media_a/stream');
    expect(view.queryByText('No roll loaded.')).toBeNull();
    expect(view.queryByText('1999-01-01')).toBeNull();
    expect(view.queryByText('Lisbon')).toBeNull();
    expect(view.queryByText('Acme Client')).toBeNull();
  });

  it('LOAD: a legacy typed-filename frame (no mediaId) renders a filename row, not a broken image', async () => {
    lensRun.mockResolvedValue(listed([
      { id: 'sht_legacy', name: 'Legacy roll', frames: [{ id: 'img_legacy', filename: 'old.jpg', mediaId: null }] },
    ]));
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'Legacy roll' })).toBeInTheDocument();
    expect(view.getByText('old.jpg')).toBeInTheDocument();
    expect(view.queryByAltText('old.jpg')).toBeNull();
  });

  it('ROLL: a refused create does not show the name', async () => {
    lensRun.mockResolvedValue(listed([]));
    const view = render(<PhotographyLens />);
    fireEvent.click(await view.findByRole('button', { name: 'Import a roll' }));
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'shoot-list') return listed([]);
      if (action === 'shoot-create') return { data: { ok: false, result: null, error: 'roll_not_saved' } };
      throw new Error(action);
    });
    fireEvent.change(view.getByTestId('ph-name'), { target: { value: 'Bad roll' } });
    fireEvent.change(view.getByTestId('ph-file'), { target: { files: [makeImageFile('bad.jpg')] } });
    fireEvent.click(view.getByRole('button', { name: 'Import a roll' }));
    expect(await view.findByRole('alert')).toHaveTextContent(/roll_not_saved/);
    expect(view.queryByRole('heading', { name: 'Bad roll' })).toBeNull();
    expect(view.getByTestId('ph-name')).toBeInTheDocument();
  });

  it('DELETE: a two-click confirm calls shoot-delete and the roll stops listing (F3)', async () => {
    let deleted = false;
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'shoot-list') {
        return listed(deleted ? [] : [{ id: 'sht_1', name: 'Door roll', frames: [{ id: 'img_1', filename: 'door.jpg', mediaId: 'media_1' }] }]);
      }
      if (action === 'shoot-delete') { deleted = true; return { data: { ok: true, result: { deleted: 'sht_1' }, error: null } }; }
      throw new Error(action);
    });
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'Door roll' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    fireEvent.click(view.getByRole('button', { name: 'Confirm delete?' }));
    await waitFor(() => expect(view.queryByRole('heading', { name: 'Door roll' })).toBeNull());
    expect(await view.findByText('No roll loaded.')).toBeInTheDocument();
    expect(lensRun.mock.calls.find((call) => call[1] === 'shoot-delete')?.[2]).toEqual({ rollId: 'sht_1' });
  });

  it('ADD PHOTO: uploads and calls shoot-add-frame on an existing roll', async () => {
    const frames: { id: string; filename: string; mediaId: string | null }[] = [{ id: 'img_1', filename: 'door.jpg', mediaId: 'media_1' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { rollId?: string; mediaId?: string }) => {
      if (action === 'shoot-list') return listed([{ id: 'sht_1', name: 'Door roll', frames }]);
      if (action === 'shoot-add-frame') {
        frames.push({ id: 'img_2', filename: 'door-2.jpg', mediaId: input?.mediaId || null });
        return { data: { ok: true, result: { frame: { id: 'img_2', mediaId: input?.mediaId } }, error: null } };
      }
      throw new Error(action);
    });
    apiPost.mockResolvedValue({ data: { mediaDTU: { id: 'media_2' } } });
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'Door roll' })).toBeInTheDocument();
    const addInput = view.getByText('Add photo').parentElement?.querySelector('input[type="file"]');
    expect(addInput).toBeTruthy();
    fireEvent.change(addInput as HTMLInputElement, { target: { files: [makeImageFile('door-2.jpg')] } });
    await waitFor(() => expect(view.getAllByTestId('ph-frame')).toHaveLength(2));
    const added = lensRun.mock.calls.find((call) => call[1] === 'shoot-add-frame');
    expect(added?.[2]).toEqual({ rollId: 'sht_1', mediaId: 'media_2' });
  });

  it('REMOVE FRAME: the \u00d7 calls shoot-remove-frame and the frame drops out', async () => {
    let frames = [{ id: 'img_1', filename: 'a.jpg', mediaId: 'media_1' }, { id: 'img_2', filename: 'b.jpg', mediaId: 'media_2' }];
    lensRun.mockImplementation(async (_d: string, action: string, input?: { frameId?: string }) => {
      if (action === 'shoot-list') return listed([{ id: 'sht_1', name: 'Door roll', frames }]);
      if (action === 'shoot-remove-frame') {
        frames = frames.filter((f) => f.id !== input?.frameId);
        return { data: { ok: true, result: { deleted: input?.frameId }, error: null } };
      }
      throw new Error(action);
    });
    const view = render(<PhotographyLens />);
    expect(await view.findByRole('heading', { name: 'Door roll' })).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'Remove a.jpg' }));
    await waitFor(() => expect(view.getAllByTestId('ph-frame')).toHaveLength(1));
    expect(lensRun.mock.calls.find((call) => call[1] === 'shoot-remove-frame')?.[2]).toEqual({ rollId: 'sht_1', frameId: 'img_1' });
  });
});
