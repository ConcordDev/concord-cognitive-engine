'use client';

/**
 * CalendarParityHub — Google Calendar 2026 feature-parity surface.
 *
 * Tabbed hub wiring the six backend backlog macros to real, purpose-built
 * UI: external account sync (ICS feed subscription), per-calendar sharing
 * + permissions, reminders that actually fire, working-location / OOO
 * status events, video-conference link auto-generation, and guest RSVP +
 * invites. Every value here is real user input or computed platform state
 * — no seed or mock data.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Users2, BellRing, MapPin, Video, MailCheck,
  Plus, Trash2, Loader2, Check, X, Link2, AlertCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Shared types ──────────────────────────────────────────────────────
interface Calendar { id: string; name: string; color: string; isDefault: boolean }
interface Account {
  id: string; provider: string; label: string; icsUrl: string;
  direction: string; lastSyncAt: string | null; lastSyncCount: number;
}
interface Share {
  id: string; calendarId: string; calendarName: string;
  sharedWith: string; role: string;
}
interface Reminder {
  id: string; eventTitle: string; occurrenceStart: string; offsetMin: number;
}
interface StatusEvent {
  id: string; title: string; eventCategory: string; start: string;
  end: string; blocksAvailability: boolean;
}
interface CalEvent { id: string; title: string; start: string; conferenceLink?: string }
interface Invite {
  id: string; token: string; eventId: string; eventTitle: string;
  guest: string; rsvp: string;
}

type Tab = 'sync' | 'sharing' | 'reminders' | 'status' | 'conference' | 'invites';

const TABS: { id: Tab; label: string; icon: typeof RefreshCw }[] = [
  { id: 'sync', label: 'Account Sync', icon: RefreshCw },
  { id: 'sharing', label: 'Sharing', icon: Users2 },
  { id: 'reminders', label: 'Reminders', icon: BellRing },
  { id: 'status', label: 'Working / OOO', icon: MapPin },
  { id: 'conference', label: 'Video Links', icon: Video },
  { id: 'invites', label: 'Guest RSVP', icon: MailCheck },
];

const RSVP_COLOR: Record<string, string> = {
  accepted: 'text-emerald-400',
  declined: 'text-rose-400',
  tentative: 'text-amber-400',
  pending: 'text-zinc-400',
};

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function CalendarParityHub() {
  const [tab, setTab] = useState<Tab>('sync');

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 overflow-x-auto">
        <span className="text-xs font-bold text-zinc-300 mr-1 whitespace-nowrap">
          Calendar parity
        </span>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              tab === id
                ? 'bg-blue-600/20 text-blue-300 border border-blue-700/50'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === 'sync' && <SyncPanel />}
        {tab === 'sharing' && <SharingPanel />}
        {tab === 'reminders' && <RemindersPanel />}
        {tab === 'status' && <StatusPanel />}
        {tab === 'conference' && <ConferencePanel />}
        {tab === 'invites' && <InvitesPanel />}
      </div>
    </div>
  );
}

// ── Item 1 — external account sync ────────────────────────────────────
function SyncPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ provider: 'ics', label: '', icsUrl: '', direction: 'two-way' });

  const refresh = useCallback(async () => {
    const r = await lensRun<{ accounts: Account[] }>('calendar', 'accounts-list', {});
    if (r.data?.ok) setAccounts(r.data.result?.accounts || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setErr(null);
    if (!form.label.trim()) { setErr('Account label required.'); return; }
    if (!/^https?:\/\//i.test(form.icsUrl.trim())) { setErr('A valid https iCal feed URL is required.'); return; }
    setBusy('connect');
    const r = await lensRun('calendar', 'accounts-connect', {
      provider: form.provider, label: form.label.trim(),
      icsUrl: form.icsUrl.trim(), direction: form.direction,
    });
    setBusy(null);
    if (r.data?.ok) {
      setForm({ provider: 'ics', label: '', icsUrl: '', direction: 'two-way' });
      await refresh();
    } else { setErr(r.data?.error || 'Could not connect account.'); }
  }
  async function sync(id: string) {
    setErr(null); setBusy(id);
    const r = await lensRun<{ imported: number; updated: number }>('calendar', 'accounts-sync', { id });
    setBusy(null);
    if (!r.data?.ok) setErr(r.data?.error || 'Sync failed.');
    await refresh();
  }
  async function disconnect(id: string) {
    setBusy(id);
    await lensRun('calendar', 'accounts-disconnect', { id });
    setBusy(null);
    await refresh();
  }

  if (loading) return <Spin />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Connect an external Google, Outlook or Apple calendar by its public/secret
        iCal feed URL. Sync pulls live events into a dedicated calendar.
      </p>
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 grid sm:grid-cols-2 gap-2">
        <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
          placeholder="Account label (e.g. Work Google)"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
        <input value={form.icsUrl} onChange={e => setForm({ ...form, icsUrl: e.target.value })}
          placeholder="https://...calendar.ics feed URL"
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
        <select value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200">
          {['ics', 'google', 'outlook', 'apple'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex gap-2">
          <select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200">
            {['two-way', 'pull', 'push'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={connect} disabled={busy === 'connect'}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-1 disabled:opacity-50">
            {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Connect
          </button>
        </div>
      </div>
      {err && <ErrLine msg={err} />}
      {accounts.length === 0 ? (
        <Empty msg="No connected accounts yet." />
      ) : (
        <ul className="space-y-1.5">
          {accounts.map(a => (
            <li key={a.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <Link2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">{a.label}</p>
                <p className="text-[10px] text-zinc-400">
                  {a.provider} · {a.direction} ·{' '}
                  {a.lastSyncAt ? `synced ${fmt(a.lastSyncAt)} (${a.lastSyncCount} events)` : 'never synced'}
                </p>
              </div>
              <button onClick={() => sync(a.id)} disabled={busy === a.id}
                className="px-2 py-1 rounded text-[11px] bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 inline-flex items-center gap-1 disabled:opacity-50">
                {busy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Sync
              </button>
              <button onClick={() => disconnect(a.id)} className="p-1 text-rose-400 hover:text-rose-300" aria-label="Disconnect">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Item 2 — calendar sharing + permissions ───────────────────────────
function SharingPanel() {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ calendarId: '', sharedWith: '', role: 'viewer' });

  const refresh = useCallback(async () => {
    const [c, s] = await Promise.all([
      lensRun<{ calendars: Calendar[] }>('calendar', 'calendars-list', {}),
      lensRun<{ shares: Share[] }>('calendar', 'calendar-shares-list', {}),
    ]);
    const cals = c.data?.result?.calendars || [];
    setCalendars(cals);
    setShares(s.data?.result?.shares || []);
    setForm(f => ({ ...f, calendarId: f.calendarId || cals[0]?.id || '' }));
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function share() {
    setErr(null);
    if (!form.calendarId) { setErr('Select a calendar.'); return; }
    if (!form.sharedWith.trim()) { setErr('Recipient identifier or email required.'); return; }
    const r = await lensRun('calendar', 'calendar-share', {
      calendarId: form.calendarId, sharedWith: form.sharedWith.trim(), role: form.role,
    });
    if (r.data?.ok) { setForm({ ...form, sharedWith: '' }); await refresh(); }
    else setErr(r.data?.error || 'Could not share calendar.');
  }
  async function unshare(id: string) {
    await lensRun('calendar', 'calendar-unshare', { id });
    await refresh();
  }

  if (loading) return <Spin />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Share a calendar with others and control whether they can view, edit or manage it.
      </p>
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 flex flex-wrap gap-2 items-center">
        <select value={form.calendarId} onChange={e => setForm({ ...form, calendarId: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200">
          {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input value={form.sharedWith} onChange={e => setForm({ ...form, sharedWith: e.target.value })}
          placeholder="Person (email or username)"
          className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
        <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200">
          {['viewer', 'editor', 'manager'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={share}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold">
          Share
        </button>
      </div>
      {err && <ErrLine msg={err} />}
      {shares.length === 0 ? (
        <Empty msg="No shares yet." />
      ) : (
        <ul className="space-y-1.5">
          {shares.map(s => (
            <li key={s.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <Users2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="text-xs text-zinc-100 truncate flex-1">{s.sharedWith}</span>
              <span className="text-[10px] text-zinc-400">{s.calendarName}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-300">{s.role}</span>
              <button onClick={() => unshare(s.id)} className="p-1 text-rose-400 hover:text-rose-300" aria-label="Unshare">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Item 3 — reminders that fire ──────────────────────────────────────
function RemindersPanel() {
  const [pending, setPending] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [firedNow, setFiredNow] = useState<number | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    const r = await lensRun<{ pending: Reminder[]; firedNow: number }>(
      'calendar', 'reminders-due', { lookAheadMin: 60 },
    );
    setChecking(false);
    if (r.data?.ok) {
      setPending(r.data.result?.pending || []);
      setFiredNow(r.data.result?.firedNow ?? 0);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void check();
    const t = setInterval(() => { void check(); }, 60_000);
    return () => clearInterval(t);
  }, [check]);

  async function ack(id: string) {
    await lensRun('calendar', 'reminders-acknowledge', { id });
    await check();
  }
  async function ackAll() {
    await lensRun('calendar', 'reminders-acknowledge', { all: true });
    await check();
  }

  if (loading) return <Spin />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-zinc-400 flex-1">
          Reminders fire automatically as each event approaches (checked every minute,
          60-minute look-ahead window).
        </p>
        <button onClick={check} disabled={checking}
          className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1 disabled:opacity-50">
          {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Check now
        </button>
        {pending.length > 0 && (
          <button onClick={ackAll}
            className="px-2 py-1 rounded text-[11px] bg-blue-600/20 text-blue-300 hover:bg-blue-600/30">
            Clear all
          </button>
        )}
      </div>
      {firedNow !== null && firedNow > 0 && (
        <p className="text-[11px] text-emerald-400">
          {firedNow} new reminder{firedNow !== 1 ? 's' : ''} fired.
        </p>
      )}
      {pending.length === 0 ? (
        <Empty msg="No pending reminders." />
      ) : (
        <ul className="space-y-1.5">
          {pending.map(r => (
            <li key={r.id} className="flex items-center gap-2 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
              <BellRing className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">{r.eventTitle}</p>
                <p className="text-[10px] text-zinc-400">
                  starts {fmt(r.occurrenceStart)} · {r.offsetMin} min reminder
                </p>
              </div>
              <button onClick={() => ack(r.id)}
                className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
                <Check className="w-3 h-3" /> Dismiss
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Item 4 — working-location + out-of-office events ──────────────────
function StatusPanel() {
  const [events, setEvents] = useState<StatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: 'working-location', detail: '',
    start: new Date().toISOString().slice(0, 16),
    end: '', allDay: false,
  });

  const refresh = useCallback(async () => {
    const r = await lensRun<{ statusEvents: StatusEvent[] }>(
      'calendar', 'status-events-list', { includeAll: true },
    );
    if (r.data?.ok) setEvents(r.data.result?.statusEvents || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    setErr(null);
    if (!form.start) { setErr('Start date/time required.'); return; }
    const r = await lensRun('calendar', 'status-event-create', {
      kind: form.kind,
      detail: form.detail.trim(),
      start: new Date(form.start).toISOString(),
      end: form.end ? new Date(form.end).toISOString() : undefined,
      allDay: form.allDay,
    });
    if (r.data?.ok) { setForm({ ...form, detail: '' }); await refresh(); }
    else setErr(r.data?.error || 'Could not create status event.');
  }

  if (loading) return <Spin />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Set your working location, out-of-office or focus-time blocks. OOO and
        focus-time block availability so you are not double-booked.
      </p>
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          {[
            { v: 'working-location', l: 'Working location' },
            { v: 'out-of-office', l: 'Out of office' },
            { v: 'focus-time', l: 'Focus time' },
          ].map(k => (
            <button key={k.v} onClick={() => setForm({ ...form, kind: k.v })}
              className={cn('px-2.5 py-1 rounded-lg text-xs border',
                form.kind === k.v
                  ? 'bg-blue-600/20 text-blue-300 border-blue-700/50'
                  : 'border-zinc-800 text-zinc-400 hover:border-zinc-700')}>
              {k.l}
            </button>
          ))}
        </div>
        <input value={form.detail} onChange={e => setForm({ ...form, detail: e.target.value })}
          placeholder={form.kind === 'working-location' ? 'Where? (e.g. Home office)' : 'Detail (e.g. Vacation)'}
          className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
        <div className="flex flex-wrap gap-2 items-center text-xs text-zinc-400">
          <label>Start
            <input type="datetime-local" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}
              className="ml-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200" />
          </label>
          <label>End
            <input type="datetime-local" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}
              className="ml-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-zinc-200" />
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="checkbox" checked={form.allDay} onChange={e => setForm({ ...form, allDay: e.target.checked })} />
            All day
          </label>
          <button onClick={create}
            className="ml-auto px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold">
            Add
          </button>
        </div>
      </div>
      {err && <ErrLine msg={err} />}
      {events.length === 0 ? (
        <Empty msg="No working-location or OOO events yet." />
      ) : (
        <ul className="space-y-1.5">
          {events.map(e => (
            <li key={e.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <MapPin className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">{e.title}</p>
                <p className="text-[10px] text-zinc-400">{fmt(e.start)} → {fmt(e.end)}</p>
              </div>
              <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
                e.blocksAvailability ? 'bg-rose-600/20 text-rose-300' : 'bg-zinc-700/40 text-zinc-300')}>
                {e.blocksAvailability ? 'blocks availability' : 'visible only'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Item 5 — video-conference link auto-generation ────────────────────
function ConferencePanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [provider, setProvider] = useState('jitsi');

  const refresh = useCallback(async () => {
    const now = Date.now();
    const r = await lensRun<{ events: CalEvent[] }>('calendar', 'events-list', {
      rangeStart: new Date(now - 86_400_000).toISOString(),
      rangeEnd: new Date(now + 90 * 86_400_000).toISOString(),
    });
    if (r.data?.ok) {
      const seen = new Set<string>();
      const uniq = (r.data.result?.events || []).filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id); return true;
      });
      setEvents(uniq);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function generate(eventId: string) {
    setBusy(eventId);
    await lensRun('calendar', 'conference-generate', { eventId, provider });
    setBusy(null);
    await refresh();
  }
  async function clear(eventId: string) {
    setBusy(eventId);
    await lensRun('calendar', 'conference-clear', { eventId });
    setBusy(null);
    await refresh();
  }

  if (loading) return <Spin />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-xs text-zinc-400 flex-1">
          Auto-generate a joinable video-conference room for any event. Rooms are
          free and keyless.
        </p>
        <select value={provider} onChange={e => setProvider(e.target.value)}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
          <option value="jitsi">Jitsi Meet</option>
          <option value="concord">Concord Meet</option>
        </select>
      </div>
      {events.length === 0 ? (
        <Empty msg="No events yet — create an event to add a video link." />
      ) : (
        <ul className="space-y-1.5">
          {events.map(e => (
            <li key={e.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <Video className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-zinc-100 truncate">{e.title}</p>
                {e.conferenceLink
                  ? <a href={e.conferenceLink} target="_blank" rel="noreferrer"
                      className="text-[10px] text-blue-400 hover:underline truncate block">{e.conferenceLink}</a>
                  : <p className="text-[10px] text-zinc-400">no video link</p>}
              </div>
              {e.conferenceLink ? (
                <button onClick={() => clear(e.id)} disabled={busy === e.id}
                  className="px-2 py-1 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50">
                  Remove
                </button>
              ) : (
                <button onClick={() => generate(e.id)} disabled={busy === e.id}
                  className="px-2 py-1 rounded text-[11px] bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 inline-flex items-center gap-1 disabled:opacity-50">
                  {busy === e.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Add link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Item 6 — guest RSVP + invites ─────────────────────────────────────
function InvitesPanel() {
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState('');
  const [guests, setGuests] = useState('');
  const [message, setMessage] = useState('');

  const loadEvents = useCallback(async () => {
    const now = Date.now();
    const r = await lensRun<{ events: CalEvent[] }>('calendar', 'events-list', {
      rangeStart: new Date(now - 86_400_000).toISOString(),
      rangeEnd: new Date(now + 90 * 86_400_000).toISOString(),
    });
    if (r.data?.ok) {
      const seen = new Set<string>();
      const uniq = (r.data.result?.events || []).filter(e => {
        if (seen.has(e.id)) return false;
        seen.add(e.id); return true;
      });
      setEvents(uniq);
      setSelectedEvent(s => s || uniq[0]?.id || '');
    }
    setLoading(false);
  }, []);
  const loadInvites = useCallback(async (eventId: string) => {
    if (!eventId) { setInvites([]); setCounts({}); return; }
    const r = await lensRun<{ invites: Invite[]; rsvpCounts: Record<string, number> }>(
      'calendar', 'invites-list', { eventId },
    );
    if (r.data?.ok) {
      setInvites(r.data.result?.invites || []);
      setCounts(r.data.result?.rsvpCounts || {});
    }
  }, []);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => { void loadInvites(selectedEvent); }, [selectedEvent, loadInvites]);

  async function send() {
    setErr(null);
    if (!selectedEvent) { setErr('Select an event.'); return; }
    const list = guests.split(/[,\n]/).map(g => g.trim()).filter(Boolean);
    if (list.length === 0) { setErr('Add at least one guest email or identifier.'); return; }
    const r = await lensRun('calendar', 'invites-send', {
      eventId: selectedEvent, guests: list, message: message.trim(),
    });
    if (r.data?.ok) { setGuests(''); setMessage(''); await loadInvites(selectedEvent); }
    else setErr(r.data?.error || 'Could not send invites.');
  }
  async function rsvp(token: string, value: string) {
    await lensRun('calendar', 'invite-rsvp', { token, rsvp: value });
    await loadInvites(selectedEvent);
  }
  async function revoke(id: string) {
    await lensRun('calendar', 'invite-revoke', { id });
    await loadInvites(selectedEvent);
  }

  if (loading) return <Spin />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Invite guests to an event and track their RSVPs. Invited guests are also
        written into the event&apos;s ICS export as ATTENDEE lines.
      </p>
      {events.length === 0 ? (
        <Empty msg="No events yet — create an event to invite guests." />
      ) : (
        <>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 space-y-2">
            <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200">
              {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
            <textarea value={guests} onChange={e => setGuests(e.target.value)}
              placeholder="Guest emails / usernames, comma or newline separated"
              rows={2}
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100 resize-none" />
            <input value={message} onChange={e => setMessage(e.target.value)}
              placeholder="Optional message"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
            <button onClick={send}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold inline-flex items-center gap-1">
              <MailCheck className="w-3.5 h-3.5" /> Send invites
            </button>
          </div>
          {err && <ErrLine msg={err} />}
          {invites.length > 0 && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {(['accepted', 'tentative', 'declined', 'pending'] as const).map(k => (
                <span key={k} className={cn('px-1.5 py-0.5 rounded bg-zinc-800', RSVP_COLOR[k])}>
                  {k}: {counts[k] || 0}
                </span>
              ))}
            </div>
          )}
          {invites.length === 0 ? (
            <Empty msg="No invites for this event yet." />
          ) : (
            <ul className="space-y-1.5">
              {invites.map(iv => (
                <li key={iv.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-100 truncate">{iv.guest}</p>
                    <p className={cn('text-[10px] capitalize', RSVP_COLOR[iv.rsvp])}>{iv.rsvp}</p>
                  </div>
                  <div className="flex gap-1">
                    {(['accepted', 'tentative', 'declined'] as const).map(v => (
                      <button key={v} onClick={() => rsvp(iv.token, v)}
                        className={cn('px-1.5 py-0.5 rounded text-[10px] border',
                          iv.rsvp === v
                            ? 'border-blue-700/50 bg-blue-600/20 text-blue-300'
                            : 'border-zinc-800 text-zinc-400 hover:border-zinc-700')}>
                        {v[0].toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => revoke(iv.id)} className="p-1 text-rose-400 hover:text-rose-300" aria-label="Revoke invite">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────
function Spin() {
  return (
    <div className="flex items-center justify-center py-6 text-zinc-400">
      <Loader2 className="w-4 h-4 animate-spin" />
    </div>
  );
}
function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-zinc-400 italic py-2">{msg}</p>;
}
function ErrLine({ msg }: { msg: string }) {
  return (
    <p className="text-[11px] text-rose-400 inline-flex items-center gap-1">
      <AlertCircle className="w-3 h-3" /> {msg}
    </p>
  );
}
