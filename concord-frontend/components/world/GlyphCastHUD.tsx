'use client';

/**
 * GlyphCastHUD — visible casting interface for player-composed glyph spells.
 * Lists the player's minted spells, shows their dominant element, and
 * lets them cast at the current world position. Wraps Phase 4 macros:
 * glyph_spells.list_for_user, glyph_spells.cast.
 *
 * Bottom-right slot (next to walker map). Click to expand a list.
 * Casting fires `glyph_spells.cast` with playerPos.
 */

import { useEffect, useState } from 'react';

interface Spell {
  id: number;
  name: string;
  components_json?: string;
  dtu_id?: string;
  created_at?: number;
}

const ELEMENT_GLYPH: Record<string, string> = {
  fire: '🔥',
  ice: '❄️',
  lightning: '⚡',
  water: '💧',
  bio: '🌿',
  poison: '☠️',
  energy: '✨',
  physical: '◆',
};

export default function GlyphCastHUD({ worldId = 'concordia-hub', playerPos }: { worldId?: string; playerPos?: { x: number; z: number } }) {
  const [spells, setSpells] = useState<Spell[]>([]);
  const [open, setOpen] = useState(false);
  const [castStatus, setCastStatus] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'glyph_spells', name: 'list_for_user', input: {} }),
      }).catch(() => null);
      const data = r ? await r.json().catch(() => null) : null;
      if (alive && data?.ok && Array.isArray(data.spells)) setSpells(data.spells);
    })();
    return () => { alive = false; };
  }, []);

  const dominantElement = (s: Spell): string => {
    let comps: { element?: string }[] = [];
    try { comps = JSON.parse(s.components_json || '[]'); } catch { /* fall through */ }
    if (!comps.length) return 'physical';
    const counts = new Map<string, number>();
    for (const c of comps) counts.set(c.element || 'physical', (counts.get(c.element || 'physical') || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'physical';
  };

  // Phase 9.3 #18 — play the spell as a chord via Web Audio API.
  // Wraps the sonic_glyph.spell_to_chord macro; renders the
  // returned note schedule into stacked OscillatorNodes.
  const playChord = async (spellId: number) => {
    setCastStatus('Composing chord…');
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: 'sonic_glyph', name: 'spell_to_chord', input: { spellId } }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    if (!data?.ok || !data?.chord?.notes?.length) {
      setCastStatus(`Sonic failed: ${data?.error || data?.reason || 'unknown'}`);
      window.setTimeout(() => setCastStatus(null), 3000);
      return;
    }
    try {
      const win = window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctx = win.AudioContext || win.webkitAudioContext;
      if (!Ctx) {
        setCastStatus('Web Audio unavailable in this browser');
        window.setTimeout(() => setCastStatus(null), 3000);
        return;
      }
      const ctx = new Ctx();
      const now = ctx.currentTime;
      for (const note of data.chord.notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = data.chord.waveform || 'sine';
        osc.frequency.value = note.freq;
        const env = data.chord.envelope || { attack_ms: 50, decay_ms: 200, sustain: 0.4, release_ms: 400 };
        const offset = (note.offset_ms || 0) / 1000;
        const dur = (note.duration_ms || 600) / 1000;
        const peak = (note.velocity || 0.5) * 0.6;
        gain.gain.setValueAtTime(0, now + offset);
        gain.gain.linearRampToValueAtTime(peak, now + offset + env.attack_ms / 1000);
        gain.gain.linearRampToValueAtTime(peak * (env.sustain || 0.4), now + offset + (env.attack_ms + env.decay_ms) / 1000);
        gain.gain.linearRampToValueAtTime(0, now + offset + dur + env.release_ms / 1000);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + offset);
        osc.stop(now + offset + dur + env.release_ms / 1000 + 0.05);
      }
      setCastStatus(`Played ${data.chord.notes.length}-note chord (${data.duration_ms}ms)`);
      window.setTimeout(() => setCastStatus(null), 3000);
    } catch (err) {
      const e = err as Error;
      setCastStatus(`Audio error: ${e.message}`);
      window.setTimeout(() => setCastStatus(null), 3000);
    }
  };

  const cast = async (spellId: number) => {
    if (!playerPos) { setCastStatus('No world position'); return; }
    setCastStatus('Casting…');
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        domain: 'glyph_spells',
        name: 'cast',
        input: { spellId, worldId, x: playerPos.x, z: playerPos.z, magnitude: 1 },
      }),
    }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    if (data?.ok) setCastStatus(`Cast ${data.element || ''} (${data.feedbackApplied || 0} channels)`);
    else setCastStatus(`Failed: ${data?.error || data?.reason || 'unknown'}`);
    window.setTimeout(() => setCastStatus(null), 3000);
  };

  if (spells.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-16 right-3 z-30 bg-zinc-900/85 backdrop-blur-md border border-purple-700/50 text-purple-300 rounded-xl px-3 py-2 shadow-md text-xs font-mono hover:bg-zinc-800/90"
        title="Open glyph spellbook"
      >
        ⟐ {spells.length} spell{spells.length === 1 ? '' : 's'}
      </button>
    );
  }

  return (
    <div className="fixed bottom-16 right-3 z-30 max-w-xs bg-zinc-950/90 backdrop-blur-md border border-purple-800/50 rounded-xl p-3 shadow-xl pointer-events-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold text-purple-300 uppercase tracking-wider">Spellbook</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-zinc-400 hover:text-white" aria-label="Close">✕</button>
      </div>
      <ul className="space-y-1 max-h-64 overflow-y-auto">
        {spells.slice(0, 12).map(s => {
          const el = dominantElement(s);
          return (
            <li key={s.id} className="flex gap-1">
              <button
                type="button"
                onClick={() => cast(s.id)}
                disabled={!playerPos}
                className="flex-1 flex items-center gap-2 text-[11px] bg-zinc-900/60 border border-zinc-800 hover:border-purple-700 rounded px-2 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <span>{ELEMENT_GLYPH[el] || '◆'}</span>
                <span className="flex-1 text-left text-zinc-100 truncate">{s.name || `Spell ${s.id}`}</span>
                <span className="text-purple-400 text-[10px] font-mono">cast</span>
              </button>
              <button
                type="button"
                onClick={() => playChord(s.id)}
                title="Play spell as chord"
                className="px-2 text-[11px] bg-zinc-900/60 border border-zinc-800 hover:border-cyan-700 rounded transition-colors"
              >
                <span className="text-cyan-400">♪</span>
              </button>
            </li>
          );
        })}
      </ul>
      {castStatus && (
        <div className="mt-2 text-[10px] text-purple-300 font-mono italic">{castStatus}</div>
      )}
      {!playerPos && (
        <p className="mt-1 text-[10px] text-amber-400/80 italic">Move into the world to enable casting.</p>
      )}
    </div>
  );
}
