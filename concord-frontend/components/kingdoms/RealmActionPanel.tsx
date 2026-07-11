'use client';

/**
 * RealmActionPanel — Crusader Kings III-shape realm + decree + takeover
 * action workbench. Surfaces the existing kingdoms.* macros (12+)
 * grouped into a single CK3-style panel: list realms, view my realm,
 * propose decree, recompute loyalty, attempt takeover (conquest /
 * inheritance / election), plus mint/DM/publish/agent.
 */

import { useState, useEffect } from 'react';
import {
  Crown, Scroll, Sword, Heart, Vote, FileText, Sparkles, Send, Globe, Wand2,
  Loader2, Check, AlertTriangle, Map,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { usePipe, useRecallableAction, RecallSlot } from '@/components/panel-polish';

// Realm rows are `SELECT * FROM realms` (migration 158) — snake_case,
// no `loyalty`/`size` columns (loyalty is a separately-computed summary
// from kingdoms.get / kingdoms.recompute_loyalty). Field names verified
// against server/lib/kingdoms.js and the HUDContextProvider consumer
// (components/world/concordia-hud/HUDContextProvider.tsx) which reads
// the exact same `kingdoms.my_realm` macro.
interface Realm {
  id: string;
  name: string;
  world_id?: string;
  capital_settlement_id?: string | null;
  faction_id?: string | null;
  ruler_kind?: string;
  ruler_id?: string | null;
  legitimacy?: number;
  treasury?: number;
  tax_rate?: number;
  founded_at?: number;
}
// propose_decree returns { ok, id, kind, popularity_delta } — flat, not
// the {region, effect} shape this panel used to assume.
interface DecreeResult { id?: string; kind?: string; popularity_delta?: number }
// recompute_loyalty only returns { ok, refreshed, count }; the actual
// loyalty score + rebellion risk comes from kingdoms.kingdom_status's
// separate `loyalty`/`rebellionRisk` fields. actLoyalty() below composes
// both real calls.
interface LoyaltyResult {
  kingdomId?: string; avg?: number; low?: number; high?: number; count?: number; refreshed?: number;
  rebellionScore?: number; rebellionThreshold?: number;
}
// realm_decrees rows my_realm's `activeDecrees` field returns (own SELECT
// list in server/domains/kingdoms.js:101-107 — snake_case, not camelCase).
interface RealmDecree { id: string; kind: string; body_json?: string | null; issued_at?: number; expires_at?: number | null; popularity_delta?: number }
// takeoverBy* return { ok, legitimacy, path } on success or { ok:false, reason } —
// there is no newRulerUserId field (the caller already knows who it is: them).
interface TakeoverResult { ok?: boolean; method?: string; legitimacy?: number; path?: string; reason?: string }

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'list' | 'mine' | 'decree' | 'loyalty' | 'conquest' | 'inheritance' | 'election' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

// POST /api/lens/run wraps the macro's own return as { ok:true, result: PAYLOAD } —
// the outer `ok` is a transport flag, not the macro's success/failure (confirmed
// against server.js's /api/lens/run handler). Every kingdoms.* macro used here
// returns a FLAT payload with its own `ok`/`reason` (never a second nested
// `result`), so this unwraps exactly one level and checks the macro's real `ok`.
// The previous version of this helper skipped that inner check entirely, so
// every macro failure (missing_inputs / invalid_kind / kingdom_not_found / …)
// was rendered as a fake success toast — a real honesty-invariant violation,
// not just a display bug.
async function callKingdoms<T>(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: T; error?: string; reason?: string }> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'kingdoms', name, input });
    const envelope = r.data as { ok?: boolean; result?: unknown; error?: string };
    if (!envelope || envelope.ok === false) return { ok: false, error: envelope?.error || 'request failed' };
    const inner = envelope.result as (T & { ok?: boolean; error?: string; reason?: string }) | undefined;
    if (!inner || typeof inner !== 'object') return { ok: false, error: 'unexpected response' };
    if (inner.ok === false) return { ok: false, error: inner.error, reason: inner.reason };
    return { ok: true, result: inner as T };
  } catch (e) { return { ok: false, error: pickMessage(e) }; }
}

