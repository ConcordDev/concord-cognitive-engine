/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const emitMock = vi.fn();
vi.mock('@/lib/realtime/socket', () => ({
  emit: (event: string, data?: unknown) => emitMock(event, data),
  subscribe: () => () => {},
}));

import SettingsPanel from './SettingsPanel';

const SAVED = {
  data: {
    ok: true,
    result: {
      prefs: {
        audio_master_volume: 0.7,
        audio_music_volume: 0.6,
        audio_sfx_volume: 0.8,
        mouse_sensitivity: 1.4,
        quality_preset: 'balanced',
      },
    },
    error: null,
  },
};

describe('SettingsPanel hydration', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    emitMock.mockReset();
  });

  it('does not render default zeros, and keeps Apply off, until settings.get resolves', async () => {
    let resolveGet: (value: unknown) => void = () => {};
    lensRunMock.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));

    render(<SettingsPanel settings={{ audioMasterVolume: 0, audioMusicVolume: 0, audioSfxVolume: 0 }} />);

    expect(screen.getByTestId('settings-hydrating')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).toBeNull();
    expect(screen.getByTestId('settings-apply')).toBeDisabled();

    resolveGet(SAVED);
    expect(await screen.findByTestId('settings-value-Master')).toHaveTextContent('0.70');
    expect(screen.getByTestId('settings-value-Music')).toHaveTextContent('0.60');
    expect(screen.getByTestId('settings-value-SFX')).toHaveTextContent('0.80');
    expect(screen.getByTestId('settings-value-Mouse Sensitivity')).toHaveTextContent('1.40');
    expect(screen.getByTestId('settings-apply')).toBeEnabled();
  });

  it('does not call setMany or onChange when the saved values did not load', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, result: null, error: 'no_session' } });
    const onChange = vi.fn();
    render(<SettingsPanel onChange={onChange} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Apply stays off/);
    fireEvent.click(screen.getByTestId('settings-apply'));
    expect(onChange).not.toHaveBeenCalled();
    expect(lensRunMock).not.toHaveBeenCalledWith('settings', 'setMany', expect.anything());
  });

  it('does not write defaults when Apply is pressed on an unchanged form', async () => {
    lensRunMock.mockResolvedValue(SAVED);
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<SettingsPanel onChange={onChange} onClose={onClose} />);
    await screen.findByTestId('settings-value-Master');

    fireEvent.click(screen.getByTestId('settings-apply'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(lensRunMock).not.toHaveBeenCalledWith('settings', 'setMany', expect.anything());
    expect(onChange).toHaveBeenCalled();
    const written = onChange.mock.calls[0][0];
    expect(written.audioMasterVolume).toBe(0.7);
    expect(written.audioSfxVolume).toBe(0.8);
  });

  it('writes only the volume the user changed', async () => {
    lensRunMock.mockResolvedValueOnce(SAVED);
    lensRunMock.mockResolvedValueOnce({ data: { ok: true, result: {}, error: null } });
    render(<SettingsPanel />);
    await screen.findByTestId('settings-value-Master');

    fireEvent.change(screen.getByLabelText('Master'), { target: { value: '0.25' } });
    fireEvent.click(screen.getByTestId('settings-apply'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('settings', 'setMany', {
      updates: { audio_master_volume: 0.25 },
    }));
    const setCall = lensRunMock.mock.calls.find((c) => c[1] === 'setMany');
    expect(setCall?.[2].updates).not.toHaveProperty('audio_music_volume');
    expect(setCall?.[2].updates).not.toHaveProperty('audio_sfx_volume');
  });

  it('leaves saved values in place when setMany fails', async () => {
    lensRunMock.mockResolvedValueOnce(SAVED);
    lensRunMock.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'write_failed' } });
    const onChange = vi.fn();
    render(<SettingsPanel onChange={onChange} />);
    await screen.findByTestId('settings-value-Master');

    fireEvent.change(screen.getByLabelText('Music'), { target: { value: '0.1' } });
    fireEvent.click(screen.getByTestId('settings-apply'));

    expect(await screen.findByRole('alert')).toHaveTextContent('write_failed');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('settings-value-Music')).toHaveTextContent('0.10');
  });

  it('reset stages schema defaults only after confirm, and does not write them until Apply', async () => {
    lensRunMock.mockResolvedValue(SAVED);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SettingsPanel />);
    await screen.findByTestId('settings-value-Master');

    fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(screen.getByTestId('settings-value-Master')).toHaveTextContent('0.70');
    expect(lensRunMock).not.toHaveBeenCalledWith('settings', 'setMany', expect.anything());

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Defaults' }));
    expect(screen.getByLabelText('Quality')).toHaveValue('medium');
    expect(lensRunMock).not.toHaveBeenCalledWith('settings', 'setMany', expect.anything());
    confirm.mockRestore();
  });
});
