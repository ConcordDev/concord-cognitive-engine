'use client';

/**
 * BrainModePanel — Private Mode / High Power Mode, Settings surface.
 *
 * Mounted at the TOP of the byo-keys lens (app/lenses/byo-keys/page.tsx)
 * rather than a separate Settings tab: this toggle's semantics directly
 * gate whether the page's 5 BYO slot cards below are even consulted at
 * inference time (Private skips BYO override lookup entirely, even if a
 * key is configured — see server/lib/byo-router.js#brainChat's header),
 * so the panel needs to visually own that context.
 *
 * Backed by byo_keys.get_brain_mode / byo_keys.set_brain_mode (thin
 * reads/writes on the SAME users.brain_mode column the onboarding
 * screen's POST /api/auth/choose-brain-mode writes — one column, one
 * account-wide guarantee, two equivalent entry points).
 *
 * The disclosure copy here is the exact same approved wording used at
 * onboarding (ChooseYourBrain.tsx) — a user who finds this later in
 * Settings deserves the same clarity as the one they saw on day one,
 * not a shortened version.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ShieldCheck, Zap, Check } from 'lucide-react';

type BrainMode = 'private' | 'high_power';

interface BrainModeResult {
  brainMode: BrainMode;
  brainModeSetAt: number | null;
  highPowerAllowed?: boolean;
}

interface Props {
  /** Fires whenever the loaded/saved mode is known, so a parent (the
   * byo-keys lens page) can gray out the BYO slot cards without a
   * duplicate fetch of the same macro. */
  onModeChange?: (mode: BrainMode) => void;
  /** Render as a single header pill (mode chip + click-to-toggle) instead
   * of the full disclosure section. Used in the chat lens header, where the
   * full wall was eating the whole mobile viewport. The full copy still
   * lives in Settings / the byo-keys lens. */
  compact?: boolean;
}

export function BrainModePanel({ onModeChange, compact = false }: Props = {}) {
  const [mode, setMode] = useState<BrainMode>('private');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rollout gate (CONCORD_HIGH_POWER_ALLOWLIST, server/lib/
  // high-power-allowlist.js) — independent of brain_mode. Defaults
  // permissive so the panel doesn't flash a disabled state before the
  // real value loads; the write path (byo_keys.set_brain_mode) re-checks
  // it server-side regardless, so this default is display-only, never
  // the enforcement point.
  const [highPowerAllowed, setHighPowerAllowed] = useState(true);

  const refresh = useCallback(async () => {
    const r = await lensRun<BrainModeResult>('byo_keys', 'get_brain_mode', {});
    if (r.data?.ok && r.data.result) {
      setMode(r.data.result.brainMode);
      if (typeof r.data.result.highPowerAllowed === 'boolean') setHighPowerAllowed(r.data.result.highPowerAllowed);
      onModeChange?.(r.data.result.brainMode);
      setError(null);
    } else if (r.data && r.data.ok === false) {
      setError(String(r.data.error || 'failed to load brain mode'));
    }
    setLoaded(true);
    // onModeChange intentionally excluded from deps -- parents that pass
    // an inline arrow function shouldn't re-trigger this fetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const choose = async (next: BrainMode) => {
    if (next === mode) return;
    if (next === 'high_power' && !highPowerAllowed) return;
    setBusy(true);
    setError(null);
    const r = await lensRun<BrainModeResult>('byo_keys', 'set_brain_mode', { brainMode: next });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setMode(r.data.result.brainMode);
      onModeChange?.(r.data.result.brainMode);
    } else {
      setError(String(r.data?.error || 'failed to save'));
    }
  };

  const isPrivate = mode === 'private';

  if (compact) {
    const next: BrainMode = isPrivate ? 'high_power' : 'private';
    const canToggle = next === 'private' || highPowerAllowed;
    return (
      <button
        type="button"
        data-testid="brain-mode-panel"
        onClick={() => canToggle && choose(next)}
        disabled={busy || !canToggle}
        title={
          isPrivate
            ? 'Private — every response from Concord’s own brains; nothing leaves. Tap to switch to High Power.'
            : 'High Power — messages may go to Google/Mistral/Groq. Tap to switch back to Private.'
        }
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-60 ${
          isPrivate
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:border-emerald-500/70'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:border-amber-500/70'
        }`}
      >
        {isPrivate ? <ShieldCheck className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
        <span className="hidden sm:inline">{isPrivate ? 'Private' : 'High Power'}</span>
      </button>
    );
  }

  return (
    <section
      data-testid="brain-mode-panel"
      className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6 mb-6"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">Private Mode / High Power Mode</h2>
        {loaded && (
          <span
            data-testid="brain-mode-current"
            className={`text-[10px] font-mono px-2 py-0.5 rounded ${
              isPrivate ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {isPrivate ? 'PRIVATE' : 'HIGH POWER'}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 text-[11px] text-red-400" data-testid="brain-mode-error">{error}</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => choose('private')}
          disabled={busy}
          aria-pressed={isPrivate}
          data-testid="brain-mode-select-private"
          className={`text-left rounded-lg border p-3 transition-all disabled:opacity-60 ${
            isPrivate
              ? 'border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30'
              : 'border-zinc-800 bg-zinc-950 hover:border-emerald-500/30'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            {isPrivate && (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wide text-emerald-400">
                <Check className="w-3 h-3" /> Active
              </span>
            )}
          </div>
          <div className="text-xs font-medium text-zinc-100">Private — local only</div>
          <p className="mt-1 text-[11px] text-zinc-400 leading-snug">
            Every response comes from Concord&apos;s own brains running on our hardware. Nothing you
            do here ever reaches an outside AI provider. No exceptions — this overrides any BYO key
            you have configured below.
          </p>
        </button>

        <button
          type="button"
          onClick={() => choose('high_power')}
          disabled={busy || !highPowerAllowed}
          aria-pressed={!isPrivate}
          data-testid="brain-mode-select-high-power"
          className={`text-left rounded-lg border p-3 transition-all disabled:opacity-60 ${
            !isPrivate
              ? 'border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/30'
              : 'border-zinc-800 bg-zinc-950 hover:border-amber-500/30'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <Zap className="w-4 h-4 text-amber-400" />
            {!isPrivate && (
              <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wide text-amber-400">
                <Check className="w-3 h-3" /> Active
              </span>
            )}
          </div>
          <div className="text-xs font-medium text-zinc-100">High Power — faster, more capable, not private</div>
          <p className="mt-1 text-[11px] text-zinc-400 leading-snug">
            Your messages are sent to third-party AI providers (<strong className="text-zinc-200">Google Gemini, Mistral, and Groq</strong>) when
            you don&apos;t have your own key configured below.{' '}
            <strong className="text-amber-300">Some of these providers may use your messages to improve their own AI models</strong> — Groq does
            not, Gemini and Mistral&apos;s free tiers do.
          </p>
          {!highPowerAllowed && (
            <p className="mt-1 text-[10px] text-zinc-500" data-testid="brain-mode-high-power-gated">Not available on your account yet.</p>
          )}
        </button>
      </div>

      {!isPrivate && (
        <p className="mt-3 text-[11px] text-amber-400/80">
          The 5 slot cards below are consulted first — your own BYO key for a slot always takes priority
          over the platform-funded fallback.
        </p>
      )}
      {isPrivate && (
        <p className="mt-3 text-[11px] text-zinc-500" data-testid="brain-mode-private-note">
          The 5 slot cards below are inert while Private Mode is active — Concord never checks them at
          inference time. Switch to High Power to use a configured key.
        </p>
      )}
    </section>
  );
}

export default BrainModePanel;
