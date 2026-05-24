'use client';

/**
 * LaunchCountdown — next-launch countdown timer with webcast embed and
 * an in-browser launch reminder. Data from space.launch-countdown
 * (SpaceX r-spacex API or universal Launch Library 2). No API key.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Timer, Loader2, AlertTriangle, ExternalLink, Bell, BellRing, Rocket,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Countdown {
  found: boolean;
  id?: string;
  name?: string;
  net?: string;
  netUnix?: number;
  tMinusSeconds?: number;
  status?: string;
  provider?: string;
  rocket?: string;
  pad?: string;
  location?: string;
  webcast?: string | null;
  webcastLive?: boolean;
  image?: string | null;
  details?: string | null;
}

function ytEmbed(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|live\/))([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export function LaunchCountdown() {
  const [source, setSource] = useState<'launch-library' | 'spacex'>('launch-library');
  const [data, setData] = useState<Countdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [reminderSet, setReminderSet] = useState(false);
  const reminderRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCountdown = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<Countdown>('space', 'launch-countdown', { source });
    if (r.data?.ok && r.data.result) {
      setData(r.data.result);
      if (r.data.result.tMinusSeconds != null) setRemaining(r.data.result.tMinusSeconds);
    } else {
      setError(r.data?.error || 'Countdown unavailable');
    }
    setLoading(false);
  }, [source]);

  useEffect(() => {
    fetchCountdown();
  }, [fetchCountdown]);

  useEffect(() => {
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => () => {
    if (reminderRef.current) clearTimeout(reminderRef.current);
  }, []);

  const setReminder = useCallback(() => {
    if (!data?.netUnix || !data.name) return;
    const fireInMs = (data.netUnix - 600) * 1000 - Date.now();
    const notify = (title: string, body: string) => {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
      } else {
        // Fallback — surface in-app so the reminder is never silent.
        window.alert(`${title}\n${body}`);
      }
    };
    const arm = () => {
      if (fireInMs > 0) {
        reminderRef.current = setTimeout(
          () => notify('Launch in 10 minutes', `${data.name} — ${data.rocket || ''}`),
          fireInMs,
        );
      }
      setReminderSet(true);
    };
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(arm);
    } else {
      arm();
    }
  }, [data]);

  const days = Math.floor(Math.max(0, remaining) / 86400);
  const hrs = Math.floor((Math.max(0, remaining) % 86400) / 3600);
  const mins = Math.floor((Math.max(0, remaining) % 3600) / 60);
  const secs = Math.floor(Math.max(0, remaining) % 60);
  const embed = ytEmbed(data?.webcast);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Timer className="w-4 h-4 text-amber-400" /> Next Launch Countdown
        </h3>
        <div className="flex gap-1 bg-zinc-900 rounded-lg p-0.5">
          {(['launch-library', 'spacex'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={cn(
                'px-2.5 py-1 rounded text-[11px] font-medium',
                source === s ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300',
              )}
            >
              {s === 'spacex' ? 'SpaceX' : 'All providers'}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {data && data.found && (
        <div className="bg-zinc-900 rounded-xl border border-amber-500/20 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Rocket className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{data.name}</p>
              <p className="text-[11px] text-zinc-400">
                {[data.provider, data.rocket, data.pad].filter(Boolean).join(' · ')}
              </p>
            </div>
            {data.webcastLive && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 font-semibold">
                LIVE
              </span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2">
            {[
              { v: days, l: 'days' },
              { v: hrs, l: 'hours' },
              { v: mins, l: 'min' },
              { v: secs, l: 'sec' },
            ].map((u) => (
              <div key={u.l} className="bg-zinc-950 rounded-lg p-2 text-center border border-zinc-800">
                <p className="text-2xl font-mono font-bold text-amber-400 tabular-nums">
                  {String(Math.max(0, u.v)).padStart(2, '0')}
                </p>
                <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{u.l}</p>
              </div>
            ))}
          </div>

          {remaining <= 0 && (
            <p className="text-xs text-emerald-400 text-center">Liftoff window reached.</p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={setReminder}
              disabled={reminderSet || !data.netUnix}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs',
                reminderSet
                  ? 'bg-emerald-600/20 text-emerald-400'
                  : 'bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50',
              )}
            >
              {reminderSet ? <BellRing className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
              {reminderSet ? 'Reminder set (T-10 min)' : 'Remind me'}
            </button>
            {data.webcast && (
              <a
                href={data.webcast}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open webcast
              </a>
            )}
          </div>

          {embed && (
            <div className="rounded-lg overflow-hidden border border-zinc-800 aspect-video">
              <iframe
                src={embed}
                title={`${data.name} webcast`}
                allow="accelerometer; encrypted-media; picture-in-picture"
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          )}
        </div>
      )}

      {data && !data.found && !error && (
        <p className="text-xs text-zinc-400 text-center py-4">No upcoming launch found.</p>
      )}
    </div>
  );
}
