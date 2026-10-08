'use client';

/**
 * Public, no-account viewer for token-scoped share links (creative proof
 * links, published event pages, shared docs pages, experience clips/reels).
 * Plain fetch against `/api/public-share/:kind/:id` — no cookie, no session.
 * The id is the only access control and resolves server-side to exactly one
 * shared object. Nothing here is writable except a proof reviewer's comment.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Loader2, MapPin, MessageSquare } from 'lucide-react';

export type ShareKind = 'proof' | 'event' | 'docs' | 'experience';

/* eslint-disable @typescript-eslint/no-explicit-any -- each kind returns its own server-defined shape */
type Result = Record<string, any>;

function fmtMs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function DocBlock({ b }: { b: Result }) {
  const t = String(b.text || '');
  switch (b.type) {
    case 'heading1': return <h1 className="mt-6 text-3xl font-semibold">{t}</h1>;
    case 'heading2': return <h2 className="mt-5 text-2xl font-semibold">{t}</h2>;
    case 'heading3': return <h3 className="mt-4 text-xl font-semibold">{t}</h3>;
    case 'bulleted_list': return <p className="ml-5 list-item list-disc">{t}</p>;
    case 'numbered_list': return <p className="ml-5 list-item list-decimal">{t}</p>;
    case 'todo': return <p className="flex gap-2"><input type="checkbox" checked={!!b.checked} readOnly aria-label="done" className="mt-1.5" /><span>{t}</span></p>;
    case 'quote': return <blockquote className="border-l-2 border-zinc-600 pl-4 italic text-zinc-300">{t}</blockquote>;
    case 'code': return <pre className="overflow-x-auto rounded-lg bg-black/50 p-3 font-mono text-[13px]">{t}</pre>;
    case 'callout': return <div className="rounded-lg border border-white/10 bg-white/5 p-3">{t}</div>;
    case 'divider': return <hr className="my-4 border-white/10" />;
    case 'table':
      return Array.isArray(b.rows) ? (
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm">
          <tbody>{b.rows.map((r: string[], i: number) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={`border border-white/10 px-2 py-1 ${i === 0 ? 'font-medium' : ''}`}>{c}</td>)}</tr>
          ))}</tbody>
        </table></div>
      ) : null;
    default: return t ? <p className="leading-relaxed">{t}</p> : null;
  }
}

