'use client';

// concord-frontend/components/conkay/conkayAttentionStore.ts
//
// Unit CK2 — the ConKay "attention" store: the single honest bridge between
// ConKayOverlay's REAL lifecycle signals (is it open, is a request actually
// in flight, is the mic genuinely listening, is TTS genuinely playing) and
// the ambient ConKayWidget (`components/conkay/widget/*`), which is mounted
// in a completely different part of the tree (AppShell, always-on — see
// ConKayWidgetLayer.tsx) and has no other way to observe what the overlay is
// doing.
//
// THE ONE RULE (same discipline as conkayHudStore.ts / conkayRunStore.ts):
// the ONLY writer of this store is ConKayOverlay's own lifecycle effects —
// a small number of thin `useEffect`s, each one mirroring a REAL piece of
// state the overlay already tracks for itself, right next to its own
// open/close/busy logic. Nothing here is re-derived or guessed:
//   - `open`           <- the overlay's own `open` useState (Cmd/Ctrl+J,
//                         the `conkay:summon`/`conkay:dismiss` window events,
//                         Esc, the header's dismiss button — whatever
//                         already flips it).
//   - `busy`           <- the overlay's own `running` useState — the EXACT
//                         SAME boolean that already drives its header's
//                         "working…" label and <ConKayWorkStatus
//                         active={running}>. Never re-derived, never a
//                         second busy-detector living in this file.
//   - `voiceListening` <- `useConKayVoice().listening` — real STT-active.
//   - `voiceSpeaking`  <- `useConKayVoice().speaking` — real TTS-playing
//                         (Piper decoded-audio playback, or the Web Speech
//                         fallback; see useConKayVoice.ts's own header for
//                         how that value itself stays honest).
//
// `widgetStateFromAttention` (pure, exported for pinning without React or
// zustand) is the ONLY place that turns these real booleans into the one
// `ConKayWidgetState` the ambient widget renders. Priority: a real backend
// call in flight ("thinking") outranks real TTS playback ("speaking"), which
// outranks real mic input ("listening"). In practice the three rarely
// overlap (`speak()` stops listening first; `running` and voice states are
// almost never simultaneously true) — the order is still someone's honest,
// documented call rather than left to accidental object-key luck.
//
// Read-only consumers (the widget layer, via `useConKayWidgetState`) must
// never call a setter — if you find yourself doing that from anywhere other
// than ConKayOverlay's lifecycle effects, you are about to fake something.

import { create } from 'zustand';
import type { ConKayWidgetState } from './widget/ConKayWidget';

interface ConkayAttentionState {
  /** Real: is ConKayOverlay's full surface currently open? */
  open: boolean;
  /** Real: the overlay's own `running` flag — a macro/brain call ConKay
   *  itself initiated (runSkill / executeMacro / resolveAndOperate /
   *  chatWithBrain) is genuinely in flight right now. */
  busy: boolean;
  /** Real: `useConKayVoice().listening` — STT is actually capturing audio. */
  voiceListening: boolean;
  /** Real: `useConKayVoice().speaking` — TTS is actually playing audio. */
  voiceSpeaking: boolean;

  // ── single-writer actions (CALL ONLY FROM ConKayOverlay's own lifecycle
  //    effects, mirroring state it already owns elsewhere) ──
  setOpen: (v: boolean) => void;
  setBusy: (v: boolean) => void;
  setVoiceListening: (v: boolean) => void;
  setVoiceSpeaking: (v: boolean) => void;
  /** Reset to the all-idle defaults — called when ConKayOverlay itself
   *  unmounts (e.g. the user navigated off every /lenses/* route, so the
   *  overlay instance that was producing these signals no longer exists)
   *  so the ambient widget never gets stuck reflecting a stale non-idle
   *  state that nothing is backing anymore. */
  reset: () => void;
}

const ATTENTION_DEFAULTS = {
  open: false,
  busy: false,
  voiceListening: false,
  voiceSpeaking: false,
};

export const useConkayAttentionStore = create<ConkayAttentionState>((set) => ({
  ...ATTENTION_DEFAULTS,
  setOpen: (v) => set({ open: v }),
  setBusy: (v) => set({ busy: v }),
  setVoiceListening: (v) => set({ voiceListening: v }),
  setVoiceSpeaking: (v) => set({ voiceSpeaking: v }),
  reset: () => set({ ...ATTENTION_DEFAULTS }),
}));

/** Pure derivation: the real attention booleans → the one ConKayWidgetState
 *  prop the ambient widget renders. Exported so the mapping is unit-pinnable
 *  without standing up the zustand store, React, or ConKayOverlay at all. */
export function widgetStateFromAttention(s: {
  busy: boolean;
  voiceSpeaking: boolean;
  voiceListening: boolean;
}): ConKayWidgetState {
  if (s.busy) return 'thinking';
  if (s.voiceSpeaking) return 'speaking';
  if (s.voiceListening) return 'listening';
  return 'idle';
}

/** Read-only selector hook for the widget layer — always a pure function of
 *  the real attention state above, never a store consumers should write to. */
export function useConKayWidgetState(): ConKayWidgetState {
  return useConkayAttentionStore((s) => widgetStateFromAttention(s));
}

export default useConkayAttentionStore;
