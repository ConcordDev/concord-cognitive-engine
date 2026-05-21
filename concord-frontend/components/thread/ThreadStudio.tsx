'use client';

/**
 * ThreadStudio — the publishing surface that closes the Typefully feature
 * gap for the thread lens. Six tabs, each wired to real `thread` macros:
 *  - Accounts   → account-connect / list / update / disconnect
 *  - Media      → media-attach / list / reorder / remove (drag-reorder)
 *  - Calendar   → queue-calendar (week/month grid of scheduled threads)
 *  - AI Assist  → ai-suggest-hook / ai-rewrite
 *  - Style      → cta-templates / restyle-preview (numbering + CTA)
 *  - Analytics  → publish-to-account / engagement-sync / engagement-report
 *
 * No seed data — every value is real user input or computed from the
 * platform state. Empty states say "no data yet".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Users, Image as ImageIcon, CalendarDays, Sparkles, Hash, BarChart3,
  Plus, Trash2, Loader2, GripVertical, Send, RefreshCw, ChevronLeft,
  ChevronRight, Wand2, Link2, AlertCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const PLATFORMS = ['x', 'threads', 'linkedin', 'bluesky', 'mastodon'];
const NUMBERING = ['slash', 'emoji', 'none', 'paren'];

type Tab = 'accounts' | 'media' | 'calendar' | 'ai' | 'style' | 'analytics';

interface Account {
  id: string; platform: string; handle: string; displayName: string;
  status: string; defaults: { numberingStyle: string; ctaTemplate: string | null; autoPlug: string | null };
}
interface DraftMeta { id: string; title: string; platform: string; status: string; postCount: number }
interface MediaItem { id: string; postIndex: number; kind: string; url: string; alt: string | null; order: number }
interface CalCell { date: string; count: number; items: Array<{ id: string; title: string; platform: string; scheduledAt: string; postCount: number }> }
interface Hook { style: string; text: string }
interface CtaTemplate { id: string; label: string; text: string }
interface RestyledPost { index: number; text: string; chars: number }
interface PublishedThread {
  publishId: string; platform: string; handle: string; title: string;
  postCount: number; impressions: number; likes: number; reposts: number; replies: number;
  engagementRate: number; synced: boolean;
}

function Empty({ label }: { label: string }) {
  return <p className="text-[11px] italic text-zinc-600 py-3 text-center">{label}</p>;
}
function ErrLine({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-1 text-[11px] text-rose-400 mt-1">
      <AlertCircle className="w-3 h-3" />{msg}
    </p>
  );
}

export function ThreadStudio() {
  const [tab, setTab] = useState<Tab>('accounts');
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);

  const loadDrafts = useCallback(async () => {
    const r = await lensRun('thread', 'draft-list', {});
    if (r.data?.ok) setDrafts((r.data.result?.drafts as DraftMeta[]) || []);
  }, []);
  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  const tabs: Array<{ id: Tab; label: string; icon: typeof Users }> = [
    { id: 'accounts', label: 'Accounts', icon: Users },
    { id: 'media', label: 'Media', icon: ImageIcon },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'ai', label: 'AI Assist', icon: Sparkles },
    { id: 'style', label: 'Style', icon: Hash },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Send className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-bold text-zinc-100">Thread Studio</h3>
        <span className="text-[11px] text-zinc-500">cross-platform publishing</span>
      </div>
      <div className="flex flex-wrap gap-1 mb-3 border-b border-zinc-800 pb-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded',
              tab === t.id ? 'bg-sky-600 text-white' : 'bg-zinc-900/60 text-zinc-400 hover:text-zinc-200')}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>
      {tab === 'accounts' && <AccountsTab />}
      {tab === 'media' && <MediaTab drafts={drafts} />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'ai' && <AiTab />}
      {tab === 'style' && <StyleTab />}
      {tab === 'analytics' && <AnalyticsTab drafts={drafts} onChange={loadDrafts} />}
    </div>
  );
}

/* ───────────────────────── Accounts ───────────────────────── */
function AccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState('x');
  const [handle, setHandle] = useState('');
  const [oauthToken, setOauthToken] = useState('');
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun('thread', 'account-list', {});
    if (r.data?.ok) setAccounts((r.data.result?.accounts as Account[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setErr('');
    if (!handle.trim()) { setErr('handle required'); return; }
    const r = await lensRun('thread', 'account-connect', { platform, handle, oauthToken });
    if (r.data?.ok) { setHandle(''); setOauthToken(''); await refresh(); }
    else setErr(r.data?.error || 'connect failed');
  }
  async function disconnect(id: string) {
    await lensRun('thread', 'account-disconnect', { id });
    await refresh();
  }
  async function setNumbering(id: string, numberingStyle: string) {
    await lensRun('thread', 'account-update', { id, numberingStyle });
    await refresh();
  }

  if (loading) return <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Connect an account</p>
        <div className="flex flex-wrap gap-1.5">
          <select value={platform} onChange={e => setPlatform(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
            {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input value={handle} onChange={e => setHandle(e.target.value)} placeholder="@handle"
            className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
          <input value={oauthToken} onChange={e => setOauthToken(e.target.value)} placeholder="OAuth token (optional)"
            className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
          <button onClick={connect} className="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Connect
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-1">Paste the token from the platform&apos;s OAuth flow to enable real publishing. Without it the account stays <span className="text-amber-400">pending</span>.</p>
        {err && <ErrLine msg={err} />}
      </div>
      {accounts.length === 0 ? <Empty label="No accounts connected yet" /> : (
        <ul className="space-y-1.5">
          {accounts.map(a => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">@{a.handle} <span className="text-zinc-500 font-normal">· {a.platform}</span></p>
                <p className="text-[10px] text-zinc-500">{a.displayName}</p>
              </div>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
                a.status === 'connected' ? 'bg-emerald-600/20 text-emerald-400' : 'bg-amber-600/20 text-amber-400')}>
                {a.status}
              </span>
              <select value={a.defaults.numberingStyle} onChange={e => setNumbering(a.id, e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[10px] text-zinc-300" aria-label="Numbering style">
                {NUMBERING.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <button onClick={() => disconnect(a.id)} className="text-rose-400 hover:text-rose-300" aria-label="Disconnect account">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────────────────── Media ───────────────────────── */
function MediaTab({ drafts }: { drafts: DraftMeta[] }) {
  const [draftId, setDraftId] = useState('');
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [postIndex, setPostIndex] = useState(1);
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const [kind, setKind] = useState('image');
  const [err, setErr] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => { if (!draftId && drafts.length) setDraftId(drafts[0].id); }, [drafts, draftId]);

  const refresh = useCallback(async () => {
    if (!draftId) { setMedia([]); return; }
    const r = await lensRun('thread', 'media-list', { draftId });
    if (r.data?.ok) setMedia((r.data.result?.media as MediaItem[]) || []);
  }, [draftId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function attach() {
    setErr('');
    if (!draftId) { setErr('select a draft'); return; }
    if (!url.trim()) { setErr('media url required'); return; }
    const r = await lensRun('thread', 'media-attach', { draftId, postIndex, url, alt, kind });
    if (r.data?.ok) { setUrl(''); setAlt(''); await refresh(); }
    else setErr(r.data?.error || 'attach failed');
  }
  async function remove(mediaId: string) {
    await lensRun('thread', 'media-remove', { draftId, mediaId });
    await refresh();
  }
  async function reorder(pIndex: number, orderedIds: string[]) {
    const r = await lensRun('thread', 'media-reorder', { draftId, postIndex: pIndex, order: orderedIds });
    if (r.data?.ok) await refresh();
  }

  const byPost = useMemo(() => {
    const map = new Map<number, MediaItem[]>();
    for (const m of [...media].sort((a, b) => a.order - b.order)) {
      if (!map.has(m.postIndex)) map.set(m.postIndex, []);
      map.get(m.postIndex)!.push(m);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [media]);

  function onDrop(pIndex: number, items: MediaItem[], targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = items.map(m => m.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragId(null);
    void reorder(pIndex, ids);
  }

  return (
    <div className="space-y-3">
      {drafts.length === 0 ? <Empty label="Create a draft in the composer first" /> : (
        <>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              <select value={draftId} onChange={e => setDraftId(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" aria-label="Draft">
                {drafts.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select>
              <input type="number" min={1} value={postIndex}
                onChange={e => setPostIndex(Math.max(1, Number(e.target.value) || 1))}
                className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" aria-label="Post index" />
              <select value={kind} onChange={e => setKind(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" aria-label="Media kind">
                {['image', 'video', 'gif'].map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Media URL (hosted or data URL)"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
            <div className="flex gap-1.5">
              <input value={alt} onChange={e => setAlt(e.target.value)} placeholder="Alt text"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
              <button onClick={attach} className="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1">
                <Plus className="w-3 h-3" />Attach
              </button>
            </div>
            {err && <ErrLine msg={err} />}
          </div>
          {byPost.length === 0 ? <Empty label="No media attached yet" /> : (
            <div className="space-y-2">
              {byPost.map(([pIndex, items]) => (
                <div key={pIndex} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Post {pIndex} · {items.length} media · drag to reorder</p>
                  <ul className="space-y-1">
                    {items.map(m => (
                      <li key={m.id} draggable
                        onDragStart={() => setDragId(m.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => onDrop(pIndex, items, m.id)}
                        className={cn('flex items-center gap-2 rounded border px-2 py-1 cursor-grab',
                          dragId === m.id ? 'border-sky-600 bg-sky-600/10' : 'border-zinc-800 bg-zinc-950')}>
                        <GripVertical className="w-3.5 h-3.5 text-zinc-600" />
                        <span className="text-[10px] px-1 rounded bg-zinc-800 text-zinc-400">{m.kind}</span>
                        <span className="flex-1 truncate text-[11px] text-zinc-300">{m.alt || m.url}</span>
                        <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sky-400" aria-label="Open media">
                          <Link2 className="w-3 h-3" />
                        </a>
                        <button onClick={() => remove(m.id)} className="text-rose-400 hover:text-rose-300" aria-label="Remove media">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── Calendar ───────────────────────── */
function CalendarTab() {
  const [range, setRange] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [cells, setCells] = useState<CalCell[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('thread', 'queue-calendar', { range, anchor: anchor.toISOString() });
    if (r.data?.ok) setCells((r.data.result?.cells as CalCell[]) || []);
    setLoading(false);
  }, [range, anchor]);
  useEffect(() => { void refresh(); }, [refresh]);

  function shift(dir: number) {
    const d = new Date(anchor);
    if (range === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setAnchor(d);
  }
  const total = cells.reduce((a, c) => a + c.count, 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex rounded bg-zinc-900 p-0.5">
          {(['week', 'month'] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={cn('px-2 py-0.5 text-[11px] rounded', range === r ? 'bg-sky-600 text-white' : 'text-zinc-400')}>
              {r}
            </button>
          ))}
        </div>
        <button onClick={() => shift(-1)} className="text-zinc-400 hover:text-zinc-200" aria-label="Previous"><ChevronLeft className="w-4 h-4" /></button>
        <span className="text-[11px] text-zinc-300">{anchor.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
        <button onClick={() => shift(1)} className="text-zinc-400 hover:text-zinc-200" aria-label="Next"><ChevronRight className="w-4 h-4" /></button>
        <button onClick={refresh} className="ml-auto text-zinc-400 hover:text-zinc-200" aria-label="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
        <span className="text-[10px] text-zinc-500">{total} scheduled</span>
      </div>
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" /> : total === 0 ? (
        <Empty label="No scheduled threads in this range — queue a draft from the composer" />
      ) : (
        <div className={cn('grid gap-1', range === 'week' ? 'grid-cols-7' : 'grid-cols-7')}>
          {cells.map(c => {
            const d = new Date(`${c.date}T00:00:00`);
            return (
              <div key={c.date} className={cn('rounded border p-1 min-h-[60px]',
                c.count > 0 ? 'border-sky-700/50 bg-sky-600/10' : 'border-zinc-800 bg-zinc-950')}>
                <p className="text-[9px] text-zinc-500">{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</p>
                {c.items.map(it => (
                  <div key={it.id} className="mt-0.5 rounded bg-sky-600/30 px-1 py-0.5">
                    <p className="text-[9px] text-zinc-100 truncate">{it.title}</p>
                    <p className="text-[8px] text-zinc-400">{new Date(it.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {it.platform}</p>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── AI Assist ───────────────────────── */
function AiTab() {
  const [content, setContent] = useState('');
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [opener, setOpener] = useState('');
  const [rewritten, setRewritten] = useState('');
  const [deltaPct, setDeltaPct] = useState(0);
  const [mode, setMode] = useState<'tighten' | 'punchier' | 'expand'>('tighten');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function suggestHooks() {
    setErr(''); setBusy(true);
    const r = await lensRun('thread', 'ai-suggest-hook', { content });
    setBusy(false);
    if (r.data?.ok) { setHooks((r.data.result?.hooks as Hook[]) || []); setOpener(String(r.data.result?.originalOpener || '')); }
    else setErr(r.data?.error || 'need more content');
  }
  async function rewrite() {
    setErr(''); setBusy(true);
    const r = await lensRun('thread', 'ai-rewrite', { content, mode });
    setBusy(false);
    if (r.data?.ok) { setRewritten(String(r.data.result?.rewritten || '')); setDeltaPct(Number(r.data.result?.deltaPct || 0)); }
    else setErr(r.data?.error || 'rewrite failed');
  }

  return (
    <div className="space-y-2">
      <textarea value={content} onChange={e => setContent(e.target.value)} rows={6}
        placeholder="Paste thread text — get a stronger hook or a tighter rewrite…"
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500" />
      <div className="flex flex-wrap gap-1.5">
        <button onClick={suggestHooks} disabled={busy || !content.trim()}
          className="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
          <Sparkles className="w-3 h-3" />Suggest hooks
        </button>
        <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {(['tighten', 'punchier', 'expand'] as const).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={rewrite} disabled={busy || !content.trim()}
          className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1 disabled:opacity-40">
          <Wand2 className="w-3 h-3" />Rewrite
        </button>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
      </div>
      {err && <ErrLine msg={err} />}
      {opener && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Current opener</p>
          <p className="text-xs text-zinc-400 italic mt-0.5">{opener}</p>
        </div>
      )}
      {hooks.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Hook suggestions</p>
          {hooks.map((h, i) => (
            <button key={i} onClick={() => navigator.clipboard?.writeText(h.text)}
              className="block w-full text-left rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 hover:border-sky-700">
              <span className="text-[9px] uppercase text-sky-400">{h.style}</span>
              <p className="text-xs text-zinc-200">{h.text}</p>
            </button>
          ))}
          <p className="text-[10px] text-zinc-600">Click a hook to copy it.</p>
        </div>
      )}
      {rewritten && (
        <div className="rounded-lg border border-emerald-700/40 bg-emerald-600/5 p-2">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400">Rewritten ({deltaPct > 0 ? '+' : ''}{deltaPct}% length)</p>
          <p className="text-xs text-zinc-200 whitespace-pre-wrap mt-0.5">{rewritten}</p>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Style ───────────────────────── */
function StyleTab() {
  const [content, setContent] = useState('');
  const [numberingStyle, setNumberingStyle] = useState('slash');
  const [templates, setTemplates] = useState<CtaTemplate[]>([]);
  const [ctaText, setCtaText] = useState('');
  const [posts, setPosts] = useState<RestyledPost[]>([]);

  useEffect(() => {
    void lensRun('thread', 'cta-templates', {}).then(r => {
      if (r.data?.ok) setTemplates((r.data.result?.templates as CtaTemplate[]) || []);
    });
  }, []);

  const restyle = useCallback(async () => {
    if (!content.trim()) { setPosts([]); return; }
    const r = await lensRun('thread', 'restyle-preview', { content, numberingStyle, ctaText });
    if (r.data?.ok) setPosts((r.data.result?.posts as RestyledPost[]) || []);
  }, [content, numberingStyle, ctaText]);
  useEffect(() => { const h = setTimeout(() => void restyle(), 250); return () => clearTimeout(h); }, [restyle]);

  return (
    <div className="space-y-2">
      <textarea value={content} onChange={e => setContent(e.target.value)} rows={5}
        placeholder="Thread text — preview numbering styles and CTA below…"
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-sky-500" />
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[10px] text-zinc-500">Numbering:</span>
        {NUMBERING.map(n => (
          <button key={n} onClick={() => setNumberingStyle(n)}
            className={cn('px-2 py-0.5 text-[11px] rounded', numberingStyle === n ? 'bg-sky-600 text-white' : 'bg-zinc-900 text-zinc-400')}>
            {n}
          </button>
        ))}
      </div>
      {templates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-zinc-500 self-center">End CTA:</span>
          {templates.map(t => (
            <button key={t.id} onClick={() => setCtaText(t.text)}
              className="px-2 py-0.5 text-[11px] rounded bg-zinc-900 text-zinc-300 hover:bg-zinc-800">
              {t.label}
            </button>
          ))}
        </div>
      )}
      <input value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="CTA text appended to the final post"
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
      {posts.length === 0 ? <Empty label="Write thread text to preview the styled split" /> : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {posts.map(p => (
            <div key={p.index} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2">
              <p className="text-xs text-zinc-200 whitespace-pre-wrap">{p.text}</p>
              <p className="text-[9px] text-zinc-600 mt-0.5">{p.chars} chars</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Analytics ───────────────────────── */
function AnalyticsTab({ drafts, onChange }: { drafts: DraftMeta[]; onChange: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [threads, setThreads] = useState<PublishedThread[]>([]);
  const [totals, setTotals] = useState<{ impressions: number; likes: number; reposts: number; replies: number } | null>(null);
  const [avgRate, setAvgRate] = useState(0);
  const [draftId, setDraftId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [err, setErr] = useState('');
  const [syncTarget, setSyncTarget] = useState<PublishedThread | null>(null);

  const refresh = useCallback(async () => {
    const [accRes, repRes] = await Promise.all([
      lensRun('thread', 'account-list', {}),
      lensRun('thread', 'engagement-report', {}),
    ]);
    if (accRes.data?.ok) setAccounts((accRes.data.result?.accounts as Account[]) || []);
    if (repRes.data?.ok) {
      setThreads((repRes.data.result?.threads as PublishedThread[]) || []);
      setTotals((repRes.data.result?.totals as typeof totals) || null);
      setAvgRate(Number(repRes.data.result?.avgEngagementRate || 0));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function publish() {
    setErr('');
    if (!draftId || !accountId) { setErr('select a draft and a connected account'); return; }
    const r = await lensRun('thread', 'publish-to-account', { draftId, accountId });
    if (r.data?.ok) { await refresh(); onChange(); }
    else setErr(r.data?.error || 'publish failed');
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">Publish a draft to a connected account</p>
        <div className="flex flex-wrap gap-1.5">
          <select value={draftId} onChange={e => setDraftId(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" aria-label="Draft to publish">
            <option value="">— draft —</option>
            {drafts.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <select value={accountId} onChange={e => setAccountId(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" aria-label="Account">
            <option value="">— account —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.handle} ({a.status})</option>)}
          </select>
          <button onClick={publish} className="px-2 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1">
            <Send className="w-3 h-3" />Publish
          </button>
        </div>
        {err && <ErrLine msg={err} />}
      </div>

      {totals && threads.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {([['Impressions', totals.impressions], ['Likes', totals.likes], ['Reposts', totals.reposts], ['Replies', totals.replies]] as const).map(([k, v]) => (
            <div key={k} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">{k}</p>
              <p className="font-mono text-sm text-sky-300">{v.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
      {threads.length > 0 && <p className="text-[10px] text-zinc-500">Avg engagement rate: <span className="text-sky-300">{avgRate}%</span></p>}

      {threads.length === 0 ? <Empty label="No published threads yet — publish a draft above" /> : (
        <ul className="space-y-1.5">
          {threads.map(t => (
            <li key={t.publishId} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-zinc-100 truncate">{t.title}</p>
                  <p className="text-[10px] text-zinc-500">@{t.handle} · {t.platform} · {t.postCount} posts</p>
                </div>
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
                  t.synced ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400')}>
                  {t.synced ? `${t.engagementRate}% ER` : 'not synced'}
                </span>
                <button onClick={() => setSyncTarget(t)} className="text-sky-400 hover:text-sky-300 text-[11px]">Sync metrics</button>
              </div>
              {t.synced && (
                <div className="flex gap-3 mt-1 text-[10px] text-zinc-500">
                  <span>{t.impressions.toLocaleString()} impr</span>
                  <span>{t.likes} likes</span>
                  <span>{t.reposts} reposts</span>
                  <span>{t.replies} replies</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {syncTarget && <SyncModal thread={syncTarget} onClose={() => setSyncTarget(null)} onDone={() => { setSyncTarget(null); void refresh(); }} />}
    </div>
  );
}

function SyncModal({ thread, onClose, onDone }: { thread: PublishedThread; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState(() =>
    Array.from({ length: thread.postCount }, (_, i) => ({ postIndex: i + 1, impressions: '', likes: '', reposts: '', replies: '' })));
  const [err, setErr] = useState('');

  async function submit() {
    setErr('');
    const perPost = rows.map(r => ({
      postIndex: r.postIndex,
      impressions: Number(r.impressions) || 0,
      likes: Number(r.likes) || 0,
      reposts: Number(r.reposts) || 0,
      replies: Number(r.replies) || 0,
    }));
    const r = await lensRun('thread', 'engagement-sync', { publishId: thread.publishId, perPost });
    if (r.data?.ok) onDone();
    else setErr(r.data?.error || 'sync failed');
  }
  function set(i: number, k: 'impressions' | 'likes' | 'reposts' | 'replies', v: string) {
    setRows(prev => prev.map((row, idx) => idx === i ? { ...row, [k]: v } : row));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-3" onClick={e => e.stopPropagation()}>
        <p className="text-sm font-bold text-zinc-100 mb-2">Sync engagement · {thread.title}</p>
        <p className="text-[10px] text-zinc-500 mb-2">Enter the real per-post numbers from {thread.platform}.</p>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-[10px] text-zinc-500 w-8">#{row.postIndex}</span>
              {(['impressions', 'likes', 'reposts', 'replies'] as const).map(k => (
                <input key={k} type="number" min={0} value={row[k]} onChange={e => set(i, k, e.target.value)}
                  placeholder={k.slice(0, 3)} aria-label={`Post ${row.postIndex} ${k}`}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-200" />
              ))}
            </div>
          ))}
        </div>
        {err && <ErrLine msg={err} />}
        <div className="flex justify-end gap-1.5 mt-2">
          <button onClick={onClose} className="px-2 py-1 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
          <button onClick={submit} className="px-2 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white">Save metrics</button>
        </div>
      </div>
    </div>
  );
}
