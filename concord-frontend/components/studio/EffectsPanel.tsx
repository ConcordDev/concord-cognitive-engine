'use client';

import { useState, useCallback, useMemo } from 'react';
import { Sliders, Power, ChevronDown, ChevronUp, GripVertical, Trash2, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DEFAULT_EFFECT_PRESETS } from '@/lib/daw/engine';
import { emitEffectChainDTU } from '@/lib/daw/dtu-hooks';
import type { EffectInstance, EffectType, DAWTrack } from '@/lib/daw/types';

interface EffectsPanelProps {
  track: DAWTrack | null;
  onUpdateEffects: (trackId: string, effects: EffectInstance[]) => void;
  onSaveChainAsDTU: (effects: EffectInstance[], trackName: string) => void;
}

const EFFECT_CATALOG: { type: EffectType; name: string; category: string }[] = [
  // Dynamics
  { type: 'compressor', name: 'Compressor', category: 'Dynamics' },
  { type: 'limiter', name: 'Limiter', category: 'Dynamics' },
  { type: 'gate', name: 'Noise Gate', category: 'Dynamics' },
  { type: 'deesser', name: 'De-Esser', category: 'Dynamics' },
  // EQ
  { type: 'eq3', name: '3-Band EQ', category: 'EQ' },
  { type: 'eq8', name: '8-Band EQ', category: 'EQ' },
  { type: 'parametricEQ', name: 'Parametric EQ', category: 'EQ' },
  // Reverb & Delay
  { type: 'reverb', name: 'Reverb', category: 'Space' },
  { type: 'convolutionReverb', name: 'Convolution Reverb', category: 'Space' },
  { type: 'delay', name: 'Delay', category: 'Space' },
  { type: 'pingPongDelay', name: 'Ping Pong Delay', category: 'Space' },
  // Distortion
  { type: 'distortion', name: 'Distortion', category: 'Distortion' },
  { type: 'overdrive', name: 'Overdrive', category: 'Distortion' },
  { type: 'bitcrusher', name: 'Bitcrusher', category: 'Distortion' },
  { type: 'waveshaper', name: 'Waveshaper', category: 'Distortion' },
  // Modulation
  { type: 'chorus', name: 'Chorus', category: 'Modulation' },
  { type: 'phaser', name: 'Phaser', category: 'Modulation' },
  { type: 'flanger', name: 'Flanger', category: 'Modulation' },
  { type: 'tremolo', name: 'Tremolo', category: 'Modulation' },
  { type: 'vibrato', name: 'Vibrato', category: 'Modulation' },
  // Filter
  { type: 'filter', name: 'Filter', category: 'Filter' },
  { type: 'autoFilter', name: 'Auto Filter', category: 'Filter' },
  { type: 'autoWah', name: 'Auto Wah', category: 'Filter' },
  // Utility
  { type: 'stereoWidener', name: 'Stereo Widener', category: 'Utility' },
  { type: 'pitchShift', name: 'Pitch Shift', category: 'Utility' },
];

