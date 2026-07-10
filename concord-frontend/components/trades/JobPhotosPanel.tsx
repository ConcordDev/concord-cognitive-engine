'use client';

import { useEffect, useState } from 'react';
import { Camera, Loader2, Plus, Eye, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface JobPhoto {
  id: string;
  jobId: string;
  url: string;
  caption: string;
  kind: 'before' | 'after' | 'issue' | 'general';
  uploadedAt: string;
}

const KIND_CONFIG: Record<JobPhoto['kind'], { label: string; color: string; icon: typeof Eye }> = {
  before: { label: 'Before', color: 'text-blue-400', icon: Eye },
  after: { label: 'After', color: 'text-green-400', icon: CheckCircle2 },
  issue: { label: 'Issue', color: 'text-amber-400', icon: AlertTriangle },
  general: { label: 'General', color: 'text-gray-400', icon: Camera },
};

interface JobPhotosPanelProps {
  jobId: string | null;
  jobTitle?: string | null;
}

// Photo documentation for a single job, backed by the real job-photos-list /
// job-photos-add macros (server/domains/trades.js). Photos are referenced by
// URL — there is no binary upload endpoint, so the input is honestly a URL
// field (matching the pattern used by logistics DeliveryProofPanel), not a
// fake local file picker with a placeholder thumbnail.
export function JobPhotosPanel({ jobId, jobTitle }: JobPhotosPanelProps) {
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [kind, setKind] = useState<JobPhoto['kind']>('before');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!jobId) { setPhotos([]); return; }
    refresh(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function refresh(id: string) {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'trades', action: 'job-photos-list', input: { jobId: id } });
      setPhotos((res.data?.result?.photos || []) as JobPhoto[]);
    } catch (e) { console.error('[JobPhotos] list failed', e); }
    finally { setLoading(false); }
  }

  async function addPhoto() {
    if (!jobId || !url.trim()) return;
    setSaving(true);
    try {
      await lensRun({ domain: 'trades', action: 'job-photos-add', input: { jobId, url: url.trim(), caption: caption.trim(), kind } });
      setUrl('');
      setCaption('');
      await refresh(jobId);
    } catch (e) { console.error('[JobPhotos] add failed', e); }
    finally { setSaving(false); }
  }

  if (!jobId) {
    return (
      <div className="space-y-4">
        <div className="bg-[#0d1117] border border-pink-500/20 rounded-lg p-8 text-center">
          <Camera className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Select a job from the Jobs tab to document its photos.</p>
        </div>
      </div>
    );
  }

  const grouped = (['before', 'after', 'issue', 'general'] as const).map(k => ({
    kind: k,
    entries: photos.filter(p => p.kind === k),
  })).filter(g => g.entries.length > 0);

  return (
    <div className="space-y-4">
      <div className="bg-[#0d1117] border border-pink-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-pink-400" />
            <span className="text-sm font-semibold text-gray-200">Photo documentation</span>
          </div>
          <span className="text-xs text-gray-400 truncate max-w-[200px]">{jobTitle} · {photos.length} photo{photos.length === 1 ? '' : 's'}</span>
        </header>

        {/* Add photo form */}
        <div className="p-3 border-b border-white/10 flex items-end gap-2 flex-wrap">
          <div className="w-28">
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Kind</label>
            <select value={kind} onChange={e => setKind(e.target.value as JobPhoto['kind'])} className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              {Object.entries(KIND_CONFIG).map(([k, cfg]) => <option key={k} value={k}>{cfg.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Photo URL</label>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] uppercase text-gray-500 mb-1">Caption</label>
            <input value={caption} onChange={e => setCaption(e.target.value)} placeholder="e.g. Kitchen rough-in, north wall" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <button
            onClick={addPhoto}
            disabled={!url.trim() || saving}
            className="px-3 py-1.5 text-xs rounded bg-pink-500 text-white font-bold hover:bg-pink-400 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Log photo
          </button>
        </div>

        <div className="max-h-[28rem] overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : photos.length === 0 ? (
            <div className="text-center py-8">
              <Camera className="w-10 h-10 text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No photo documentation logged for this job yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map(({ kind: k, entries }) => {
                const cfg = KIND_CONFIG[k];
                return (
                  <div key={k}>
                    <h4 className={cn('text-xs font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wide', cfg.color)}>
                      <cfg.icon className="w-3.5 h-3.5" /> {cfg.label} ({entries.length})
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {entries.map(p => (
                        <div key={p.id} className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden group">
                          <div className="aspect-video bg-black/40 flex items-center justify-center overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={p.url}
                              alt={p.caption || `${cfg.label} photo`}
                              className="w-full h-full object-cover"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          </div>
                          <div className="p-2">
                            {p.caption && <p className="text-xs text-white truncate">{p.caption}</p>}
                            <p className="text-[10px] text-gray-500 mt-0.5">{new Date(p.uploadedAt).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default JobPhotosPanel;