// server/domains/kingdoms.js#propose_decree only accepts these 8 kinds
// (server/lib/kingdom-decrees.js KIND_DEFAULTS) — any other string is
// rejected with reason:'invalid_kind'.
const DECREE_KINDS = [
  { id: 'tax_change', label: 'Tax change' },
  { id: 'conscription', label: 'Conscription' },
  { id: 'trade_embargo', label: 'Trade embargo' },
  { id: 'recipe_grant', label: 'Recipe grant' },
  { id: 'pardon', label: 'Pardon' },
  { id: 'exile', label: 'Exile' },
  { id: 'construction', label: 'Construction' },
  { id: 'festival', label: 'Festival' },
] as const;
type DecreeKind = typeof DECREE_KINDS[number]['id'];

export function RealmActionPanel() {
  const [realmList, setRealmList] = useState<Realm[]>([]);
  const [myRealm, setMyRealm] = useState<Realm | null>(null);
  const [targetRealmId, setTargetRealmId] = useState('');
  const [decreeKind, setDecreeKind] = useState<DecreeKind>('tax_change');
  // Repurposed per decree kind: tax_change reads this as the new tax rate
  // (0-0.50, sent as body.new_rate); other kinds ignore it.
  const [decreeMagnitude, setDecreeMagnitude] = useState('');
  // pardon/exile read this as body.target_npc_id; other kinds ignore it.
  const [decreeTargetNpc, setDecreeTargetNpc] = useState('');
  const [recipient, setRecipient] = useState('');
  // kingdoms.list requires a worldId (server/domains/kingdoms.js:47-53) —
  // follow the same localStorage hint the rest of the world lens uses
  // (see DriftAlertToast.tsx, HUDContextProvider.tsx) rather than the flat
  // 'concordia-hub' default only, so this panel tracks whatever world the
  // player is actually in.
  const [worldId, setWorldId] = useState('concordia-hub');
  useEffect(() => {
    const id = typeof window !== 'undefined' ? localStorage.getItem('concordia:activeWorldId') : null;
    if (id) setWorldId(id);
  }, []);

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [decreeResult, setDecreeResult] = useState<DecreeResult | null>(null);
  const [loyaltyResult, setLoyaltyResult] = useState<LoyaltyResult | null>(null);
  // kingdoms.my_realm's `activeDecrees` field was already being fetched
  // but silently dropped — never rendered, and kingdoms.revoke_decree had
  // zero UI anywhere despite being a real, working macro. Surfacing both.
  const [myRealmDecrees, setMyRealmDecrees] = useState<RealmDecree[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [takeoverResult, setTakeoverResult] = useState<TakeoverResult | null>(null);
  const [mintedDtuId, setMintedDtuId] = useState<string | null>(null);
  const [publishedDtuId, setPublishedDtuId] = useState<string | null>(null);
  const [agentReply, setAgentReply] = useState<string | null>(null);

  const ok  = (text: string) => setFeedback({ kind: 'ok',  text });
  const err = (text: string) => setFeedback({ kind: 'err', text });

  const pipe = usePipe();
  const dmRecall = useRecallableAction({
    label: 'DM',
    windowMs: 60_000,
    onUndo: async (id) => { await api.delete(`/api/social/dm/${encodeURIComponent(id)}`); },
  });
  const publishRecall = useRecallableAction({
    label: 'publish',
    windowMs: 30_000,
    onUndo: async (id) => {
      await api.delete(`/api/dtus/${encodeURIComponent(id)}/publish`);
      setPublishedDtuId(null);
    },
  });

  // Auto-load realm list + my realm on mount (and whenever the active-world
  // hint resolves from localStorage after mount).
  useEffect(() => {
    (async () => {
      try {
        const list = await callKingdoms<{ kingdoms: Realm[] }>('list', { worldId });
        if (list.ok && list.result?.kingdoms) setRealmList(list.result.kingdoms);
      } catch {/* dormant */}
      try {
        const mine = await callKingdoms<{ realm: Realm; activeDecrees?: RealmDecree[] }>('my_realm', {});
        if (mine.ok && mine.result?.realm) {
          setMyRealm(mine.result.realm);
          setMyRealmDecrees(mine.result.activeDecrees || []);
        }
      } catch {/* dormant */}
    })();
  }, [worldId]);

  async function actList() {
    setBusy('list'); setFeedback(null);
    const r = await callKingdoms<{ kingdoms: Realm[] }>('list', { worldId });
    if (r.ok && r.result?.kingdoms) {
      setRealmList(r.result.kingdoms);
      pipe.publish('kingdoms.realmList', r.result.kingdoms, { label: `${r.result.kingdoms.length} realms` });
      ok(`${r.result.kingdoms.length} realms in ${worldId}.`);
    }
    else err(r.error ?? r.reason ?? 'list failed');
    setBusy(null);
  }
  async function actMine() {
    setBusy('mine'); setFeedback(null);
    const r = await callKingdoms<{ realm: Realm; activeDecrees?: RealmDecree[] }>('my_realm', {});
    if (r.ok && r.result?.realm) {
      setMyRealm(r.result.realm);
      setMyRealmDecrees(r.result.activeDecrees || []);
      pipe.publish('kingdoms.myRealm', r.result.realm, { label: r.result.realm.name });
      ok(`My realm: ${r.result.realm.name}.`);
    }
    else err(r.error ?? r.reason ?? 'no realm');
    setBusy(null);
  }
  // kingdoms.revoke_decree was a real, wired macro with zero UI anywhere
  // in the lens — a ruler had no way to repeal their own decree.
  async function actRevokeDecree(decreeId: string) {
    setRevokingId(decreeId); setFeedback(null);
    const r = await callKingdoms<{ ok: boolean }>('revoke_decree', { decreeId });
    if (r.ok) {
      setMyRealmDecrees((prev) => prev.filter((d) => d.id !== decreeId));
      ok('Decree revoked.');
    } else err(r.error ?? r.reason ?? 'revoke failed');
    setRevokingId(null);
  }
  async function actDecree() {
    const kingdomId = targetRealmId.trim();
    if (!kingdomId) { err('Target kingdom id required.'); return; }
    const body: Record<string, unknown> = {};
    if (decreeKind === 'tax_change') {
      const rate = parseFloat(decreeMagnitude);
      if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) { err('New tax rate must be 0–0.50.'); return; }
      body.new_rate = rate;
    } else if (decreeKind === 'pardon' || decreeKind === 'exile') {
      if (!decreeTargetNpc.trim()) { err('Target NPC id required for pardon/exile.'); return; }
      body.target_npc_id = decreeTargetNpc.trim();
    }
    setBusy('decree'); setFeedback(null);
    const r = await callKingdoms<DecreeResult>('propose_decree', { kingdomId, kind: decreeKind, body });
    if (r.ok && r.result) {
      setDecreeResult(r.result);
      pipe.publish('kingdoms.decree', r.result, { label: `${decreeKind} · ${kingdomId.slice(0, 8)}` });
      ok(`Decree issued: ${decreeKind} (popularity Δ ${r.result.popularity_delta ?? 0}).`);
    }
    else err(r.error ?? r.reason ?? 'decree failed');
    setBusy(null);
  }
  async function actLoyalty() {
    const kingdomId = targetRealmId.trim() || myRealm?.id;
    if (!kingdomId) { err('Pick a target realm.'); return; }
    setBusy('loyalty'); setFeedback(null);
    // recompute_loyalty only returns { refreshed, count } — the actual
    // avg/low/high loyalty summary + rebellion risk live on
    // kingdoms.kingdom_status's `loyalty`/`rebellionRisk` fields, so this
    // composes both real calls rather than guessing a shape.
    const recompute = await callKingdoms<{ refreshed: number; count: number }>('recompute_loyalty', { kingdomId });
    if (!recompute.ok) { err(recompute.error ?? recompute.reason ?? 'loyalty failed'); setBusy(null); return; }
    const status = await callKingdoms<{
      kingdom: Realm;
      loyalty: { avg: number; count: number; low: number; high: number };
      rebellionRisk?: { score?: number; threshold?: number };
    }>('kingdom_status', { kingdomId });
    if (status.ok && status.result?.loyalty) {
      const l = status.result.loyalty;
      const rr = status.result.rebellionRisk;
      const next: LoyaltyResult = {
        kingdomId, avg: l.avg, low: l.low, high: l.high, count: l.count, refreshed: recompute.result?.refreshed,
        rebellionScore: rr?.score, rebellionThreshold: rr?.threshold,
      };
      setLoyaltyResult(next);
      pipe.publish('kingdoms.loyalty', next, { label: `loyalty ${next.avg}` });
      ok(`Loyalty avg ${next.avg} (refreshed ${next.refreshed ?? 0}/${next.count ?? 0} citizens).`);
    } else {
      // Recompute genuinely succeeded even though the follow-up summary
      // fetch failed — report the real partial result honestly rather
      // than a generic error.
      ok(`Recomputed loyalty for ${recompute.result?.refreshed ?? 0} citizens.`);
    }
    setBusy(null);
  }
  async function actTakeover(method: 'conquest' | 'inheritance' | 'election') {
    const kingdomId = targetRealmId.trim();
    if (!kingdomId) { err('Target realm id required.'); return; }
    setBusy(method); setFeedback(null);
    const macroName = method === 'conquest' ? 'takeover_conquest' : method === 'inheritance' ? 'takeover_inheritance' : 'takeover_election';
    // takeoverBy* return { legitimacy, path } on success — no proof of a real
    // ruler-kill / capital-hold is fabricated client-side here (conquest
    // without proof.rulerKilledAt/capitalHeldSince honestly fails with
    // reason:'ruler_not_killed' — that's the correct behaviour, not a bug).
    const r = await callKingdoms<TakeoverResult>(macroName, { kingdomId });
    if (r.ok && r.result) {
      const next: TakeoverResult = { ...r.result, ok: true, method };
      setTakeoverResult(next);
      pipe.publish('kingdoms.takeover', next, { label: `${method} · success` });
      ok(`${method}: you now rule (legitimacy ${r.result.legitimacy ?? '?'}).`);
    } else {
      const reason = r.error ?? r.reason ?? `${method} failed`;
      setTakeoverResult({ method, ok: false, reason });
      err(reason);
    }
    setBusy(null);
  }

  async function actMint() {
    setBusy('mint'); setFeedback(null);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: {
          title: `Realm snapshot — ${myRealm?.name ?? 'realmless'}`,
          tags: ['kingdoms', 'realm', myRealm?.id ? `realm:${myRealm.id}` : 'unowned'],
          source: 'kingdoms:realm:mint',
          meta: { visibility: 'private', consent: { allowCitations: false }, realm: { mine: myRealm, all: realmList.slice(0, 50), recentDecree: decreeResult, loyalty: loyaltyResult, takeover: takeoverResult } },
        },
      });
      const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
      const id = dtu?.id ?? dtu?.dtuId;
      if (id) {
        setMintedDtuId(id);
        pipe.publish('kingdoms.mintedDtuId', id, { label: `realm DTU ${id.slice(0, 8)}` });
        ok(`Realm DTU ${id.slice(0, 8)}…`);
      }
      else err('No DTU id returned.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actDm() {
    if (!recipient.trim()) { err('Enter a recipient.'); return; }
    setBusy('dm'); setFeedback(null);
    const body = [
      `👑 Realm dispatch`,
      myRealm ? `From: ${myRealm.name} (capital ${myRealm.capital_settlement_id ?? '—'})` : '',
      loyaltyResult ? `Loyalty: avg ${loyaltyResult.avg} (low ${loyaltyResult.low} / high ${loyaltyResult.high})` : '',
      decreeResult ? `Recent decree: ${decreeResult.kind ?? '—'} (popularity Δ ${decreeResult.popularity_delta ?? 0}) in ${targetRealmId || '—'}` : '',
      takeoverResult ? `Takeover (${takeoverResult.method}): ${takeoverResult.ok ? 'succeeded' : 'failed'}${takeoverResult.reason ? ` — ${takeoverResult.reason}` : ''}` : '',
      mintedDtuId ? `\n[Realm DTU ${mintedDtuId}]` : '',
    ].filter(Boolean).join('\n');
    try {
      const messageId = await dmRecall.run(async () => {
        const r = await api.post('/api/social/dm', { toUserId: recipient.trim(), content: body });
        if (r.data?.ok === false) throw new Error(r.data?.error ?? 'send failed');
        return r.data?.message?.id as string;
      });
      if (messageId) { ok('Dispatch sent. 60s to recall.'); setRecipient(''); }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actPublish() {
    if (!decreeResult) { err('Issue a decree first.'); return; }
    setBusy('publish'); setFeedback(null);
    try {
      const id = await publishRecall.run(async () => {
        const r = await api.post('/api/lens/run', {
          domain: 'dtu', name: 'create',
          input: {
            title: `Public decree — ${targetRealmId || decreeResult.kind}`,
            tags: ['kingdoms', 'decree', 'public', decreeKind],
            source: 'kingdoms:decree:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, decree: { kingdomId: targetRealmId, kind: decreeResult.kind ?? decreeKind, popularityDelta: decreeResult.popularity_delta } },
          },
        });
        const dtu = r.data?.result?.dtu ?? r.data?.dtu ?? r.data?.result;
        const newId = dtu?.id ?? dtu?.dtuId;
        if (!newId) throw new Error('No DTU id returned.');
        const pub = await api.post(`/api/dtus/${encodeURIComponent(newId)}/publish`);
        if (pub.data?.ok === false) throw new Error(pub.data?.error ?? 'publish flag failed');
        return newId as string;
      });
      if (id) {
        setPublishedDtuId(id);
        pipe.publish('kingdoms.publishedDtuId', id, { label: `decree ${id.slice(0, 8)}` });
        ok(`Decree published ${id.slice(0, 8)}… · 30s to recall.`);
      }
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }
  async function actAgent() {
    setBusy('agent'); setFeedback(null); setAgentReply(null);
    try {
      const task = [
        `Realm context: ${myRealm ? `${myRealm.name} (capital ${myRealm.capital_settlement_id ?? '—'}, loyalty ${loyaltyResult?.avg ?? '?'})` : 'no realm yet'}.`,
        realmList.length ? `${realmList.length} realms on the map.` : '',
        decreeResult ? `Recent decree: ${decreeResult.kind ?? decreeKind} in ${targetRealmId || '—'}.` : '',
        '',
        'Suggest the single highest-leverage move for my realm this turn: which decree, when to call levies, whether to attempt a takeover (conquest / inheritance / election) and why.',
        'Speak in the voice of a CK3 council member. One paragraph. Direct.',
      ].filter(Boolean).join(' ');
      const r = await api.post('/api/lens/run', { domain: 'chat_agent', name: 'do', input: { task, maxTurns: 4 } });
      const reply = r.data?.result?.reply ?? r.data?.result?.summary ?? r.data?.result?.output ?? r.data?.reply;
      if (reply) { setAgentReply(typeof reply === 'string' ? reply : JSON.stringify(reply, null, 2)); ok('Council member spoke.'); }
      else err('Agent returned empty.');
    } catch (e) { err(pickMessage(e)); }
    finally { setBusy(null); }
  }

  const actions: Array<{ id: ActionId; label: string; desc: string; icon: React.ComponentType<{ className?: string }>; accent: string; handler: () => void; disabled?: boolean }> = [
    { id: 'list',        label: 'Realms',     desc: 'List all realms on the map',           icon: Map,        accent: '#06b6d4', handler: actList },
    { id: 'mine',        label: 'My realm',   desc: 'Current realm status',                 icon: Crown,      accent: '#eab308', handler: actMine },
    { id: 'decree',      label: 'Decree',     desc: 'Propose a regional decree',            icon: Scroll,     accent: '#8b5cf6', handler: actDecree },
    { id: 'loyalty',     label: 'Loyalty',    desc: 'Recompute realm loyalty',              icon: Heart,      accent: '#ec4899', handler: actLoyalty },
    { id: 'conquest',    label: 'Conquest',   desc: 'Takeover via conquest',                icon: Sword,      accent: '#ef4444', handler: () => actTakeover('conquest') },
    { id: 'inheritance', label: 'Inheritance', desc: 'Takeover via inheritance',            icon: FileText,   accent: '#22c55e', handler: () => actTakeover('inheritance') },
    { id: 'election',    label: 'Election',   desc: 'Takeover via election',                icon: Vote,       accent: '#06b6d4', handler: () => actTakeover('election') },
    { id: 'mint',        label: mintedDtuId      ? 'Saved'     : 'Mint snapshot',  desc: mintedDtuId      ? `DTU ${mintedDtuId.slice(0, 8)}…`     : 'Private realm-state DTU',                icon: Sparkles, accent: '#3b82f6', handler: actMint },
    { id: 'dm',          label: 'DM ally',    desc: 'Send realm dispatch to ally',          icon: Send,       accent: '#f97316', handler: actDm },
    { id: 'publish',     label: publishedDtuId ? 'Published' : 'Publish decree', desc: publishedDtuId ? `DTU ${publishedDtuId.slice(0, 8)}…` : 'Public decree DTU + federation',          icon: Globe,    accent: '#15803d', handler: actPublish, disabled: !decreeResult },
    { id: 'agent',       label: 'Council',    desc: 'Agent in the voice of a CK3 council',  icon: Wand2,      accent: '#a855f7', handler: actAgent },
  ];

  return (
    <div className="rounded-lg border border-amber-500/20 bg-gradient-to-br from-zinc-950 to-amber-950/10 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-amber-500/10 pb-2">
        <Crown className="h-4 w-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-white">Realm command</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">crusader kings III</span>
        {myRealm && <span className="ml-auto text-[10px] text-amber-300 font-semibold">👑 {myRealm.name}</span>}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        <input type="text" value={targetRealmId} onChange={(e) => setTargetRealmId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Target kingdom id" />
        <select value={decreeKind} onChange={(e) => setDecreeKind(e.target.value as DecreeKind)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {DECREE_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <input type="text" value={decreeMagnitude} onChange={(e) => setDecreeMagnitude(e.target.value.replace(/[^\d.]/g, ''))} disabled={decreeKind !== 'tax_change'} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono disabled:opacity-40" placeholder="new tax rate 0–0.50 (tax_change)" />
        <input type="text" value={decreeTargetNpc} onChange={(e) => setDecreeTargetNpc(e.target.value)} disabled={decreeKind !== 'pardon' && decreeKind !== 'exile'} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white disabled:opacity-40" placeholder="target NPC id (pardon/exile)" />
        <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="md:col-span-4 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="DM ally user id" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <RecallSlot ctl={dmRecall} />
        <RecallSlot ctl={publishRecall} />
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-11 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const isBusy = busy === a.id;
          return (
            <button key={a.id} type="button" disabled={a.disabled || !!busy} onClick={a.handler}
              className={cn('group flex flex-col items-start gap-1.5 p-2.5 rounded-lg text-left border transition-all', 'bg-zinc-900/40 border-zinc-800 hover:bg-zinc-800/60 hover:border-zinc-700', 'disabled:opacity-40 disabled:cursor-not-allowed')}>
              <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ backgroundColor: a.accent + '20', color: a.accent }}>
                {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
              </div>
              <div className="text-[11px] font-semibold text-zinc-100 leading-tight">{a.label}</div>
              <div className="text-[10px] text-zinc-400 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {realmList.length > 0 && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5"><Map className="w-3 h-3" /> Realms on the map ({realmList.length})</div>
          {realmList.slice(0, 20).map(r => (
            <button key={r.id} onClick={() => setTargetRealmId(r.id)} className="block w-full text-left text-[11px] text-zinc-300 hover:text-cyan-200 py-0.5">
              <span className="font-mono text-cyan-300">{r.id.slice(0, 8)}</span> {r.name} <span className="text-zinc-400">{r.capital_settlement_id ? `· ${r.capital_settlement_id}` : ''} · legitimacy {r.legitimacy ?? '?'}</span>
            </button>
          ))}
        </div>
      )}

      {myRealm && myRealmDecrees.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-amber-300 font-semibold flex items-center gap-1.5">
            <Scroll className="w-3 h-3" /> {myRealm.name}&rsquo;s active decrees ({myRealmDecrees.length})
          </div>
          <ul className="mt-1.5 space-y-1">
            {myRealmDecrees.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded bg-zinc-900/60 px-2 py-1 text-[11px]">
                <span className="capitalize text-zinc-200">{d.kind.replace(/_/g, ' ')}</span>
                <button
                  type="button"
                  onClick={() => actRevokeDecree(d.id)}
                  disabled={revokingId === d.id}
                  className="rounded bg-rose-900/50 px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-800/60 disabled:opacity-50"
                >
                  {revokingId === d.id ? 'revoking…' : 'revoke'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {decreeResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><Scroll className="w-3 h-3" /> Decree</div>
            <div className="text-[11px] text-zinc-300 mt-1">
              <strong className="text-purple-200 capitalize">{decreeResult.kind?.replace(/_/g, ' ')}</strong> issued
              {decreeResult.popularity_delta != null && (
                <span className={cn('ml-1', decreeResult.popularity_delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  (popularity Δ {decreeResult.popularity_delta >= 0 ? '+' : ''}{decreeResult.popularity_delta})
                </span>
              )}
            </div>
          </div>
        )}
        {loyaltyResult && (
          <div className={cn('rounded-md border p-2.5', (loyaltyResult.avg ?? 0) >= 70 ? 'border-emerald-500/40 bg-emerald-500/5' : (loyaltyResult.avg ?? 0) >= 40 ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-pink-300 font-semibold flex items-center gap-1.5"><Heart className="w-3 h-3" /> Loyalty</div>
            <div className="text-2xl font-bold text-zinc-100 mt-1">{loyaltyResult.avg}</div>
            <p className="text-[10px] text-zinc-400">low {loyaltyResult.low} / high {loyaltyResult.high} · {loyaltyResult.count} citizens ({loyaltyResult.refreshed ?? 0} refreshed)</p>
            {loyaltyResult.rebellionScore != null && (
              <p className={cn('mt-1 text-[10px]', loyaltyResult.rebellionThreshold != null && loyaltyResult.rebellionScore >= loyaltyResult.rebellionThreshold ? 'text-rose-300 font-semibold' : 'text-zinc-400')}>
                Rebellion risk: {loyaltyResult.rebellionScore}{loyaltyResult.rebellionThreshold != null ? ` / ${loyaltyResult.rebellionThreshold} threshold` : ''}
              </p>
            )}
          </div>
        )}
        {takeoverResult && (
          <div className={cn('rounded-md border p-2.5', takeoverResult.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 capitalize"
                 style={{ color: takeoverResult.ok ? '#86efac' : '#fda4af' }}>
              {takeoverResult.method === 'conquest' ? <Sword className="w-3 h-3" /> : takeoverResult.method === 'inheritance' ? <FileText className="w-3 h-3" /> : <Vote className="w-3 h-3" />}
              {takeoverResult.method}: {takeoverResult.ok ? 'success' : 'failed'}
            </div>
            {takeoverResult.ok && takeoverResult.legitimacy != null && <div className="text-[11px] text-zinc-300 mt-1">Legitimacy: <span className="font-mono">{takeoverResult.legitimacy}</span></div>}
            {takeoverResult.reason && <p className="text-[11px] text-zinc-400 italic">{takeoverResult.reason}</p>}
          </div>
        )}
      </div>

      {agentReply && (
        <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-3 max-h-72 overflow-y-auto">
          <div className="flex items-center gap-1.5 text-purple-300 font-semibold mb-1.5 uppercase tracking-wider text-[10px]"><Wand2 className="w-3 h-3" /> Council member speaks</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-200 leading-relaxed italic">{agentReply}</pre>
        </div>
      )}

      <AnimatePresence>
        {feedback && (
          <motion.div key={feedback.text} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -2 }}
            className={cn('px-3 py-2 rounded text-[11px] flex items-start gap-2 border', feedback.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-red-500/10 text-red-300 border-red-500/30')}>
            {feedback.kind === 'ok' ? <Check className="h-3 w-3 mt-0.5" /> : <AlertTriangle className="h-3 w-3 mt-0.5" />}
            <span>{feedback.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
