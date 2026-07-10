'use client';

/**
 * FediverseIdentityPanel — this instance's own ActivityPub identity: the
 * actor descriptor other Fediverse servers discover via Webfinger/AP GET,
 * the outbox (federated DTU announcements this account has sent), and the
 * inbox (activities received from federated peers).
 *
 * Wires 3 macros registered directly in server/server.js:75804-75821 +
 * :76029-76041 (`federation.actor`, `federation.outbox`, `federation.inbox`
 * — real W3C ActivityPub reads over `lib/activitypub-bridge.js`, backed by
 * the `activitypub_outbox`/`activitypub_inbox` tables) — a real feature
 * with NO frontend before this pass. It's invisible to
 * `scripts/lens-unsurfaced.mjs` because that script only scans
 * `server/domains/*.js`, and these 3 (plus the 5 Commune macros in
 * `CommunesPanel.tsx`) are registered directly in `server.js`.
 *
 * `federation.inbox_receive` is deliberately NOT surfaced here — it's the
 * internal handler the PUBLIC `POST /api/federation/users/:userId/inbox`
 * delivery route uses when a REMOTE peer pushes an activity (HTTP-signature
 * verified). A user never calls it directly; it isn't a missing UI, it's a
 * server-to-server protocol endpoint, same disposition class as any
 * webhook receiver.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { UserCircle2, Send, Inbox as InboxIcon, Loader2, KeyRound, RefreshCw } from 'lucide-react';

interface Actor {
  id: string;
  preferredUsername: string;
  name: string;
  inbox: string;
  outbox: string;
  publicKey?: { publicKeyPem?: string };
}

interface OutboxItem { id: string; type: string; published: number; summary?: string }
interface InboxItem { id: string; type: string; actor?: string; receivedAt: number; processed: boolean }

export function FediverseIdentityPanel() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [outbox, setOutbox] = useState<OutboxItem[] | null>(null);
  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [a, o, i] = await Promise.all([
        lensRun<{ ok: boolean; actor: Actor }>('federation', 'actor', {}),
        lensRun<{ ok: boolean; items: OutboxItem[] }>('federation', 'outbox', { limit: 20 }),
        lensRun<{ ok: boolean; items: InboxItem[] }>('federation', 'inbox', { limit: 20 }),
      ]);
      if (a.data.ok && a.data.result?.actor) setActor(a.data.result.actor);
      else setErr('Could not load your ActivityPub actor descriptor.');
      if (o.data.ok && o.data.result?.items) setOutbox(o.data.result.items);
      if (i.data.ok && i.data.result?.items) setInbox(i.data.result.items);
    } catch {
      setErr('Fediverse identity service unreachable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="rounded-lg border border-sky-500/30 bg-black/60 p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sky-300 font-semibold inline-flex items-center gap-1.5">
          <UserCircle2 className="w-4 h-4" /> My ActivityPub identity
        </h2>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-400">
        This is the Person actor other Fediverse servers (Mastodon, etc.) discover for your account —
        real, protocol-conformant, resolvable via Webfinger. DTUs you publish are announced here as
        Create/Note activities when federation is enabled.
      </p>

      {err && <p className="text-rose-300 text-xs">{err}</p>}

      {actor && (
        <div className="rounded bg-sky-900/20 border border-sky-500/20 p-3 space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-sky-200 font-medium">@{actor.preferredUsername}</span>
            <span className="text-gray-400">{actor.name}</span>
          </div>
          <div className="text-gray-400 font-mono truncate">{actor.id}</div>
          <div className="flex items-center gap-1 text-gray-400">
            <KeyRound className="w-3 h-3" />
            {actor.publicKey?.publicKeyPem ? 'Signing key configured' : 'No signing key configured yet (CONCORD_AP_PUBLIC_KEY_PEM unset)'}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-2 inline-flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5 text-emerald-400" /> Outbox ({outbox?.length ?? 0})
          </h3>
          {!outbox || outbox.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No federated activity sent yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {outbox.map((o) => (
                <li key={o.id} className="border border-white/10 rounded p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-emerald-300 font-medium">{o.type}</span>
                    <span className="text-gray-400">{new Date(o.published * 1000).toLocaleString()}</span>
                  </div>
                  {o.summary && <p className="text-gray-400 mt-0.5 line-clamp-2">{o.summary}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-xs uppercase tracking-wide text-gray-400 mb-2 inline-flex items-center gap-1.5">
            <InboxIcon className="w-3.5 h-3.5 text-amber-400" /> Inbox ({inbox?.length ?? 0})
          </h3>
          {!inbox || inbox.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No activity received from federated peers yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {inbox.map((i) => (
                <li key={i.id} className="border border-white/10 rounded p-2 text-[11px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-amber-300 font-medium">{i.type}</span>
                    <span className="text-gray-400">{new Date(i.receivedAt * 1000).toLocaleString()}</span>
                  </div>
                  {i.actor && <p className="text-gray-400 font-mono truncate mt-0.5">{i.actor}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
