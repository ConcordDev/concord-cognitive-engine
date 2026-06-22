'use client';

// concord-frontend/components/home/MyDashboard.tsx
//
// The user "My Dashboard" — Concord's home surface, restyled to the clean dark
// operator-console feel of the reference: main column (quick-action cards → a
// "My Activity" hero chart with Daily/Weekly/Monthly → a Concordia-events list)
// + a right comms rail (who's around · messages · update news · quick post).
// The left icon sidebar is provided by AppShell/Sidebar, so this is the inner
// content. Every widget is personalizable (show/hide) via useDashboardPrefs, and
// a "Classic view" escape renders the legacy panel dashboard.
//
// Reuses, doesn't rebuild: ChartKit (viz), PresenceIndicator + QuickPostComposer
// (social), the existing /api hooks, and the --lattice / --neon theme tokens.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles, Globe2, Users, MessageSquare, Newspaper, Activity,
  Settings2, ChevronRight, CalendarClock, Trophy, Radio, X,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { ChartKit } from '@/components/viz/ChartKit';
import { PresenceIndicator } from '@/components/social/PresenceIndicator';
import { QuickPostComposer } from '@/components/social/QuickPostComposer';
import { useDashboardPrefs, DASHBOARD_WIDGETS, type DashboardWidget } from '@/lib/hooks/useDashboardPrefs';

// Resilient GET — any failure yields a safe empty value so a widget degrades to
// its empty state instead of crashing the dashboard.
async function safeGet<T>(url: string, fallback: T): Promise<T> {
  try { const r = await api.get(url); return (r?.data ?? fallback) as T; } catch { return fallback; }
}

// ── Card shell ────────────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-lattice-border bg-lattice-surface/80 backdrop-blur-sm ${className}`}>
      {children}
    </div>
  );
}
function CardHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      {action}
    </div>
  );
}

