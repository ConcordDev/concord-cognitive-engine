'use client';

// concord-frontend/components/conkay/widget/ConKayWidget.tsx
//
// ConKayWidget — the ambient, small, always-present ConKay character SHELL
// (V1.1 unit CK1 — see the durable plan's "R2 — ConKay as default interface"
// section and its Clippy-failure-mode research note). This unit builds ONLY
// the shell: idle/stand visuals, a distinct readable-at-small-size
// silhouette, and a mount point later units attach to. It deliberately does
// NOT implement attention/promote (CK2), layout-aware movement (CK3), or
// onboarding (CK4) — those build ON TOP of this file without needing to
// touch it:
//   - CK2 will drive `state` from a REAL turn-toward-user / macro-lifecycle
//     subscription (the same single-writer pattern `conkayHudStore.ts`
//     already uses for the cockpit) and will wire `onActivate` to promote
//     into the existing `ConKayOverlay` — this component doesn't know or
//     care what `onActivate` does; that decision lives entirely with the
//     caller (see `ConKayWidgetLayer`).
//   - CK3 will position this component via its wrapping layer using a
//     "safe region" solver; this component has no opinion on where it sits
//     on screen — it only fills whatever container it's given.
//   - CK4 will reuse `onActivate` + a `state="speaking"` prop to narrate.
//
// ── HONESTY CONTRACT (hard invariant — see CLAUDE.md "Honest by
// construction" + the plan's Clippy research note) ─────────────────────────
// `state` is a PURE PROP, nothing else. This component:
//   - has ZERO internal timers: no setInterval, no setTimeout, anywhere in
//     this file (verify: `grep -rE "setInterval|setTimeout"
//     concord-frontend/components/conkay/widget/` — it must come back
//     empty);
//   - never wraps `state` in its own useState/useReducer and never has an
//     effect that flips it — there is no code path in this file that can
//     assign itself 'listening' | 'thinking' | 'speaking';
//   - never changes what it visually reports as a *side effect* of being
//     clicked/activated — `onActivate` is called and that's it. Only a
//     caller that has observed a REAL system event (an honest mic-active
//     flag, a real `macro:started`/`macro:completed` pair, a real
//     TTS-is-playing flag) may pass a non-idle `state` back down as a prop.
// The idle "breathing" motion below is pure CSS (Tailwind's `animate-pulse`
// utility — no JS clock driving it at all). That's honest ambient motion:
// it represents "alive and idle," never simulated work, and it needs no
// timer of its own to fake anything. The 'thinking' ring similarly uses
// pure CSS `animate-spin` — motion appears ONLY while a real caller has
// asserted `state="thinking"`, mirroring the "rings spin IFF real work is in
// flight" rule `conkayHudStore.ts` already documents for the cockpit.
//
// ── ACCESSIBILITY ───────────────────────────────────────────────────────────
// The widget is a real focusable control (`role="button"`, `tabIndex={0}`)
// with an `aria-label` and an `aria-describedby` pointing at a
// visually-hidden (`sr-only`) text alternative that states the SAME
// information the animated visual states convey to sighted users. Enter and
// Space both activate it. The dismiss control is a separate, always-present-
// in-the-DOM `<button>` (not nested inside the widget's own interactive
// element, to keep the accessibility tree unambiguous) that's reachable by
// Tab and gains visibility on hover OR keyboard focus.

import { useId, type KeyboardEvent } from 'react';

export type ConKayWidgetState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface ConKayWidgetProps {
  /**
   * Real system state to visualize. Defaults to 'idle'. See the file-header
   * honesty contract above — never set this speculatively, and never derive
   * it from anything other than a real, observed system event.
   */
  state?: ConKayWidgetState;
  /**
   * Called on click, or on Enter/Space while the widget is focused. The
   * widget itself does not know or care what this does (e.g. opening
   * ConKayOverlay) — that wiring lives entirely in the caller (see
   * `ConKayWidgetLayer`), never here.
   */
  onActivate?: () => void;
  /**
   * Called when the user activates the dismiss control. The widget itself
   * holds no "am I hidden" state — the caller (`ConKayWidgetLayer`) owns and
   * persists that decision, so this component stays a pure function of its
   * props. Omit to render without a dismiss control.
   */
  onDismiss?: () => void;
  /** Override the accessible name. Defaults to a ConKay-branded label. */
  label?: string;
  className?: string;
}

