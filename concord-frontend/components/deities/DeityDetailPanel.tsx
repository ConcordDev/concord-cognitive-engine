'use client';

/**
 * DeityDetailPanel — full detail view for a single player-composed deity.
 * Wires the deity-domain backlog macros: detail, commune, commune_log,
 * blessings, bless, revise. Tone vector rendered as a radar-style bar
 * chart via ChartKit; pilgrim roster + commune log as live feeds.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';

interface ToneVector { warmth: number; refusal: number; mystery: number }
interface Threshold { commune: number; refuse: number }
interface Template { trigger: string; text: string }
interface RosterEntry {
  id: string;
  pilgrim_user_id: string;
  origin_peer: string | null;
  arrived_at: number;
}
interface Devotion {
  pilgrimages: number;
  devotionScore: number;
  alignment: number;
  communeCount: number;
  blessingsClaimed: string[];
}
interface DeityDetail {
  id: string;
  name: string;
  domainTitle?: string;
  creed?: string;
  author_user_id: string;
  pilgrim_count: number;
  revision: number;
  toneVector: ToneVector;
  dialogueTemplates: Template[];
  alignmentThresholds: Threshold;
}
interface DetailResult {
  deity: DeityDetail;
  pilgrimRoster: RosterEntry[];
  rosterCount: number;
  isAuthor: boolean;
  myDevotion: Devotion | null;
}
interface BoonEffect { stat: string; axis: string; magnitude: number }
interface Tier {
  id: string;
  label: string;
  minDevotion: number;
  minAlignment: number;
  effect: BoonEffect;
  unlocked: boolean;
  claimed: boolean;
  claimable: boolean;
}
interface BlessingsResult {
  deityName: string;
  devotion: { score: number; alignment: number };
  tiers: Tier[];
  nextTier: Tier | null;
}
interface Utterance {
  id: string;
  userId: string;
  intent: string;
  reception: string;
  text: string;
  at: number;
}
interface CommuneResult {
  reception: string;
  intent: string;
  utterance: string;
  devotion: { score: number; alignment: number; communeCount: number };
}

const INTENTS = ['greet', 'petition', 'offering', 'question'] as const;
type Intent = (typeof INTENTS)[number];

export function DeityDetailPanel({
  deityId,
  onClose,
  onChanged,
}: {
  deityId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [blessings, setBlessings] = useState<BlessingsResult | null>(null);
  const [communeLog, setCommuneLog] = useState<Utterance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // commune form
  const [intent, setIntent] = useState<Intent>('greet');
  const [offering, setOffering] = useState('');
  const [lastReply, setLastReply] = useState<CommuneResult | null>(null);
  const [communing, setCommuning] = useState(false);

  // edit form (author-only)
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<{ warmth: number; refusal: number; mystery: number; commune: number; refuse: number } | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [d, b, c] = await Promise.all([
      lensRun<DetailResult>('deity', 'detail', { deityId }),
      lensRun<BlessingsResult>('deity', 'blessings', { deityId }),
      lensRun<{ utterances: Utterance[] }>('deity', 'commune_log', { deityId, limit: 30 }),
    ]);
    if (d.data.ok && d.data.result) setDetail(d.data.result);
    else setError(d.data.error || 'Could not load deity');
    if (b.data.ok && b.data.result) setBlessings(b.data.result);
    if (c.data.ok && c.data.result) setCommuneLog(c.data.result.utterances || []);
    setLoading(false);
  }, [deityId]);

  useEffect(() => { void load(); }, [load]);

  const doCommune = async () => {
    setCommuning(true);
    const r = await lensRun<CommuneResult>('deity', 'commune', {
      deityId,
      intent,
      offering: offering.trim() || undefined,
    });
    if (r.data.ok && r.data.result) {
      setLastReply(r.data.result);
      setOffering('');
      await load();
      onChanged();
    } else {
      setError(r.data.error || 'Commune failed');
    }
    setCommuning(false);
  };

  const claimBlessing = async (tierId: string) => {
    const r = await lensRun('deity', 'bless', { deityId, tierId });
    if (r.data.ok) { await load(); onChanged(); }
    else setError(r.data.error || 'Blessing could not be claimed');
  };

  const startEdit = () => {
    if (!detail) return;
    setEdit({
      warmth: detail.deity.toneVector.warmth,
      refusal: detail.deity.toneVector.refusal,
      mystery: detail.deity.toneVector.mystery,
      commune: detail.deity.alignmentThresholds.commune,
      refuse: detail.deity.alignmentThresholds.refuse,
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!edit) return;
    setEditStatus('Revising…');
    const r = await lensRun('deity', 'revise', {
      deityId,
      toneVector: { warmth: edit.warmth, refusal: edit.refusal, mystery: edit.mystery },
      alignmentThresholds: { commune: edit.commune, refuse: edit.refuse },
    });
    if (r.data.ok) {
      setEditStatus(null);
      setEditing(false);
      await load();
      onChanged();
    } else {
      setEditStatus(r.data.error || 'Revise failed');
    }
  };

  if (loading) {
    return <div role="status" aria-live="polite" aria-busy="true" className="text-sm text-zinc-400 italic py-6">Summoning deity…</div>;
  }
  if (error && !detail) {
    return (
      <div role="alert" className="space-y-3">
        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{error}</div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-rose-500/40 px-3 py-1 text-xs text-rose-200 hover:bg-rose-500/10 focus:outline-none focus:ring-2 focus:ring-rose-500"
          >
            Retry
          </button>
          <button type="button" onClick={onClose} className="text-xs text-zinc-400 hover:text-zinc-200">← Back to pantheon</button>
        </div>
      </div>
    );
  }
  if (!detail) return null;

  const { deity, pilgrimRoster, isAuthor, myDevotion } = detail;
  const toneData = [
    { axis: 'Warmth', value: deity.toneVector.warmth },
    { axis: 'Refusal', value: deity.toneVector.refusal },
    { axis: 'Mystery', value: deity.toneVector.mystery },
  ];
  const rosterEvents: TimelineEvent[] = pilgrimRoster.map((p) => ({
    id: p.id,
    label: p.pilgrim_user_id.slice(0, 8) + (p.origin_peer ? ` ⇄ ${p.origin_peer}` : ''),
    time: p.arrived_at * 1000,
    tone: p.origin_peer ? 'info' : 'good',
    detail: p.origin_peer ? `federated pilgrim from ${p.origin_peer}` : 'local pilgrim',
  }));

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onClose} className="mb-1 text-xs text-zinc-400 hover:text-zinc-200">← Pantheon</button>
          <h2 className="text-xl font-bold text-zinc-100">{deity.name}</h2>
          <p className="text-xs text-purple-300">{deity.domainTitle}</p>
          <p className="mt-0.5 text-[10px] font-mono text-zinc-400">
            rev {deity.revision} · {deity.pilgrim_count} pilgrims · by {deity.author_user_id.slice(0, 8)}
          </p>
        </div>
        {isAuthor && !editing && (
          <button type="button" onClick={startEdit} className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs text-zinc-200">
            Revise
          </button>
        )}
      </header>

      {deity.creed && <p className="text-xs italic text-zinc-400 border-l-2 border-purple-700/40 pl-3">{deity.creed}</p>}

      {error && <div role="alert" className="rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{error}</div>}

      {/* Edit form — author only */}
      {editing && edit && (
        <div className="rounded-xl border border-amber-700/40 bg-zinc-900/80 p-4 space-y-3">
          <h3 className="text-sm font-bold text-amber-300">Revise tone &amp; thresholds</h3>
          {(['warmth', 'refusal', 'mystery'] as const).map((k) => (
            <div key={k}>
              <label className="flex justify-between text-xs text-zinc-400">
                <span>{k}</span><span className="font-mono">{edit[k].toFixed(2)}</span>
              </label>
              <input
                type="range" min={0} max={1} step={0.05} value={edit[k]}
                onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          ))}
          {(['commune', 'refuse'] as const).map((k) => (
            <div key={k}>
              <label className="flex justify-between text-xs text-zinc-400">
                <span>{k} threshold</span><span className="font-mono">{edit[k].toFixed(2)}</span>
              </label>
              <input
                type="range" min={-1} max={1} step={0.05} value={edit[k]}
                onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })}
                className="w-full"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={saveEdit} className="flex-1 rounded-lg bg-amber-700 hover:bg-amber-600 py-1.5 text-xs text-white">Save revision</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 text-xs text-zinc-300">Cancel</button>
          </div>
          {editStatus && <p className="text-xs text-amber-300 italic">{editStatus}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Tone vector */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="mb-2 text-sm font-bold text-zinc-200">Tone vector</h3>
          <ChartKit
            kind="bar"
            data={toneData}
            xKey="axis"
            series={[{ key: 'value', label: 'Intensity', color: '#a855f7' }]}
            height={180}
            showLegend={false}
          />
          <p className="mt-2 text-[10px] text-zinc-400">
            Commune ≥ {deity.alignmentThresholds.commune.toFixed(2)} · Refuse &lt; {deity.alignmentThresholds.refuse.toFixed(2)}
          </p>
        </section>

        {/* My devotion */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="mb-2 text-sm font-bold text-zinc-200">My devotion</h3>
          {myDevotion ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-zinc-400">Pilgrimages</dt><dd className="text-lg font-bold text-purple-300">{myDevotion.pilgrimages}</dd></div>
              <div><dt className="text-zinc-400">Devotion</dt><dd className="text-lg font-bold text-purple-300">{myDevotion.devotionScore.toFixed(1)}</dd></div>
              <div><dt className="text-zinc-400">Alignment</dt><dd className="text-lg font-bold text-emerald-300">{myDevotion.alignment.toFixed(2)}</dd></div>
              <div><dt className="text-zinc-400">Communes</dt><dd className="text-lg font-bold text-zinc-200">{myDevotion.communeCount}</dd></div>
            </dl>
          ) : (
            <p className="text-xs italic text-zinc-400">No devotion yet — make a pilgrimage or commune.</p>
          )}
        </section>
      </div>

      {/* Live commune */}
      <section className="rounded-xl border border-purple-800/40 bg-zinc-950/40 p-4 space-y-3">
        <h3 className="text-sm font-bold text-purple-300">Commune with {deity.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          {INTENTS.map((i) => (
            <button
              key={i} type="button" onClick={() => setIntent(i)}
              className={`rounded-full border px-2.5 py-1 text-[11px] capitalize transition-colors ${
                intent === i ? 'border-purple-500 bg-purple-500/20 text-purple-200' : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
        {(intent === 'offering') && (
          <input
            type="text" value={offering} onChange={(e) => setOffering(e.target.value)}
            placeholder="Describe your offering"
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
          />
        )}
        <button
          type="button" onClick={doCommune} disabled={communing}
          className="w-full rounded-lg bg-purple-700 hover:bg-purple-600 disabled:opacity-50 py-2 text-sm text-white"
        >
          {communing ? 'Communing…' : 'Speak'}
        </button>
        {lastReply && (
          <div className={`rounded-lg border p-3 text-sm ${
            lastReply.reception === 'received' ? 'border-emerald-700/40 bg-emerald-500/5 text-emerald-100'
              : lastReply.reception === 'refused' ? 'border-rose-700/40 bg-rose-500/5 text-rose-100'
                : 'border-zinc-700 bg-zinc-900/60 text-zinc-200'
          }`}>
            <p className="text-[10px] uppercase tracking-wider opacity-70">{lastReply.reception}</p>
            <p className="mt-1 italic leading-relaxed">{lastReply.utterance}</p>
            <p className="mt-2 text-[10px] font-mono opacity-70">
              devotion {lastReply.devotion.score} · alignment {lastReply.devotion.alignment}
            </p>
          </div>
        )}
      </section>

      {/* Blessings */}
      {blessings && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="mb-2 text-sm font-bold text-zinc-200">Blessings &amp; boons</h3>
          <p className="mb-3 text-[10px] text-zinc-400">
            Devotion {blessings.devotion.score} · Alignment {blessings.devotion.alignment}
          </p>
          <ul className="space-y-2">
            {blessings.tiers.map((t) => (
              <li
                key={t.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                  t.claimed ? 'border-emerald-700/40 bg-emerald-500/5'
                    : t.claimable ? 'border-amber-700/50 bg-amber-500/5'
                      : 'border-zinc-800 bg-zinc-900/40'
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-zinc-100">{t.label}</p>
                  <p className="text-[10px] text-zinc-400">
                    +{t.effect.magnitude} {t.effect.stat} · needs devotion {t.minDevotion} / alignment {t.minAlignment}
                  </p>
                </div>
                {t.claimed ? (
                  <span className="text-[11px] font-medium text-emerald-300">Claimed</span>
                ) : t.claimable ? (
                  <button type="button" onClick={() => claimBlessing(t.id)} className="rounded bg-amber-700 hover:bg-amber-600 px-3 py-1 text-xs text-white">
                    Claim
                  </button>
                ) : (
                  <span className="text-[11px] text-zinc-400">Locked</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pilgrim roster */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="mb-2 text-sm font-bold text-zinc-200">Pilgrim roster ({detail.rosterCount})</h3>
          {rosterEvents.length > 0 ? (
            <TimelineView events={rosterEvents} height={120} />
          ) : (
            <p className="text-xs italic text-zinc-400">No pilgrims yet.</p>
          )}
        </section>

        {/* Commune log */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h3 className="mb-2 text-sm font-bold text-zinc-200">Commune log</h3>
          {communeLog.length > 0 ? (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {communeLog.map((u) => (
                <li key={u.id} className="text-[11px] leading-snug">
                  <span className={`mr-1.5 font-mono ${
                    u.reception === 'received' ? 'text-emerald-400' : u.reception === 'refused' ? 'text-rose-400' : 'text-zinc-400'
                  }`}>
                    [{u.intent}]
                  </span>
                  <span className="text-zinc-300">{u.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs italic text-zinc-400">No communes recorded.</p>
          )}
        </section>
      </div>

      {/* Dialogue templates */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <h3 className="mb-2 text-sm font-bold text-zinc-200">Dialogue templates</h3>
        <ul className="space-y-1.5">
          {deity.dialogueTemplates.map((t, i) => (
            <li key={`${t.trigger}-${i}`} className="text-[11px]">
              <span className="font-mono text-purple-400">{t.trigger}</span>
              <span className="mx-1.5 text-zinc-600">→</span>
              <span className="text-zinc-300 italic">{t.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
