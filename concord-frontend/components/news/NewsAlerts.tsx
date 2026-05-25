'use client';

/**
 * NewsAlerts — breaking-news and followed-topic push alerts. Subscribes via
 * `news.alert-subscribe`, lists active subscriptions, and shows the matched
 * alert feed from `news.alert-feed`. All entries are real article matches.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Bell, BellRing, Zap, Tag, Rss, Trash2, CheckCheck } from 'lucide-react';

import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AlertSub {
  id: string;
  kind: 'breaking' | 'topic' | 'channel';
  target: string;
  createdAt: string;
}

interface AlertItem {
  id: string;
  articleId: string;
  kind: string;
  title: string;
  source: string;
  topic: string;
  deliveredAt: string;
  read: boolean;
}

const KIND_ICON: Record<string, typeof Zap> = { breaking: Zap, topic: Tag, channel: Rss };

export function NewsAlerts() {
  const [subs, setSubs] = useState<AlertSub[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'breaking' | 'topic' | 'channel'>('topic');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, f] = await Promise.all([
      lensRun('news', 'alert-list', {}),
      lensRun('news', 'alert-feed', {}),
    ]);
    if (s.data?.ok) setSubs((s.data.result?.subscriptions as AlertSub[]) || []);
    if (f.data?.ok) {
      setAlerts((f.data.result?.alerts as AlertItem[]) || []);
      setUnread((f.data.result?.unread as number) || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const subscribe = useCallback(async () => {
    if (kind !== 'breaking' && !target.trim()) return;
    setBusy(true);
    await lensRun('news', 'alert-subscribe', {
      kind,
      ...(kind !== 'breaking' ? { target: target.trim() } : {}),
    });
    setTarget('');
    await refresh();
    setBusy(false);
  }, [kind, target, refresh]);

  const unsubscribe = useCallback(async (sub: AlertSub) => {
    await lensRun('news', 'alert-subscribe', {
      kind: sub.kind,
      ...(sub.kind !== 'breaking' ? { target: sub.target } : {}),
    });
    await refresh();
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    await lensRun('news', 'alert-feed', { markRead: true });
    await refresh();
  }, [refresh]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-sky-600/15 to-transparent">
        <Bell className="w-5 h-5 text-sky-400" />
        <h2 className="text-sm font-bold text-zinc-100">Alerts</h2>
        {unread > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500 text-white">
            {unread}
          </span>
        )}
        <span className="text-[11px] text-zinc-400 ml-auto">Breaking + followed-topic push</span>
      </header>

      {/* Subscribe form */}
      <div className="p-3 border-b border-zinc-800 space-y-2">
        <div className="flex gap-1">
          {(['breaking', 'topic', 'channel'] as const).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg capitalize focus:outline-none focus:ring-2 focus:ring-sky-500',
                  kind === k ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Icon className="w-3 h-3" /> {k}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          {kind !== 'breaking' && (
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={kind === 'topic' ? 'Topic to watch (e.g. politics)' : 'Source / channel name'}
              className="input-lattice flex-1 text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') void subscribe(); }}
            />
          )}
          <button
            type="button"
            disabled={busy || (kind !== 'breaking' && !target.trim())}
            onClick={() => void subscribe()}
            className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-lg bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40"
          >
            <BellRing className="w-3 h-3" /> Subscribe
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="p-3 space-y-4">
          {/* Active subscriptions */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-300 mb-2">
              Active subscriptions <span className="text-zinc-600">· {subs.length}</span>
            </h3>
            {subs.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">No alert subscriptions yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {subs.map((sub) => {
                  const Icon = KIND_ICON[sub.kind];
                  return (
                    <li
                      key={sub.id}
                      className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300"
                    >
                      <Icon className="w-3 h-3 text-sky-400" />
                      <span className="capitalize">
                        {sub.kind === 'breaking' ? 'Breaking news' : sub.target}
                      </span>
                      <button
                        type="button"
                        onClick={() => void unsubscribe(sub)}
                        className="text-zinc-600 hover:text-red-400"
                        aria-label="Remove subscription"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Alert feed */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-zinc-300">
                Alert feed <span className="text-zinc-600">· {alerts.length}</span>
              </h3>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
                >
                  <CheckCheck className="w-3 h-3" /> Mark all read
                </button>
              )}
            </div>
            {alerts.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">
                No alerts yet — alerts appear when new articles match a subscription.
              </p>
            ) : (
              <ul className="space-y-1.5 max-h-60 overflow-y-auto">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      'flex items-start gap-2 px-2.5 py-2 rounded-xl border',
                      a.read ? 'border-zinc-800/60 bg-zinc-900/40' : 'border-sky-500/30 bg-sky-500/5',
                    )}
                  >
                    {!a.read && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-1.5 shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-zinc-100">{a.title}</p>
                      <p className="text-[10px] text-zinc-400">
                        <span className="capitalize">{a.kind}</span> · {a.source} ·{' '}
                        {String(a.deliveredAt).slice(0, 16).replace('T', ' ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