function ProofView({ id, data, reload }: { id: string; data: Result; reload: () => void }) {
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [at, setAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = data.asset || {};
  const src = String(a.src || '');

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/public-share/proof/${encodeURIComponent(id)}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: body.trim(),
          authorName: name.trim(),
          timestampSec: a.kind === 'video' && at !== '' ? Number(at) : undefined,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setErr(j?.error || 'Comment failed'); return; }
      setBody('');
      reload();
    } catch { setErr('Network error. Please try again.'); } finally { setBusy(false); }
  };

  return (
    <>
      <p className="text-sm text-zinc-500">Review link</p>
      <h1 className="mt-1 text-3xl font-semibold">{data.label || a.name}</h1>
      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black">
        {!src ? <p className="p-6 text-sm text-zinc-500">No preview is available for this asset.</p>
          : a.kind === 'video' ? <video src={src} controls className="w-full" />
          : a.kind === 'audio' ? <audio src={src} controls className="w-full p-4" />
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-supplied asset URL
          : <img src={src} alt={a.name || 'Shared asset'} className="w-full" />}
      </div>
      <section className="mt-6">
        <h2 className="flex items-center gap-2 text-lg font-medium"><MessageSquare className="h-4 w-4" /> Comments ({(data.comments || []).length})</h2>
        <ul className="mt-3 space-y-3">
          {(data.comments || []).map((c: Result) => (
            <li key={c.id} className="rounded-xl border border-white/10 bg-[#111] p-3 text-sm">
              <p className="text-xs text-zinc-500">{c.authorName}{c.timestampSec != null ? ` · at ${fmtMs(c.timestampSec * 1000)}` : ''}</p>
              <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
          {!(data.comments || []).length && <li className="text-sm text-zinc-500">No comments yet.</li>}
        </ul>
        {data.allowComments ? (
          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-[#111] p-4">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm" />
            {a.kind === 'video' && (
              <input value={at} onChange={(e) => setAt(e.target.value)} type="number" min={0} placeholder="Timestamp (seconds, optional)"
                className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm" />
            )}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={1200} placeholder="Leave feedback"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm" />
            {err && <p role="alert" className="text-sm text-rose-300">{err}</p>}
            <button type="button" onClick={() => void submit()} disabled={busy || !body.trim()}
              className="rounded-full bg-teal-400 px-5 py-2 text-sm font-medium text-black disabled:opacity-40">
              {busy ? 'Sending…' : 'Post comment'}
            </button>
          </div>
        ) : <p className="mt-4 text-sm text-zinc-500">Commenting is turned off for this link.</p>}
      </section>
    </>
  );
}

function EventView({ data }: { data: Result }) {
  const e = data.event || {};
  const p = data.publicPage || {};
  return (
    <>
      <p className="flex items-center gap-2 text-sm text-zinc-500"><CalendarDays className="h-4 w-4" /> {e.type || 'Event'}</p>
      <h1 className="mt-1 text-4xl font-semibold">{p.headline || e.name}</h1>
      {p.headline && p.headline !== e.name && <p className="mt-1 text-zinc-400">{e.name}</p>}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-300">
        {e.date && <span>{new Date(e.date).toString() === 'Invalid Date' ? String(e.date) : new Date(e.date).toLocaleString()}</span>}
        {e.venue && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {typeof e.venue === 'string' ? e.venue : e.venue?.name}</span>}
        <span>{data.attendeeCount ?? 0} registered</span>
      </p>
      {p.blurb && <p className="mt-5 whitespace-pre-wrap leading-relaxed text-zinc-200">{p.blurb}</p>}
      {(data.tiers || []).length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-medium">Tickets</h2>
          <ul className="mt-3 space-y-2">
            {data.tiers.map((t: Result) => (
              <li key={t.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-[#111] p-3 text-sm">
                <span>{t.name}{t.description ? <span className="block text-xs text-zinc-500">{t.description}</span> : null}</span>
                <span className="text-right">{Number(t.price) > 0 ? `$${Number(t.price).toFixed(2)}` : 'Free'}
                  <span className="block text-xs text-zinc-500">{t.soldOut ? 'Sold out' : `${t.remaining} left`}</span></span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">Registration for this event is handled by the organiser — contact them directly to reserve a spot.</p>
        </section>
      )}
    </>
  );
}

function ClipRow({ c }: { c: Result }) {
  return (
    <li className="rounded-xl border border-white/10 bg-[#111] p-3 text-sm">
      <p className="font-medium">{c.label}</p>
      <p className="text-xs text-zinc-500">{fmtMs(c.startMs)}–{fmtMs(c.endMs)} · {c.sentiment}</p>
      {c.note && <p className="mt-1 text-zinc-300">{c.note}</p>}
    </li>
  );
}

export default function PublicShareView({ kind, id }: { kind: ShareKind; id: string }) {
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public-share/${kind}/${encodeURIComponent(id)}`);
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.ok) { setError('This link is invalid, was turned off, or the content was removed.'); setData(null); return; }
      setError(null);
      setData(j.result as Result);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  return (
    <main className="min-h-screen bg-[#0a0a0b] px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl">
        {loading ? (
          <div role="status" className="flex items-center gap-2 text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Opening…</div>
        ) : error || !data ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        ) : kind === 'proof' ? <ProofView id={id} data={data} reload={() => void load()} />
          : kind === 'event' ? <EventView data={data} />
          : kind === 'docs' ? (
            <>
              <p className="text-sm text-zinc-500">Shared page · read-only</p>
              <h1 className="mt-1 text-4xl font-semibold">{data.icon} {data.title}</h1>
              <div className="mt-6 space-y-2 text-[15px] text-zinc-200">
                {(data.blocks || []).map((b: Result, i: number) => <DocBlock key={i} b={b} />)}
              </div>
            </>
          ) : data.kind === 'reel' ? (
            <>
              <p className="text-sm text-zinc-500">Highlight reel · {fmtMs(data.reel.totalDurationMs)}</p>
              <h1 className="mt-1 text-3xl font-semibold">{data.reel.name}</h1>
              <ul className="mt-5 space-y-2">{data.reel.clips.map((c: Result, i: number) => <ClipRow key={i} c={c} />)}</ul>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-500">Highlight clip</p>
              <ul className="mt-3 space-y-2"><ClipRow c={data.clip} /></ul>
            </>
          )}
      </div>
    </main>
  );
}
