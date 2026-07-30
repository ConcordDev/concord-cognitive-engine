/// <reference types="@testing-library/jest-dom/vitest" />
// ChooseYourBrain — Private Mode / High Power Mode onboarding screen.
//
// Task #28 of the Private Mode / High Power Mode plan (plus task #33's
// rollout-gate wiring). Pins:
//   1. Private is pre-selected by default.
//   2. Both disclosure blocks actually render the approved copy verbatim
//      -- not just "the toggle works" but that the plain-and-specific
//      tradeoff language (named providers, the training-tradeoff
//      sentence) is genuinely on screen.
//   3. Submitting posts the selected mode to /api/auth/choose-brain-mode.
//   4. onComplete fires on success; the default fallback navigates to
//      /onboarding (the universe-seeding step that runs after this one).
//   5. The rollout gate (highPowerAllowed from GET /api/auth/me) disables
//      the High Power card when the account isn't allowlisted.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const post = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => post(...a), get: (...a: unknown[]) => get(...a) },
}));

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ChooseYourBrain } from './ChooseYourBrain';

function renderWithClient(props: Parameters<typeof ChooseYourBrain>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChooseYourBrain {...props} />
    </QueryClientProvider>,
  );
}

describe('ChooseYourBrain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { user: { highPowerAllowed: true } } });
  });

  it('pre-selects Private by default', () => {
    renderWithClient();
    const privateCard = screen.getByRole('button', { name: /Private — local only/ });
    const highPowerCard = screen.getByRole('button', { name: /High Power — faster, more capable, not private/ });
    expect(privateCard).toHaveAttribute('aria-pressed', 'true');
    expect(highPowerCard).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the Private disclosure with the absolute "no exceptions" guarantee', () => {
    renderWithClient();
    expect(screen.getByText(/Nothing you do here ever reaches an outside AI provider\. No exceptions\./)).toBeInTheDocument();
  });

  it('renders the High Power disclosure naming the actual providers and the training tradeoff, plain and specific', () => {
    renderWithClient();
    // Names the real providers -- not a euphemism like "external services".
    expect(screen.getByText(/Google Gemini, Mistral, and Groq/)).toBeInTheDocument();
    // States which ones train, which one doesn't -- the actual tradeoff,
    // not hidden behind a generic "your data may be used" disclaimer.
    expect(screen.getByText(/Groq does not, Gemini and Mistral.s free tiers do\./)).toBeInTheDocument();
    expect(screen.getByText(/Some of these providers may use your messages to improve their own AI models/)).toBeInTheDocument();
  });

  it('selecting High Power flips aria-pressed and the continue-button label', async () => {
    renderWithClient();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /High Power — faster, more capable, not private/ }));
    expect(screen.getByRole('button', { name: /High Power — faster, more capable, not private/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Private — local only/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Continue with High Power/)).toBeInTheDocument();
  });

  it('continuing with Private (the default) posts brainMode: "private" and calls onComplete', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, brainMode: 'private', brainModeSetAt: 123 } });
    const onComplete = vi.fn();
    renderWithClient({ onComplete });

    fireEvent.click(screen.getByText(/Stay Private/));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/auth/choose-brain-mode', { brainMode: 'private' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('continuing with High Power posts brainMode: "high_power"', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, brainMode: 'high_power', brainModeSetAt: 123 } });
    const onComplete = vi.fn();
    renderWithClient({ onComplete });

    fireEvent.click(screen.getByRole('button', { name: /High Power — faster, more capable, not private/ }));
    fireEvent.click(screen.getByText(/Continue with High Power/));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/auth/choose-brain-mode', { brainMode: 'high_power' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('falls back to router.push("/onboarding") when no onComplete is given', async () => {
    post.mockResolvedValueOnce({ data: { ok: true, brainMode: 'private', brainModeSetAt: 123 } });
    renderWithClient();

    fireEvent.click(screen.getByText(/Stay Private/));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/onboarding'));
  });

  it('shows an error message and does not navigate when the request fails', async () => {
    post.mockRejectedValueOnce(new Error('network down'));
    renderWithClient();

    fireEvent.click(screen.getByText(/Stay Private/));

    await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });

  describe('rollout gate (CONCORD_HIGH_POWER_ALLOWLIST via GET /api/auth/me)', () => {
    it('disables the High Power card when highPowerAllowed is false', async () => {
      get.mockResolvedValue({ data: { user: { highPowerAllowed: false } } });
      renderWithClient();

      const highPowerCard = await screen.findByTestId('brain-mode-onboarding-high-power');
      await waitFor(() => expect(highPowerCard).toBeDisabled());
      expect(screen.getByTestId('brain-mode-onboarding-high-power-gated')).toBeInTheDocument();
    });

    it('clicking a disabled High Power card does not change the selection', async () => {
      get.mockResolvedValue({ data: { user: { highPowerAllowed: false } } });
      renderWithClient();

      const highPowerCard = await screen.findByTestId('brain-mode-onboarding-high-power');
      await waitFor(() => expect(highPowerCard).toBeDisabled());
      fireEvent.click(highPowerCard);
      expect(highPowerCard).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('button', { name: /Private — local only/ })).toHaveAttribute('aria-pressed', 'true');
    });

    it('a fetch failure on /api/auth/me defaults to permissive (High Power stays selectable)', async () => {
      get.mockRejectedValue(new Error('network down'));
      renderWithClient();

      await waitFor(() => expect(get).toHaveBeenCalled());
      const highPowerCard = screen.getByRole('button', { name: /High Power — faster, more capable, not private/ });
      expect(highPowerCard).not.toBeDisabled();
    });

    it('when allowed, the card is enabled and carries no gated note', async () => {
      renderWithClient();
      const highPowerCard = await screen.findByTestId('brain-mode-onboarding-high-power');
      await waitFor(() => expect(get).toHaveBeenCalled());
      expect(highPowerCard).not.toBeDisabled();
      expect(screen.queryByTestId('brain-mode-onboarding-high-power-gated')).toBeNull();
    });
  });
});