function EffectSlot({
  effect,
  onToggle,
  onRemove,
  onUpdateParam,
  onUpdateWet,
}: {
  effect: EffectInstance;
  onToggle: () => void;
  onRemove: () => void;
  onUpdateParam: (key: string, value: number | string | boolean) => void;
  onUpdateWet: (wet: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      'rounded-lg border transition-colors',
      effect.enabled ? 'bg-white/5 border-neon-purple/20' : 'bg-black/20 border-white/5'
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <GripVertical className="w-3 h-3 text-gray-600 cursor-grab" />
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          className={cn('p-0.5 rounded', effect.enabled ? 'text-neon-green' : 'text-gray-600')}
        aria-label="Power">
          <Power className="w-3 h-3" />
        </button>
        <span className={cn('text-xs font-medium flex-1', !effect.enabled && 'text-gray-500')}>{effect.name}</span>
        <div className="flex items-center gap-1">
          <span className="text-[8px] text-gray-500">Wet</span>
          <input
            type="range"
            min={0} max={1} step={0.01}
            value={effect.wet}
            onChange={e => { e.stopPropagation(); onUpdateWet(parseFloat(e.target.value)); }}
            onClick={e => e.stopPropagation()}
            className="w-12 h-0.5 accent-neon-purple"
          />
          <span className="text-[8px] text-gray-400 w-6">{Math.round(effect.wet * 100)}%</span>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onRemove(); }}
          className="p-0.5 text-gray-600 hover:text-red-400"
        aria-label="Delete">
          <Trash2 className="w-3 h-3" />
        </button>
        {expanded ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
      </div>

      {/* Parameters */}
      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 border-t border-white/5 pt-2">
          {Object.entries(effect.params).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 capitalize w-20">{key}</span>
              {typeof value === 'number' ? (
                <>
                  <input
                    type="range"
                    min={getParamMin(key)}
                    max={getParamMax(key)}
                    step={getParamStep(key)}
                    value={value}
                    onChange={e => onUpdateParam(key, parseFloat(e.target.value))}
                    className="flex-1 h-0.5 accent-neon-purple"
                  />
                  <span className="text-[9px] text-gray-500 font-mono w-12 text-right">{formatParamValue(key, value)}</span>
                </>
              ) : typeof value === 'boolean' ? (
                <button
                  onClick={() => onUpdateParam(key, !value)}
                  className={cn('px-2 py-0.5 rounded text-[10px]', value ? 'bg-neon-green/20 text-neon-green' : 'bg-white/10 text-gray-500')}
                >
                  {value ? 'On' : 'Off'}
                </button>
              ) : (
                <span className="text-[10px] text-gray-400">{String(value)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getParamMin(key: string): number {
  if (key.includes('threshold') || key.includes('gain') || key.includes('Gain')) return -60;
  if (key.includes('ratio')) return 1;
  if (key.includes('attack') || key.includes('release') || key.includes('time') || key.includes('delay')) return 0;
  if (key.includes('freq') || key.includes('Freq')) return 20;
  return 0;
}

function getParamMax(key: string): number {
  if (key.includes('threshold') || key.includes('ceiling')) return 0;
  if (key.includes('gain') || key.includes('Gain')) return 24;
  if (key.includes('ratio')) return 20;
  if (key.includes('attack')) return 1;
  if (key.includes('release')) return 2;
  if (key.includes('time') || key.includes('delay')) return 5;
  if (key.includes('freq') || key.includes('Freq')) return 20000;
  if (key.includes('feedback')) return 0.95;
  if (key.includes('amount') || key.includes('depth') || key.includes('rate')) return 100;
  if (key.includes('Q') || key.includes('resonance')) return 20;
  if (key.includes('knee')) return 40;
  return 1;
}

function getParamStep(key: string): number {
  if (key.includes('freq') || key.includes('Freq')) return 1;
  return 0.01;
}

function formatParamValue(key: string, value: number): string {
  if (key.includes('freq') || key.includes('Freq')) {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`;
  }
  if (key.includes('threshold') || key.includes('gain') || key.includes('Gain') || key.includes('ceiling')) {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}dB`;
  }
  if (key.includes('time') || key.includes('attack') || key.includes('release') || key.includes('delay')) {
    return value < 1 ? `${Math.round(value * 1000)}ms` : `${value.toFixed(2)}s`;
  }
  return value.toFixed(2);
}

export function EffectsPanel({ track, onUpdateEffects, onSaveChainAsDTU }: EffectsPanelProps) {
  const [showCatalog, setShowCatalog] = useState(false);

  const effects = useMemo(() => track?.effectChain || [], [track]);

  const handleAddEffect = useCallback((type: EffectType, name: string) => {
    if (!track) return;
    const defaultPreset = DEFAULT_EFFECT_PRESETS.find(p => p.type === type);
    const newEffect: EffectInstance = {
      id: `fx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      name,
      enabled: true,
      wet: defaultPreset?.wet ?? 1,
      params: defaultPreset?.params ? { ...defaultPreset.params } : {},
    };
    onUpdateEffects(track.id, [...effects, newEffect]);
    setShowCatalog(false);
  }, [track, effects, onUpdateEffects]);

  const handleToggle = useCallback((effectId: string) => {
    if (!track) return;
    onUpdateEffects(track.id, effects.map(e =>
      e.id === effectId ? { ...e, enabled: !e.enabled } : e
    ));
  }, [track, effects, onUpdateEffects]);

  const handleRemove = useCallback((effectId: string) => {
    if (!track) return;
    onUpdateEffects(track.id, effects.filter(e => e.id !== effectId));
  }, [track, effects, onUpdateEffects]);

  const handleUpdateParam = useCallback((effectId: string, key: string, value: number | string | boolean) => {
    if (!track) return;
    onUpdateEffects(track.id, effects.map(e =>
      e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e
    ));
  }, [track, effects, onUpdateEffects]);

  const handleUpdateWet = useCallback((effectId: string, wet: number) => {
    if (!track) return;
    onUpdateEffects(track.id, effects.map(e =>
      e.id === effectId ? { ...e, wet } : e
    ));
  }, [track, effects, onUpdateEffects]);

  const handleSaveChain = useCallback(() => {
    if (!track || effects.length === 0) return;
    emitEffectChainDTU(effects, 'insert', track.name);
    onSaveChainAsDTU(effects, track.name);
  }, [track, effects, onSaveChainAsDTU]);

  if (!track) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="text-center">
          <Sliders className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a track to edit effects</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sliders className="w-5 h-5 text-neon-purple" />
          <h2 className="text-sm font-bold">Effects — {track.name}</h2>
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: track.color }} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveChain}
            disabled={effects.length === 0}
            className="flex items-center gap-1 text-[10px] px-2 py-1 bg-neon-cyan/10 text-neon-cyan rounded hover:bg-neon-cyan/20 disabled:opacity-30"
          >
            <Save className="w-3 h-3" /> Save Chain as DTU
          </button>
        </div>
      </div>

      {/* Effect chain */}
      <div className="space-y-1.5">
        {effects.map(effect => (
          <EffectSlot
            key={effect.id}
            effect={effect}
            onToggle={() => handleToggle(effect.id)}
            onRemove={() => handleRemove(effect.id)}
            onUpdateParam={(key, val) => handleUpdateParam(effect.id, key, val)}
            onUpdateWet={(wet) => handleUpdateWet(effect.id, wet)}
          />
        ))}
      </div>

      {/* Add effect */}
      {showCatalog ? (
        <div className="bg-white/5 rounded-xl border border-white/10 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400">Add Effect</span>
            <button onClick={() => setShowCatalog(false)} className="text-[10px] text-gray-500 hover:text-white">Cancel</button>
          </div>
          {['Dynamics', 'EQ', 'Space', 'Distortion', 'Modulation', 'Filter', 'Utility'].map(cat => {
            const items = EFFECT_CATALOG.filter(e => e.category === cat);
            return (
              <div key={cat}>
                <h4 className="text-[10px] text-gray-500 uppercase mb-1">{cat}</h4>
                <div className="flex flex-wrap gap-1">
                  {items.map(item => (
                    <button
                      key={item.type}
                      onClick={() => handleAddEffect(item.type, item.name)}
                      className="px-2 py-1 rounded text-[10px] bg-white/5 border border-white/10 hover:border-neon-purple/30 hover:text-neon-purple"
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <button
          onClick={() => setShowCatalog(true)}
          className="w-full py-2 rounded-lg border border-dashed border-white/10 text-gray-500 hover:text-white hover:border-neon-purple/30 text-xs flex items-center justify-center gap-1"
        >
          <span className="text-lg leading-none">+</span> Add Effect
        </button>
      )}
    </div>
  );
}
