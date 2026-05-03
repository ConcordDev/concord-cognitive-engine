'use client';

/**
 * ControlsMenu — settings panel for the Flow Combat keyboard layer.
 * Two tabs: General (mouse/FOV/inversion) and Combat (the dual-hand
 * remap table + presets).
 *
 * Important note shown at the top of the Combat tab: evolved combos
 * track *actions*, not keys, so a remap leaves the Flow Combat substrate
 * intact — only the keys change.
 *
 * Click a [Remap] button → captures the next keypress + variant
 * (tap/hold/double-tap is determined by the press itself: short = tap,
 * 250ms+ = hold, second press within 280ms = double-tap).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type KeyAction, type KeyBinding, type KeyProfile,
  DEFAULT_PROFILE, PRESETS, resetToDefault,
  loadActiveProfile, saveActiveProfile,
} from '@/lib/concordia/keybindings';

type Tab = 'general' | 'combat';

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACTION_LABELS: Record<KeyAction, { ground: string; aerial: string; description: string }> = {
  light:    { ground: 'Light Attack',    aerial: 'Quick Blast',          description: 'Right-hand fast strike (Shift = left hand).' },
  heavy:    { ground: 'Heavy Attack',    aerial: 'Charged Dive / Slam',  description: 'Right-hand power strike (Shift = left hand).' },
  finisher: { ground: 'Special Finisher', aerial: 'Aerial Finisher',     description: 'Double-press; ultra damage on the active hand.' },
  parry:    { ground: 'Parry / Block',   aerial: 'Air Dodge / Boost',    description: 'Tight timing window opens a counter chain.' },
  grab:     { ground: 'Grab / Throw',    aerial: 'Aerial Grab & Slam',   description: 'Combo extender; hold to commit.' },
  kick:     { ground: 'Kick / Sweep',    aerial: 'Dive Kick',            description: 'Quick stagger + new combo branch.' },
  dodge:    { ground: 'Dodge / Roll',    aerial: 'Air Dash / Boost',     description: 'I-frames; counter-dodge into attacks.' },
  modifier: { ground: 'Power Modifier',  aerial: 'Aerial Power Boost',   description: 'Hold to switch active hand to LEFT.' },
};

function bindingLabel(b: KeyBinding): string {
  const k = b.key === 'shift' ? 'Shift' : b.key === 'control' ? 'Ctrl' : b.key.toUpperCase();
  if (b.variant === 'tap')        return k;
  if (b.variant === 'hold')       return `${k} (Hold)`;
  return `${k} ×2`;
}

export default function ControlsMenu({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('combat');
  const [profile, setProfile] = useState<KeyProfile>(DEFAULT_PROFILE);
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [mouseSens, setMouseSens] = useState(1.0);
  const [invertY, setInvertY] = useState(false);
  const [fov, setFov] = useState(75);
  const captureStartRef = useRef<number>(0);
  const captureLastTapRef = useRef<{ key: string; t: number } | null>(null);

  useEffect(() => {
    if (open) setProfile(loadActiveProfile());
  }, [open]);

  const applyBinding = useCallback((action: KeyAction, b: KeyBinding) => {
    const next: KeyProfile = {
      ...profile,
      id: 'custom',
      name: 'Custom',
      bindings: { ...profile.bindings, [action]: b },
    };
    setProfile(next);
    saveActiveProfile(next);
    setCapturing(null);
  }, [profile]);

  useEffect(() => {
    if (!capturing) return;
    function onDown(e: KeyboardEvent) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      // Reserve some keys for system: Escape cancels capture
      if (k === 'escape') { setCapturing(null); return; }
      // Detect double-tap: same key within 280ms
      const last = captureLastTapRef.current;
      if (last && last.key === k && performance.now() - last.t < 280) {
        if (!capturing) return;
        applyBinding(capturing, { key: k, variant: 'double-tap' });
        captureLastTapRef.current = null;
        return;
      }
      captureStartRef.current = performance.now();
      captureLastTapRef.current = { key: k, t: performance.now() };
    }
    function onUp(e: KeyboardEvent) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      const start = captureStartRef.current;
      if (!start) return;
      const heldMs = performance.now() - start;
      captureStartRef.current = 0;
      // Wait the double-tap window — if the user presses again, the down
      // handler will fire double-tap. Otherwise commit single tap/hold.
      setTimeout(() => {
        if (captureLastTapRef.current?.key !== k) return;
        captureLastTapRef.current = null;
        const variant: 'tap' | 'hold' = heldMs >= 220 ? 'hold' : 'tap';
        if (!capturing) return;
        applyBinding(capturing, { key: k, variant });
      }, 290);
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [capturing, applyBinding]);

  const loadPreset = useCallback((id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setProfile(p);
    saveActiveProfile(p);
  }, []);

  const reset = useCallback(() => {
    resetToDefault();
    setProfile(DEFAULT_PROFILE);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-950/95 border border-cyan-500/40 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <h2 className="text-base font-bold text-white uppercase tracking-wider">Controls</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>
        {/* Tabs */}
        <div className="flex border-b border-white/10 px-5">
          <button
            onClick={() => setTab('general')}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'general' ? 'border-cyan-400 text-white' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >General</button>
          <button
            onClick={() => setTab('combat')}
            className={`py-3 px-4 text-sm font-semibold border-b-2 transition-colors ${
              tab === 'combat' ? 'border-cyan-400 text-white' : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >Combat</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'general' && (
            <>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Mouse Sensitivity: {mouseSens.toFixed(2)}</label>
                <input type="range" min={0.25} max={3} step={0.05} value={mouseSens}
                  onChange={(e) => setMouseSens(Number(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1">Field of View: {fov}°</label>
                <input type="range" min={50} max={110} step={1} value={fov}
                  onChange={(e) => setFov(Number(e.target.value))} className="w-full" />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={invertY} onChange={(e) => setInvertY(e.target.checked)} />
                Invert Y-Axis
              </label>
              <div className="text-[11px] text-slate-500 italic">
                Mouse-only for camera + shoot/cast is locked on by design — keeps the trackpad-friendly combat path clean.
              </div>
            </>
          )}

          {tab === 'combat' && (
            <>
              <div className="px-3 py-2 bg-cyan-500/10 border border-cyan-400/30 rounded text-xs text-cyan-100">
                <strong className="text-cyan-300">Note:</strong> Evolved combos and procedural moves track <em>actions</em>,
                not keys. Remapping just changes which keys produce which actions — your personal fighting style stays the same.
              </div>

              <div>
                <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">Preset</label>
                <select
                  value={PRESETS.find((p) => p.id === profile.id) ? profile.id : 'custom'}
                  onChange={(e) => e.target.value !== 'custom' && loadPreset(e.target.value)}
                  className="w-full bg-slate-900 border border-white/10 rounded px-3 py-2 text-sm text-white"
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="custom">— Custom —</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="grid grid-cols-[120px_1fr_1fr_120px] gap-2 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400">
                  <div>Key</div>
                  <div>Ground</div>
                  <div>Aerial</div>
                  <div className="text-right">Remap</div>
                </div>
                {(Object.keys(ACTION_LABELS) as KeyAction[]).map((action) => {
                  const b = profile.bindings[action];
                  const labels = ACTION_LABELS[action];
                  const capturingThis = capturing === action;
                  return (
                    <div key={action} className="grid grid-cols-[120px_1fr_1fr_120px] gap-2 px-2 py-2 bg-slate-900/40 hover:bg-slate-900/70 rounded items-center">
                      <div className="text-sm font-mono text-cyan-300">{bindingLabel(b)}</div>
                      <div className="text-xs text-white">{labels.ground}</div>
                      <div className="text-xs text-slate-300">{labels.aerial}</div>
                      <div className="text-right">
                        <button
                          onClick={() => setCapturing(capturingThis ? null : action)}
                          className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
                            capturingThis
                              ? 'bg-amber-500/30 text-amber-200 border border-amber-400/60 animate-pulse'
                              : 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/40 hover:bg-cyan-500/25'
                          }`}
                        >
                          {capturingThis ? 'Press a key…' : 'Remap'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2 pt-2 border-t border-white/10">
                <button
                  onClick={reset}
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded text-slate-200"
                >Reset to Default</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
