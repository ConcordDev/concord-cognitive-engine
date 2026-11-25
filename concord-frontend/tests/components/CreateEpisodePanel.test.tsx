/**
 * Create Episode uploads a selected file instead of saving mediaId null. The
 * file goes to POST /api/media/upload-raw as the request body (the JSON
 * base64 path was cut at ~7.5 KB by the request sanitizer, so no real
 * episode ever uploaded through it).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();
const postMock = vi.fn(); // the fetch to /api/media/upload-raw
const toastMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/common/Toasts', () => ({
  showToast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (props: { onValueChange?: (v: string) => void; placeholder?: string }) => (
    <textarea aria-label="Description" placeholder={props.placeholder} onChange={(e) => props.onValueChange?.(e.target.value)} />
  ),
}));
vi.mock('@/lib/podcast/probe-audio-duration', () => ({
  probeAudioFileDuration: () => Promise.resolve(8),
}));

import { CreateEpisodePanel } from '@/components/podcast/CreateEpisodePanel';

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateEpisodePanel />
    </QueryClientProvider>,
  );
}

function makeFile(name = 'pilot.mp3', type = 'audio/mpeg', content = 'not-really-audio') {
  const file = new File([content], name, { type });
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.resolve(new TextEncoder().encode(content).buffer),
    });
  }
  return file;
}

beforeEach(() => {
  vi.stubGlobal('fetch', (...args: unknown[]) => postMock(...args));
  lensRunMock.mockReset();
  postMock.mockReset();
  toastMock.mockReset();
  lensRunMock.mockImplementation((_domain: string, action: string, input?: Record<string, unknown>) => {
    if (action === 'my-show-ensure') {
      return Promise.resolve({ data: { ok: true, result: { show: { id: 'show_1', subscriberCount: 2 } } } });
    }
    if (action === 'episode-list') {
      return Promise.resolve({ data: { ok: true, result: { episodes: [] } } });
    }
    if (action === 'episode-add') {
      return Promise.resolve({
        data: {
          ok: true,
          result: {
            episode: {
              id: 'ep_1',
              episodeNumber: input?.episodeNumber ?? 1,
              mediaId: input?.mediaId ?? null,
              durationSec: input?.durationSec ?? 0,
            },
          },
        },
      });
    }
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
  postMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ mediaDTU: { id: 'media_1', duration: 12.4 } }) });
});

describe('CreateEpisodePanel', () => {
  it('uploads a selected file on Create and saves mediaId plus duration', async () => {
    const { container } = renderPanel();
    fireEvent.change(await screen.findByPlaceholderText('Episode title'), { target: { value: 'Pilot' } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Episode' }));

    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('podcast', 'episode-add', expect.objectContaining({
        title: 'Pilot',
        showId: 'show_1',
        mediaId: 'media_1',
      }));
    });
    const add = lensRunMock.mock.calls.find((c) => c[1] === 'episode-add');
    expect(add?.[2].mediaId).toBe('media_1');
    expect(add?.[2].durationSec).toBeGreaterThan(0);
    expect(postMock).toHaveBeenCalled();
    const [url, init] = postMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^\/api\/media\/upload-raw\?/);
    expect(new URLSearchParams(url.split('?')[1]).get('mediaType')).toBe('audio');
    expect(init.body).toBeInstanceOf(File);
    expect((init.body as File).name).toBe('pilot.mp3');
    const uploadOrder = postMock.mock.invocationCallOrder[0];
    const addOrder = lensRunMock.mock.invocationCallOrder[
      lensRunMock.mock.calls.findIndex((c) => c[1] === 'episode-add')
    ];
    expect(uploadOrder).toBeLessThan(addOrder);
    expect(add?.[2].mediaId).not.toBeNull();
  });

  it('blocks Create when the selected file does not upload', async () => {
    postMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'File type not allowed' }) });
    const { container } = renderPanel();
    fireEvent.change(await screen.findByPlaceholderText('Episode title'), { target: { value: 'Pilot' } });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Episode' }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith('error', expect.stringContaining('Upload the audio first'));
    });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'episode-add')).toBe(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload the audio first');
  });

  it('seeds the next episode number from the show', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'my-show-ensure') {
        return Promise.resolve({ data: { ok: true, result: { show: { id: 'show_1' } } } });
      }
      if (action === 'episode-list') {
        return Promise.resolve({
          data: { ok: true, result: { episodes: [{ id: 'ep_old', episodeNumber: 4, seasonNumber: 1, title: 'Old', durationSec: 10, status: 'draft' }] } },
        });
      }
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    renderPanel();
    await waitFor(() => {
      expect(screen.getByLabelText('Episode Number')).toHaveValue(5);
    });
  });
});
