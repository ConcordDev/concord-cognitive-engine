/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/tests/components/ConKayWidgetAttention.test.tsx
//
// CK2 — pins the attention + promote/collapse contract (durable plan's
// "R2 — ConKay as default interface", CK2 line; conkayAttentionStore.ts's own
// header):
//  - `widgetStateFromAttention` (pure): busy ("thinking") outranks TTS
//    playback ("speaking"), which outranks mic input ("listening"), which
//    falls back to idle — and NOTHING here is invented; every input is a
//    real boolean.
//  - ConKayWidgetLayer renders the STORE-DERIVED state by default (no prop
//    override needed) — proven by driving the store directly, the same way
//    ConKayOverlay's own lifecycle effects would.
//  - ConKayOverlay itself is the ONLY real writer: opening it flips the
//    store's `open`; a real macro call in flight flips `busy` true, then
//    back to false the moment the real call resolves — never a fabricated
//    timer-driven flip.
//  - Promote round-trip: clicking the ambient widget dispatches the EXISTING
//    `conkay:summon` event and the real ConKayOverlay actually opens in
//    response — not just "the event fired", the full listener chain works.
//  - Collapse round-trip: closing the overlay (Escape) returns the store (and
//    therefore the widget) to idle WITHOUT losing the conversation — the
//    transcript built up before closing is still there after reopening,
//    because ConKayOverlay never unmounts across an open/close toggle (this
//    test proves that rather than assuming it).

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ConKayWidgetLayer } from '@/components/conkay/widget/ConKayWidgetLayer';
import {
  useConkayAttentionStore,
  widgetStateFromAttention,
} from '@/components/conkay/conkayAttentionStore';

// jsdom doesn't implement scrollIntoView (ConKayOverlay auto-scrolls the
// transcript on every new message) — stub it, irrelevant to these assertions.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/lenses/creatures',
}));

// The WebGL world-tree backdrop + the AR exploded-view inspector are irrelevant
// here and have no WebGL context under jsdom.
vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@/components/conkay/useConKayVoice', () => ({
  useConKayVoice: () => ({
    supported: false,
    listening: false,
    speaking: false,
    interim: '',
    usingServerStt: false,
    voiceUnavailable: false,
    ttsAmplitudeRef: { current: 0 },
    speak: vi.fn(),
  }),
}));

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
  onConnectionLost: vi.fn(() => () => {}),
  onReconnected: vi.fn(() => () => {}),
}));

type LensRunTestResult = { data: { ok: boolean; result: unknown; error: string | null } };
const defaultLensRunImpl = async (
  _domain: string, _macro: string, _input: Record<string, unknown>, _runId?: string,
): Promise<LensRunTestResult> => ({
  data: { ok: true, result: { done: true }, error: null },
});
const lensRunMock = vi.fn(defaultLensRunImpl);
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: Parameters<typeof lensRunMock>) => lensRunMock(...args),
}));

// Imported AFTER the mocks above so ConKayOverlay picks them up.
import { ConKayOverlay } from '@/components/conkay/ConKayOverlay';

function getWidget() {
  return screen.getByRole('button', { name: /^ConKay/i });
}

function attention() {
  return useConkayAttentionStore.getState();
}

beforeEach(() => {
  attention().reset();
  lensRunMock.mockClear();
  lensRunMock.mockImplementation(defaultLensRunImpl);
});
afterEach(() => {
  cleanup();
  attention().reset();
});

describe('widgetStateFromAttention — pure derivation (no fabrication)', () => {
  it('is idle when nothing real is happening', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: false, voiceListening: false })).toBe('idle');
  });
  it('is listening when only the mic is real-active', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: false, voiceListening: true })).toBe('listening');
  });
  it('is speaking when only TTS is real-playing', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: true, voiceListening: false })).toBe('speaking');
  });
  it('is thinking when a real backend call is in flight', () => {
    expect(widgetStateFromAttention({ busy: true, voiceSpeaking: false, voiceListening: false })).toBe('thinking');
  });
  it('busy outranks speaking and listening when they somehow overlap', () => {
    expect(widgetStateFromAttention({ busy: true, voiceSpeaking: true, voiceListening: true })).toBe('thinking');
  });
  it('speaking outranks listening when they somehow overlap', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: true, voiceListening: true })).toBe('speaking');
  });
});

describe('ConKayWidgetLayer — renders the real store-derived state by default', () => {
  it('reflects a real busy=true as "thinking", and returns to idle when it clears', () => {
    render(<ConKayWidgetLayer />);
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'idle');

    act(() => attention().setBusy(true));
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'thinking');

    act(() => attention().setBusy(false));
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'idle');
  });

  it('reflects real voiceListening/voiceSpeaking too', () => {
    render(<ConKayWidgetLayer />);
    act(() => attention().setVoiceListening(true));
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'listening');
    act(() => attention().setVoiceListening(false));
    act(() => attention().setVoiceSpeaking(true));
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'speaking');
  });

  it('an explicit state prop still overrides the store (back-compat / test hook)', () => {
    act(() => attention().setBusy(true));
    render(<ConKayWidgetLayer state="idle" />);
    // Explicit prop wins even though the store says busy.
    expect(getWidget()).toHaveAttribute('data-conkay-widget-state', 'idle');
  });
});