// ── 1) Quick-action feature cards (Tariff/Options/Subscription → Concord core) ──
const ACTIONS = [
  { href: '/lenses/studio', icon: Sparkles, accent: 'text-fuchsia-300', ring: 'border-fuchsia-500/30 bg-fuchsia-500/5',
    title: 'Create', bullets: ['Mint a thought into a DTU', 'Author in the studio', 'Publish to the commons'] },
  { href: '/lenses/world', icon: Globe2, accent: 'text-sky-300', ring: 'border-sky-500/30 bg-sky-500/5',
    title: 'Concordia', bullets: ['Enter the world via the Concord Link', 'Join live events & quests', 'Carry your inventory anywhere'] },
  { href: '/lenses/social', icon: Users, accent: 'text-emerald-300', ring: 'border-emerald-500/30 bg-emerald-500/5',
    title: 'Connect', bullets: ['Follow creators & friends', 'Share to the feed', 'Message and collaborate'] },
];
function FeatureCards() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {ACTIONS.map((a) => {
        const Icon = a.icon;
        return (
          <Link key={a.title} href={a.href}
            className={`group rounded-2xl border bg-lattice-surface/80 p-4 transition-all hover:-translate-y-0.5 hover:border-neon-purple/40 ${a.ring}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`grid h-8 w-8 place-items-center rounded-lg bg-lattice-elevated ${a.accent}`}><Icon className="h-4 w-4" /></span>
              <span className="text-sm font-semibold text-zinc-100">{a.title}</span>
              <ChevronRight className="ml-auto h-4 w-4 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-400" />
            </div>
            <ul className="space-y-1.5">
              {a.bullets.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-[11px] text-zinc-400">
                  <span className={`mt-1 h-1 w-1 shrink-0 rounded-full ${a.accent}`} />{b}
                </li>
              ))}
            </ul>
          </Link>
        );
      })}
    </div>
  );
}

// ── 2) "My Activity" hero chart — DTUs bucketed Daily/Weekly/Monthly ────────────
type Range = 'Daily' | 'Weekly' | 'Monthly';
function bucketDtus(items: Array<{ ts: number }>, range: Range) {
  const now = new Date();
  const buckets: { bucket: string; count: number }[] = [];
  const fmtDay = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtMon = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  const n = range === 'Daily' ? 14 : range === 'Weekly' ? 12 : 12;
  for (let i = n - 1; i >= 0; i--) {
    const start = new Date(now); const end = new Date(now);
    if (range === 'Daily') { start.setDate(now.getDate() - i); start.setHours(0, 0, 0, 0); end.setTime(start.getTime() + 86400000); }
    else if (range === 'Weekly') { start.setDate(now.getDate() - i * 7 - now.getDay()); start.setHours(0, 0, 0, 0); end.setTime(start.getTime() + 7 * 86400000); }
    else { start.setMonth(now.getMonth() - i, 1); start.setHours(0, 0, 0, 0); end.setMonth(start.getMonth() + 1, 1); }
    const label = range === 'Monthly' ? fmtMon(start) : fmtDay(start);
    const count = items.filter((x) => x.ts >= start.getTime() && x.ts < end.getTime()).length;
    buckets.push({ bucket: label, count });
  }
  return buckets;
}
function ActivityChart() {
  const [range, setRange] = useState<Range>('Daily');
  const { data } = useQuery({
    queryKey: ['dash-activity-dtus'],
    // mine=true → only the signed-in user's OWN creations (their creation
    // rhythm), never the global published feed.
    queryFn: () => safeGet<{ dtus?: Array<Record<string, unknown>> }>('/api/dtus?mine=true&limit=200&pageSize=200', { dtus: [] }),
    refetchInterval: 60000, retry: 1,
  });
  const items = useMemo(() => {
    const list = (data?.dtus ?? (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
    return list.map((d) => {
      const t = (d.timestamp || d.createdAt || d.created_at) as string | number | undefined;
      return { ts: t ? new Date(t).getTime() : Date.now() };
    }).filter((x) => Number.isFinite(x.ts));
  }, [data]);
  const chartData = useMemo(() => bucketDtus(items, range), [items, range]);
  const total = items.length;

  return (
    <Card>
      <CardHead
        title="My Activity"
        action={
          <div className="flex items-center gap-1 rounded-lg bg-lattice-elevated p-0.5">
            {(['Daily', 'Weekly', 'Monthly'] as Range[]).map((r) => (
              <button key={r} onClick={() => setRange(r)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${range === r ? 'bg-neon-purple/20 text-fuchsia-200' : 'text-zinc-400 hover:text-zinc-200'}`}>{r}</button>
            ))}
          </div>
        }
      />
      <div className="px-2 pb-2">
        {total === 0 ? (
          <div className="m-2 rounded-xl border border-dashed border-lattice-border px-4 py-10 text-center">
            <Sparkles className="mx-auto mb-2 h-5 w-5 text-fuchsia-300/70" />
            <div className="text-[13px] text-zinc-300">No thoughts minted yet</div>
            <div className="mt-1 text-[11px] text-zinc-500">
              Your creation rhythm shows up here. <Link href="/lenses/studio" className="text-neon-purple hover:underline">Mint your first thought</Link>.
            </div>
          </div>
        ) : (
          <>
            <div className="px-2 pb-1 text-[11px] text-zinc-500">{total} thoughts minted · your creation rhythm</div>
            <ChartKit kind="area" data={chartData} xKey="bucket"
              series={[{ key: 'count', label: 'DTUs', color: '#a855f7' }]} height={220} />
          </>
        )}
      </div>
    </Card>
  );
}

