'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * EegWorkbench — EEGLAB / MNE-Python parity surface for the neuro lens.
 *
 * Every value rendered here comes from a real backend macro on the
 * `neuro` domain: signal import, waveform viewer, topographic scalp maps,
 * the preprocessing pipeline, epoching, time-frequency (spectrogram),
 * source localization and statistical testing. There is no synthetic /
 * demo data — the user imports a real EEG/MEG recording (EDF/FIF JSON or
 * CSV) and every analysis runs on that recording server-side.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload, Waves, Map as MapIcon, Filter, Scissors, Grid3x3,
  Crosshair, FlaskConical, Trash2, Loader2, Check, AlertTriangle, FileUp,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

// ── Macro envelope types ──────────────────────────────────────────────
interface RecordingSummary {
  id: string; name: string; format: string; sampleRate: number;
  channelCount: number; sampleCount: number; durationSec: number;
  eventCount: number; importedAt: string;
}
interface ImportResult extends RecordingSummary { channelNames: string[]; recordingId: string }
interface Trace { channel: string; points: { t: number; v: number }[]; min: number; max: number; mean: number }
interface WaveformResult {
  recordingId: string; startSec: number; windowSec: number; stride: number;
  sampleRate: number; durationSec: number; channelCount: number;
  traces: Trace[]; events: { id: string; label: string; t: number }[];
}
interface Electrode { channel: string; x: number; y: number; value: number; normalized: number }
interface TopoResult {
  recordingId: string; metric: string; electrodes: Electrode[];
  gridSize: number; grid: (number | null)[][];
  range: { min: number; max: number }; mappedChannels: number; unmappedChannels: number;
}
interface IcaComponent { component: string; sourceChannel: string; varianceExplained: number; kurtosis: number }
interface PreprocessResult {
  recordingId: string; derivedFrom: string; pipeline: string[];
  stepCount: number; channelCount: number; sampleCount: number;
  icaComponents: IcaComponent[] | null;
}
interface EpochResult {
  recordingId: string; channel: string; condition: string;
  epochCount: number; rejectedCount: number; epochLength: number;
  sampleRate: number; preMs: number; postMs: number; baselineMs: number;
  timeMs: number[]; grandAverage: number[];
  epochs: { onset: number; condition: string; label: string; samples: number[] }[];
}
interface TfResult {
  recordingId: string; channel: string; windowSize: number; hop: number;
  sampleRate: number; frequencies: number[]; times: number[];
  spectrogram: number[][]; dbRange: { min: number; max: number };
  frameCount: number; freqBinCount: number;
}
interface SourceResult {
  recordingId: string; method: string; sensorCount: number; gridSize: number;
  dipoles: { x: number; y: number; strength: number }[];
  peakSources: { x: number; y: number; strength: number; region: string }[];
}
interface StatResult {
  test: string;
  groupA: { n: number; mean: number; sd: number };
  groupB: { n: number; mean: number; sd: number };
  tStatistic: number; degreesOfFreedom: number; pValue: number;
  significance: string; significant: boolean;
  cohensD: number; effectSize: string; meanDifference: number;
}

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type Tab = 'import' | 'waveform' | 'topo' | 'preprocess' | 'epoch' | 'tf' | 'source' | 'stats';

const TABS: { id: Tab; label: string; icon: typeof Upload }[] = [
  { id: 'import', label: 'Import', icon: Upload },
  { id: 'waveform', label: 'Waveform', icon: Waves },
  { id: 'topo', label: 'Scalp Map', icon: MapIcon },
  { id: 'preprocess', label: 'Preprocess', icon: Filter },
  { id: 'epoch', label: 'Epoch', icon: Scissors },
  { id: 'tf', label: 'Time-Freq', icon: Grid3x3 },
  { id: 'source', label: 'Source', icon: Crosshair },
  { id: 'stats', label: 'Statistics', icon: FlaskConical },
];

// Heat colour for a normalized [0,1] scalar — blue → green → red.
function heat(v: number | null): string {
  if (v === null || Number.isNaN(v)) return 'transparent';
  const c = Math.max(0, Math.min(1, v));
  const r = Math.round(255 * Math.min(1, c * 2));
  const b = Math.round(255 * Math.min(1, (1 - c) * 2));
  const g = Math.round(255 * (1 - Math.abs(c - 0.5) * 2));
  return `rgb(${r},${g},${b})`;
}
function dbHeat(v: number, lo: number, hi: number): string {
  return heat(hi > lo ? (v - lo) / (hi - lo) : 0.5);
}

