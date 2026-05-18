'use client';

// ChordStampTool — Sprint A Item #3.
//
// Authors chord progressions with smooth voice-leading, in either
// top-down (melody-led) or bottom-up (bass-led) mode. Minted as a
// `kind='chord_progression'` DTU so the royalty cascade pays the
// author every time another producer cites the progression.

import { useState, useMemo, useCallback } from 'react';
import { Music, Plus, X, Save, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  parseChord, diatonicChords, leadProgression,
  type Chord, type VoiceLeadingMode, type Voicing,
} from '@/lib/daw/voice-leading';

interface ChordStampToolProps {
  initialKeyRoot?: number;   // MIDI note, default C4
  initialMode?: 'major' | 'minor';
  initialBpm?: number;
  onMinted?: (dtuId: string, title: string) => void;
  onCancel?: () => void;
}

const KEY_OPTIONS = [
  { name: 'C', midi: 60 }, { name: 'C#', midi: 61 }, { name: 'D', midi: 62 },
  { name: 'Eb', midi: 63 }, { name: 'E', midi: 64 }, { name: 'F', midi: 65 },
  { name: 'F#', midi: 66 }, { name: 'G', midi: 67 }, { name: 'Ab', midi: 68 },
  { name: 'A', midi: 69 }, { name: 'Bb', midi: 70 }, { name: 'B', midi: 71 },
];

const VOICE_MODES: Array<{ id: VoiceLeadingMode; label: string; hint: string }> = [
  { id: 'smooth',     label: 'Smooth',     hint: 'Minimise total voice movement' },
  { id: 'melody-led', label: 'Top-down',   hint: 'Keep the top voice contiguous (melody)' },
  { id: 'bass-led',   label: 'Bottom-up',  hint: 'Keep the bass voice contiguous' },
];

const PRESETS: Array<{ label: string; degrees: number[] }> = [
  { label: 'I-V-vi-IV',   degrees: [0, 4, 5, 3] },
  { label: 'ii-V-I',      degrees: [1, 4, 0] },
  { label: 'I-vi-IV-V',   degrees: [0, 5, 3, 4] },
  { label: 'vi-IV-I-V',   degrees: [5, 3, 0, 4] },
  { label: 'I-IV-V',      degrees: [0, 3, 4] },
];

