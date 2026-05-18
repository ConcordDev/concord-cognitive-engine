'use client';

// StemSplitterPanel — Sprint C Item #4.
//
// Frontend surface for the Demucs stem splitter. Producer drops an
// audio DTU id or a path; the macro splits into 4 stems and returns
// per-stem DTUs. We render the four stem rows + a clear "Demucs not
// installed" path so the panel is honest when the backend isn't
// configured.

import { useState, useEffect, useCallback } from 'react';
import { Scissors, Mic2, Drum, Music2, Waves, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Stem {
  id: string;
  role: 'vocals' | 'drums' | 'bass' | 'other';
  path: string;
}

interface StatusResp {
  ok: boolean;
  available?: boolean;
  backend?: string;
  stats?: { calls?: number; errors?: number; lastError?: string };
}

interface SplitResp {
  ok: boolean;
  reason?: string;
  hint?: string;
  stems?: Stem[];
  fromCache?: boolean;
  durationMs?: number;
}

interface StemSplitterPanelProps {
  parentAudioDtuId?: string;
  parentTitle?: string;
}

const ROLE_META: Record<Stem['role'], { label: string; icon: typeof Drum; color: string }> = {
  vocals: { label: 'Vocals', icon: Mic2,  color: 'neon-pink' },
  drums:  { label: 'Drums',  icon: Drum,  color: 'neon-purple' },
  bass:   { label: 'Bass',   icon: Music2, color: 'neon-green' },
  other:  { label: 'Other',  icon: Waves,  color: 'neon-cyan' },
};

export default function StemSplitterPanel({ parentAudioDtuId, parentTitle }: StemSplitterPanelProps) {
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SplitResp | null>(null);
  const [audioPath, setAudioPath] = useState('');

  const refreshStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domain: 'studio', name: 'stems_status', input: {} }),
      });
      const json = await r.json();
      setStatus(json?.result || json);
    } catch (e) {
      setStatus({ ok: false });
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const split = useCallback(async () => {
    if (!parentAudioDtuId && !audioPath.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          domain: 'studio', name: 'split_audio',
          input: parentAudioDtuId
            ? { parent_audio_dtuId: parentAudioDtuId }
            : { audio_path: audioPath.trim() },
        }),
      });
      const json = await r.json();
      setResult(json?.result || json);
    } catch (e) {
      setResult({ ok: false, reason: e instanceof Error ? e.message : 'request_failed' });
    } finally {
      setBusy(false);
    }
  }, [parentAudioDtuId, audioPath]);

  const demucsMissing = status && !status.available;

  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 text-neon-purple" />
          <h3 className="text-xs font-semibold">Stem Splitter</h3>
          <span className="text-[9px] text-gray-500">Demucs · 4 stems → 4 DTUs</span>
        </div>
        <button
          onClick={refreshStatus}
          className="text-[10px] text-gray-500 hover:text-white flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Status
        </button>
      </div>

      {demucsMissing && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 text-[10px] text-yellow-200 flex items-start gap-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            Demucs isn't installed on this server. Set <code className="bg-black/30 px-1 rounded">DEMUCS_BIN</code>
            {' '}to the demucs binary path and restart the server to enable stem splitting.
          </span>
        </div>
      )}

      {!parentAudioDtuId && (
        <input
          type="text" value={audioPath}
          onChange={e => setAudioPath(e.target.value)}
          placeholder="Path on the server (e.g. ./data/audio/track.wav)"
          className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
        />
      )}
      {parentAudioDtuId && (
        <div className="text-[10px] text-gray-400">
          Source DTU: <span className="font-mono">{parentAudioDtuId}</span>
          {parentTitle && <span className="ml-2 italic">"{parentTitle}"</span>}
        </div>
      )}

      <button
        onClick={split}
        disabled={busy || demucsMissing || (!parentAudioDtuId && !audioPath.trim())}
        className="w-full py-2 bg-neon-purple/20 text-neon-purple rounded-lg text-sm font-medium hover:bg-neon-purple/30 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <Scissors className={cn('w-4 h-4', busy && 'animate-pulse')} />
        {busy ? 'Splitting…' : 'Split into 4 stems'}
      </button>

      {result && !result.ok && (
        <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-[10px] text-red-300">
          {result.reason || 'Split failed'}{result.hint ? ` — ${result.hint}` : ''}
        </div>
      )}

      {result?.ok && result.stems && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-gray-400">
            {result.fromCache ? 'From cache' : `Split in ${(result.durationMs! / 1000).toFixed(1)}s`}
            {' '}· {result.stems.length} stems minted as DTUs
          </div>
          {result.stems.map(s => {
            const m = ROLE_META[s.role];
            const Icon = m?.icon || Waves;
            return (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded border',
                  `bg-${m?.color}/5 border-${m?.color}/20`,
                )}
              >
                <Icon className={`w-4 h-4 text-${m?.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{m?.label || s.role}</div>
                  <div className="text-[9px] text-gray-500 font-mono truncate">{s.path}</div>
                </div>
                <div className="text-[9px] text-gray-500 font-mono">{s.id.slice(-8)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
