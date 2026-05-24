'use client';

/**
 * FmAwardPicker — a small modal that loads the award catalog from the
 * backend and gives the chosen award to the target topic/post.
 */

import { useEffect, useState } from 'react';
import { X, Award, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface AwardDef { id: string; name: string; icon: string; weight: number }

export function FmAwardPicker({
  target, onClose, onGiven,
}: {
  target: { type: 'topic' | 'post'; id: string };
  onClose: () => void;
  onGiven: () => void;
}) {
  const [catalog, setCatalog] = useState<AwardDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const r = await lensRun('forum', 'award-catalog', {});
      if (live) {
        setCatalog((r.data?.result?.awards as AwardDef[]) || []);
        setLoading(false);
      }
    })();
    return () => { live = false; };
  }, []);

  const give = async (kind: string) => {
    setBusy(kind);
    setError(null);
    const r = await lensRun('forum', 'award-give', { targetType: target.type, targetId: target.id, kind });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to give award'); return; }
    onGiven();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
            <Award className="w-4 h-4 text-amber-400" /> Give an award
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {error && <p className="text-[11px] text-rose-400 px-4 pt-2">{error}</p>}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-3 gap-2 p-4">
            {catalog.map((a) => (
              <button key={a.id} type="button" disabled={!!busy} onClick={() => give(a.id)}
                className="flex flex-col items-center gap-1 p-3 bg-zinc-900 border border-zinc-800 rounded-lg hover:border-amber-500/50 disabled:opacity-40">
                {busy === a.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <span className="text-xl">{a.icon}</span>}
                <span className="text-[11px] text-zinc-200 font-medium">{a.name}</span>
                <span className="text-[10px] text-zinc-500">+{a.weight}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
