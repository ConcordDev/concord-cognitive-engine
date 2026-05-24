'use client';

import { useState, useCallback } from 'react';
import { Waves, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_SYNTH_PRESETS } from '@/lib/daw/engine';
import { emitInstrumentDTU } from '@/lib/daw/dtu-hooks';
import type { SynthPreset, OscillatorShape, FilterType, EnvelopeParams, OscillatorParams } from '@/lib/daw/types';

interface SynthPanelProps {
  presets: SynthPreset[];
  activePreset: SynthPreset | null;
  onSelectPreset: (preset: SynthPreset) => void;
  onUpdatePreset: (preset: SynthPreset) => void;
  onSavePreset: (preset: SynthPreset) => void;
  onAddToTrack: (preset: SynthPreset) => void;
}

const OSCILLATOR_SHAPES: OscillatorShape[] = ['sine', 'square', 'sawtooth', 'triangle', 'pulse', 'noise'];
const FILTER_TYPES: FilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

function Knob({ value, min, max, label, onChange, color = 'neon-cyan' }: {
  value: number; min: number; max: number; label: string;
  onChange: (v: number) => void; color?: string;
}) {
  const normalized = (value - min) / (max - min);
  const angle = -135 + normalized * 270;

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className="w-10 h-10 rounded-full border-2 border-white/20 relative cursor-pointer hover:border-white/40"
        onClick={() => {
          const next = normalized + 0.1 > 1 ? 0 : normalized + 0.1;
          onChange(min + next * (max - min));
        }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div
          className={`absolute w-0.5 h-3 bg-${color} rounded-full left-1/2 -translate-x-1/2 origin-bottom`}
          style={{ bottom: '50%', transform: `translateX(-50%) rotate(${angle}deg)` }}
        />
        {/* Arc indicator */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 40 40">
          <circle
            cx="20" cy="20" r="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={`${normalized * 75} 100`}
            strokeDashoffset="-12.5"
            className={`text-${color}/40`}
            transform="rotate(-225 20 20)"
          />
        </svg>
      </div>
      <span className="text-[8px] text-gray-400">{label}</span>
      <span className="text-[8px] text-gray-500 font-mono">{typeof value === 'number' ? (value > 100 ? Math.round(value) : value.toFixed(2)) : value}</span>
    </div>
  );
}

function EnvelopeDisplay({ envelope, onChange, label }: {
  envelope: EnvelopeParams; onChange: (e: EnvelopeParams) => void; label: string;
}) {
  const { attack, decay, sustain, release } = envelope;
  const w = 160;
  const h = 50;
  const aX = attack * 30;
  const dX = aX + decay * 30;
  const sY = h * (1 - sustain);
  const rX = dX + 40;
  const endX = rX + release * 30;

  return (
    <div className="space-y-1">
      <span className="text-[9px] text-gray-400 uppercase tracking-wider">{label}</span>
      <svg width={w} height={h} className="bg-black/30 rounded">
        <polyline
          points={`0,${h} ${aX},2 ${dX},${sY} ${rX},${sY} ${endX},${h}`}
          fill="none"
          stroke="var(--neon-cyan)"
          strokeWidth="1.5"
          opacity="0.6"
        />
        <polygon
          points={`0,${h} ${aX},2 ${dX},${sY} ${rX},${sY} ${endX},${h}`}
          fill="var(--neon-cyan)"
          opacity="0.1"
        />
      </svg>
      <div className="flex gap-2">
        <Knob value={attack} min={0} max={2} label="A" onChange={v => onChange({ ...envelope, attack: v })} />
        <Knob value={decay} min={0} max={2} label="D" onChange={v => onChange({ ...envelope, decay: v })} />
        <Knob value={sustain} min={0} max={1} label="S" onChange={v => onChange({ ...envelope, sustain: v })} />
        <Knob value={release} min={0} max={5} label="R" onChange={v => onChange({ ...envelope, release: v })} />
      </div>
    </div>
  );
}

export function SynthPanel({
  presets,
  activePreset,
  onSelectPreset,
  onUpdatePreset,
  onSavePreset,
  onAddToTrack,
}: SynthPanelProps) {
  const [showBrowser, setShowBrowser] = useState(!activePreset);
  const allPresets = [...DEFAULT_SYNTH_PRESETS, ...presets];

  const handleSave = useCallback(() => {
    if (activePreset) {
      emitInstrumentDTU(activePreset, 'create');
      onSavePreset(activePreset);
    }
  }, [activePreset, onSavePreset]);

  const updateOsc = useCallback((index: number, data: Partial<OscillatorParams>) => {
    if (!activePreset) return;
    const oscillators = [...activePreset.oscillators];
    oscillators[index] = { ...oscillators[index], ...data };
    onUpdatePreset({ ...activePreset, oscillators });
  }, [activePreset, onUpdatePreset]);

  if (showBrowser || !activePreset) {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Waves className="w-5 h-5 text-neon-purple" /> Synthesizers
          </h2>
          {activePreset && (
            <button onClick={() => setShowBrowser(false)} className="text-xs text-neon-cyan hover:underline">
              Back to Editor
            </button>
          )}
        </div>

        {/* Preset categories */}
        {['bass', 'lead', 'pad', 'keys', 'pluck', 'strings', 'fm'].map(cat => {
          const catPresets = allPresets.filter(p => p.category === cat);
          if (catPresets.length === 0) return null;
          return (
            <section key={cat}>
              <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2 capitalize">{cat}</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {catPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => { onSelectPreset(preset); setShowBrowser(false); }}
                    className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-neon-purple/30 text-left transition-colors group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Waves className="w-4 h-4 text-neon-purple" />
                      <span className="text-sm font-medium">{preset.name}</span>
                    </div>
                    <p className="text-[10px] text-gray-500 capitalize">{preset.type} &middot; {preset.oscillators.length} osc</p>
                    <div className="mt-1 flex gap-1">
                      {preset.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-1 py-0.5 bg-white/5 rounded text-[8px] text-gray-500">{tag}</span>
                      ))}
                    </div>
                    <div className="mt-2 opacity-0 group-hover:opacity-100 flex gap-2">
                      <span className="text-[10px] text-neon-cyan">Edit</span>
                      <span
                        className="text-[10px] text-neon-green"
                        onClick={e => { e.stopPropagation(); onAddToTrack(preset); }}
                      >
                        Add to track
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="w-5 h-5 text-neon-purple" />
          <h2 className="text-lg font-bold">{activePreset.name}</h2>
          <span className="text-xs text-gray-400 capitalize">{activePreset.type}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBrowser(true)} className="text-xs text-gray-400 hover:text-white">Browse</button>
          <button onClick={handleSave} className="flex items-center gap-1 text-xs px-2 py-1 bg-neon-cyan/10 text-neon-cyan rounded hover:bg-neon-cyan/20">
            <Save className="w-3 h-3" /> Save as DTU
          </button>
          <button onClick={() => onAddToTrack(activePreset)} className="flex items-center gap-1 text-xs px-2 py-1 bg-neon-green/10 text-neon-green rounded hover:bg-neon-green/20">
            <Plus className="w-3 h-3" /> Add to Track
          </button>
        </div>
      </div>

      {/* Oscillators */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase">Oscillators</h3>
        {activePreset.oscillators.map((osc, i) => (
          <div key={i} className="flex items-center gap-3 bg-black/20 rounded-lg p-2">
            <span className="text-[10px] text-gray-500 w-6">OSC{i + 1}</span>
            <div className="flex gap-1">
              {OSCILLATOR_SHAPES.map(shape => (
                <button
                  key={shape}
                  onClick={() => updateOsc(i, { shape })}
                  className={cn('px-1.5 py-0.5 rounded text-[9px] capitalize', osc.shape === shape ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-500 hover:text-white')}
                >
                  {shape.slice(0, 3)}
                </button>
              ))}
            </div>
            <Knob value={osc.octave} min={-3} max={3} label="Oct" onChange={v => updateOsc(i, { octave: Math.round(v) })} color="neon-purple" />
            <Knob value={osc.detune} min={-100} max={100} label="Det" onChange={v => updateOsc(i, { detune: v })} color="neon-purple" />
            <Knob value={osc.level} min={0} max={1} label="Vol" onChange={v => updateOsc(i, { level: v })} color="neon-green" />
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase">Filter</h3>
        <div className="flex items-center gap-2 mb-2">
          {FILTER_TYPES.map(ft => (
            <button
              key={ft}
              onClick={() => onUpdatePreset({ ...activePreset, filter: { ...activePreset.filter, type: ft } })}
              className={cn('px-2 py-0.5 rounded text-[10px] capitalize', activePreset.filter.type === ft ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-500 hover:text-white')}
            >
              {ft}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <Knob value={activePreset.filter.frequency} min={20} max={20000} label="Freq" onChange={v => onUpdatePreset({ ...activePreset, filter: { ...activePreset.filter, frequency: v } })} />
          <Knob value={activePreset.filter.resonance} min={0} max={20} label="Res" onChange={v => onUpdatePreset({ ...activePreset, filter: { ...activePreset.filter, resonance: v } })} />
          <Knob value={activePreset.filter.envelope} min={-1} max={1} label="Env" onChange={v => onUpdatePreset({ ...activePreset, filter: { ...activePreset.filter, envelope: v } })} />
          <Knob value={activePreset.filter.keyTrack} min={0} max={1} label="Key" onChange={v => onUpdatePreset({ ...activePreset, filter: { ...activePreset.filter, keyTrack: v } })} />
        </div>
      </div>

      {/* Envelopes */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 rounded-xl p-3 border border-white/10">
          <EnvelopeDisplay
            envelope={activePreset.ampEnvelope}
            onChange={e => onUpdatePreset({ ...activePreset, ampEnvelope: e })}
            label="Amp Envelope"
          />
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/10">
          <EnvelopeDisplay
            envelope={activePreset.filterEnvelope}
            onChange={e => onUpdatePreset({ ...activePreset, filterEnvelope: e })}
            label="Filter Envelope"
          />
        </div>
      </div>

      {/* Polyphony & Performance */}
      <div className="bg-white/5 rounded-xl p-3 border border-white/10 flex gap-4">
        <Knob value={activePreset.polyphony} min={1} max={32} label="Poly" onChange={v => onUpdatePreset({ ...activePreset, polyphony: Math.round(v) })} color="neon-green" />
        <Knob value={activePreset.portamento} min={0} max={1} label="Porta" onChange={v => onUpdatePreset({ ...activePreset, portamento: v })} color="neon-green" />
        <Knob value={activePreset.unison} min={1} max={8} label="Unison" onChange={v => onUpdatePreset({ ...activePreset, unison: Math.round(v) })} color="neon-green" />
        <Knob value={activePreset.unisonDetune} min={0} max={50} label="Detune" onChange={v => onUpdatePreset({ ...activePreset, unisonDetune: v })} color="neon-green" />
      </div>
    </div>
  );
}

// Needed by reference above
function Plus(props: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><line x1="12" x2="12" y1="5" y2="19"/><line x1="5" x2="19" y1="12" y2="12"/></svg>
  );
}