describe('ConKayOverlay — the real writer of the attention store', () => {
  it('mirrors open=true/false as the overlay is summoned and dismissed', async () => {
    render(<ConKayOverlay />);
    expect(attention().open).toBe(false);

    fireEvent.click(screen.getByLabelText('Summon ConKay (⌘/Ctrl+J)'));
    await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());
    expect(attention().open).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(attention().open).toBe(false));
  });

  it('mirrors busy=true while a REAL macro call is in flight, then false the moment it resolves — never a timer', async () => {
    // A controllable deferred promise stands in for the real backend round
    // trip: busy must stay true for exactly as long as this is unresolved.
    let resolveCall: (v: LensRunTestResult) => void = () => {};
    const pending = new Promise<LensRunTestResult>((resolve) => { resolveCall = resolve; });
    lensRunMock.mockImplementation(async (domain: string) => {
      if (domain === 'creatures') return pending;
      return defaultLensRunImpl(domain, '', {});
    });

    render(<ConKayOverlay />);
    fireEvent.click(screen.getByLabelText('Summon ConKay (⌘/Ctrl+J)'));
    await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());
    expect(attention().busy).toBe(false);

    const input = screen.getByLabelText('Message ConKay') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'run creatures.list' } });
    fireEvent.click(screen.getByLabelText('Send'));

    // The real macro call is in flight — busy must be true right now.
    await waitFor(() => expect(attention().busy).toBe(true));

    // Resolve the real backend call — busy must clear, honestly, the moment
    // (and only the moment) the real response lands.
    resolveCall({ data: { ok: true, result: { creatures: [] }, error: null } });
    await waitFor(() => expect(attention().busy).toBe(false));
  });
});

describe('Promote round-trip — the ambient widget genuinely opens ConKayOverlay', () => {
  it('clicking the widget dispatches conkay:summon and the real overlay opens in response', async () => {
    render(
      <>
        <ConKayWidgetLayer />
        <ConKayOverlay />
      </>,
    );

    // Overlay starts closed (its own closed-state summon button, not the widget).
    expect(screen.queryByLabelText('Message ConKay')).not.toBeInTheDocument();

    fireEvent.click(getWidget());

    await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());
    expect(attention().open).toBe(true);
  });
});

describe('Dismiss round-trip — clicking the widget again closes an already-open overlay', () => {
  it('dispatches conkay:dismiss (not another conkay:summon) when the real store already says open=true, and the overlay actually closes', async () => {
    render(
      <>
        <ConKayWidgetLayer />
        <ConKayOverlay />
      </>,
    );

    // Open it first via the widget (real conkay:summon round-trip, same as
    // the promote test above).
    fireEvent.click(getWidget());
    await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());
    expect(attention().open).toBe(true);

    // Second click on the SAME widget, while the real store still says open,
    // must dismiss rather than no-op re-summon.
    fireEvent.click(getWidget());
    await waitFor(() => expect(attention().open).toBe(false));
    await waitFor(() => expect(screen.queryByLabelText('Message ConKay')).not.toBeInTheDocument());
  });

  it('still dispatches conkay:summon (not dismiss) on the very first click, when open=false', async () => {
    render(
      <>
        <ConKayWidgetLayer />
        <ConKayOverlay />
      </>,
    );
    expect(attention().open).toBe(false);
    fireEvent.click(getWidget());
    await waitFor(() => expect(attention().open).toBe(true));
  });
});

describe('Collapse round-trip — closing preserves conversation continuity', () => {
  it('a message sent before closing is still in the transcript after reopening (ConKayOverlay never unmounts across open/close)', async () => {
    render(<ConKayOverlay />);

    fireEvent.click(screen.getByLabelText('Summon ConKay (⌘/Ctrl+J)'));
    await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());

    // "what can you do" is a fully local, deterministic ConKay skill (no
    // network call) — good for pinning continuity without racing a mock.
    const input = screen.getByLabelText('Message ConKay') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'what can you do' } });
    fireEvent.click(screen.getByLabelText('Send'));

    const reply = await screen.findByText(/I can act on your real Concord data directly/i);
    expect(reply).toBeInTheDocument();

    // Collapse (Escape) — the store returns to idle...
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(attention().open).toBe(false));
    await waitFor(() => expect(screen.queryByLabelText('Message ConKay')).not.toBeInTheDocument());

    // ...reopen via the same real conkay:summon contract the widget uses...
    act(() => { window.dispatchEvent(new Event('conkay:summon')); });
    await waitFor(() => expect(screen.getByLabelText('Message ConKay')).toBeInTheDocument());

    // ...and the SAME reply from before closing is still there — no reset,
    // no re-fetch, no silent conversation loss.
    expect(screen.getByText(/I can act on your real Concord data directly/i)).toBeInTheDocument();
    // The user's own message also survived.
    expect(screen.getByText('what can you do')).toBeInTheDocument();
  });
});
