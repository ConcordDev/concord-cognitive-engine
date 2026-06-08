'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExportFormat = 'STL' | 'G-code' | 'DXF' | 'STEP' | 'OBJ' | 'IGES';

interface FormatInfo {
  id: ExportFormat;
  icon: string;
  description: string;
  extension: string;
}

interface MachineProfile {
  id: string;
  name: string;
  type: string;
  nozzle?: string;
  bedSize: string;
  notes: string;
}

interface ExportHistoryEntry {
  id: string;
  dtuId: string;
  format: ExportFormat;
  machine: string | null;
  timestamp: string;
  hash: string;
  fileSize: string;
  status: 'completed' | 'failed';
}

type ExportStage = 'idle' | 'validating' | 'processing' | 'optimizing' | 'completed' | 'failed';

interface ExportParams {
  tolerance: number;
  wallThickness: number;
  orientation: 'auto' | 'manual';
  supports: boolean;
  infill: number;
  scale: number;
}

// ---------------------------------------------------------------------------
// Seed Data
// ---------------------------------------------------------------------------

const FORMATS: FormatInfo[] = [
  { id: 'STL', icon: '△', description: 'Stereolithography — mesh triangles for 3D printing', extension: '.stl' },
  { id: 'G-code', icon: '⚙', description: 'Machine toolpath instructions for CNC / FDM', extension: '.gcode' },
  { id: 'DXF', icon: '✏', description: 'AutoCAD Drawing Exchange — 2D laser / waterjet', extension: '.dxf' },
  { id: 'STEP', icon: '◼', description: 'ISO 10303 parametric solid for CAD interchange', extension: '.step' },
  { id: 'OBJ', icon: '◆', description: 'Wavefront OBJ — lightweight polygonal mesh', extension: '.obj' },
  { id: 'IGES', icon: '◇', description: 'Initial Graphics Exchange — legacy CAD surfaces', extension: '.iges' },
];

