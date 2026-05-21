'use client';

import { useRef, useState } from 'react';
import { Package, Loader2, Download, Upload, Layers } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Stem { trackId: string; trackName: string; index: number; outputUrl: string }
interface StemJob { id: string; projectName: string; format: string; sampleRate: number; stemCount: number; stems: Stem[] }
interface ImportResult { project: { id: string; name: string }; imported: { tracks: number; clips: number; notes: number; markers: number } }

const FORMATS = ['wav_24', 'wav_32f', 'aiff_24', 'flac'];
const RATES = [44100, 48000, 88200, 96000];

export function ProjectIOPanel({ projectId }: { projectId?: string }) {
  const [format, setFormat] = useState('wav_24');
  const [sampleRate, setSampleRate] = useState(48000);
  const [job, setJob] = useState<StemJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function exportStems() {
    if (!projectId) return;
    setBusy(true); setErr(null); setJob(null);
    try {
      const res = await lensRun('studio', 'export-stems', { projectId, format, sampleRate });
      if (res.data?.ok) setJob(res.data.result.job as StemJob);
      else setErr(res.data?.error || 'Stem export failed.');
    } catch (e) { console.error('[ProjectIO] stems', e); setErr('Stem export failed.'); }
    finally { setBusy(false); }
  }

  async function exportProject() {
    if (!projectId) return;
    setBusy(true); setErr(null);
    try {
      const res = await lensRun('studio', 'project-export', { projectId });
      if (!res.data?.ok) { setErr(res.data?.error || 'Project export failed.'); return; }
      const bundle = res.data.result.bundle;
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(bundle.project?.name || 'project').replace(/\s+/g, '_')}.concord-studio.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('[ProjectIO] export', e); setErr('Project export failed.'); }
    finally { setBusy(false); }
  }

  async function importProject(file: File) {
    setBusy(true); setErr(null); setImportResult(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await lensRun('studio', 'project-import', { bundle });
      if (res.data?.ok) setImportResult(res.data.result as ImportResult);
      else setErr(res.data?.error || 'Import failed.');
    } catch (e) { console.error('[ProjectIO] import', e); setErr('Import failed — invalid bundle file.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Package className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Stem export & project import/export</span>
      </header>
      <div className="p-3 space-y-4">
        <section className="space-y-2">
          <div className="text-[10px] uppercase text-violet-300 font-semibold">Stem export</div>
          <div className="grid grid-cols-2 gap-2">
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {RATES.map((r) => <option key={r} value={r}>{r} Hz</option>)}
            </select>
          </div>
          <button onClick={exportStems} disabled={busy || !projectId} className="w-full px-3 py-1.5 text-xs rounded bg-violet-500 disabled:opacity-40 text-white font-bold inline-flex items-center justify-center gap-1">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}Export stems
          </button>
          {job && (
            <div className="text-[11px] text-gray-300">
              <div className="text-emerald-400 mb-1">{job.stemCount} stems · {job.format} @ {job.sampleRate}Hz</div>
              <ul className="space-y-0.5">
                {job.stems.map((s) => (
                  <li key={s.trackId} className="font-mono text-[10px] text-gray-500 truncate">{String(s.index + 1).padStart(2, '0')} {s.trackName} — {s.outputUrl}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="space-y-2 pt-2 border-t border-white/10">
          <div className="text-[10px] uppercase text-violet-300 font-semibold">Project file</div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={exportProject} disabled={busy || !projectId} className="px-3 py-1.5 text-xs rounded bg-white/[0.06] disabled:opacity-40 text-gray-200 inline-flex items-center justify-center gap-1">
              <Download className="w-3 h-3" />Export .json
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="px-3 py-1.5 text-xs rounded bg-white/[0.06] disabled:opacity-40 text-gray-200 inline-flex items-center justify-center gap-1">
              <Upload className="w-3 h-3" />Import .json
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importProject(f); e.target.value = ''; }} />
          </div>
          {importResult && (
            <div className="text-[11px] text-emerald-400">
              Imported &ldquo;{importResult.project.name}&rdquo; — {importResult.imported.tracks} tracks · {importResult.imported.clips} clips · {importResult.imported.notes} notes · {importResult.imported.markers} markers.
            </div>
          )}
        </section>

        {err && <div className="text-[11px] text-rose-400">{err}</div>}
        {!projectId && <div className="text-[10px] text-gray-500">Open a project to export stems or its project file.</div>}
      </div>
    </div>
  );
}

export default ProjectIOPanel;