export function EegWorkbench() {
  const [tab, setTab] = useState<Tab>('import');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const active = recordings.find((r) => r.id === activeId) || null;

  // import form
  const [importFormat, setImportFormat] = useState<'csv' | 'edf-json' | 'fif-json'>('csv');
  const [importName, setImportName] = useState('');
  const [importText, setImportText] = useState('');
  const [importSampleRate, setImportSampleRate] = useState('256');
  const [importEvents, setImportEvents] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // waveform
  const [wfStart, setWfStart] = useState('0');
  const [wfWindow, setWfWindow] = useState('4');
  const [waveform, setWaveform] = useState<WaveformResult | null>(null);

  // topo
  const [topoBand, setTopoBand] = useState<string>('');
  const [topo, setTopo] = useState<TopoResult | null>(null);

  // preprocess
  const [ppBandLow, setPpBandLow] = useState('1');
  const [ppBandHigh, setPpBandHigh] = useState('40');
  const [ppNotch, setPpNotch] = useState('50');
  const [ppReref, setPpReref] = useState(true);
  const [ppArtifact, setPpArtifact] = useState('100');
  const [preproc, setPreproc] = useState<PreprocessResult | null>(null);

  // epoch
  const [epPre, setEpPre] = useState('200');
  const [epPost, setEpPost] = useState('800');
  const [epCondition, setEpCondition] = useState('');
  const [epoch, setEpoch] = useState<EpochResult | null>(null);

  // time-freq
  const [tfChannel, setTfChannel] = useState('');
  const [tfMaxFreq, setTfMaxFreq] = useState('50');
  const [tf, setTf] = useState<TfResult | null>(null);

  // source
  const [source, setSource] = useState<SourceResult | null>(null);

  // stats
  const [statA, setStatA] = useState('');
  const [statB, setStatB] = useState('');
  const [stat, setStat] = useState<StatResult | null>(null);

  const ok = (t: string) => setFeedback({ kind: 'ok', text: t });
  const err = (t: string) => setFeedback({ kind: 'err', text: t });

  const refreshRecordings = useCallback(async () => {
    const r = await lensRun('neuro', 'listRecordings', {});
    if (r.data?.ok && r.data.result) {
      const recs = (r.data.result as { recordings: RecordingSummary[] }).recordings || [];
      setRecordings(recs);
      setActiveId((cur) => (cur && recs.some((x) => x.id === cur) ? cur : recs[0]?.id || ''));
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refreshRecordings(); }, []);

  // ── Import ──────────────────────────────────────────────────────────
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      if (f.name.toLowerCase().endsWith('.json')) {
        setImportFormat(f.name.toLowerCase().includes('fif') ? 'fif-json' : 'edf-json');
        setImportText(text);
      } else {
        setImportFormat('csv');
        setImportText(text);
      }
    };
    reader.readAsText(f);
  };

  const parseEvents = (): { label: string; sampleIndex: number; condition: string }[] => {
    // user enters "label,sampleIndex,condition" per line
    return importText && importEvents
      ? importEvents.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean).map((ln, i) => {
        const [label, idx, cond] = ln.split(',').map((s) => s.trim());
        return {
          label: label || `event ${i + 1}`,
          sampleIndex: Number(idx) || 0,
          condition: cond || 'default',
        };
      })
      : [];
  };

  const doImport = async () => {
    if (!importText.trim()) { err('Provide signal data — upload a file or paste CSV/JSON.'); return; }
    setBusy('import'); setFeedback(null);
    try {
      const params: Record<string, unknown> = {
        format: importFormat,
        name: importName || 'recording',
        sampleRate: Number(importSampleRate) || 256,
        events: parseEvents(),
      };
      if (importFormat === 'csv') {
        params.text = importText;
      } else {
        try { params.payload = JSON.parse(importText); }
        catch { err('JSON payload could not be parsed.'); setBusy(null); return; }
      }
      const r = await lensRun<ImportResult>('neuro', 'importSignal', params);
      if (r.data?.ok && r.data.result) {
        ok(`Imported "${r.data.result.name}" — ${r.data.result.channelCount} ch · ${r.data.result.durationSec}s.`);
        await refreshRecordings();
        setActiveId(r.data.result.recordingId);
        setImportText(''); setImportName(''); setImportEvents('');
      } else err(r.data?.error || 'Import failed.');
    } catch (e: any) { err(e?.message || 'Import failed.'); }
    finally { setBusy(null); }
  };

  const doDelete = async (id: string) => {
    setBusy('delete'); setFeedback(null);
    try {
      const r = await lensRun('neuro', 'deleteRecording', { recordingId: id });
      if (r.data?.ok) { ok('Recording deleted.'); await refreshRecordings(); }
      else err(r.data?.error || 'Delete failed.');
    } catch (e: any) { err(e?.message || 'Delete failed.'); }
    finally { setBusy(null); }
  };

  // ── Waveform ────────────────────────────────────────────────────────
  const doWaveform = async () => {
    if (!activeId) { err('Select a recording first.'); return; }
    setBusy('waveform'); setFeedback(null);
    try {
      const r = await lensRun<WaveformResult>('neuro', 'waveformWindow', {
        recordingId: activeId,
        startSec: Number(wfStart) || 0,
        windowSec: Number(wfWindow) || 4,
        maxPoints: 1200,
      });
      if (r.data?.ok && r.data.result) { setWaveform(r.data.result); ok(`${r.data.result.channelCount} traces.`); }
      else err(r.data?.error || 'Waveform failed.');
    } catch (e: any) { err(e?.message || 'Waveform failed.'); }
    finally { setBusy(null); }
  };

  // ── Topographic map ─────────────────────────────────────────────────
  const doTopo = async () => {
    if (!activeId) { err('Select a recording first.'); return; }
    setBusy('topo'); setFeedback(null);
    try {
      const params: Record<string, unknown> = { recordingId: activeId, gridSize: 28 };
      if (topoBand) params.band = topoBand;
      const r = await lensRun<TopoResult>('neuro', 'topographicMap', params);
      if (r.data?.ok && r.data.result) { setTopo(r.data.result); ok(`${r.data.result.mappedChannels} electrodes mapped.`); }
      else err(r.data?.error || 'Topographic map failed.');
    } catch (e: any) { err(e?.message || 'Topographic map failed.'); }
    finally { setBusy(null); }
  };

  // ── Preprocess ──────────────────────────────────────────────────────
  const doPreprocess = async () => {
    if (!activeId) { err('Select a recording first.'); return; }
    setBusy('preprocess'); setFeedback(null);
    const steps: Record<string, unknown>[] = [];
    if (ppBandLow && ppBandHigh) steps.push({ kind: 'bandpass', low: Number(ppBandLow), high: Number(ppBandHigh) });
    if (ppNotch) steps.push({ kind: 'notch', freq: Number(ppNotch) });
    if (ppArtifact) steps.push({ kind: 'artifact-reject', threshold: Number(ppArtifact) });
    if (ppReref) steps.push({ kind: 'reref', mode: 'average' });
    if (steps.length === 0) { err('Enable at least one preprocessing step.'); return; }
    try {
      const r = await lensRun<PreprocessResult>('neuro', 'preprocess', { recordingId: activeId, steps });
      if (r.data?.ok && r.data.result) {
        setPreproc(r.data.result);
        ok(`Pipeline applied (${r.data.result.stepCount} steps) → new recording.`);
        await refreshRecordings();
        setActiveId(r.data.result.recordingId);
      } else err(r.data?.error || 'Preprocess failed.');
    } catch (e: any) { err(e?.message || 'Preprocess failed.'); }
    finally { setBusy(null); }
  };

  // ── Epoch ───────────────────────────────────────────────────────────
  const doEpoch = async () => {
    if (!activeId) { err('Select a recording first.'); return; }
    setBusy('epoch'); setFeedback(null);
    try {
      const params: Record<string, unknown> = {
        recordingId: activeId,
        preMs: Number(epPre) || 200,
        postMs: Number(epPost) || 800,
      };
      if (epCondition) params.condition = epCondition;
      const r = await lensRun<EpochResult>('neuro', 'epochData', params);
      if (r.data?.ok && r.data.result) { setEpoch(r.data.result); ok(`${r.data.result.epochCount} epochs (${r.data.result.rejectedCount} rejected).`); }
      else err(r.data?.error || 'Epoching failed.');
    } catch (e: any) { err(e?.message || 'Epoching failed.'); }
    finally { setBusy(null); }
  };

  // run ERP analysis on the epoched data
  const doErp = async () => {
    if (!epoch) { err('Epoch the data first.'); return; }
    setBusy('erp'); setFeedback(null);
    try {
      const r = await lensRun('neuro', 'erpAnalysis', {
        artifact: { data: { epochs: epoch.epochs, sampleRate: epoch.sampleRate } },
        epochs: epoch.epochs, sampleRate: epoch.sampleRate,
      });
      const result = r.data?.result as { identifiedComponents?: { component: string; latencyMs: number }[]; snrQuality?: string } | null;
      if (r.data?.ok && result) {
        const comps = result.identifiedComponents?.map((c) => `${c.component}@${c.latencyMs}ms`).join(', ') || 'none';
        ok(`ERP components: ${comps} · SNR ${result.snrQuality || '-'}.`);
      } else err(r.data?.error || 'ERP analysis failed.');
    } catch (e: any) { err(e?.message || 'ERP analysis failed.'); }
    finally { setBusy(null); }
  };

  // ── Time-frequency ──────────────────────────────────────────────────
  const doTf = async () => {
    if (!activeId) { err('Select a recording first.'); return; }
    setBusy('tf'); setFeedback(null);
    try {
      const params: Record<string, unknown> = { recordingId: activeId, maxFreq: Number(tfMaxFreq) || 50 };
      if (tfChannel) params.channel = tfChannel;
      const r = await lensRun<TfResult>('neuro', 'timeFrequency', params);
      if (r.data?.ok && r.data.result) { setTf(r.data.result); ok(`${r.data.result.frameCount} frames × ${r.data.result.freqBinCount} bins.`); }
      else err(r.data?.error || 'Time-frequency failed.');
    } catch (e: any) { err(e?.message || 'Time-frequency failed.'); }
    finally { setBusy(null); }
  };

  // ── Source localization ─────────────────────────────────────────────
  const doSource = async () => {
    if (!activeId) { err('Select a recording first.'); return; }
    setBusy('source'); setFeedback(null);
    try {
      const r = await lensRun<SourceResult>('neuro', 'sourceLocalization', { recordingId: activeId });
      if (r.data?.ok && r.data.result) { setSource(r.data.result); ok(`${r.data.result.peakSources.length} peak sources.`); }
      else err(r.data?.error || 'Source localization failed.');
    } catch (e: any) { err(e?.message || 'Source localization failed.'); }
    finally { setBusy(null); }
  };

  // ── Statistics ──────────────────────────────────────────────────────
  const doStats = async () => {
    setBusy('stats'); setFeedback(null);
    const parse = (s: string) => s.split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const groupA = parse(statA);
    const groupB = parse(statB);
    if (groupA.length < 2 || groupB.length < 2) { err('Each group needs at least 2 numeric values.'); return; }
    try {
      const r = await lensRun<StatResult>('neuro', 'statisticalTest', { groupA, groupB });
      if (r.data?.ok && r.data.result) { setStat(r.data.result); ok(r.data.result.significance); }
      else err(r.data?.error || 'Statistical test failed.');
    } catch (e: any) { err(e?.message || 'Statistical test failed.'); }
    finally { setBusy(null); }
  };

  // pull means from the active epoch grand-average so stats use real data
  const loadEpochIntoStats = () => {
    if (!epoch) { err('Epoch the data first to populate group A.'); return; }
    setStatA(epoch.epochs.map((e) => {
      const s = e.samples;
      return (s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)).toFixed(4);
    }).join(', '));
    ok(`Loaded ${epoch.epochs.length} epoch means into group A.`);
  };

  // ── Render helpers ──────────────────────────────────────────────────
  const inputCls = 'bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-[12px] text-white w-full';
  const labelCls = 'text-[10px] uppercase tracking-wider text-zinc-400 mb-1 block';
  const btnCls = 'flex items-center gap-1.5 rounded-md bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-[12px] font-semibold text-white transition-colors';

  return (
    <div className="rounded-lg border border-purple-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-purple-500/10 pb-2">
        <Waves className="h-4 w-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-white">EEG / MEG Workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">EEGLAB / MNE parity</span>
        {active && (
          <span className="ml-auto text-[11px] text-zinc-400 font-mono">
            {active.name} · {active.channelCount}ch · {active.sampleRate}Hz · {active.durationSec}s · {active.eventCount} events
          </span>
        )}
      </header>

      {/* recording selector */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={labelCls + ' !mb-0'}>Recording</span>
        <select value={activeId} onChange={(e) => setActiveId(e.target.value)} className={cn(inputCls, 'w-auto min-w-[220px]')}>
          <option value="">— none imported —</option>
          {recordings.map((r) => (
            <option key={r.id} value={r.id}>{r.name} ({r.channelCount}ch · {r.durationSec}s)</option>
          ))}
        </select>
        {activeId && (
          <button type="button" onClick={() => doDelete(activeId)} disabled={!!busy} className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-red-300 hover:bg-red-500/20 disabled:opacity-40" aria-label="Delete recording">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* tab nav */}
      <nav className="flex items-center gap-1 flex-wrap border-b border-zinc-800 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
                tab === t.id ? 'bg-purple-500/20 text-purple-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white')}>
              <Icon className="h-3.5 w-3.5" />{t.label}
            </button>
          );
        })}
      </nav>

      {/* ── Import ─────────────────────────────────────────────────── */}
      {tab === 'import' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div>
              <label className={labelCls}>Format</label>
              <select value={importFormat} onChange={(e) => setImportFormat(e.target.value as typeof importFormat)} className={inputCls}>
                <option value="csv">CSV (channels × samples)</option>
                <option value="edf-json">EDF (JSON export)</option>
                <option value="fif-json">FIF (JSON export)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Recording name</label>
              <input value={importName} onChange={(e) => setImportName(e.target.value)} className={inputCls} placeholder="subject-01 rest" />
            </div>
            <div>
              <label className={labelCls}>Sample rate (Hz)</label>
              <input value={importSampleRate} onChange={(e) => setImportSampleRate(e.target.value)} className={inputCls} type="number" />
            </div>
            <div className="flex items-end">
              <button type="button" onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-800 w-full justify-center">
                <FileUp className="h-3.5 w-3.5" /> Upload file
              </button>
              <input ref={fileRef} type="file" accept=".csv,.txt,.json,.tsv" className="hidden" onChange={onFile} />
            </div>
          </div>
          <div>
            <label className={labelCls}>
              {importFormat === 'csv'
                ? 'CSV data — header row of channel names (Fz, Cz, Pz…), each row a sample'
                : 'JSON payload — { channels: [{ name, samples }], sampleRate }'}
            </label>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={6}
              className={cn(inputCls, 'font-mono text-[11px] resize-y')}
              placeholder={importFormat === 'csv' ? 'Fz,Cz,Pz\n0.12,-0.04,0.31\n0.18,-0.02,0.27' : '{"channels":[{"name":"Fz","samples":[0.1,0.2]}],"sampleRate":256}'} />
          </div>
          <div>
            <label className={labelCls}>Event markers (optional) — one per line: label,sampleIndex,condition</label>
            <textarea value={importEvents} onChange={(e) => setImportEvents(e.target.value)} rows={2}
              className={cn(inputCls, 'font-mono text-[11px] resize-y')} placeholder={'target,512,oddball\nstandard,768,standard'} />
          </div>
          <button type="button" onClick={doImport} disabled={busy === 'import'} className={btnCls}>
            {busy === 'import' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Import signal
          </button>

          {recordings.length > 0 && (
            <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Imported recordings ({recordings.length})</div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {recordings.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-[11px] text-zinc-300">
                    <span className="font-mono flex-1 truncate">{r.name}</span>
                    <span className="text-zinc-400">{r.format}</span>
                    <span className="text-zinc-400">{r.channelCount}ch</span>
                    <span className="text-zinc-400">{r.sampleCount} samp</span>
                    <span className="text-zinc-400">{r.eventCount} ev</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Waveform ───────────────────────────────────────────────── */}
      {tab === 'waveform' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div><label className={labelCls}>Start (s)</label><input value={wfStart} onChange={(e) => setWfStart(e.target.value)} type="number" className={cn(inputCls, 'w-24')} /></div>
            <div><label className={labelCls}>Window (s)</label><input value={wfWindow} onChange={(e) => setWfWindow(e.target.value)} type="number" className={cn(inputCls, 'w-24')} /></div>
            <button type="button" onClick={doWaveform} disabled={busy === 'waveform' || !activeId} className={btnCls}>
              {busy === 'waveform' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Waves className="h-3.5 w-3.5" />}
              Load window
            </button>
          </div>
          {waveform && (
            <div className="space-y-3">
              <div className="text-[11px] text-zinc-400 font-mono">
                {waveform.startSec}s – {(waveform.startSec + waveform.windowSec).toFixed(1)}s · stride {waveform.stride} · {waveform.events.length} events in window
              </div>
              {waveform.traces.map((tr) => (
                <div key={tr.channel} className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-mono uppercase tracking-wider text-purple-300">{tr.channel}</span>
                    <span className="text-zinc-400 font-mono">min {tr.min} · mean {tr.mean} · max {tr.max}</span>
                  </div>
                  <ChartKit kind="line" data={tr.points as unknown as Record<string, unknown>[]} xKey="t"
                    series={[{ key: 'v', label: tr.channel, color: '#a855f7' }]} height={90} showLegend={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Topographic scalp map ──────────────────────────────────── */}
      {tab === 'topo' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className={labelCls}>Metric</label>
              <select value={topoBand} onChange={(e) => setTopoBand(e.target.value)} className={cn(inputCls, 'w-44')}>
                <option value="">RMS amplitude</option>
                <option value="delta">Delta band power</option>
                <option value="theta">Theta band power</option>
                <option value="alpha">Alpha band power</option>
                <option value="beta">Beta band power</option>
                <option value="gamma">Gamma band power</option>
              </select>
            </div>
            <button type="button" onClick={doTopo} disabled={busy === 'topo' || !activeId} className={btnCls}>
              {busy === 'topo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapIcon className="h-3.5 w-3.5" />}
              Render scalp map
            </button>
          </div>
          {topo && (
            <div className="flex flex-wrap gap-4 items-start">
              <div className="relative" style={{ width: 280, height: 280 }}>
                <div className="absolute inset-0 rounded-full overflow-hidden border border-zinc-700">
                  {topo.grid.map((row, gy) => (
                    <div key={gy} className="flex" style={{ height: `${100 / topo.gridSize}%` }}>
                      {row.map((cell, gx) => (
                        <div key={gx} style={{ width: `${100 / topo.gridSize}%`, height: '100%', backgroundColor: heat(cell) }} />
                      ))}
                    </div>
                  ))}
                </div>
                {topo.electrodes.map((e) => (
                  <div key={e.channel} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                    style={{ left: `${((e.x + 1) / 2) * 100}%`, top: `${((1 - e.y) / 2) * 100}%` }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-white ring-1 ring-black/60" />
                    <span className="text-[8px] text-white font-mono drop-shadow">{e.channel}</span>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-zinc-300 space-y-1">
                <div className="text-zinc-400">{topo.metric}</div>
                <div className="font-mono">range {topo.range.min} – {topo.range.max}</div>
                <div className="font-mono">{topo.mappedChannels} mapped · {topo.unmappedChannels} unmapped</div>
                <div className="mt-2 space-y-0.5 max-h-48 overflow-y-auto">
                  {[...topo.electrodes].sort((a, b) => b.normalized - a.normalized).map((e) => (
                    <div key={e.channel} className="flex items-center gap-2">
                      <span className="font-mono w-10">{e.channel}</span>
                      <div className="w-24 h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${heat(e.normalized)} ${e.normalized * 100}%, #27272a ${e.normalized * 100}%)` }} />
                      <span className="font-mono text-zinc-400">{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Preprocess ─────────────────────────────────────────────── */}
      {tab === 'preprocess' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div><label className={labelCls}>Bandpass low (Hz)</label><input value={ppBandLow} onChange={(e) => setPpBandLow(e.target.value)} type="number" className={inputCls} /></div>
            <div><label className={labelCls}>Bandpass high (Hz)</label><input value={ppBandHigh} onChange={(e) => setPpBandHigh(e.target.value)} type="number" className={inputCls} /></div>
            <div><label className={labelCls}>Notch (Hz)</label><input value={ppNotch} onChange={(e) => setPpNotch(e.target.value)} type="number" className={inputCls} /></div>
            <div><label className={labelCls}>Artifact reject ±</label><input value={ppArtifact} onChange={(e) => setPpArtifact(e.target.value)} type="number" className={inputCls} /></div>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-zinc-300">
            <input type="checkbox" checked={ppReref} onChange={(e) => setPpReref(e.target.checked)} />
            Re-reference to common average
          </label>
          <button type="button" onClick={doPreprocess} disabled={busy === 'preprocess' || !activeId} className={btnCls}>
            {busy === 'preprocess' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Filter className="h-3.5 w-3.5" />}
            Run pipeline
          </button>
          {preproc && (
            <div className="space-y-2">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-[11px]">
                <div className="text-emerald-300 uppercase tracking-wider text-[10px] font-semibold mb-1">Pipeline applied → {preproc.recordingId.slice(0, 12)}…</div>
                {preproc.pipeline.map((p, i) => <div key={i} className="text-zinc-300 font-mono">{i + 1}. {p}</div>)}
              </div>
              {preproc.icaComponents && (
                <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">ICA component decomposition</div>
                  <ChartKit kind="bar" data={preproc.icaComponents as unknown as Record<string, unknown>[]} xKey="component"
                    series={[{ key: 'varianceExplained', label: '% variance', color: '#22c55e' }]} height={140} showLegend={false} />
                  <div className="mt-1 space-y-0.5">
                    {preproc.icaComponents.slice(0, 6).map((c) => (
                      <div key={c.component} className="text-[10px] text-zinc-400 font-mono">
                        {c.component} ← {c.sourceChannel} · {c.varianceExplained}% var · kurtosis {c.kurtosis}
                        {Math.abs(c.kurtosis) > 5 && <span className="text-amber-400"> (artifact-like)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Epoch ──────────────────────────────────────────────────── */}
      {tab === 'epoch' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div><label className={labelCls}>Pre-stim (ms)</label><input value={epPre} onChange={(e) => setEpPre(e.target.value)} type="number" className={cn(inputCls, 'w-28')} /></div>
            <div><label className={labelCls}>Post-stim (ms)</label><input value={epPost} onChange={(e) => setEpPost(e.target.value)} type="number" className={cn(inputCls, 'w-28')} /></div>
            <div><label className={labelCls}>Condition (optional)</label><input value={epCondition} onChange={(e) => setEpCondition(e.target.value)} className={cn(inputCls, 'w-36')} placeholder="oddball" /></div>
            <button type="button" onClick={doEpoch} disabled={busy === 'epoch' || !activeId} className={btnCls}>
              {busy === 'epoch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
              Epoch
            </button>
            {epoch && (
              <button type="button" onClick={doErp} disabled={busy === 'erp'} className={cn(btnCls, 'bg-amber-600/80 hover:bg-amber-600')}>
                {busy === 'erp' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                ERP analysis
              </button>
            )}
          </div>
          {epoch && (
            <div className="space-y-2">
              <div className="text-[11px] text-zinc-400 font-mono">
                {epoch.epochCount} epochs · {epoch.rejectedCount} rejected · channel {epoch.channel} · condition {epoch.condition} · {epoch.epochLength} samples/epoch
              </div>
              <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Grand-average ERP waveform</div>
                <ChartKit kind="line"
                  data={epoch.grandAverage.map((v, i) => ({ t: epoch.timeMs[i], v })) as unknown as Record<string, unknown>[]}
                  xKey="t" series={[{ key: 'v', label: 'μV', color: '#f59e0b' }]} height={180} showLegend={false} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Time-frequency ─────────────────────────────────────────── */}
      {tab === 'tf' && (
        <div className="space-y-3">
          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className={labelCls}>Channel</label>
              <input value={tfChannel} onChange={(e) => setTfChannel(e.target.value)} className={cn(inputCls, 'w-32')} placeholder="(first)" />
            </div>
            <div><label className={labelCls}>Max freq (Hz)</label><input value={tfMaxFreq} onChange={(e) => setTfMaxFreq(e.target.value)} type="number" className={cn(inputCls, 'w-28')} /></div>
            <button type="button" onClick={doTf} disabled={busy === 'tf' || !activeId} className={btnCls}>
              {busy === 'tf' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Grid3x3 className="h-3.5 w-3.5" />}
              Compute spectrogram
            </button>
          </div>
          {tf && (
            <div className="space-y-1">
              <div className="text-[11px] text-zinc-400 font-mono">
                channel {tf.channel} · {tf.frameCount} frames × {tf.freqBinCount} bins · window {tf.windowSize} · dB {tf.dbRange.min} – {tf.dbRange.max}
              </div>
              <div className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
                <div className="flex" style={{ minWidth: tf.times.length * 4 }}>
                  <div className="flex flex-col-reverse justify-between pr-1 text-[8px] text-zinc-400 font-mono">
                    {tf.frequencies.filter((_, i) => i % Math.max(1, Math.floor(tf.frequencies.length / 8)) === 0).map((f) => <span key={f}>{f}Hz</span>)}
                  </div>
                  <div className="flex flex-col-reverse">
                    {tf.frequencies.map((_, fi) => (
                      <div key={fi} className="flex" style={{ height: 6 }}>
                        {tf.spectrogram.map((col, ti) => (
                          <div key={ti} style={{ width: 4, height: 6, backgroundColor: dbHeat(col[fi], tf.dbRange.min, tf.dbRange.max) }} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="text-[8px] text-zinc-400 font-mono mt-1">time → ({tf.times[0]}s – {tf.times[tf.times.length - 1]}s)</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Source localization ────────────────────────────────────── */}
      {tab === 'source' && (
        <div className="space-y-3">
          <button type="button" onClick={doSource} disabled={busy === 'source' || !activeId} className={btnCls}>
            {busy === 'source' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
            Localize cortical sources
          </button>
          {source && (
            <div className="flex flex-wrap gap-4 items-start">
              <div className="relative rounded-full border border-zinc-700 bg-zinc-900/60" style={{ width: 280, height: 280 }}>
                {source.dipoles.map((d, i) => (
                  <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      left: `${((d.x + 0.8) / 1.6) * 100}%`, top: `${((0.8 - d.y) / 1.6) * 100}%`,
                      width: 6 + d.strength * 14, height: 6 + d.strength * 14,
                      backgroundColor: heat(d.strength), opacity: 0.25 + d.strength * 0.7,
                    }} />
                ))}
                {source.peakSources.map((p, i) => (
                  <div key={`pk${i}`} className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${((p.x + 0.8) / 1.6) * 100}%`, top: `${((0.8 - p.y) / 1.6) * 100}%` }}>
                    <Crosshair className="h-4 w-4 text-white drop-shadow" />
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-zinc-300 space-y-1">
                <div className="text-zinc-400">{source.method}</div>
                <div className="font-mono">{source.sensorCount} sensors · {source.gridSize}×{source.gridSize} grid</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-400 mt-2">Peak sources</div>
                {source.peakSources.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-mono text-purple-300 w-6">#{i + 1}</span>
                    <span className="flex-1">{p.region}</span>
                    <div className="w-20 h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${heat(p.strength)} ${p.strength * 100}%, #27272a ${p.strength * 100}%)` }} />
                    <span className="font-mono text-zinc-400">{p.strength}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Statistics ─────────────────────────────────────────────── */}
      {tab === 'stats' && (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-400">
            Welch two-sample t-test + Cohen&apos;s d. Enter numeric observations per group (epoch means, band powers),
            or pull the epoched grand-average means from the Epoch tab.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Group A — numeric values</label>
              <textarea value={statA} onChange={(e) => setStatA(e.target.value)} rows={3} className={cn(inputCls, 'font-mono text-[11px] resize-y')} placeholder="1.2, 0.9, 1.5, 1.1" />
            </div>
            <div>
              <label className={labelCls}>Group B — numeric values</label>
              <textarea value={statB} onChange={(e) => setStatB(e.target.value)} rows={3} className={cn(inputCls, 'font-mono text-[11px] resize-y')} placeholder="0.4, 0.6, 0.3, 0.5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={doStats} disabled={busy === 'stats'} className={btnCls}>
              {busy === 'stats' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
              Run t-test
            </button>
            <button type="button" onClick={loadEpochIntoStats} className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-800">
              ← Load epoch means into A
            </button>
          </div>
          {stat && (
            <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-3 text-[12px] space-y-1">
              <div className="text-cyan-300 uppercase tracking-wider text-[10px] font-semibold">{stat.test}</div>
              <div className="grid grid-cols-2 gap-2 text-zinc-300 font-mono text-[11px]">
                <div>Group A: n={stat.groupA.n} · μ={stat.groupA.mean} · σ={stat.groupA.sd}</div>
                <div>Group B: n={stat.groupB.n} · μ={stat.groupB.mean} · σ={stat.groupB.sd}</div>
                <div>t = {stat.tStatistic} · df = {stat.degreesOfFreedom}</div>
                <div>p = {stat.pValue}</div>
                <div>Cohen&apos;s d = {stat.cohensD} ({stat.effectSize})</div>
                <div>mean diff = {stat.meanDifference}</div>
              </div>
              <div className={cn('font-semibold', stat.significant ? 'text-emerald-300' : 'text-zinc-400')}>
                {stat.significance}
              </div>
            </div>
          )}
        </div>
      )}

      {feedback && (
        <div className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border',
          feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
          {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5 shrink-0" /> : <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}
    </div>
  );
}
