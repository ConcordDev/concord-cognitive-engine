'use client';

import { useEffect, useState, useCallback } from 'react';
import { Download, Loader2, FileAudio, CheckCircle, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { logStudioCollabEdit } from '@/lib/daw/collab-log';
import { renderWorkbenchProject, pcmToAudioBuffer, type WorkbenchClip, type WorkbenchNote, type WorkbenchProject, type WorkbenchRenderResult } from '@/lib/daw/workbench-render';
import { encodeWav } from '@/lib/daw/wav';
import { encodeFlac } from '@/lib/daw/flac';
import { PublishAsAdaptiveMusicDialog } from './PublishAsAdaptiveMusicDialog';

interface Render { id: string; projectId: string; projectName: string; trackId: string | null; format: string; sampleRate: number; kind: string; durationSec: number; status: string; downloadUrl?: string; reason?: string; sizeBytes?: number; bouncedAt: string }

export function BouncePanel({ projectId }: { projectId?: string }) {
  const [renders, setRenders] = useState<Render[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ format: 'wav_24', sampleRate: '48000', stems: false });
  const [publishOpen, setPublishOpen] = useState(false);
  const [bouncedBuffer, setBouncedBuffer] = useState<AudioBuffer | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderNote, setRenderNote] = useState<string | null>(null);
  const [trackCount, setTrackCount] = useState(0);

  // Render the project's REAL mix in-browser (Q31): audio clips are
  // decoded and placed at their beat positions, MIDI/drum clips are
  // voiced from their actual notes — see lib/daw/workbench-render.ts.
  // (Was: a 4-second 220 Hz placeholder tone attached to publishes, and
  // bounces that never sent audio, so every render sat "pending".)
  // Unrenderable clips come back in result.skipped with reasons and are
  // surfaced in the panel — never silently dropped.
  const loadAndRender = useCallback(async (): Promise<{ render: WorkbenchRenderResult; project: WorkbenchProject; clips: WorkbenchClip[]; notesByClip: Map<string, WorkbenchNote[]> } | null> => {
    if (!projectId) return null;
    const projRes = await lensRun({ domain: 'studio', action: 'project-get', input: { id: projectId } });
    const project = projRes.data?.result?.project as WorkbenchProject | undefined;
    if (!project) { setRenderNote('Project could not be loaded — nothing was rendered.'); return null; }
    const clipsRes = await lensRun({ domain: 'studio', action: 'clips-list', input: { projectId } });
    const clips = (clipsRes.data?.result?.clips || []) as WorkbenchClip[];
    const notesByClip = new Map<string, WorkbenchNote[]>();
    for (const clip of clips) {
      if (clip.kind === 'audio') continue;
      const notesRes = await lensRun({ domain: 'studio', action: 'midi-notes-list', input: { clipId: clip.id } });
      notesByClip.set(clip.id, (notesRes.data?.result?.notes || []) as WorkbenchNote[]);
    }
    const render = await renderWorkbenchProject(project, clips, notesByClip, { sampleRate: Number(form.sampleRate) });
    return { render, project, clips, notesByClip };
  }, [projectId, form.sampleRate]);

  function skippedSummary(render: WorkbenchRenderResult): string {
    if (render.skipped.length === 0) return '';
    const reasons = render.skipped.map(s => `${s.clipName} (${s.reason})`).join('; ');
    return ` Skipped ${render.skipped.length}: ${reasons}.`;
  }

  // Encode the rendered PCM true to the selected format where a browser
  // encoder exists (WAV 24 / WAV 32f / FLAC 24 via lib/daw). MP3/AIFF
  // have no in-browser encoder wired yet, so those render as WAV and
  // SAY so — the bytes never pretend to be the selected format.
  async function encodeForUpload(pcm: { channels: Float32Array[]; sampleRate: number }): Promise<{ dataUrl: string; formatNote: string | null }> {
    let bytes: ArrayBuffer | Uint8Array;
    let mime = 'audio/wav';
    let formatNote: string | null = null;
    if (form.format === 'wav_32f') {
      bytes = encodeWav(pcm.channels, pcm.sampleRate, { bitDepth: 32 });
    } else if (form.format === 'flac') {
      bytes = encodeFlac(pcm.channels, pcm.sampleRate, { bitDepth: 24 });
      mime = 'audio/flac';
    } else {
      bytes = encodeWav(pcm.channels, pcm.sampleRate, { bitDepth: 24 });
      if (form.format === 'mp3_320' || form.format === 'aiff_24') {
        formatNote = `Rendered as WAV — in-browser ${form.format === 'mp3_320' ? 'MP3' : 'AIFF'} encoding isn't wired yet.`;
      }
    }
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { dataUrl, formatNote };
  }

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
    if (!projectId || rendering) return;
    setRendering(true);
    setRenderNote(null);
    try {
      const loaded = await loadAndRender();
      if (!loaded) return;
      const { render } = loaded;
      if (!render.pcm) {
        // Nothing renderable — do NOT post a bounce (it would sit as an
        // eternal "pending" row) and do NOT fabricate audio. Say why.
        setRenderNote(`Nothing to render yet — this project has no audio clips with sources and no MIDI notes.${skippedSummary(render)}`);
        return;
      }
      if (form.stems) {
        // Real stems: one render + one bounce per unmuted track (the
        // macro's trackId makes each a "stem" render with its own
        // artifact) — never one stereo file mislabeled as stems.
        let done = 0;
        const failedTracks: string[] = [];
        for (const track of (loaded.project.tracks || []).filter(t => !t.muted)) {
          const stemRender = await renderWorkbenchProject({ ...loaded.project, tracks: [track] }, loaded.clips, loaded.notesByClip, { sampleRate: Number(form.sampleRate) });
          if (!stemRender.pcm) { failedTracks.push(track.name || track.id); continue; }
          const { dataUrl } = await encodeForUpload(stemRender.pcm);
          const res = await lensRun({ domain: 'studio', action: 'bounce', input: { projectId, trackId: track.id, format: form.format, sampleRate: Number(form.sampleRate), audioDataUrl: dataUrl, durationSec: Math.round(stemRender.durationSec) } });
          if (res.data?.ok) done++; else failedTracks.push(track.name || track.id);
        }
        if (done > 0) logStudioCollabEdit(projectId, 'bounce', undefined, { format: form.format, sampleRate: Number(form.sampleRate), stems: true });
        setRenderNote(`Rendered ${done} stem${done === 1 ? '' : 's'}.${failedTracks.length ? ` No audio rendered for: ${failedTracks.join(', ')}.` : ''}`);
        await refresh();
        return;
      }
      const { dataUrl, formatNote } = await encodeForUpload(render.pcm);
      const res = await lensRun({ domain: 'studio', action: 'bounce', input: { projectId, format: form.format, sampleRate: Number(form.sampleRate), stems: form.stems, audioDataUrl: dataUrl, durationSec: Math.round(render.durationSec) } });
      if (res.data?.ok) {
        logStudioCollabEdit(projectId, 'bounce', undefined, { format: form.format, sampleRate: Number(form.sampleRate), stems: form.stems });
        setRenderNote(`Rendered ${render.renderedClips} clip${render.renderedClips === 1 ? '' : 's'} (${render.durationSec.toFixed(1)}s at ${render.bpm} BPM).${skippedSummary(render)}${formatNote ? ` ${formatNote}` : ''}`);
      } else {
        setRenderNote(`Bounce failed: ${res.data?.error || 'the server did not accept the render'}`);
      }
      await refresh();
    } catch (e) {
      console.error('[Bounce] bounce', e);
      setRenderNote('Render failed in the browser — see console for details.');
    } finally { setRendering(false); }
  }

  async function publish() {
    if (!projectId || rendering) return;
    setRendering(true);
    setRenderNote(null);
    try {
      const loaded = await loadAndRender();
      if (!loaded) return;
      const { render, project } = loaded;
      if (!render.pcm) {
        // Never publish a placeholder: no renderable material means no
        // publish dialog — the reason is shown instead.
        setRenderNote(`Can't publish yet — nothing in this project renders to audio (no audio clips with sources, no MIDI notes).${skippedSummary(render)}`);
        return;
      }
      setTrackCount(project.tracks?.length || 0);
      setBouncedBuffer(pcmToAudioBuffer(render.pcm));
      setPublishOpen(true);
    } catch (e) {
      console.error('[Bounce] publish render', e);
      setRenderNote('Render failed in the browser — see console for details.');
    } finally { setRendering(false); }
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
          <button onClick={bounce} disabled={rendering} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-50 inline-flex items-center justify-center gap-1">{rendering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}{rendering ? 'Rendering…' : 'Bounce'}</button>
        </div>
      )}
      {projectId && renderNote && (
        <div className="px-3 py-2 border-b border-white/10 text-[11px] text-gray-300" role="status">{renderNote}</div>
      )}
      {projectId && (
        <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2 text-xs text-gray-400">
          <div className="min-w-0">
            <span>Publish as adaptive music for Concordia regions</span>
            {/* Q31: the reference audio is a real in-browser mixdown of this
                project (lib/daw/workbench-render.ts) — no placeholder tone. */}
            <div className="text-[10px] text-gray-500">
              Publishes a real mixdown of your project, rendered in your browser.
            </div>
          </div>
          <button
            onClick={publish}
            disabled={rendering}
            title="Render your project's actual mix in the browser and publish it as the reference audio"
            className="px-2 py-1 text-xs rounded bg-violet-600/30 border border-violet-500/40 text-violet-100 hover:bg-violet-500/40 disabled:opacity-50 inline-flex items-center gap-1 shrink-0"
          >
            {rendering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} Publish
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
                    {r.status === 'pending' && <span className="text-amber-300/80"> · no audio was rendered for this bounce — bounce again to render it in your browser</span>}
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
          manifest={{ format: form.format, sampleRate: Number(form.sampleRate), trackCount }}
          referenceBuffer={bouncedBuffer}
          onClose={() => { setPublishOpen(false); setBouncedBuffer(null); }}
        />
      )}
    </div>
  );
}

export default BouncePanel;
