'use client';

// MidiGenerator — Sprint A Item #6.
//
// Constrained MIDI generation panel. Three modes: melody, chord
// progression, drum rhythm. Each generation mints a
// `kind='midi_generation'` DTU and returns the notes so the user
// can paste them into the Piano Roll.

import { useState, useCallback } from 'react';
import { Music2, Wand2, Save, Clipboard, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GeneratedNote {
  tick: number;
  pitch: number;
  velocity: number;
  duration: number;
}

interface MidiGenResult {
  ok: boolean;
  dtuId?: string;
  title?: string;
  notes?: GeneratedNote[];
  reason?: string;
  meta?: { generator?: string; constraints?: Record<string, unknown> };
}

interface MidiGeneratorProps {
  initialKey?: string;
  initialBpm?: number;
  onPasteIntoPianoRoll?: (notes: GeneratedNote[]) => void;
  onCancel?: () => void;
}

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = ['major', 'minor', 'dorian', 'mixolydian', 'pentatonic_major', 'pentatonic_minor', 'blues', 'harmonic_minor', 'phrygian'];
const MOODS = ['neutral', 'cinematic', 'driving', 'melancholic', 'uplifting', 'tense', 'meditative'];
const GENRES = ['neutral', 'lofi', 'house', 'techno', 'hip-hop', 'rock', 'jazz', 'breakbeat'];

type GenKind = 'melody' | 'chord_progression' | 'rhythm';

export default function MidiGenerator({
  initialKey = 'C',
  onPasteIntoPianoRoll,
  onCancel,
}: MidiGeneratorProps) {
  const [kind, setKind] = useState<GenKind>('melody');

  // shared constraints
  const [key, setKey] = useState(initialKey);
  const [scale, setScale] = useState('major');
  const [mood, setMood] = useState('neutral');
  const [lengthBars, setLengthBars] = useState(4);
  const [density, setDensity] = useState(0.6);

  // rhythm-only constraints
  const [genre, setGenre] = useState('lofi');
  const [swing, setSwing] = useState(0);

  // chord-only constraints
  const [voiceLeading, setVoiceLeading] = useState<'smooth' | 'melody-led' | 'bass-led'>('smooth');

  const [result, setResult] = useState<MidiGenResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const macro = kind === 'melody' ? 'generate_melody'
      : kind === 'chord_progression' ? 'generate_chord_progression'
      : 'generate_rhythm';
    const input: Record<string, unknown> = { lengthBars };
    if (kind === 'melody') {
      Object.assign(input, { key, scale, mood, density });
    } else if (kind === 'chord_progression') {
      Object.assign(input, { key, mood, voiceLeading });
    } else {
      Object.assign(input, { genre, density, swing });
    }
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: 'studio', name: macro, input }),
      });
      const json = await r.json();
      const out: MidiGenResult = json?.result || json;
      if (!out?.ok) {
        setError(out?.reason || 'generate_failed');
      } else {
        setResult(out);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request_failed');
    } finally {
      setBusy(false);
    }
  }, [kind, key, scale, mood, density, lengthBars, voiceLeading, genre, swing]);

  const KindButton = ({ id, label }: { id: GenKind; label: string }) => (
    <button
      onClick={() => setKind(id)}
      className={cn(
        'flex-1 px-3 py-2 rounded text-xs font-medium border transition-colors',
        kind === id
          ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'
          : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/20',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music2 className="w-5 h-5 text-neon-purple" />
          <h2 className="text-lg font-bold">MIDI Generator</h2>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-white">
            Close
          </button>
        )}
      </div>

      {/* Mode picker */}
      <div className="flex gap-2 bg-white/5 rounded-xl p-2 border border-white/10">
        <KindButton id="melody" label="Melody" />
        <KindButton id="chord_progression" label="Chord progression" />
        <KindButton id="rhythm" label="Rhythm" />
      </div>

      {/* Constraints */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 grid grid-cols-2 md:grid-cols-3 gap-3">
        {kind !== 'rhythm' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Key
            <select
              value={key} onChange={e => setKey(e.target.value)}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
            >
              {KEYS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
        )}
        {kind === 'melody' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Scale
            <select
              value={scale} onChange={e => setScale(e.target.value)}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
            >
              {SCALES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </label>
        )}
        {kind === 'chord_progression' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Voice leading
            <select
              value={voiceLeading} onChange={e => setVoiceLeading(e.target.value as typeof voiceLeading)}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
            >
              <option value="smooth">Smooth</option>
              <option value="melody-led">Top-down</option>
              <option value="bass-led">Bottom-up</option>
            </select>
          </label>
        )}
        {kind === 'rhythm' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Genre
            <select
              value={genre} onChange={e => setGenre(e.target.value)}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
            >
              {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        )}
        {kind !== 'rhythm' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Mood
            <select
              value={mood} onChange={e => setMood(e.target.value)}
              className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
            >
              {MOODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          Bars
          <input
            type="number" min={1} max={32} value={lengthBars}
            onChange={e => setLengthBars(Math.max(1, Math.min(32, Number(e.target.value) || 4)))}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          />
        </label>
        {kind !== 'chord_progression' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Density
            <input
              type="range" min={0.1} max={1} step={0.05} value={density}
              onChange={e => setDensity(Number(e.target.value))}
              className="w-full accent-neon-cyan"
            />
            <span className="text-[9px] text-gray-500 font-mono">{density.toFixed(2)}</span>
          </label>
        )}
        {kind === 'rhythm' && (
          <label className="flex flex-col gap-1 text-[10px] text-gray-400">
            Swing
            <input
              type="range" min={0} max={0.6} step={0.05} value={swing}
              onChange={e => setSwing(Number(e.target.value))}
              className="w-full accent-neon-purple"
            />
            <span className="text-[9px] text-gray-500 font-mono">{swing.toFixed(2)}</span>
          </label>
        )}
      </div>

      <button
        onClick={generate}
        disabled={busy}
        className="w-full py-2.5 bg-neon-purple/20 text-neon-purple rounded-lg text-sm font-medium hover:bg-neon-purple/30 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Wand2 className={cn('w-4 h-4', busy && 'animate-pulse')} />
        {busy ? 'Composing…' : 'Generate'}
      </button>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300 flex items-start gap-2">
          <X className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Result */}
      {result?.ok && result.notes && (
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{result.title}</div>
              <div className="text-[10px] text-gray-500">
                {result.notes.length} notes · DTU {result.dtuId?.slice(0, 12)}…
              </div>
            </div>
            {onPasteIntoPianoRoll && (
              <button
                onClick={() => onPasteIntoPianoRoll(result.notes!)}
                className="flex items-center gap-1 px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-xs font-medium hover:bg-neon-cyan/30"
              >
                <Clipboard className="w-3 h-3" /> Paste into Piano Roll
              </button>
            )}
          </div>

          {/* Piano-roll preview */}
          <div className="bg-black/40 rounded p-2 h-32 overflow-hidden relative">
            <PianoRollPreview notes={result.notes} />
          </div>

          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <Save className="w-3 h-3" />
            <span>Saved as DTU — citable, royalty-cascadeable from the moment it lands.</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PianoRollPreview({ notes }: { notes: GeneratedNote[] }) {
  if (notes.length === 0) return null;
  const maxTick = Math.max(...notes.map(n => n.tick + n.duration));
  const pitches = notes.map(n => n.pitch);
  const minPitch = Math.min(...pitches);
  const maxPitch = Math.max(...pitches);
  const pitchRange = Math.max(1, maxPitch - minPitch);
  return (
    <svg className="w-full h-full" viewBox={`0 0 ${maxTick} ${pitchRange + 1}`} preserveAspectRatio="none">
      {notes.map((n, i) => (
        <rect
          key={i}
          x={n.tick}
          y={maxPitch - n.pitch}
          width={n.duration}
          height={1}
          fill="rgb(34 211 238)"
          opacity={0.3 + (n.velocity / 127) * 0.7}
        />
      ))}
    </svg>
  );
}