// ── 3) Concordia events list (Current Partnerships → live world events) ─────────
interface WorldEvent { id: string; name?: string; title?: string; type?: string; status?: string; participant_count?: number; world_id?: string }
function ConcordiaEvents() {
  const { data } = useQuery({
    queryKey: ['dash-world-events'],
    queryFn: () => safeGet<{ events?: WorldEvent[] }>('/api/world/events?status=active&limit=6', { events: [] }),
    refetchInterval: 45000, retry: 1,
  });
  const events = (data?.events ?? []).slice(0, 6);
  return (
    <Card>
      <CardHead title="Concordia Events" action={<Link href="/lenses/world" className="text-[11px] text-neon-purple hover:underline">Enter world</Link>} />
      <div className="px-3 pb-3">
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-lattice-border px-3 py-6 text-center text-[12px] text-zinc-500">
            No live events right now — <Link href="/lenses/world" className="text-neon-purple hover:underline">start one</Link> in Concordia.
          </div>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-xl border border-lattice-border bg-lattice-elevated/40 px-3 py-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-neon-purple/10 text-fuchsia-300"><CalendarClock className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-zinc-100">{e.name || e.title || 'World event'}</div>
                  <div className="truncate text-[11px] text-zinc-500">{e.type || 'event'}{typeof e.participant_count === 'number' ? ` · ${e.participant_count} joined` : ''}</div>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Active</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── Right rail: who's around ────────────────────────────────────────────────────
const PRESENCE_COLORS = ['#a855f7', '#06b6d4', '#22c55e', '#ec4899', '#f59e0b', '#6366f1'];
function PresenceCard() {
  const { data } = useQuery({
    queryKey: ['dash-presence'],
    queryFn: () => safeGet<{ users?: Array<{ userId: string; displayName?: string; status?: string }> }>('/api/presence/active?lens=feed&windowMs=300000&limit=8', { users: [] }),
    refetchInterval: 30000, retry: 1,
  });
  const users = (data?.users ?? []).map((u, i) => ({
    id: u.userId, name: u.displayName || 'Someone', color: PRESENCE_COLORS[i % PRESENCE_COLORS.length],
    status: (u.status === 'idle' ? 'idle' : 'active') as 'active' | 'idle' | 'viewing',
  }));
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Who’s around</div>
          <div className="text-[11px] text-zinc-500">{users.length} active in the commons</div>
        </div>
        <Link href="/lenses/chat" className="rounded-lg bg-neon-purple/20 px-2.5 py-1 text-[11px] font-medium text-fuchsia-200 hover:bg-neon-purple/30">Ask Concord</Link>
      </div>
      {users.length === 0
        ? <div className="text-[12px] text-zinc-500">Quiet right now. You could be the spark.</div>
        : <PresenceIndicator users={users} maxVisible={6} />}
    </Card>
  );
}

// ── Right rail: messages ─────────────────────────────────────────────────────────
interface Conversation { id?: string; conversationId?: string; withName?: string; otherName?: string; displayName?: string; lastMessage?: string; preview?: string; unread?: number }
function MessagesCard() {
  const { data } = useQuery({
    queryKey: ['dash-dm'],
    queryFn: () => safeGet<{ conversations?: Conversation[] }>('/api/social/dm/conversations', { conversations: [] }),
    refetchInterval: 30000, retry: 1,
  });
  const convos = (data?.conversations ?? []).slice(0, 5);
  return (
    <Card>
      <CardHead title="Messages" action={<Link href="/lenses/message" className="text-[11px] text-neon-purple hover:underline">Open</Link>} />
      <div className="px-2 pb-2">
        {convos.length === 0 ? (
          <div className="px-2 py-4 text-[12px] text-zinc-500">No messages yet.</div>
        ) : (
          <ul>
            {convos.map((c, i) => (
              <li key={c.id || c.conversationId || i}>
                <Link href="/lenses/message" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-lattice-elevated/60">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neon-purple/15 text-[11px] font-semibold text-fuchsia-200">
                    {(c.withName || c.otherName || c.displayName || '·').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-zinc-200">{c.withName || c.otherName || c.displayName || 'Direct message'}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{c.lastMessage || c.preview || '—'}</span>
                  </span>
                  {!!c.unread && <span className="shrink-0 rounded-full bg-rose-500/80 px-1.5 text-[10px] font-semibold text-white">{c.unread}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── Right rail: update news (recent platform events) ─────────────────────────────
interface NewsItem { id?: string; type?: string; title?: string; message?: string; summary?: string; createdAt?: string; at?: string }
function NewsCard() {
  const { data } = useQuery({
    queryKey: ['dash-news'],
    queryFn: () => safeGet<{ events?: NewsItem[] } | NewsItem[]>('/api/events?limit=8', { events: [] }),
    refetchInterval: 60000, retry: 1,
  });
  const items = (Array.isArray(data) ? data : data?.events ?? []).slice(0, 6);
  return (
    <Card>
      <CardHead title="Update News" action={<Radio className="h-3.5 w-3.5 text-zinc-500" />} />
      <div className="px-3 pb-3">
        {items.length === 0 ? (
          <div className="text-[12px] text-zinc-500">All quiet on the substrate.</div>
        ) : (
          <ul className="space-y-2">
            {items.map((n, i) => (
              <li key={n.id || i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neon-cyan" />
                <span className="min-w-0 text-[12px] text-zinc-300">
                  <span className="line-clamp-2">{n.title || n.message || n.summary || n.type || 'Update'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ── Customize popover ────────────────────────────────────────────────────────────
function Customize({ prefs, isVisible, toggle, setClassic, reset, onClose }:
  ReturnType<typeof useDashboardPrefs> & { onClose: () => void }) {
  return (
    <div className="absolute right-0 top-10 z-30 w-64 rounded-2xl border border-lattice-border bg-lattice-surface p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-zinc-200">Customize dashboard</span>
        <button aria-label="Close" onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-1">
        {DASHBOARD_WIDGETS.map((w) => (
          <label key={w.id} className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 hover:bg-lattice-elevated/60">
            <span className="text-[12px] text-zinc-300">{w.label}</span>
            <input type="checkbox" checked={isVisible(w.id as DashboardWidget)} onChange={() => toggle(w.id as DashboardWidget)} className="accent-fuchsia-500" />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-lattice-border pt-2">
        <button onClick={reset} className="text-[11px] text-zinc-500 hover:text-zinc-300">Reset</button>
        <button onClick={() => setClassic(!prefs.classic)} className="text-[11px] text-neon-purple hover:underline">
          {prefs.classic ? 'New view' : 'Classic view'}
        </button>
      </div>
    </div>
  );
}

// ── The dashboard ────────────────────────────────────────────────────────────────
export function MyDashboard({ dash: dashProp }: { dash?: ReturnType<typeof useDashboardPrefs> } = {}) {
  const { user } = useAuth();
  const ownDash = useDashboardPrefs();
  const dash = dashProp ?? ownDash; // shared instance when the switcher owns it
  const { isVisible } = dash;
  const [customizing, setCustomizing] = useState(false);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = user?.username ? `, ${user.username}` : '';

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5">
      {/* Header */}
      <div className="relative mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-50">My Dashboard</h1>
          <p className="text-[12px] text-zinc-500">{greeting}{name} — here’s your corner of the universe.</p>
        </div>
        <div className="relative flex items-center gap-2">
          <Link href="/lenses/world" className="hidden items-center gap-1.5 rounded-xl border border-lattice-border bg-lattice-surface px-3 py-1.5 text-[12px] text-zinc-300 hover:border-neon-purple/40 sm:flex">
            <Trophy className="h-3.5 w-3.5 text-amber-300" /> Concordia
          </Link>
          <button onClick={() => setCustomizing((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl border border-lattice-border bg-lattice-surface px-3 py-1.5 text-[12px] text-zinc-300 hover:border-neon-purple/40">
            <Settings2 className="h-3.5 w-3.5" /> Customize
          </button>
          {customizing && <Customize {...dash} onClose={() => setCustomizing(false)} />}
        </div>
      </div>

      {/* Two-zone body: main column + right comms rail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="space-y-4">
          {isVisible('featureCards') && <FeatureCards />}
          {isVisible('activityChart') && <ActivityChart />}
          {isVisible('concordiaEvents') && <ConcordiaEvents />}
          {!isVisible('featureCards') && !isVisible('activityChart') && !isVisible('concordiaEvents') && (
            <Card className="p-8 text-center text-[13px] text-zinc-500">
              <Activity className="mx-auto mb-2 h-5 w-5 text-zinc-600" />
              Everything’s hidden. <button onClick={() => setCustomizing(true)} className="text-neon-purple hover:underline">Customize</button> to bring widgets back.
            </Card>
          )}
        </div>

        {/* Right comms rail */}
        <div className="space-y-4">
          {isVisible('presence') && <PresenceCard />}
          {isVisible('messages') && <MessagesCard />}
          {isVisible('news') && (
            <div className="flex items-center gap-1.5 px-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-zinc-600">
              <Newspaper className="h-3 w-3" /> Latest
            </div>
          )}
          {isVisible('news') && <NewsCard />}
          {isVisible('quickPost') && (
            <Card className="p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-zinc-200">
                <MessageSquare className="h-3.5 w-3.5 text-emerald-300" /> Share something
              </div>
              {user?.id ? <QuickPostComposer currentUserId={user.id} /> : <div className="text-[12px] text-zinc-500">Sign in to post.</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default MyDashboard;
