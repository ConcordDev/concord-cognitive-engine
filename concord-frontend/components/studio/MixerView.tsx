'use client';

import { useState, useRef, useCallback } from 'react';
import { Headphones, Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWTrack, MasterBus } from '@/lib/daw/types';

interface MixerViewProps {
  tracks: DAWTrack[];
  masterBus: MasterBus;
  selectedTrackId: string | null;
  spectrumData: Uint8Array | null;
  onSelectTrack: (id: string) => void;
  onUpdateTrack: (trackId: string, data: Partial<DAWTrack>) => void;
  onToggleEffect: (trackId: string, effectId: string) => void;
  onAddEffect: (trackId: string) => void;
  onRemoveEffect: (trackId: string, effectId: string) => void;
  onMasterVolumeChange: (volume: number) => void;
}

function VUMeter({ value, peak }: { value: number; peak?: number }) {
  const height = Math.max(0, Math.min(100, ((value + 60) / 66) * 100));
  const peakHeight = peak ? Math.max(0, Math.min(100, ((peak + 60) / 66) * 100)) : height;
  const isClipping = (peak ?? value) > -0.5;

  return (
    <div className="w-2 h-full bg-black/60 rounded-full relative overflow-hidden">
      <div
        className={cn(
          'absolute bottom-0 w-full rounded-full transition-all duration-75',
          isClipping ? 'bg-red-500' : height > 75 ? 'bg-gradient-to-t from-neon-green via-yellow-400 to-red-500' : 'bg-gradient-to-t from-neon-green to-neon-cyan'
        )}
        style={{ height: `${height}%` }}
      />
      {peak !== undefined && (
        <div
          className="absolute w-full h-px bg-white/60"
          style={{ bottom: `${peakHeight}%` }}
        />
      )}
    </div>
  );
}

