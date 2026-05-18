'use client';

import { useState, useCallback } from 'react';
import { Zap, Download, Save, Activity, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { emitMasteringProcessDTU, emitExportDTU } from '@/lib/daw/dtu-hooks';
import { analyzeMastering, snapshotFromAnalysers, type MasteringAnalysisResult } from '@/lib/daw/mastering-analysis';
import AudioLoggerPanel from './AudioLoggerPanel';
import ChordDetectionPanel from './ChordDetectionPanel';
import type { MasteringChain, MasteringAnalysis, ExportSettings, EffectInstance } from '@/lib/daw/types';

interface MasteringPanelProps {
  chain: MasteringChain;
  analysis: MasteringAnalysis | null;
  projectId: string;
  projectTitle: string;
  spectrumData: Uint8Array | null;
  /** Tap on the master bus — used by the in-browser analyzer to
   *  capture a 2-3s snapshot of the live mix without rendering offline. */
  masterAnalysers?: AnalyserNode[] | null;
  /** Sample rate of the audio context. Default 44100. */
  sampleRate?: number;
  onUpdateChain: (chain: MasteringChain) => void;
  onAnalyze: () => void;
  onExport: (settings: ExportSettings) => void;
  isAnalyzing?: boolean;
  isExporting?: boolean;
}

interface CoachingResponse {
  ok: boolean;
  composer?: 'utility_brain' | 'deterministic';
  narrative?: string;
  suggestions?: Array<{ kind: string; severity: 'high' | 'medium' | 'low'; text: string }>;
}

function MeterBar({ value, min, max, label, unit, color = 'neon-cyan', target }: {
  value: number; min: number; max: number; label: string; unit: string; color?: string; target?: number;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const targetPct = target !== undefined ? Math.max(0, Math.min(100, ((target - min) / (max - min)) * 100)) : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-gray-400">{label}</span>
        <span className={`text-[10px] font-mono text-${color}`}>{value.toFixed(1)} {unit}</span>
      </div>
      <div className="h-2 bg-black/40 rounded-full relative overflow-hidden">
        <div className={`h-full bg-${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
        {targetPct !== null && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-white/60" style={{ left: `${targetPct}%` }} />
        )}
      </div>
    </div>
  );
}

export function MasteringPanel({
  chain,
  analysis,
  projectId,
  projectTitle,
  spectrumData,
  masterAnalysers,
  sampleRate = 44100,
  onUpdateChain,
  onAnalyze,
  onExport,
  isAnalyzing,
  isExporting,
}: MasteringPanelProps) {
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3' | 'flac' | 'ogg'>('wav');
  const [exportSampleRate, setExportSampleRate] = useState<44100 | 48000 | 88200 | 96000>(44100);
  const [exportBitDepth, setExportBitDepth] = useState<16 | 24 | 32>(24);
  const [exportNormalize, setExportNormalize] = useState(true);
  const [exportDithering, setExportDithering] = useState(true);
  const [exportStems, setExportStems] = useState(false);

  // Mastering Assistant — local BS.1770 analyser result + brain
  // coaching narrative. Local result is what we render meters from;
  // coaching is what the producer reads.
  const [localAnalysis, setLocalAnalysis] = useState<MasteringAnalysisResult | null>(null);
  const [coaching, setCoaching] = useState<CoachingResponse | null>(null);
  const [isCoaching, setIsCoaching] = useState(false);

  const runLocalAnalysisAndCoach = useCallback(async () => {
    onAnalyze(); // keep host-side hooks (downstream meters etc.) in sync
    if (!masterAnalysers || masterAnalysers.length === 0) {
      // No live tap — skip analyser, ask for deterministic-only coaching
      // if there's an upstream analysis we can repackage.
      if (!analysis) return;
      setIsCoaching(true);
      try {
        const r = await fetch('/api/lens/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            domain: 'studio',
            name: 'coach_mastering',
            input: {
              targetLUFS: chain.loudnessTarget,
              summary: {
                integratedLUFS: analysis.integratedLUFS,
                truePeak: analysis.truePeak,
                dynamicRange: analysis.dynamicRange,
                hottestBand: 'mid',
                quietestBand: 'air',
                imbalances: [],
                loudnessVsTarget: analysis.integratedLUFS - chain.loudnessTarget,
              },
            },
          }),
        });
        const json = await r.json();
        setCoaching(json?.result || json);
      } catch {
        setCoaching({ ok: false });
      } finally {
        setIsCoaching(false);
      }
      return;
    }
    // Live tap: capture, analyse, then coach.
    const channels = snapshotFromAnalysers(masterAnalysers);
    const result = analyzeMastering(channels, sampleRate, { targetLUFS: chain.loudnessTarget });
    setLocalAnalysis(result);
    setIsCoaching(true);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio',
          name: 'coach_mastering',
          input: { summary: result.summary, targetLUFS: chain.loudnessTarget },
        }),
      });
      const json = await r.json();
      setCoaching(json?.result || json);
    } catch {
      setCoaching({ ok: false });
    } finally {
      setIsCoaching(false);
    }
  }, [analysis, chain.loudnessTarget, masterAnalysers, onAnalyze, sampleRate]);

  const handleExport = useCallback(() => {
    const settings: ExportSettings = {
      format: exportFormat,
      sampleRate: exportSampleRate,
      bitDepth: exportBitDepth,
      normalize: exportNormalize,
      dithering: exportDithering,
      stems: exportStems,
      startBeat: 0,
      endBeat: -1,
    };
    emitExportDTU(settings, projectId, projectTitle);
    onExport(settings);
  }, [exportFormat, exportSampleRate, exportBitDepth, exportNormalize, exportDithering, exportStems, projectId, projectTitle, onExport]);

  const handleSaveChainAsDTU = useCallback(() => {
    emitMasteringProcessDTU(chain, analysis ? {
      integratedLUFS: analysis.integratedLUFS,
      truePeak: analysis.truePeak,
      dynamicRange: analysis.dynamicRange,
    } : null);
  }, [chain, analysis]);

  const updateEffect = useCallback((key: keyof MasteringChain, effect: EffectInstance) => {
    onUpdateChain({ ...chain, [key]: effect });
  }, [chain, onUpdateChain]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-neon-green" />
          <h2 className="text-lg font-bold">Mastering</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveChainAsDTU}
            className="flex items-center gap-1 text-[10px] px-2 py-1 bg-neon-cyan/10 text-neon-cyan rounded hover:bg-neon-cyan/20"
          >
            <Save className="w-3 h-3" /> Save Chain as DTU
          </button>
          <button
            onClick={runLocalAnalysisAndCoach}
            disabled={isAnalyzing || isCoaching}
            className="flex items-center gap-1 text-[10px] px-2 py-1 bg-neon-green/10 text-neon-green rounded hover:bg-neon-green/20 disabled:opacity-50"
          >
            <Activity className={cn('w-3 h-3', (isAnalyzing || isCoaching) && 'animate-pulse')} />
            {isCoaching ? 'Coaching...' : isAnalyzing ? 'Analyzing...' : 'Analyze + Coach'}
          </button>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onUpdateChain({ ...chain, enabled: !chain.enabled })}
          className={cn('px-3 py-1 rounded text-xs font-medium', chain.enabled ? 'bg-neon-green/20 text-neon-green' : 'bg-white/10 text-gray-500')}
        >
          {chain.enabled ? 'Enabled' : 'Bypassed'}
        </button>
        <span className="text-xs text-gray-500">
          Target: {chain.loudnessTarget} LUFS
        </span>
        <input
          type="range"
          min={-24}
          max={-6}
          value={chain.loudnessTarget}
          onChange={e => onUpdateChain({ ...chain, loudnessTarget: parseFloat(e.target.value) })}
          className="w-24 h-0.5 accent-neon-green"
        />
      </div>

      {/* Mastering chain */}
      <div className="grid grid-cols-2 gap-3">
        {/* EQ */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400">EQ</span>
            <button
              onClick={() => updateEffect('eq', { ...chain.eq, enabled: !chain.eq.enabled })}
              className={cn('text-[10px] px-2 py-0.5 rounded', chain.eq.enabled ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/10 text-gray-500')}
            >
              {chain.eq.enabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="space-y-1">
            {['lowGain', 'midGain', 'highGain'].map(param => (
              <div key={param} className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-10 capitalize">{param.replace('Gain', '')}</span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={0.1}
                  value={Number(chain.eq.params[param]) || 0}
                  onChange={e => updateEffect('eq', { ...chain.eq, params: { ...chain.eq.params, [param]: parseFloat(e.target.value) } })}
                  className="flex-1 h-0.5 accent-neon-cyan"
                />
                <span className="text-[9px] text-gray-400 w-10 text-right font-mono">{Number(chain.eq.params[param] || 0).toFixed(1)}dB</span>
              </div>
            ))}
          </div>
        </div>

        {/* Multiband Compressor */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400">Multiband Comp</span>
            <button
              onClick={() => updateEffect('multibandCompressor', { ...chain.multibandCompressor, enabled: !chain.multibandCompressor.enabled })}
              className={cn('text-[10px] px-2 py-0.5 rounded', chain.multibandCompressor.enabled ? 'bg-neon-purple/20 text-neon-purple' : 'bg-white/10 text-gray-500')}
            >
              {chain.multibandCompressor.enabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="space-y-1">
            {['threshold', 'ratio', 'attack', 'release'].map(param => (
              <div key={param} className="flex items-center gap-2">
                <span className="text-[9px] text-gray-500 w-10 capitalize">{param.slice(0, 5)}</span>
                <input
                  type="range"
                  min={param === 'threshold' ? -60 : param === 'ratio' ? 1 : 0}
                  max={param === 'threshold' ? 0 : param === 'ratio' ? 20 : 1}
                  step={0.01}
                  value={Number(chain.multibandCompressor.params[param]) || 0}
                  onChange={e => updateEffect('multibandCompressor', { ...chain.multibandCompressor, params: { ...chain.multibandCompressor.params, [param]: parseFloat(e.target.value) } })}
                  className="flex-1 h-0.5 accent-neon-purple"
                />
                <span className="text-[9px] text-gray-400 w-10 text-right font-mono">{Number(chain.multibandCompressor.params[param] || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stereo Widener */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400">Stereo Width</span>
            <button
              onClick={() => updateEffect('stereoWidener', { ...chain.stereoWidener, enabled: !chain.stereoWidener.enabled })}
              className={cn('text-[10px] px-2 py-0.5 rounded', chain.stereoWidener.enabled ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/10 text-gray-500')}
            >
              {chain.stereoWidener.enabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500 w-10">Width</span>
            <input
              type="range"
              min={0} max={2} step={0.01}
              value={Number(chain.stereoWidener.params.width) || 1}
              onChange={e => updateEffect('stereoWidener', { ...chain.stereoWidener, params: { ...chain.stereoWidener.params, width: parseFloat(e.target.value) } })}
              className="flex-1 h-0.5 accent-neon-pink"
            />
            <span className="text-[9px] text-gray-400 w-10 text-right font-mono">{((Number(chain.stereoWidener.params.width) || 1) * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* Limiter */}
        <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-400">Limiter</span>
            <button
              onClick={() => updateEffect('limiter', { ...chain.limiter, enabled: !chain.limiter.enabled })}
              className={cn('text-[10px] px-2 py-0.5 rounded', chain.limiter.enabled ? 'bg-neon-green/20 text-neon-green' : 'bg-white/10 text-gray-500')}
            >
              {chain.limiter.enabled ? 'On' : 'Off'}
            </button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-10">Ceil</span>
              <input
                type="range"
                min={-6} max={0} step={0.1}
                value={Number(chain.limiter.params.ceiling) || -1}
                onChange={e => updateEffect('limiter', { ...chain.limiter, params: { ...chain.limiter.params, ceiling: parseFloat(e.target.value) } })}
                className="flex-1 h-0.5 accent-neon-green"
              />
              <span className="text-[9px] text-gray-400 w-10 text-right font-mono">{Number(chain.limiter.params.ceiling || -1).toFixed(1)}dB</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-10">Rel</span>
              <input
                type="range"
                min={0.01} max={1} step={0.01}
                value={Number(chain.limiter.params.release) || 0.1}
                onChange={e => updateEffect('limiter', { ...chain.limiter, params: { ...chain.limiter.params, release: parseFloat(e.target.value) } })}
                className="flex-1 h-0.5 accent-neon-green"
              />
              <span className="text-[9px] text-gray-400 w-10 text-right font-mono">{(Number(chain.limiter.params.release || 0.1) * 1000).toFixed(0)}ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* Analysis */}
      {analysis && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
          <h3 className="text-xs font-semibold text-gray-400 uppercase">Loudness Analysis</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-neon-green font-mono">{analysis.integratedLUFS.toFixed(1)}</div>
              <div className="text-[10px] text-gray-400">Integrated LUFS</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-neon-cyan font-mono">{analysis.truePeak.toFixed(1)}</div>
              <div className="text-[10px] text-gray-400">True Peak dBTP</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-neon-purple font-mono">{analysis.dynamicRange.toFixed(1)}</div>
              <div className="text-[10px] text-gray-400">Dynamic Range dB</div>
            </div>
          </div>
          <MeterBar value={analysis.integratedLUFS} min={-24} max={0} label="Integrated LUFS" unit="LUFS" color="neon-green" target={chain.loudnessTarget} />
          <MeterBar value={analysis.truePeak} min={-6} max={3} label="True Peak" unit="dBTP" color="neon-cyan" target={-1} />
          <MeterBar value={analysis.dynamicRange} min={0} max={20} label="Dynamic Range" unit="dB" color="neon-purple" />
          <MeterBar value={analysis.stereoCorrelation} min={-1} max={1} label="Stereo Correlation" unit="" color="neon-pink" />
        </div>
      )}

      {/* Coaching narrative from utility brain (deterministic fallback) */}
      {(coaching || localAnalysis) && (
        <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-neon-purple" />
            <h3 className="text-xs font-semibold text-gray-400 uppercase">Mastering Coach</h3>
            {coaching?.composer && (
              <span className="text-[9px] text-gray-500">
                ({coaching.composer === 'utility_brain' ? 'AI coach' : 'auto-readout'})
              </span>
            )}
          </div>
          {coaching?.narrative && (
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">{coaching.narrative}</p>
          )}
          {coaching?.suggestions && coaching.suggestions.length > 0 && (
            <ul className="space-y-1.5">
              {coaching.suggestions.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0',
                    s.severity === 'high' ? 'bg-red-400'
                      : s.severity === 'medium' ? 'bg-yellow-400'
                      : 'bg-neon-green'
                  )} />
                  <span className="text-gray-300">{s.text}</span>
                </li>
              ))}
            </ul>
          )}
          {localAnalysis && (
            <div className="pt-2 border-t border-white/5">
              <div className="text-[9px] text-gray-500 uppercase mb-1.5">Per-band balance</div>
              <div className="grid grid-cols-8 gap-1">
                {localAnalysis.spectralBalance.map(b => (
                  <div key={b.name} className="text-center">
                    <div className="text-[8px] text-gray-500 capitalize">{b.name}</div>
                    <div
                      className={cn(
                        'text-[9px] font-mono mt-0.5',
                        Math.abs(b.relativeDb) >= 4 ? 'text-yellow-400' : 'text-gray-300'
                      )}
                    >
                      {b.relativeDb > 0 ? '+' : ''}{b.relativeDb.toFixed(1)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Always-on Audio Logger (Sprint C #8) — captures master bus
          into a local IndexedDB rolling buffer, opt-in + privacy-safe. */}
      <AudioLoggerPanel masterAnalyser={masterAnalysers?.[0]} />

      {/* Chord detection panel (Sprint C #2) — pure-JS chroma + 24-template
          matching, top-3 candidates with confidence bars. Accuracy lifts
          when the harmonic stem from Item #4's splitter feeds this. */}
      <ChordDetectionPanel masterAnalyser={masterAnalysers?.[0]} sampleRate={sampleRate} />

      {/* Spectrum */}
      {spectrumData && (
        <div className="bg-white/5 rounded-xl p-3 border border-white/10">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-2">Spectrum</h3>
          <div className="h-20 flex items-end gap-px">
            {Array.from({ length: 32 }).map((_, i) => {
              const idx = Math.floor((i / 32) * spectrumData.length);
              const val = spectrumData[idx] / 255;
              return (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-neon-green via-neon-cyan to-neon-purple rounded-t transition-all duration-75"
                  style={{ height: `${val * 100}%`, opacity: 0.4 + val * 0.6 }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[8px] text-gray-600 mt-1">
            <span>20Hz</span>
            <span>200Hz</span>
            <span>2kHz</span>
            <span>20kHz</span>
          </div>
        </div>
      )}

      {/* Export */}
      <div className="bg-white/5 rounded-xl p-4 border border-white/10 space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-2">
          <Download className="w-3.5 h-3.5" /> Export
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Format</label>
            <div className="flex gap-1">
              {(['wav', 'mp3', 'flac', 'ogg'] as const).map(fmt => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  className={cn('px-2 py-1 rounded text-[10px] uppercase', exportFormat === fmt ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-500 hover:text-white')}
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Sample Rate</label>
            <div className="flex gap-1">
              {([44100, 48000, 96000] as const).map(sr => (
                <button
                  key={sr}
                  onClick={() => setExportSampleRate(sr)}
                  className={cn('px-2 py-1 rounded text-[10px]', exportSampleRate === sr ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-500 hover:text-white')}
                >
                  {sr / 1000}k
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Bit Depth</label>
            <div className="flex gap-1">
              {([16, 24, 32] as const).map(bd => (
                <button
                  key={bd}
                  onClick={() => setExportBitDepth(bd)}
                  className={cn('px-2 py-1 rounded text-[10px]', exportBitDepth === bd ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-500 hover:text-white')}
                >
                  {bd}-bit
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer">
              <input type="checkbox" checked={exportNormalize} onChange={e => setExportNormalize(e.target.checked)} className="accent-neon-cyan" />
              Normalize
            </label>
            <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer">
              <input type="checkbox" checked={exportDithering} onChange={e => setExportDithering(e.target.checked)} className="accent-neon-cyan" />
              Dithering
            </label>
            <label className="flex items-center gap-2 text-[10px] text-gray-400 cursor-pointer">
              <input type="checkbox" checked={exportStems} onChange={e => setExportStems(e.target.checked)} className="accent-neon-cyan" />
              Export Stems
            </label>
          </div>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full py-2 bg-neon-green/20 text-neon-green rounded-lg text-sm font-medium hover:bg-neon-green/30 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          <Download className={cn('w-4 h-4', isExporting && 'animate-pulse')} />
          {isExporting ? 'Exporting...' : `Export ${exportFormat.toUpperCase()}`}
        </button>
      </div>
    </div>
  );
}
