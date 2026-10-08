'use client';

/**
 * FabricationExportPanel: turn a parametric part into a real fabrication file.
 *
 * Geometry comes from engineering.partMesh (metres). STL is written on the
 * server by engineering.partStl (binary, millimetres) and OBJ is converted
 * from the same mesh here. The hash shown is the SHA-256 of the exact bytes
 * downloaded. Formats with no exporter in Concord are listed as unavailable.
 */

import React, { useState } from 'react';
import { lensRun } from '@/lib/api/client';

type ExportFormat = 'STL' | 'OBJ' | 'G-code' | 'DXF' | 'STEP' | 'IGES';
type PartKind = 'box' | 'cylinder' | 'sphere';

const FORMATS: { id: ExportFormat; icon: string; description: string; available: boolean }[] = [
  { id: 'STL', icon: '△', description: 'Binary mesh for 3D printing slicers', available: true },
  { id: 'OBJ', icon: '◆', description: 'Wavefront polygon mesh', available: true },
  { id: 'G-code', icon: '⚙', description: 'Needs a slicer; slice the STL in PrusaSlicer or Cura', available: false },
  { id: 'DXF', icon: '✏', description: '2D drawing export not available yet', available: false },
  { id: 'STEP', icon: '◼', description: 'Solid CAD export not available yet', available: false },
  { id: 'IGES', icon: '◇', description: 'Surface CAD export not available yet', available: false },
];

const DIMENSIONS: Record<PartKind, { key: string; label: string; def: number }[]> = {
  box: [
    { key: 'width', label: 'Width', def: 40 },
    { key: 'height', label: 'Height', def: 20 },
    { key: 'length', label: 'Length', def: 60 },
  ],
  cylinder: [
    { key: 'radius', label: 'Radius', def: 15 },
    { key: 'length', label: 'Length', def: 50 },
  ],
  sphere: [{ key: 'radius', label: 'Radius', def: 20 }],
};