function ChannelStrip({
  track,
  isSelected,
  onSelect,
  onUpdate,
  onToggleEffect,
  onAddEffect,
  onRemoveEffect,
}: {
  track: DAWTrack;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (data: Partial<DAWTrack>) => void;
  onToggleEffect: (effectId: string) => void;
  onAddEffect: () => void;
  onRemoveEffect: (effectId: string) => void;
}) {
  const faderRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFaderDrag = useCallback((e: React.MouseEvent) => {
    if (!faderRef.current) return;
    const rect = faderRef.current.getBoundingClientRect();
    const y = 1 - (e.clientY - rect.top) / rect.height;
    const db = Math.round((y * 66 - 60) * 10) / 10;
    onUpdate({ volume: Math.max(-60, Math.min(6, db)) });
  }, [onUpdate]);

  return (
    <div
      onClick={onSelect}
      className={cn(
        'w-[88px] flex-shrink-0 bg-black/40 rounded-lg border p-2 flex flex-col items-center gap-1 cursor-pointer transition-colors',
        isSelected ? 'border-neon-cyan/40 bg-neon-cyan/5' : 'border-white/10 hover:border-white/20'
      )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      {/* Color indicator + name */}
      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: track.color }} />
      <span className="text-[10px] font-medium truncate w-full text-center">{track.name}</span>

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <button
          onClick={e => { e.stopPropagation(); onUpdate({ mute: !track.mute }); }}
          className={cn('px-1.5 py-0.5 text-[8px] rounded font-bold', track.mute ? 'bg-red-500/30 text-red-400' : 'bg-white/10 text-gray-400')}
        >
          M
        </button>
        <button
          onClick={e => { e.stopPropagation(); onUpdate({ solo: !track.solo }); }}
          className={cn('px-1.5 py-0.5 text-[8px] rounded font-bold', track.solo ? 'bg-yellow-500/30 text-yellow-400' : 'bg-white/10 text-gray-400')}
        >
          S
        </button>
      </div>

      {/* Pan knob */}
      <div className="relative w-8 h-8 rounded-full border border-white/20 flex items-center justify-center">
        <div
          className="w-0.5 h-2.5 bg-neon-cyan rounded-full origin-bottom"
          style={{ transform: `rotate(${track.pan * 135}deg)` }}
        />
      </div>
      <span className="text-[8px] text-gray-400">
        {track.pan > 0.01 ? `R${Math.round(track.pan * 100)}` : track.pan < -0.01 ? `L${Math.round(Math.abs(track.pan) * 100)}` : 'C'}
      </span>

      {/* Fader + meter */}
      <div className="flex items-stretch gap-1 h-28">
        <VUMeter value={track.mute ? -60 : track.volume - 10 + Math.random() * 8} />
        <div
          ref={faderRef}
          className="w-3 bg-white/10 rounded-full relative cursor-ns-resize"
          onMouseDown={e => { setIsDragging(true); handleFaderDrag(e); }}
          onMouseMove={e => isDragging && handleFaderDrag(e)}
          onMouseUp={() => setIsDragging(false)}
          onMouseLeave={() => setIsDragging(false)}
        >
          <div
            className="absolute bottom-0 w-full bg-gradient-to-t from-neon-cyan to-neon-purple rounded-full transition-all"
            style={{ height: `${((track.volume + 60) / 66) * 100}%` }}
          />
          {/* Fader thumb */}
          <div
            className="absolute left-1/2 -translate-x-1/2 w-4 h-1.5 bg-white/80 rounded-full shadow"
            style={{ bottom: `${((track.volume + 60) / 66) * 100}%` }}
          />
        </div>
        <VUMeter value={track.mute ? -60 : track.volume - 12 + Math.random() * 8} />
      </div>

      <span className="text-[9px] text-gray-400 font-mono">
        {track.volume > 0 ? '+' : ''}{track.volume.toFixed(1)} dB
      </span>

      {/* Send levels */}
      {Object.keys(track.sendLevels).length > 0 && (
        <div className="w-full space-y-0.5">
          {Object.entries(track.sendLevels).map(([busId, level]) => (
            <div key={busId} className="flex items-center gap-1">
              <Send className="w-2 h-2 text-gray-400" />
              <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-neon-purple/60 rounded-full" style={{ width: `${((level + 60) / 66) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Effect inserts */}
      <div className="w-full space-y-0.5 mt-1">
        {track.effectChain.slice(0, 4).map(fx => (
          <div
            key={fx.id}
            className={cn(
              'px-1 py-0.5 rounded text-[8px] truncate cursor-pointer flex items-center gap-0.5 group/fx',
              fx.enabled ? 'bg-neon-purple/20 text-neon-purple' : 'bg-white/5 text-gray-600'
            )}
            onClick={e => { e.stopPropagation(); onToggleEffect(fx.id); }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <span className="flex-1 truncate">{fx.name}</span>
            <button
              onClick={e => { e.stopPropagation(); onRemoveEffect(fx.id); }}
              className="opacity-0 group-hover/fx:opacity-100 p-0.5 text-gray-400 hover:text-red-400"
            aria-label="Close">
              <X className="w-2 h-2" />
            </button>
          </div>
        ))}
        {track.effectChain.length > 4 && (
          <span className="text-[8px] text-gray-400 block text-center">+{track.effectChain.length - 4} more</span>
        )}
        <button
          onClick={e => { e.stopPropagation(); onAddEffect(); }}
          className="w-full px-1 py-0.5 text-[8px] text-gray-400 hover:text-white bg-white/5 rounded"
        >
          + FX
        </button>
      </div>
    </div>
  );
}

export function MixerView({
  tracks,
  masterBus,
  selectedTrackId,
  spectrumData,
  onSelectTrack,
  onUpdateTrack,
  onToggleEffect,
  onAddEffect,
  onRemoveEffect,
  onMasterVolumeChange,
}: MixerViewProps) {
  return (
    <div className="flex-1 overflow-x-auto p-3">
      <div className="flex gap-2 min-w-max items-stretch">
        {/* Channel strips */}
        {tracks.map(track => (
          <ChannelStrip
            key={track.id}
            track={track}
            isSelected={selectedTrackId === track.id}
            onSelect={() => onSelectTrack(track.id)}
            onUpdate={(data) => onUpdateTrack(track.id, data)}
            onToggleEffect={(effectId) => onToggleEffect(track.id, effectId)}
            onAddEffect={() => onAddEffect(track.id)}
            onRemoveEffect={(effectId) => onRemoveEffect(track.id, effectId)}
          />
        ))}

        {/* Master bus */}
        <div className="w-[100px] flex-shrink-0 bg-black/60 rounded-lg border border-neon-cyan/30 p-2 flex flex-col items-center gap-1">
          <Headphones className="w-4 h-4 text-neon-cyan" />
          <span className="text-[10px] font-bold text-neon-cyan">MASTER</span>

          {/* Spectrum visualization */}
          {spectrumData && (
            <div className="w-full h-12 flex items-end gap-px">
              {Array.from({ length: 16 }).map((_, i) => {
                const idx = Math.floor((i / 16) * spectrumData.length);
                const val = spectrumData[idx] / 255;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-neon-green via-neon-cyan to-neon-purple rounded-t"
                    style={{ height: `${val * 100}%`, opacity: 0.4 + val * 0.6 }}
                  />
                );
              })}
            </div>
          )}

          {/* Master fader */}
          <div className="flex items-stretch gap-1 h-28">
            <VUMeter value={masterBus.volume - 5 + Math.random() * 6} />
            <div
              className="w-3 bg-white/10 rounded-full relative cursor-ns-resize"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const y = 1 - (e.clientY - rect.top) / rect.height;
                const db = Math.round((y * 66 - 60) * 10) / 10;
                onMasterVolumeChange(Math.max(-60, Math.min(6, db)));
              }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div
                className="absolute bottom-0 w-full bg-gradient-to-t from-neon-green to-neon-cyan rounded-full transition-all"
                style={{ height: `${((masterBus.volume + 60) / 66) * 100}%` }}
              />
              {/* Master fader thumb */}
              <div
                className="absolute left-1/2 -translate-x-1/2 w-4 h-1.5 bg-white/80 rounded-full shadow"
                style={{ bottom: `${((masterBus.volume + 60) / 66) * 100}%` }}
              />
            </div>
            <VUMeter value={masterBus.volume - 6 + Math.random() * 6} />
          </div>

          <span className="text-[9px] text-gray-400 font-mono">
            {masterBus.volume > 0 ? '+' : ''}{masterBus.volume.toFixed(1)} dB
          </span>

          {/* Master inserts */}
          <div className="w-full space-y-0.5">
            {masterBus.inserts.map((fx, i) => (
              <div
                key={i}
                className={cn(
                  'px-1 py-0.5 rounded text-[8px] truncate',
                  fx.enabled ? 'bg-neon-cyan/10 text-neon-cyan' : 'bg-white/5 text-gray-600'
                )}
              >
                {fx.name || fx.type}
              </div>
            ))}
          </div>

          {/* LUFS meter */}
          <div className="w-full mt-1 px-1">
            <div className="text-[8px] text-gray-400 text-center">LUFS</div>
            <div className="text-center font-mono text-[10px] text-neon-green">
              {(masterBus.metering?.lufs ?? -14).toFixed(1)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
