/// <reference types="@testing-library/jest-dom/vitest" />
// BrainModePanel — Private Mode / High Power Mode Settings surface.
//
// Task #29 of the Private Mode / High Power Mode plan. Pins:
//   1. Loads byo_keys.get_brain_mode on mount and reflects Private by
//      default (aria-pressed).
//   2. Both disclosure blocks render the approved copy verbatim -- same
//      bar as the onboarding screen's test: named providers + the
//      training-tradeoff sentence must actually be on screen, not just
//      "the toggle works".
//   3. Clicking a mode calls byo_keys.set_brain_mode with the right
//      payload and updates the "current mode" badge.
//   4. onModeChange fires with the loaded/saved mode so a parent (the
//      byo-keys lens page) can gray out the BYO slot cards.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { BrainModePanel } from './BrainModePanel';

describe('BrainModePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads get_brain_mode on mount and shows Private as active by default', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });

    render(<BrainModePanel />);

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('byo_keys', 'get_brain_mode', {}));
    expect(await screen.findByTestId('brain-mode-current')).toHaveTextContent('PRIVATE');
    expect(screen.getByTestId('brain-mode-select-private')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('brain-mode-select-high-power')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('brain-mode-private-note')).toBeInTheDocument();
  });

  it('reflects a High Power state loaded from the backend', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { brainMode: 'high_power', brainModeSetAt: 123 }, error: null },
    });

    render(<BrainModePanel />);

    expect(await screen.findByTestId('brain-mode-current')).toHaveTextContent('HIGH POWER');
    expect(screen.getByTestId('brain-mode-select-high-power')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('brain-mode-private-note')).toBeNull();
  });

  it('renders the Private disclosure with the absolute "no exceptions" guarantee', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });
    render(<BrainModePanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(screen.getByText(/Nothing you.*do here ever reaches an outside AI provider\. No exceptions/)).toBeInTheDocument();
  });

  it('renders the High Power disclosure naming the actual providers and the training tradeoff', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });
    render(<BrainModePanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(screen.getByText(/Google Gemini, Mistral, and Groq/)).toBeInTheDocument();
    expect(screen.getByText(/Groq does.*not, Gemini and Mistral.s free tiers do\./)).toBeInTheDocument();
    expect(screen.getByText(/Some of these providers may use your messages to improve their own AI models/)).toBeInTheDocument();
  });

  it('clicking High Power calls set_brain_mode with the right payload and updates the badge', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { brainMode: 'high_power', brainModeSetAt: 456 }, error: null },
    });

    render(<BrainModePanel />);
    await waitFor(() => expect(screen.getByTestId('brain-mode-current')).toHaveTextContent('PRIVATE'));

    fireEvent.click(screen.getByTestId('brain-mode-select-high-power'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('byo_keys', 'set_brain_mode', { brainMode: 'high_power' }));
    await waitFor(() => expect(screen.getByTestId('brain-mode-current')).toHaveTextContent('HIGH POWER'));
  });

  it('calls onModeChange with the loaded mode and again after a save', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { brainMode: 'high_power', brainModeSetAt: 456 }, error: null },
    });
    const onModeChange = vi.fn();

    render(<BrainModePanel onModeChange={onModeChange} />);
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('private'));

    fireEvent.click(screen.getByTestId('brain-mode-select-high-power'));
    await waitFor(() => expect(onModeChange).toHaveBeenCalledWith('high_power'));
  });

  it('clicking the already-active mode does not re-issue a write', async () => {
    lensRunMock.mockResolvedValue({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });
    render(<BrainModePanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('brain-mode-select-private'));
    // Give any accidental async write a tick to fire, then assert it didn't.
    await new Promise((r) => setTimeout(r, 10));
    expect(lensRunMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when set_brain_mode fails', async () => {
    lensRunMock.mockResolvedValueOnce({
      data: { ok: true, result: { brainMode: 'private', brainModeSetAt: null }, error: null },
    });
    lensRunMock.mockResolvedValueOnce({
      data: { ok: false, result: null, error: 'invalid_brain_mode' },
    });

    render(<BrainModePanel />);
    await waitFor(() => expect(screen.getByTestId('brain-mode-current')).toHaveTextContent('PRIVATE'));

    fireEvent.click(screen.getByTestId('brain-mode-select-high-power'));

    expect(await screen.findByTestId('brain-mode-error')).toHaveTextContent('invalid_brain_mode');
    // The badge must NOT have flipped on a failed write.
    expect(screen.getByTestId('brain-mode-current')).toHaveTextContent('PRIVATE');
  });
});
