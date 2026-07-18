/// <reference types="@testing-library/jest-dom/vitest" />
// ARCaptureGallery — Wave-4 gap closure, docs/lens-specs/ar-capability-map.md
// item 13 ("No AR capture/screenshot/recording gallery"). Pins: the honest
// browser-support fallback when MediaRecorder/canvas.captureStream are
// unavailable, a real screenshot capture flow that posts the actual
// canvas.toDataURL() output to ar.captureUpload (never a placeholder image),
// the gallery rendering real fetched captures from ar.captureList, the
// delete flow round-tripping through ar.captureDelete, and an honest empty
// state when there are no captures yet.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { ARCaptureGallery } from '@/components/ar/ARCaptureGallery';

const REAL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function listResponse(captures: Array<Record<string, unknown>> = []) {
  return { data: { ok: true, result: { captures, count: captures.length } } };
}

function makeCanvasRef(canvas: HTMLCanvasElement | null): MutableRefObject<HTMLCanvasElement | null> {
  return { current: canvas };
}

describe('ARCaptureGallery — honest browser-support fallback', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockResolvedValue(listResponse([]));
  });

  it('shows an honest "recording not supported" message and disables Record when MediaRecorder/captureStream are unavailable', async () => {
    const origMediaRecorder = (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const origCaptureStream = (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;
    // Force the unsupported branch explicitly (jsdom doesn't implement either by default).
    delete (window as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    delete (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream;

    try {
      const canvas = document.createElement('canvas');
      render(<ARCaptureGallery canvasRef={makeCanvasRef(canvas)} sceneId={null} />);

      await waitFor(() => expect(lensRun).toHaveBeenCalledWith('ar', 'captureList', {}));
      expect(await screen.findByText(/Recording not supported in this browser/i)).toBeInTheDocument();
      expect(screen.getByLabelText('Start recording')).toBeDisabled();
    } finally {
      if (origMediaRecorder) (window as unknown as { MediaRecorder?: unknown }).MediaRecorder = origMediaRecorder;
      if (origCaptureStream) {
        (HTMLCanvasElement.prototype as unknown as { captureStream?: unknown }).captureStream = origCaptureStream;
      }
    }
  });

  it('leaves Screenshot enabled even when recording is unsupported', async () => {
    const canvas = document.createElement('canvas');
    render(<ARCaptureGallery canvasRef={makeCanvasRef(canvas)} sceneId={null} />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('ar', 'captureList', {}));
    expect(screen.getByLabelText('Take screenshot')).not.toBeDisabled();
  });
});

describe('ARCaptureGallery — real screenshot capture flow', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('captures the real canvas.toDataURL() output and posts it to ar.captureUpload', async () => {
    const canvas = document.createElement('canvas');
    const toDataURLSpy = vi.spyOn(canvas, 'toDataURL').mockReturnValue(REAL_PNG_DATA_URL);

    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'captureList') return Promise.resolve(listResponse([]));
      if (action === 'captureUpload') {
        return Promise.resolve({
          data: { ok: true, result: { uploaded: true, capture: { id: 'cap_1', mimeType: 'image/png', sceneId: null, durationMs: null, label: null, byteSize: 67, createdAt: '2026-07-16T00:00:00.000Z' } } },
        });
      }
      return Promise.resolve(listResponse([]));
    });

    render(<ARCaptureGallery canvasRef={makeCanvasRef(canvas)} sceneId="scene_9" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('ar', 'captureList', {}));

    fireEvent.click(screen.getByLabelText('Take screenshot'));

    await waitFor(() => expect(toDataURLSpy).toHaveBeenCalledWith('image/png'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('ar', 'captureUpload', {
      dataUrl: REAL_PNG_DATA_URL, mimeType: 'image/png', sceneId: 'scene_9',
    }));
    // Never fabricates — the exact bytes captured from the real canvas are what's sent.
    const uploadCall = lensRun.mock.calls.find((c) => c[1] === 'captureUpload');
    expect(uploadCall?.[2].dataUrl).toBe(REAL_PNG_DATA_URL);
  });

  it('does not call captureUpload when there is no real canvas to capture from', async () => {
    lensRun.mockResolvedValue(listResponse([]));
    render(<ARCaptureGallery canvasRef={makeCanvasRef(null)} sceneId={null} />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('ar', 'captureList', {}));

    fireEvent.click(screen.getByLabelText('Take screenshot'));
    await waitFor(() => expect(screen.getByText(/No active AR render surface/i)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalledWith('ar', 'captureUpload', expect.anything());
  });
});

describe('ARCaptureGallery — gallery renders real fetched captures', () => {
  beforeEach(() => lensRun.mockReset());

  it('renders honest empty state with zero captures', async () => {
    lensRun.mockResolvedValue(listResponse([]));
    render(<ARCaptureGallery canvasRef={makeCanvasRef(document.createElement('canvas'))} sceneId={null} />);
    expect(await screen.findByText(/No captures yet/i)).toBeInTheDocument();
    expect(screen.getByText('Gallery (0)')).toBeInTheDocument();
  });

  it('renders real captures returned by ar.captureList (id, mime, size, label)', async () => {
    lensRun.mockResolvedValue(listResponse([
      { id: 'cap_a', mimeType: 'image/png', sceneId: null, durationMs: null, label: 'porch shot', byteSize: 2048, createdAt: '2026-07-16T00:00:00.000Z' },
      { id: 'cap_b', mimeType: 'video/webm', sceneId: 'scene_1', durationMs: 4200, label: null, byteSize: 900000, createdAt: '2026-07-16T00:01:00.000Z' },
    ]));
    render(<ARCaptureGallery canvasRef={makeCanvasRef(document.createElement('canvas'))} sceneId={null} />);

    expect(await screen.findByText('Gallery (2)')).toBeInTheDocument();
    expect(screen.getByText('porch shot')).toBeInTheDocument();
    expect(screen.getByText('video/webm')).toBeInTheDocument();
    expect(screen.getByText('4.2s')).toBeInTheDocument();
  });
});

describe('ARCaptureGallery — delete flow', () => {
  beforeEach(() => lensRun.mockReset());

  it('deletes a capture through ar.captureDelete and refreshes the gallery', async () => {
    let deleteCalled = false;
    lensRun.mockImplementation((domain: string, action: string) => {
      if (action === 'captureList') {
        return Promise.resolve(
          (deleteCalled ? listResponse([]) : listResponse([
            { id: 'cap_x', mimeType: 'image/png', sceneId: null, durationMs: null, label: 'to delete', byteSize: 1024, createdAt: '2026-07-16T00:00:00.000Z' },
          ])),
        );
      }
      if (action === 'captureDelete') {
        deleteCalled = true;
        return Promise.resolve({ data: { ok: true, result: { deleted: true, captureId: 'cap_x' } } });
      }
      return Promise.resolve(listResponse([]));
    });

    render(<ARCaptureGallery canvasRef={makeCanvasRef(document.createElement('canvas'))} sceneId={null} />);
    await screen.findByText('to delete');

    fireEvent.click(screen.getByLabelText('Delete capture cap_x'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('ar', 'captureDelete', { captureId: 'cap_x' }));
    await waitFor(() => expect(screen.queryByText('to delete')).not.toBeInTheDocument());
  });
});
