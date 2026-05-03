'use client';

/**
 * PauseMenu — ESC-to-open hub for the Flow Combat UI surfaces.
 *
 * Single overlay with five slots:
 *   Resume    — close the overlay
 *   Loadout   — open EquipmentSlotsPanel inline
 *   Controls  — open ControlsMenu (combat keybinds + presets)
 *   Settings  — quick toggles (audio mute, FPS overlay, hint level)
 *   Quit      — return to /
 *
 * Toggles via Escape key globally (suppressed when typing in input/textarea
 * or when a dialogue panel is open). When the menu is open, dispatches
 * concordia:pause-state events so other systems (combat input, soundscape,
 * world tick) can soft-pause if they want to.
 *
 * Lives next to the polish-pass overlays; mounted from world/page.tsx so
 * a single component owns the pause-menu UX surface area.
 */

import { useCallback, useEffect, useState } from 'react';

interface Props {
  onOpenControls: () => void;
  onOpenLoadout: () => void;
  onQuit?: () => void;
}

type Subview = 'menu' | 'settings';

export default function PauseMenu({ onOpenControls, onOpenLoadout, onQuit }: Props) {
  const [open, setOpen]     = useState(false);
  const [view, setView]     = useState<Subview>('menu');
  const [muted, setMuted]   = useState(false);
  const [fpsOn, setFpsOn]   = useState(false);
  const [hintLevel, setHintLevel] = useState<'off' | 'minimal' | 'full'>('full');

  const close = useCallback(() => {
    setOpen(false);
    setView('menu');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('concordia:pause-state', { detail: { paused: false } }));
    }
  }, []);

  const openMenu = useCallback(() => {
    setOpen(true);
    setView('menu');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('concordia:pause-state', { detail: { paused: true } }));
    }
  }, []);

  // Escape toggles. Suppress when typing or when a dialogue is active so
  // the pause menu doesn't fight the dialogue close UX.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      // Don't open while a dialogue panel is in the DOM
      if (document.querySelector('[data-active-dialogue="true"]')) return;
      e.preventDefault();
      if (open) close(); else openMenu();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, openMenu]);

  // Persist quick settings
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('concord:quick-settings');
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.muted === 'boolean') setMuted(s.muted);
        if (typeof s.fpsOn === 'boolean') setFpsOn(s.fpsOn);
        if (typeof s.hintLevel === 'string') setHintLevel(s.hintLevel);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('concord:quick-settings', JSON.stringify({ muted, fpsOn, hintLevel }));
    } catch { /* ignore */ }
    // Surface mute via the soundscape-command channel
    window.dispatchEvent(new CustomEvent('concordia:soundscape-command', {
      detail: { action: muted ? 'setMute' : 'setUnmute' },
    }));
    // FPS overlay toggle
    window.dispatchEvent(new CustomEvent('concordia:fps-overlay', { detail: { enabled: fpsOn } }));
    window.dispatchEvent(new CustomEvent('concordia:hint-level', { detail: { level: hintLevel } }));
  }, [muted, fpsOn, hintLevel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[75] bg-black/75 backdrop-blur-md flex items-center justify-center pointer-events-auto">
      <div className="bg-slate-950/95 border border-cyan-500/40 rounded-lg w-full max-w-md p-6 shadow-2xl"
           style={{ boxShadow: '0 0 32px rgba(34,211,238,0.25)' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white uppercase tracking-widest">
            {view === 'menu' ? 'Paused' : 'Settings'}
          </h2>
          <button onClick={close} className="text-slate-400 hover:text-white text-sm">Esc to close</button>
        </div>

        {view === 'menu' && (
          <div className="space-y-2">
            <MenuButton label="Resume"   hint="Esc"   onClick={close}   primary />
            <MenuButton label="Loadout"  hint="Right + Left hand" onClick={() => { close(); onOpenLoadout(); }} />
            <MenuButton label="Controls" hint="Remap combat keys"  onClick={() => { close(); onOpenControls(); }} />
            <MenuButton label="Settings" hint="Audio · FPS · Hints" onClick={() => setView('settings')} />
            {onQuit && (
              <MenuButton label="Quit to Menu" hint="Returns to /"     onClick={onQuit} danger />
            )}
          </div>
        )}

        {view === 'settings' && (
          <div className="space-y-4">
            <button
              onClick={() => setView('menu')}
              className="text-xs text-cyan-400 hover:text-cyan-200 mb-2"
            >← Back</button>

            <label className="flex items-center justify-between px-3 py-2 bg-slate-900/60 rounded">
              <span className="text-sm text-white">Mute Audio</span>
              <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
            </label>

            <label className="flex items-center justify-between px-3 py-2 bg-slate-900/60 rounded">
              <span className="text-sm text-white">Show FPS Overlay</span>
              <input type="checkbox" checked={fpsOn} onChange={(e) => setFpsOn(e.target.checked)} />
            </label>

            <div className="px-3 py-2 bg-slate-900/60 rounded">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Hints</div>
              <div className="grid grid-cols-3 gap-1">
                {(['off', 'minimal', 'full'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => setHintLevel(l)}
                    className={`py-1.5 text-xs rounded transition-colors ${
                      hintLevel === l ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400/60'
                                       : 'bg-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >{l}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuButton({
  label, hint, onClick, primary, danger,
}: { label: string; hint?: string; onClick: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-3 rounded-md text-left transition-colors flex items-center justify-between ${
        primary ? 'bg-cyan-500/25 hover:bg-cyan-500/35 border border-cyan-400/60'
        : danger ? 'bg-rose-700/30 hover:bg-rose-700/50 border border-rose-500/40'
        : 'bg-slate-900/70 hover:bg-slate-900/90 border border-white/10'
      }`}
    >
      <span className={`text-sm font-semibold ${primary ? 'text-cyan-100' : danger ? 'text-rose-100' : 'text-white'}`}>
        {label}
      </span>
      {hint && <span className="text-[10px] text-slate-400 uppercase tracking-wider">{hint}</span>}
    </button>
  );
}