export default function ChordStampTool({
  initialKeyRoot = 60,
  initialMode = 'major',
  initialBpm = 120,
  onMinted,
  onCancel,
}: ChordStampToolProps) {
  const [keyRoot, setKeyRoot] = useState(initialKeyRoot);
  const [mode, setMode] = useState<'major' | 'minor'>(initialMode);
  const [bpm, setBpm] = useState(initialBpm);
  const [beatsPerChord, setBeatsPerChord] = useState(4);
  const [voiceMode, setVoiceMode] = useState<VoiceLeadingMode>('smooth');
  const [chords, setChords] = useState<Chord[]>([]);
  const [title, setTitle] = useState('Untitled Progression');
  const [chordInput, setChordInput] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);

  const diatonic = useMemo(() => diatonicChords(keyRoot, mode), [keyRoot, mode]);
  const lead = useMemo(() => leadProgression(chords, voiceMode), [chords, voiceMode]);

  const addDiatonic = useCallback((degree: number) => {
    setChords(prev => [...prev, diatonic[degree]]);
  }, [diatonic]);

  const addPreset = useCallback((degrees: number[]) => {
    setChords(prev => [...prev, ...degrees.map(d => diatonic[d])]);
  }, [diatonic]);

  const addFromInput = useCallback(() => {
    const parsed = parseChord(chordInput);
    if (!parsed) {
      setMintError(`Couldn't parse "${chordInput}" — try e.g. Cmaj7, F#m, Bbm7`);
      return;
    }
    setChords(prev => [...prev, parsed]);
    setChordInput('');
    setMintError(null);
  }, [chordInput]);

  const removeChord = useCallback((idx: number) => {
    setChords(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const mint = useCallback(async () => {
    if (chords.length === 0) {
      setMintError('Add at least one chord before minting.');
      return;
    }
    setMinting(true);
    setMintError(null);
    // Materialise the actual voicings the producer hears so the DTU
    // captures the picked inversion / drop variant, not just the
    // chord symbol.
    const progressionPayload = lead.voicings.map((v: Voicing) => ({
      root: v.chord.root,
      quality: v.chord.quality,
      label: v.chord.label,
      notes: v.notes,
      inversion: v.inversion,
      variant: v.variant,
    }));
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio',
          name: 'mint_progression',
          input: {
            title,
            keyRoot,
            mode,
            voiceLeading: voiceMode,
            bpm,
            beatsPerChord,
            progression: progressionPayload,
          },
        }),
      });
      const json = await r.json();
      const result = json?.result || json;
      if (!result?.ok) {
        setMintError(result?.reason || 'mint_failed');
        return;
      }
      onMinted?.(result.dtuId, result.title);
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'request_failed');
    } finally {
      setMinting(false);
    }
  }, [chords.length, lead.voicings, title, keyRoot, mode, voiceMode, bpm, beatsPerChord, onMinted]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/40">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-5 h-5 text-neon-cyan" />
          <h2 className="text-lg font-bold">Chord Stamp</h2>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-white">
            Close
          </button>
        )}
      </div>

      {/* Key + mode + tempo */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 grid grid-cols-2 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          Key
          <select
            value={keyRoot}
            onChange={e => setKeyRoot(Number(e.target.value))}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          >
            {KEY_OPTIONS.map(k => (<option key={k.midi} value={k.midi}>{k.name}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          Mode
          <select
            value={mode}
            onChange={e => setMode(e.target.value as 'major' | 'minor')}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          >
            <option value="major">Major</option>
            <option value="minor">Minor</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          BPM
          <input
            type="number" min={20} max={400} value={bpm}
            onChange={e => setBpm(Math.max(20, Math.min(400, Number(e.target.value) || 120)))}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">
          Beats per chord
          <input
            type="number" min={0.25} max={32} step={0.25} value={beatsPerChord}
            onChange={e => setBeatsPerChord(Math.max(0.25, Math.min(32, Number(e.target.value) || 4)))}
            className="bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-white"
          />
        </label>
      </div>

      {/* Voice-leading mode picker */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
        <div className="text-[10px] text-gray-400 uppercase mb-2">Voice leading</div>
        <div className="flex gap-2">
          {VOICE_MODES.map(m => (
            <button
              key={m.id}
              onClick={() => setVoiceMode(m.id)}
              title={m.hint}
              className={cn(
                'flex-1 px-3 py-2 rounded text-xs font-medium border transition-colors',
                voiceMode === m.id
                  ? 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40'
                  : 'bg-white/5 text-gray-400 border-white/10 hover:border-white/20',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Diatonic chord palette */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
        <div className="text-[10px] text-gray-400 uppercase mb-2">In key — click to add</div>
        <div className="flex flex-wrap gap-2">
          {diatonic.map((c, i) => (
            <button
              key={i}
              onClick={() => addDiatonic(i)}
              className="px-3 py-1.5 bg-black/40 hover:bg-neon-cyan/20 text-sm rounded border border-white/10 hover:border-neon-cyan/40 transition-colors font-mono"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10">
        <div className="text-[10px] text-gray-400 uppercase mb-2">Preset progressions</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => addPreset(p.degrees)}
              className="px-3 py-1.5 bg-black/40 hover:bg-neon-purple/20 text-xs rounded border border-white/10 hover:border-neon-purple/40 transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Free-form chord input */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex gap-2">
        <input
          type="text" value={chordInput}
          onChange={e => setChordInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addFromInput(); }}
          placeholder="Add by name (Cmaj7, F#m, Bbm7…)"
          className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
        />
        <button
          onClick={addFromInput}
          className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-xs font-medium hover:bg-neon-cyan/30 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Progression preview */}
      <div className="bg-black/40 rounded-xl p-4 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold text-gray-300">Progression</div>
          <div className="text-[10px] text-gray-500">
            {chords.length} chord{chords.length === 1 ? '' : 's'}
            {chords.length > 1 && ` · total movement ${lead.totalCost.toFixed(0)} semitones`}
          </div>
        </div>
        {chords.length === 0 ? (
          <div className="text-xs text-gray-500 italic">
            Add chords from the palette, presets, or free-form input.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {lead.voicings.map((v, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 bg-white/5 rounded border border-white/10 group/chord"
              >
                <div className="flex flex-col items-center">
                  <span className="text-sm font-bold font-mono">{v.chord.label}</span>
                  <span className="text-[9px] text-gray-500">{v.variant}</span>
                </div>
                <div className="text-[9px] text-gray-500 font-mono">
                  {v.notes.map(n => midiToName(n)).join(' ')}
                </div>
                <button
                  onClick={() => removeChord(i)}
                  className="opacity-0 group-hover/chord:opacity-100 p-0.5 text-gray-500 hover:text-red-400 transition-opacity"
                  aria-label={`Remove ${v.chord.label}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mint */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
        <input
          type="text" value={title}
          onChange={e => setTitle(e.target.value.slice(0, 120))}
          placeholder="Name your progression"
          className="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white"
        />
        {mintError && (
          <div className="text-xs text-red-400">{mintError}</div>
        )}
        <button
          onClick={mint}
          disabled={minting || chords.length === 0}
          className="w-full py-2 bg-neon-green/20 text-neon-green rounded text-sm font-medium hover:bg-neon-green/30 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {minting ? (<><Wand2 className="w-4 h-4 animate-pulse" /> Minting…</>)
                  : (<><Save className="w-4 h-4" /> Mint Progression as DTU</>)}
        </button>
      </div>
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}