interface ExportRecord {
  id: string;
  kind: PartKind;
  format: ExportFormat;
  filename: string;
  bytes: number;
  sha256: string;
  triangles: number;
  at: string;
}

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function download(bytes: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FabricationExportPanel() {
  const [kind, setKind] = useState<PartKind>('box');
  const [dims, setDims] = useState<Record<string, number>>(
    Object.fromEntries(DIMENSIONS.box.map((d) => [d.key, d.def])),
  );
  const [scale, setScale] = useState(1);
  const [format, setFormat] = useState<ExportFormat>('STL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ExportRecord | null>(null);
  const [history, setHistory] = useState<ExportRecord[]>([]);

  const chooseKind = (k: PartKind) => {
    setKind(k);
    setDims(Object.fromEntries(DIMENSIONS[k].map((d) => [d.key, d.def])));
  };

  // partMesh takes metres; the form is in millimetres.
  const meshParams = () => Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v / 1000]));

  const runExport = async () => {
    setBusy(true);
    setError(null);
    try {
      let rec: ExportRecord;
      if (format === 'STL') {
        const r = await lensRun<{ base64: string; sha256: string; byteLength: number; triangleCount: number; filename: string }>(
          'engineering', 'partStl', { kind, params: meshParams(), scale },
        );
        if (!r.data?.ok || !r.data.result) throw new Error(r.data?.error || 'STL export failed');
        const res = r.data.result;
        const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
        download(bytes, res.filename, 'model/stl');
        rec = { id: `${Date.now()}`, kind, format, filename: res.filename, bytes: res.byteLength, sha256: res.sha256, triangles: res.triangleCount, at: new Date().toISOString() };
      } else {
        const r = await lensRun<{ positions: number[]; indices: number[]; triangleCount: number }>(
          'engineering', 'partMesh', { kind, params: meshParams() },
        );
        if (!r.data?.ok || !r.data.result) throw new Error(r.data?.error || 'Mesh generation failed');
        const { positions, indices, triangleCount } = r.data.result;
        const k = 1000 * scale;
        const lines = [`# Concord ${kind} part (mm)`];
        for (let i = 0; i < positions.length; i += 3) {
          lines.push(`v ${(positions[i] * k).toFixed(4)} ${(positions[i + 1] * k).toFixed(4)} ${(positions[i + 2] * k).toFixed(4)}`);
        }
        for (let i = 0; i < indices.length; i += 3) {
          lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
        }
        const text = lines.join('\n') + '\n';
        const bytes = new TextEncoder().encode(text);
        const filename = `${kind}-part.obj`;
        download(text, filename, 'model/obj');
        rec = { id: `${Date.now()}`, kind, format, filename, bytes: bytes.length, sha256: await sha256Hex(bytes), triangles: triangleCount, at: new Date().toISOString() };
      }
      setLast(rec);
      setHistory((h) => [rec, ...h].slice(0, 20));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const fmt = FORMATS.find((f) => f.id === format)!;

  return (
    <div className={`${panel} p-5 space-y-5 text-white max-w-2xl`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Fabrication Export</h2>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-600/80 text-cyan-100">Part → File</span>
      </div>
      <p className="text-sm text-white/50">
        Size a parametric part and export a real mesh file for printing or CAD.
      </p>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">Part</h3>
        <div className="flex gap-2">
          {(Object.keys(DIMENSIONS) as PartKind[]).map((k) => (
            <button
              key={k}
              onClick={() => chooseKind(k)}
              aria-pressed={kind === k}
              className={`text-xs px-3 py-1.5 rounded-md border capitalize ${kind === k ? 'border-cyan-500 bg-cyan-500/10 text-cyan-200' : 'border-white/10 bg-white/5 text-white/60 hover:border-white/25'}`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {DIMENSIONS[kind].map((d) => (
            <label key={d.key} className="text-[11px] text-white/60 space-y-1">
              <span>{d.label} (mm)</span>
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={dims[d.key] ?? d.def}
                onChange={(e) => setDims((prev) => ({ ...prev, [d.key]: Math.max(0.1, Number(e.target.value) || 0.1) }))}
                className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-white"
              />
            </label>
          ))}
          <label className="text-[11px] text-white/60 space-y-1">
            <span>Scale</span>
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.1}
              value={scale}
              onChange={(e) => setScale(Math.min(100, Math.max(0.1, Number(e.target.value) || 1)))}
              className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-xs text-white"
            />
          </label>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">Output Format</h3>
        <div className="grid grid-cols-3 gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => f.available && setFormat(f.id)}
              disabled={!f.available}
              aria-pressed={format === f.id}
              className={`text-left p-3 rounded-lg border transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                format === f.id ? 'border-cyan-500 bg-cyan-500/10' : 'border-white/10 hover:border-white/25 bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{f.icon}</span>
                <span className="font-semibold text-sm">{f.id}</span>
                {!f.available && <span className="ml-auto text-[9px] uppercase text-white/50">unavailable</span>}
              </div>
              <p className="text-[11px] leading-tight text-white/50">{f.description}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <button
          onClick={() => void runExport()}
          disabled={busy || !fmt.available}
          className="w-full py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-semibold text-sm transition-colors disabled:opacity-50"
        >
          {busy ? 'Exporting…' : `Export and download ${format}`}
        </button>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      </section>

      {last && (
        <section className="p-3 rounded-lg bg-green-900/20 border border-green-500/20 space-y-1">
          <h4 className="text-xs font-semibold text-green-400 uppercase tracking-wider">Downloaded {last.filename}</h4>
          <p className="text-[11px] text-green-200/80">{fmtBytes(last.bytes)} · {last.triangles} triangles · millimetres</p>
          <p className="text-[11px] font-mono text-green-300/80 break-all">sha256:{last.sha256}</p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">This session ({history.length})</h3>
        {history.length === 0 ? (
          <p className="text-[11px] text-white/30 py-1">No exports yet.</p>
        ) : (
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded border border-white/10 bg-white/5 px-3 py-1.5 text-[11px]">
                <span className="font-mono">{h.filename}</span>
                <span className="text-white/40">{fmtBytes(h.bytes)} · {new Date(h.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