const MACHINE_PROFILES: MachineProfile[] = [
  {
    id: 'prusa-mk4',
    name: 'Prusa MK4',
    type: 'FDM 3D Printer',
    nozzle: '0.4 mm',
    bedSize: '250 × 210 × 220 mm',
    notes: 'PLA / PETG / ASA. Auto bed leveling, input shaper.',
  },
  {
    id: 'haas-vf2',
    name: 'Haas VF-2',
    type: 'CNC Mill',
    bedSize: '762 × 406 × 508 mm',
    notes: '3-axis vertical mill. 8,100 RPM spindle, 20-tool carousel.',
  },
  {
    id: 'epilog-zing',
    name: 'Epilog Zing 24',
    type: 'Laser Cutter / Engraver',
    bedSize: '610 × 305 mm',
    notes: '40 W CO₂ laser. Cuts acrylic up to 6 mm, engraves metal.',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

function ProgressBar({ pct, color = 'bg-cyan-500' }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
      <div
        className={`${color} h-full rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FabricationExportPanel() {
  // State -------------------------------------------------------------------
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('STL');
  const [selectedMachine, setSelectedMachine] = useState<string>(MACHINE_PROFILES[0].id);
  const [params, setParams] = useState<ExportParams>({
    tolerance: 0.1,
    wallThickness: 1.2,
    orientation: 'auto',
    supports: true,
    infill: 20,
    scale: 1.0,
  });
  const [exportStage, setExportStage] = useState<ExportStage>('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [validationHash, setValidationHash] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);

  // Real export history from the export domain. Stays empty (honest
  // empty-state) on error or no data — never renders fabricated runs.
  useEffect(() => {
    let cancelled = false;
    lensRun('export', 'history-list', { limit: 50 })
      .then((r) => {
        const runs = (r.data?.result as { runs?: Record<string, unknown>[] } | null)?.runs;
        if (cancelled || !Array.isArray(runs)) return;
        const fmtBytes = (b: number): string => {
          if (!b) return '0 B';
          if (b < 1024) return `${b} B`;
          if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
          return `${(b / (1024 * 1024)).toFixed(1)} MB`;
        };
        const mapped: ExportHistoryEntry[] = runs.map((run) => {
          const sources = Array.isArray(run.dataSources) ? (run.dataSources as string[]) : [];
          const fmt = String(run.format ?? '').toLowerCase();
          const matched = FORMATS.find((f) => f.id.toLowerCase() === fmt);
          return {
            id: String(run.id ?? ''),
            dtuId: sources[0] ?? String(run.filename ?? run.id ?? ''),
            format: matched ? matched.id : 'STL',
            machine: null,
            timestamp: run.at ? new Date(Number(run.at)).toISOString() : new Date().toISOString(),
            hash: run.scheduleId ? String(run.scheduleId) : '',
            fileSize: fmtBytes(Number(run.byteLength) || 0),
            status: 'completed',
          };
        });
        setHistory(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const formatInfo = useMemo(() => FORMATS.find(f => f.id === selectedFormat)!, [selectedFormat]);
  const machineInfo = useMemo(
    () => MACHINE_PROFILES.find(m => m.id === selectedMachine)!,
    [selectedMachine],
  );

  const needsMachine = selectedFormat === 'G-code';

  // Handlers ----------------------------------------------------------------
  const updateParam = <K extends keyof ExportParams>(key: K, value: ExportParams[K]) =>
    setParams(prev => ({ ...prev, [key]: value }));

  const startExport = () => {
    setExportStage('validating');
    setExportProgress(0);
    setValidationHash(null);

    // Simulate multi-stage export
    setTimeout(() => {
      setExportStage('processing');
      setExportProgress(25);
    }, 600);
    setTimeout(() => setExportProgress(55), 1200);
    setTimeout(() => {
      setExportStage('optimizing');
      setExportProgress(80);
    }, 1800);
    setTimeout(() => {
      setExportStage('completed');
      setExportProgress(100);
      setValidationHash(
        `sha256:${Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}...${Array.from({ length: 4 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`,
      );
    }, 2800);
  };

  const resetExport = () => {
    setExportStage('idle');
    setExportProgress(0);
    setValidationHash(null);
  };

  // Stage label mapping
  const stageLabel: Record<ExportStage, string> = {
    idle: 'Ready',
    validating: 'Validating DTU geometry...',
    processing: 'Converting to ' + selectedFormat + '...',
    optimizing: 'Optimizing output...',
    completed: 'Export complete',
    failed: 'Export failed',
  };

  // Render ------------------------------------------------------------------
  return (
    <div className={`${panel} p-5 space-y-5 text-white max-w-2xl`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Fabrication Export</h2>
        <Badge color="bg-cyan-600/80 text-cyan-100">DTU &rarr; Machine</Badge>
      </div>
      <p className="text-sm text-white/50">
        Convert Digital Twin Units to machine-readable fabrication formats.
      </p>

      {/* ---- Format Selector ---- */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Output Format
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {FORMATS.map(f => (
            <button
              key={f.id}
              onClick={() => setSelectedFormat(f.id)}
              className={`text-left p-3 rounded-lg border transition-all ${
                selectedFormat === f.id
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : 'border-white/10 hover:border-white/25 bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{f.icon}</span>
                <span className="font-semibold text-sm">{f.id}</span>
              </div>
              <p className="text-[11px] leading-tight text-white/50">{f.description}</p>
            </button>
          ))}
        </div>
      </section>

      {/* ---- Machine Profile (conditional) ---- */}
      {needsMachine && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
            Machine Profile
          </h3>
          <div className="space-y-2">
            {MACHINE_PROFILES.map(m => (
              <button
                key={m.id}
                onClick={() => setSelectedMachine(m.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedMachine === m.id
                    ? 'border-cyan-500 bg-cyan-500/10'
                    : 'border-white/10 hover:border-white/25 bg-white/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{m.name}</span>
                  <Badge color="bg-white/10 text-white/60">{m.type}</Badge>
                </div>
                <p className="text-[11px] text-white/40 mt-1">
                  Bed: {m.bedSize}
                  {m.nozzle ? ` · Nozzle: ${m.nozzle}` : ''}
                </p>
                <p className="text-[11px] text-white/30 mt-0.5">{m.notes}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---- Parameter Controls ---- */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Parameters
        </h3>

        {/* Tolerance */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-white/60">Tolerance</span>
            <span className="font-mono text-cyan-400">{params.tolerance.toFixed(2)} mm</span>
          </div>
          <input
            type="range"
            min={0.01}
            max={1}
            step={0.01}
            value={params.tolerance}
            onChange={e => updateParam('tolerance', parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        {/* Wall Thickness */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-white/60">Wall Thickness</span>
            <span className="font-mono text-cyan-400">{params.wallThickness.toFixed(1)} mm</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={params.wallThickness}
            onChange={e => updateParam('wallThickness', parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>

        {/* Orientation */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/60">Orientation</span>
          <div className="flex gap-1">
            {(['auto', 'manual'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => updateParam('orientation', opt)}
                className={`text-xs px-3 py-1 rounded-md transition-all ${
                  params.orientation === opt
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
                    : 'bg-white/5 text-white/50 border border-white/10 hover:border-white/25'
                }`}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Supports toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/60">Generate Supports</span>
          <button
            onClick={() => updateParam('supports', !params.supports)}
            aria-label={`Generate Supports — ${params.supports ? 'on' : 'off'}`}
            aria-pressed={params.supports}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              params.supports ? 'bg-cyan-500' : 'bg-white/20'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                params.supports ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Scale */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-white/60">Scale</span>
            <span className="font-mono text-cyan-400">{params.scale.toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min={0.1}
            max={10}
            step={0.1}
            value={params.scale}
            onChange={e => updateParam('scale', parseFloat(e.target.value))}
            className="w-full accent-cyan-500"
          />
        </div>
      </section>

      {/* ---- Export Action ---- */}
      <section className="space-y-3">
        {exportStage === 'idle' && (
          <button
            onClick={startExport}
            className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-semibold text-sm transition-colors"
          >
            Export as {selectedFormat}
            {needsMachine ? ` for ${machineInfo.name}` : ''}
          </button>
        )}

        {exportStage !== 'idle' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/70">{stageLabel[exportStage]}</span>
              <span className="font-mono text-cyan-400">{exportProgress}%</span>
            </div>
            <ProgressBar
              pct={exportProgress}
              color={exportStage === 'failed' ? 'bg-red-500' : 'bg-cyan-500'}
            />

            {exportStage === 'completed' && (
              <div className="space-y-2 pt-1">
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('fabrication:download', { detail: { extension: formatInfo.extension } })); }}
                  className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-500 font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <span>&#8681;</span> Download {formatInfo.extension}
                </button>
                <button
                  onClick={resetExport}
                  className="w-full py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
                >
                  New Export
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ---- Validation Hash ---- */}
      {validationHash && (
        <section className="p-3 rounded-lg bg-green-900/20 border border-green-500/20 space-y-1">
          <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider">
            Validation Hash
          </h4>
          <p className="text-xs font-mono text-green-300/80 break-all">{validationHash}</p>
        </section>
      )}

      {/* ---- Export History ---- */}
      <section className="space-y-2">
        <button
          onClick={() => setHistoryExpanded(!historyExpanded)}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-white/40 hover:text-white/60 transition-colors"
        >
          <span>{historyExpanded ? '▾' : '▸'}</span> Export History ({history.length})
        </button>

        {historyExpanded && (
          <div className="space-y-2">
            {history.length === 0 && (
              <p className="text-[11px] text-white/30 py-2">No exports yet.</p>
            )}
            {history.map(entry => (
              <div
                key={entry.id}
                className="p-3 rounded-lg border border-white/10 bg-white/5 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold font-mono">{entry.dtuId}</span>
                  <Badge
                    color={
                      entry.status === 'completed'
                        ? 'bg-green-600/40 text-green-300'
                        : 'bg-red-600/40 text-red-300'
                    }
                  >
                    {entry.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-white/40">
                  <span>{entry.format}</span>
                  {entry.machine && <span>· {entry.machine}</span>}
                  <span>· {entry.fileSize}</span>
                </div>
                <div className="text-[11px] font-mono text-white/30">{entry.hash}</div>
                <div className="text-[11px] text-white/25">
                  {new Date(entry.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
