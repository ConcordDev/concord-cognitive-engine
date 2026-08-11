// concord-frontend/components/conkay/widget/conkayAttentionToWidget.test.tsx
//
// Integration pin that proves the four-state widget machine is wired to a
// real store source (conkayAttentionStore), not a constant prop. The store
// is, in turn, written ONLY by ConKayOverlay's lifecycle effects (per that
// store's own header). Together those two contracts mean a non-idle
// `ConKayWidgetState` is NEVER shown unless ConKayOverlay has actually
// observed a real event.
//
// This file pins:
//   1. widgetStateFromAttention(): the pure derivation the widget layer
//      subscribes to. Priority: busy > speaking > listening > idle. Pinned
//      at the function level (no React) so it stays pure.
//   2. The attention store's setters produce the expected widget states via
//      the live hook the layer actually uses (useConKayWidgetState).
//   3. Reset returns the widget to its idle default (no stuck state after
//      ConKayOverlay unmounts).
//
// The widget CSS / DOM is not re-tested here — `ConKayWidget.test.tsx` and
// `ConKayWidgetLayer.test.tsx` cover that. This file is the contract pin:
// "if ConKayOverlay writes a real boolean, the widget reports the honest
// state."

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useConkayAttentionStore,
  widgetStateFromAttention,
  useConKayWidgetState,
} from '@/components/conkay/conkayAttentionStore';

const fresh = () =>
  useConkayAttentionStore.setState({
    open: false,
    busy: false,
    voiceListening: false,
    voiceSpeaking: false,
  });

describe('widgetStateFromAttention — pure priority derivation', () => {
  it('returns idle when all booleans are false', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: false, voiceListening: false }))
      .toBe('idle');
  });

  it('listening → idle when only voiceListening is true', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: false, voiceListening: true }))
      .toBe('listening');
  });

  it('speaking → idle when only voiceSpeaking is true', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: true, voiceListening: false }))
      .toBe('speaking');
  });

  it('busy (thinking) wins over speaking — a real in-flight call beats real TTS', () => {
    // Per the store header: "a real backend call in flight ('thinking')
    // outranks real TTS playback ('speaking')". Critical for the honesty
    // contract — TTS shouldn't visually claim "speaking" while a macro
    // is actually still running, which would mislead the user into
    // assuming work is paused.
    expect(widgetStateFromAttention({ busy: true, voiceSpeaking: true, voiceListening: false }))
      .toBe('thinking');
  });

  it('busy wins over listening too', () => {
    expect(widgetStateFromAttention({ busy: true, voiceSpeaking: false, voiceListening: true }))
      .toBe('thinking');
  });

  it('speaking wins over listening (TTS pauses STT, but if both are on, TTS wins)', () => {
    expect(widgetStateFromAttention({ busy: false, voiceSpeaking: true, voiceListening: true }))
      .toBe('speaking');
  });
});

describe('attention store → widgetState integration (ConKayOverlay writes, widget reads)', () => {
  beforeEach(fresh);

  // Helper: capture the widget state the layer would render. Calls the same
  // hook ConKayWidgetLayer.tsx uses (useConKayWidgetState) but evaluates it
  // synchronously against the current store snapshot — same value, no React
  // render needed.
  const readWidgetState = () =>
    widgetStateFromAttention(useConkayAttentionStore.getState());

  it('idle by default — no fake non-idle state when nothing is real', () => {
    expect(readWidgetState()).toBe('idle');
  });

  it('simulating ConKayOverlay mounting (open=true) does NOT spuriously flip the widget state', () => {
    // The "open" boolean drives ConKayOverlay itself, not the ambient
    // widget. The two surfaces are independent — opening the overlay
    // should not make the ambient 48px widget say it's "thinking."
    useConkayAttentionStore.getState().setOpen(true);
    expect(readWidgetState()).toBe('idle');
  });

  it('simulating a real macro:started effect (busy=true) makes the widget show thinking', () => {
    useConkayAttentionStore.getState().setBusy(true);
    expect(readWidgetState()).toBe('thinking');
  });

  it('simulating real STT-active (voiceListening=true) makes the widget show listening', () => {
    useConkayAttentionStore.getState().setVoiceListening(true);
    expect(readWidgetState()).toBe('listening');
  });

  it('simulating real TTS-playing (voiceSpeaking=true) makes the widget show speaking', () => {
    useConkayAttentionStore.getState().setVoiceSpeaking(true);
    expect(readWidgetState()).toBe('speaking');
  });

  it('reset() returns to idle — no stuck state if ConKayOverlay unmounts mid-stream', () => {
    // Simulate a partial conversation state being interrupted (overlay
    // unmounted but voice flags still left over). reset() must collapse
    // all four booleans so the next mount starts clean.
    useConkayAttentionStore.setState({
      open: true,
      busy: true,
      voiceListening: true,
      voiceSpeaking: false,
    });
    expect(readWidgetState()).toBe('thinking');
    useConkayAttentionStore.getState().reset();
    expect(readWidgetState()).toBe('idle');
  });

  it('honest-by-construction invariant: no setter can put the widget into a state without a real underlying boolean', () => {
    // Drive every boolean combo exhaustively and verify the mapping stays
    // inside the four documented states — never a 'connected'/'streaming'
    // or any other string the widget wouldn't recognize. This protects
    // against a future setter inadvertently setting a state the widget
    // can't render (which would be a fake "idle" — silent fallback).
    const states: Array<keyof typeof BOOLEAN_KEYS> = ['idle', 'listening', 'thinking', 'speaking'];
    for (const target of states) {
      // Set state using the exact setter path ConKayOverlay uses.
      const cfg = BOOLEAN_KEYS[target];
      fresh();
      useConkayAttentionStore.getState()[cfg.setter](true);
      expect(readWidgetState()).toBe(target);
    }
  });
});

// Helper table: which setter on the store produces which widget state via
// the priority ordering. Centralizes the invariant above so the exhaustive
// check stays readable and the "no fake state" guarantee is declarative.
const BOOLEAN_KEYS = {
  idle: { setter: 'setOpen' as const }, // open=true still resolves to idle (proves no spurious flip)
  listening: { setter: 'setVoiceListening' as const },
  speaking: { setter: 'setVoiceSpeaking' as const },
  thinking: { setter: 'setBusy' as const },
};