const STATE_DESCRIPTION: Record<ConKayWidgetState, string> = {
  idle: 'Idle and ready. Activate to talk to ConKay.',
  listening: 'Listening to you right now.',
  thinking: 'Working on a real request right now.',
  speaking: 'Speaking a real response right now.',
};

export function ConKayWidget({ state = 'idle', onActivate, onDismiss, label, className }: ConKayWidgetProps) {
  const descId = useId();

  const activate = () => {
    onActivate?.();
  };

  // A real KeyboardEvent handler (not a reliance on native <button> default
  // action) — this is a role="button" div, so nothing activates it unless we
  // wire Enter/Space ourselves. Per WAI-ARIA authoring practices for custom
  // button-role widgets.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      activate();
    }
  };

  return (
    <div className={`group relative inline-flex ${className ?? ''}`}>
      <div
        role="button"
        tabIndex={0}
        aria-label={label ?? 'ConKay — your Concord assistant'}
        aria-describedby={descId}
        data-conkay-widget-state={state}
        onClick={activate}
        onKeyDown={onKeyDown}
        className="ck-widget relative flex h-12 w-12 cursor-pointer select-none items-center justify-center rounded-full border border-cyan-400/40 bg-black/70 shadow-lg shadow-cyan-500/20 backdrop-blur outline-none transition hover:scale-105 hover:border-cyan-300/70 focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        {/* idle "breathing" glow — pure CSS animate-pulse, no JS clock */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 rounded-full ${
            state === 'idle' ? 'animate-pulse bg-cyan-400/10' : ''
          }`}
        />

        {/* listening ring — rendered ONLY while a real caller reports listening */}
        {state === 'listening' && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-emerald-400/20 animate-ping"
          />
        )}

        {/* thinking ring — rendered ONLY while a real macro/brain call is in flight */}
        {state === 'thinking' && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-[3px] rounded-full border-2 border-transparent border-t-amber-300/80 animate-spin"
          />
        )}

        {/* speaking cue — rendered ONLY while real TTS audio is playing */}
        {state === 'speaking' && (
          <span aria-hidden className="pointer-events-none absolute inset-0 flex items-end justify-center gap-[2px] pb-2">
            <span className="h-2 w-[2px] animate-pulse bg-cyan-200/90" style={{ animationDelay: '0ms' }} />
            <span className="h-3 w-[2px] animate-pulse bg-cyan-200/90" style={{ animationDelay: '120ms' }} />
            <span className="h-2 w-[2px] animate-pulse bg-cyan-200/90" style={{ animationDelay: '240ms' }} />
          </span>
        )}

        {/* Distinct, readable-at-small-size silhouette — a simple lattice-node
            glyph consistent with ConKay's existing cyan/orbital visual
            identity (see conkay-persona.ts's voice/tone + LatticeGlobe /
            orbital-rings-motion.ts's orbiting-node motif elsewhere in this
            directory). A plain core + orbit + three satellite dots reads
            clearly at 48px without needing a photo or a 3D render. */}
        <svg viewBox="0 0 24 24" className="relative h-6 w-6" aria-hidden focusable="false">
          <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-cyan-400/50" />
          <circle cx="12" cy="12" r="4.2" fill="currentColor" className="text-cyan-300" />
          <circle cx="12" cy="3.2" r="1.3" fill="currentColor" className="text-cyan-200/80" />
          <circle cx="19.8" cy="16" r="1.1" fill="currentColor" className="text-cyan-200/60" />
          <circle cx="4.2" cy="16" r="1.1" fill="currentColor" className="text-cyan-200/60" />
        </svg>
      </div>

      {/* Visually-hidden text alternative — the SAME information sighted
          users get from the animated state above, exposed to assistive tech. */}
      <span id={descId} className="sr-only">
        {STATE_DESCRIPTION[state]}
      </span>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Hide ConKay widget"
          title="Hide ConKay widget"
          className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-white/20 bg-black/80 text-[10px] leading-none text-white/60 opacity-0 outline-none transition hover:bg-black hover:text-white focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-cyan-300 group-hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default ConKayWidget;
