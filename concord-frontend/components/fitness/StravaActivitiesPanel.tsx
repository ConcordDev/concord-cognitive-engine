'use client';

/**
 * StravaActivitiesPanel — activity feed + logger. Hydrates from
 * fitness.activity-list; logs via fitness.activity-create.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, Heart, Trash2, Flame, Clock, Ruler, TrendingUp, Mountain,
  MessageSquare, ImagePlus, ChevronDown, ChevronUp, Send, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Activity {
  id: string;
  type: string;
  name: string;
  distanceKm: number;
  durationSec: number;
  elevationGainM: number;
  avgHr: number;
  relativeEffort: number;
  paceSecPerKm: number | null;
  date: string;
  kudos: string[];
  comments?: { userId: string; text: string; at: string }[];
  photos?: { id: string; url: string | null; dataUrl: string | null; caption: string | null }[];
}

const TYPES = ['run', 'ride', 'swim', 'walk', 'hike', 'row', 'workout', 'yoga'];

function paceLabel(secPerKm: number | null): string {
  if (!secPerKm || secPerKm <= 0) return '—';
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')}/km`;
}
function durLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function StravaActivitiesPanel() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [totalKm, setTotalKm] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'run', name: '', distanceKm: '', durationMin: '', elevationGainM: '', avgHr: '', calories: '' });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fitness', 'activity-list', {});
    if (r.data?.ok === false) setError(r.data?.error || 'Failed to load activities');
    else {
      setActivities(r.data?.result?.activities || []);
      setTotalKm(r.data?.result?.totalDistanceKm || 0);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async () => {
    const durationSec = Math.round((Number(form.durationMin) || 0) * 60);
    if (durationSec <= 0) { setError('Duration must be greater than zero.'); return; }
    setBusy(true);
    const r = await lensRun('fitness', 'activity-create', {
      type: form.type,
      name: form.name.trim(),
      distanceKm: Number(form.distanceKm) || 0,
      durationSec,
      elevationGainM: Number(form.elevationGainM) || 0,
      avgHr: Number(form.avgHr) || 0,
      calories: Number(form.calories) || 0,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not log activity'); return; }
    setForm({ type: 'run', name: '', distanceKm: '', durationMin: '', elevationGainM: '', avgHr: '', calories: '' });
    setShowForm(false);
    await refresh();
  };

  const kudos = async (a: Activity) => {
    await lensRun('fitness', 'activity-kudos', { id: a.id });
    await refresh();
  };
  const remove = async (a: Activity) => {
    await lensRun('fitness', 'activity-delete', { id: a.id });
    await refresh();
  };

  const addComment = async (a: Activity) => {
    const text = commentDraft.trim();
    if (!text) return;
    const r = await lensRun('fitness', 'activity-kudos', { id: a.id, comment: text });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not post comment'); return; }
    setCommentDraft('');
    await refresh();
  };

  const deleteComment = async (a: Activity, index: number) => {
    await lensRun('fitness', 'activity-comment-delete', { id: a.id, index });
    await refresh();
  };

  const addPhoto = async (a: Activity, file: File) => {
    if (file.size > 2_400_000) { setError('Photo is too large (2.4 MB max).'); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('read failed'));
      reader.readAsDataURL(file);
    }).catch(() => null);
    if (!dataUrl) { setError('Could not read the photo file.'); return; }
    const r = await lensRun('fitness', 'activity-photo-add', { id: a.id, dataUrl });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not attach photo'); return; }
    setError(null);
    await refresh();
  };

  const removePhoto = async (a: Activity, photoId: string) => {
    await lensRun('fitness', 'activity-photo-remove', { id: a.id, photoId });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-400">
          <span className="text-zinc-100 font-semibold">{activities.length}</span> activities ·{' '}
          <span className="text-zinc-100 font-semibold">{totalKm}</span> km logged
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
        >
          <Plus className="w-3.5 h-3.5" /> Log activity
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showForm && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <select
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Distance (km)" inputMode="decimal" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Duration (min)" inputMode="decimal" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Elevation (m)" inputMode="numeric" value={form.elevationGainM} onChange={(e) => setForm({ ...form, elevationGainM: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Avg HR (bpm)" inputMode="numeric" value={form.avgHr} onChange={(e) => setForm({ ...form, avgHr: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Calories" inputMode="numeric" value={form.calories} onChange={(e) => setForm({ ...form, calories: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={submit} disabled={busy}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save activity'}
          </button>
        </div>
      )}

      {activities.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No activities yet. Log your first run, ride or swim.
        </div>
      ) : (
        <ul className="space-y-2">
          {activities.map((a) => (
            <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{a.name}</p>
                  <p className="text-[11px] text-zinc-400 capitalize">{a.type} · {a.date}</p>
                </div>
                <button aria-label="Delete" type="button" onClick={() => remove(a)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-zinc-400">
                <span className="flex items-center gap-1"><Ruler className="w-3 h-3 text-orange-400" />{a.distanceKm} km</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-orange-400" />{durLabel(a.durationSec)}</span>
                <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-orange-400" />{paceLabel(a.paceSecPerKm)}</span>
                {a.elevationGainM > 0 && <span className="flex items-center gap-1"><Mountain className="w-3 h-3 text-orange-400" />{a.elevationGainM} m</span>}
                {a.avgHr > 0 && <span className="flex items-center gap-1"><Heart className="w-3 h-3 text-rose-400" />{a.avgHr} bpm</span>}
                <span className="flex items-center gap-1"><Flame className="w-3 h-3 text-amber-400" />RE {a.relativeEffort}</span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => kudos(a)}
                  className={cn(
                    'flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border transition-colors',
                    (a.kudos?.length || 0) > 0
                      ? 'border-orange-700/50 bg-orange-950/40 text-orange-300'
                      : 'border-zinc-800 text-zinc-400 hover:text-orange-300',
                  )}
                >
                  <Heart className="w-3 h-3" /> {a.kudos?.length || 0} kudos
                </button>
                <button
                  type="button"
                  onClick={() => { setExpanded(expanded === a.id ? null : a.id); setCommentDraft(''); }}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-zinc-800 text-zinc-400 hover:text-orange-300"
                >
                  <MessageSquare className="w-3 h-3" /> {a.comments?.length || 0}
                  {a.photos && a.photos.length > 0 && (
                    <><ImagePlus className="w-3 h-3 ml-1" /> {a.photos.length}</>
                  )}
                  {expanded === a.id ? <ChevronUp className="w-3 h-3 ml-0.5" /> : <ChevronDown className="w-3 h-3 ml-0.5" />}
                </button>
              </div>

              {expanded === a.id && (
                <div className="mt-2 border-t border-zinc-800 pt-2 space-y-2">
                  {/* photos */}
                  <div className="flex flex-wrap gap-2">
                    {(a.photos || []).map((ph) => (
                      <div key={ph.id} className="relative group">
                        <div
                          className="w-20 h-20 rounded-lg bg-zinc-800 bg-cover bg-center border border-zinc-700"
                          style={{ backgroundImage: ph.dataUrl || ph.url ? `url(${ph.dataUrl || ph.url})` : undefined }}
                          role="img"
                          aria-label={ph.caption || 'Activity photo'}
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(a, ph.id)}
                          aria-label="Remove photo"
                          className="absolute -top-1.5 -right-1.5 bg-rose-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    <label className="w-20 h-20 rounded-lg border border-dashed border-zinc-700 flex flex-col items-center justify-center gap-1 cursor-pointer text-zinc-400 hover:text-orange-300 hover:border-orange-700/60">
                      <ImagePlus className="w-4 h-4" />
                      <span className="text-[10px]">Add photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(a, f); e.target.value = ''; }}
                      />
                    </label>
                  </div>

                  {/* comments thread */}
                  <ul className="space-y-1.5">
                    {(a.comments || []).map((c, ci) => (
                      <li key={ci} className="flex items-start gap-2 text-[11px]">
                        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5">
                          <p className="text-zinc-300">{c.text}</p>
                          <p className="text-[10px] text-zinc-400 mt-0.5">
                            {c.userId} · {new Date(c.at).toLocaleString()}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteComment(a, ci)}
                          aria-label="Delete comment"
                          className="text-zinc-600 hover:text-rose-400 mt-1"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                    {(a.comments || []).length === 0 && (
                      <li className="text-[11px] text-zinc-400 italic">No comments yet.</li>
                    )}
                  </ul>
                  <div className="flex items-center gap-1.5">
                    <input
                      placeholder="Add a comment…"
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addComment(a); }}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-100"
                    />
                    <button
                      type="button"
                      onClick={() => addComment(a)}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg"
                    >
                      <Send className="w-3 h-3" /> Post
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
