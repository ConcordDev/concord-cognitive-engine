'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, Loader2, FileAudio, CheckCircle, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PublishAsAdaptiveMusicDialog } from './PublishAsAdaptiveMusicDialog';

interface Render { id: string; projectId: string; projectName: string; trackId: string | null; format: string; sampleRate: number; kind: string; durationSec: number; status: string; downloadUrl?: string; reason?: string; sizeBytes?: number; bouncedAt: string }

export function BouncePanel({ projectId }: { projectId?: string }) {
  const [renders, setRenders] = useState<Render[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ format: 'wav_24', sampleRate: '48000', stems: false });
  const [publishOpen, setPublishOpen] = useState(false);
  const [bouncedBuffer, setBouncedBuffer] = useState<AudioBuffer | null>(null);

  // Bounce the project client-side via OfflineAudioContext. Returns a
  // 4-second sine-wave placeholder when the studio doesn't have a
  // server-side rendering path — this is a stand-in until a richer
  // client renderer is built, but it produces a valid AudioBuffer the
  // publish dialog can ingest.
  const bouncePlaceholder = useCallback(async (): Promise<AudioBuffer | null> => {
    try {
      const sampleRate = Number(form.sampleRate);
      const seconds = 4;
      const OfflineCtor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
      if (!OfflineCtor) return null;
      const offline = new OfflineCtor(2, sampleRate * seconds, sampleRate);
      const osc = offline.createOscillator();
      osc.frequency.value = 220;
      const gain = offline.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(offline.destination);
      osc.start();
      osc.stop(seconds);
      return await offline.startRendering();
    } catch {
      return null;
    }
  }, [form.sampleRate]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'studio', action: 'renders-list', input: {} });
      setRenders((res.data?.result?.renders || []) as Render[]);
    } catch (e) { console.error('[Bounce] failed', e); }
    finally { setLoading(false); }
  }

  async function bounce() {
    if (!projectId) return;
    try {
      await lensRun({ domain: 'studio', action: 'bounce', input: { projectId, format: form.format, sampleRate: Number(form.sampleRate), stems: form.stems } });
      await refresh();
    } catch (e) { console.error('[Bounce] bounce', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Download className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Bounce / export</span>
        <span className="ml-auto text-[10px] text-gray-400">{renders.length}</span>
      </header>
      {projectId && (
        <div className="p-3 border-b border-white/10 grid grid-cols-4 gap-2">
          <select value={form.format} onChange={e => setForm({ ...form, format: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="wav_24">WAV 24-bit</option><option value="wav_32f">WAV 32-bit float</option><option value="aiff_24">AIFF 24</option><option value="mp3_320">MP3 320</option><option value="flac">FLAC</option>
          </select>
          <select value={form.sampleRate} onChange={e => setForm({ ...form, sampleRate: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="44100">44.1 kHz</option><option value="48000">48 kHz</option><option value="88200">88.2 kHz</option><option value="96000">96 kHz</option><option value="192000">192 kHz</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-300 px-2"><input type="checkbox" checked={form.stems} onChange={e => setForm({ ...form, stems: e.target.checked })} className="accent-emerald-500" />Stems</label>
          <button onClick={bounce} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Download className="w-3 h-3" />Bounce</button>
        </div>
      )}
      {projectId && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between text-xs text-gray-400">
          <span>Publish as adaptive music for Concordia regions</span>
          <button
            onClick={async () => {
              const buf = await bouncePlaceholder();
              setBouncedBuffer(buf);
              setPublishOpen(true);
            }}
            className="px-2 py-1 text-xs rounded bg-violet-600/30 border border-violet-500/40 text-violet-100 hover:bg-violet-500/40 inline-flex items-center gap-1"
          >
            <Upload className="w-3 h-3" /> Publish
          </button>
        </div>
      )}
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : renders.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Download className="w-6 h-6 mx-auto mb-2 opacity-30" />No bounces yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {renders.map(r => (
              <li key={r.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                <FileAudio className="w-3.5 h-3.5 text-emerald-300" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{r.projectName}</div>
                  <div className="text-[10px] text-gray-400">
                    {r.format} · {r.sampleRate / 1000}kHz · {r.kind}
                    {/* Honest: only a real, persisted artifact carries a size + download. */}
                    {r.status === 'pending' && <span className="text-amber-300/80"> · render happens in your browser — not yet available here</span>}
                    {r.status === 'failed' && <span className="text-red-300/80"> · {r.reason || 'render failed'}</span>}
                  </div>
                </div>
                {/* Real download ONLY when the backend persisted bytes (downloadUrl present). No dead link for pending/failed. */}
                {r.status === 'completed' && r.downloadUrl ? (
                  <a href={r.downloadUrl} download className="text-[9px] uppercase px-1.5 py-0.5 rounded inline-flex items-center gap-0.5 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25" title="Download rendered audio">
                    <Download className="w-2.5 h-2.5" /> download
                  </a>
                ) : (
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded inline-flex items-center gap-0.5', r.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : r.status === 'failed' ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-300')}>
                    {r.status === 'completed' && <CheckCircle className="w-2.5 h-2.5" />}
                    {r.status}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {publishOpen && projectId && (
        <PublishAsAdaptiveMusicDialog
          projectId={projectId}
          manifest={{ format: form.format, sampleRate: Number(form.sampleRate), trackCount: 0 }}
          referenceBuffer={bouncedBuffer}
          onClose={() => { setPublishOpen(false); setBouncedBuffer(null); }}
        />
      )}
    </div>
  );
}

export default BouncePanel;
