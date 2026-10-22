import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listMock = vi.fn();
vi.mock('@/lib/daw/studio-api', () => ({
  studioTransport: { list: (...a: unknown[]) => listMock(...a) },
  browserLocalStore: {},
  browseMusicLibrary: vi.fn(async () => []),
}));
vi.mock('@/lib/daw/playback-engine', () => ({
  getStudioEngine: () => ({ ctx: { sampleRate: 48000 }, resume: async () => {} }),
}));

import { Opener } from '@/components/studio/daw/Opener';
import { RecordPanel } from '@/components/studio/daw/RecordPanel';
import type { InputRecorderApi } from '@/components/studio/daw/useInputRecorder';
import { DEFAULT_INPUT_PREFS, classifyMicError } from '@/lib/daw/input-devices';

function fakeRecorder(over: Partial<InputRecorderApi['state']> = {}): InputRecorderApi {
  return {
    state: { devices: [], needsPermission: true, prefs: { ...DEFAULT_INPUT_PREFS }, open: false, opening: false, deviceChannels: 1, activeLabel: null, error: null, latencyMs: 0, monitorPath: 'off', monitorLines: ['Software monitoring is off.'], ...over },
    refresh: vi.fn(async () => []),
    openInput: vi.fn(async () => true),
    setPrefs: vi.fn(async () => {}),
    close: vi.fn(),
    getLevel: () => ({ peakDb: -120, rmsDb: -120, clipped: false }),
    resetClip: vi.fn(),
    start: () => true,
    stop: () => null,
    isRecording: () => false,
    isOpen: () => false,
    calibrate: vi.fn(async () => ({ ok: false, message: 'not measured' })),
  };
}

describe('Studio opener', () => {
  it('lists templates (no podcast) and recent projects newest first', async () => {
    listMock.mockResolvedValueOnce([
      { id: 'a', name: 'Older', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'b', name: 'Newer', updatedAt: '2026-06-01T00:00:00Z' },
    ]);
    const onNew = vi.fn();
    const onOpen = vi.fn();
    render(<Opener onNew={onNew} onOpenProject={onOpen} opening={null} />);
    expect(screen.getByTestId('studio-template-demo')).toBeTruthy();
    expect(screen.getByTestId('studio-template-vocal')).toBeTruthy();
    expect(screen.queryByText(/podcast/i)).toBeNull();
    const rows = await screen.findAllByTestId('studio-recent');
    expect(rows[0].textContent).toContain('Newer');
    fireEvent.click(rows[0]);
    expect(onOpen).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByTestId('studio-template-beat'));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew.mock.calls[0][0].tracks.length).toBeGreaterThan(1);
  });
});

describe('Studio record panel', () => {
  it('asks for mic permission and lists devices by label', () => {
    const api = fakeRecorder({ devices: [{ deviceId: 'x', groupId: 'g', label: 'Scarlett 2i2 USB', hasRealLabel: true, isDefault: false }], needsPermission: false });
    render(<RecordPanel api={api} />);
    expect(screen.getByRole('option', { name: /Scarlett 2i2 USB/ })).toBeTruthy();
    fireEvent.click(screen.getByTestId('studio-enable-input'));
    expect(api.openInput).toHaveBeenCalled();
  });

  it('shows per-browser steps and retry when permission is denied', () => {
    const err = classifyMicError(Object.assign(new Error('denied'), { name: 'NotAllowedError' }), { isSecureContext: true, userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' });
    const api = fakeRecorder({ error: err });
    render(<RecordPanel api={api} />);
    const card = screen.getByTestId('studio-mic-error');
    expect(card.textContent).toMatch(/Safari/);
  });

  it('voice cleanup is off by default and monitoring asks for headphones first', async () => {
    const api = fakeRecorder({ open: true });
    render(<RecordPanel api={api} />);
    expect((screen.getByTestId('studio-voice-cleanup') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('studio-monitor'));
    expect(api.setPrefs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/I have headphones on/));
    await waitFor(() => expect(api.setPrefs).toHaveBeenCalledWith({ monitor: true }));
  });
});
