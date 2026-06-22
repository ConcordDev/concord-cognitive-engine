'use client';

// Phase DC2 — Courtship lens.
// Lists active courtships + marriages + children. Lets the player
// propose / wed if affinity threshold met.

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { Heart, Crown, Baby, Loader2 } from 'lucide-react';

interface Courtship {
  partner_kind: string;
  partner_id: string;
  affinity: number;
  status: string;
  initiated_at: number;
  last_interaction_at?: number;
}
interface Marriage {
  id: string;
  partner_kind: string;
  partner_id: string;
  married_at: number;
  status: string;
}
interface Child {
  id: string;
  carrier_user_id: string;
  partner_id: string;
  maturity_stage: string;
  born_at: number;
}

export default function CourtshipLensPage() {
  const [courtships, setCourtships] = useState<Courtship[]>([]);
  const [marriages, setMarriages] = useState<Marriage[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cJ, mJ] = await Promise.all([
        fetch('/api/courtship/mine', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/courtship/marriages/mine', { credentials: 'include' }).then(r => r.json()),
      ]);
      if (cJ?.ok) setCourtships(cJ.courtships || []);
      if (mJ?.ok) {
        setMarriages(mJ.marriages || []);
        setChildren(mJ.children || []);
      }
    } catch { /* swallow */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const interact = async (c: Courtship, sentiment: number) => {
    setPending(true);
    try {
      await fetch('/api/courtship/interact', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partnerKind: c.partner_kind, partnerId: c.partner_id, sentiment }),
      });
      refresh();
    } finally { setPending(false); }
  };

  const propose = async (c: Courtship) => {
    setPending(true);
    try {
      await fetch('/api/courtship/propose', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partnerKind: c.partner_kind, partnerId: c.partner_id }),
      });
      refresh();
    } finally { setPending(false); }
  };

  const wed = async (c: Courtship) => {
    setPending(true);
    try {
      await fetch('/api/courtship/wed', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partnerKind: c.partner_kind, partnerId: c.partner_id }),
      });
      refresh();
    } finally { setPending(false); }
  };

  return (
    <LensShell lensId="courtship">
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-pink-200">
          <Heart size={22} /> Courtships
        </h1>
        <p className="text-sm text-zinc-400">Track affinity, propose, wed, raise children.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-pink-300">Active courtships ({courtships.length})</h2>
        {courtships.length === 0 ? (
          <p className="text-xs text-zinc-500">No active courtships. Initiate one via an NPC's context menu.</p>
        ) : (
          <div className="space-y-2">
            {courtships.map((c) => {
              const pct = Math.round((c.affinity || 0) * 100);
              const canPropose = pct >= 60 && c.status !== 'proposed' && c.status !== 'married';
              const canWed = c.status === 'proposed';
              return (
                <div key={c.partner_id} className="rounded-lg border border-pink-500/30 bg-zinc-900/50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-mono text-pink-100">{c.partner_kind}:{c.partner_id.slice(0, 14)}</div>
                      <div className="text-[10px] text-pink-300/60">status: {c.status}</div>
                    </div>
                    <div className="font-mono text-base text-pink-200">{pct}%</div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-pink-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => interact(c, 1)} disabled={pending} className="flex-1 rounded bg-pink-500/30 px-2 py-1 text-[10px] text-pink-100 hover:bg-pink-500/50 disabled:opacity-50">
                      Interact (+)
                    </button>
                    {canPropose && (
                      <button onClick={() => propose(c)} disabled={pending} className="rounded bg-amber-500/40 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/60 disabled:opacity-50">
                        Propose
                      </button>
                    )}
                    {canWed && (
                      <button onClick={() => wed(c)} disabled={pending} className="rounded bg-amber-500/50 px-2 py-1 text-[10px] font-bold text-amber-50 hover:bg-amber-500/70 disabled:opacity-50">
                        ⚭ Wed
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold text-amber-300"><Crown size={14} /> Marriages ({marriages.length})</h2>
        {marriages.length === 0 ? (
          <p className="text-xs text-zinc-500">No active marriages.</p>
        ) : (
          <div className="space-y-1">
            {marriages.map((m) => (
              <div key={m.id} className="flex justify-between rounded border border-amber-500/30 bg-amber-950/30 p-2 text-xs">
                <span className="font-mono text-amber-100">{m.partner_kind}:{m.partner_id.slice(0, 14)}</span>
                <span className="text-amber-300/70">since {new Date(m.married_at * 1000).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold text-emerald-300"><Baby size={14} /> Children ({children.length})</h2>
        {children.length === 0 ? (
          <p className="text-xs text-zinc-500">No children.</p>
        ) : (
          <div className="space-y-1">
            {children.map((c) => (
              <div key={c.id} className="flex justify-between rounded border border-emerald-500/30 bg-emerald-950/30 p-2 text-xs">
                <span className="font-mono text-emerald-100">{c.id.slice(0, 16)}</span>
                <span className="text-emerald-300/70">{c.maturity_stage}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {pending && <div className="text-center text-xs text-pink-300/70"><Loader2 className="inline animate-spin" size={11} /> updating…</div>}
    </div>
    </LensShell>
  );
}
