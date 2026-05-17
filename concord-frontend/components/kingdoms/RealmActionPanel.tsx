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

interface Realm { id: string; name: string; rulerUserId?: string; capital?: string; loyalty?: number; size?: number }
interface DecreeResult { decreeId?: string; region?: string; effect?: string }
interface LoyaltyResult { realmId?: string; loyalty?: number; delta?: number; reason?: string }
interface TakeoverResult { ok?: boolean; method?: string; newRulerUserId?: string; reason?: string }

type Feedback = { kind: 'ok' | 'err'; text: string } | null;
type ActionId = 'list' | 'mine' | 'decree' | 'loyalty' | 'conquest' | 'inheritance' | 'election' | 'mint' | 'dm' | 'publish' | 'agent';

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

async function callKingdoms<T>(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: T; error?: string; reason?: string }> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'kingdoms', name, input });
    const d = r.data as { ok?: boolean; result?: T; error?: string; reason?: string };
    if (d && typeof d === 'object' && 'ok' in d) return d as { ok: boolean; result?: T };
    return { ok: false, error: 'unexpected response' };
  } catch (e) { return { ok: false, error: pickMessage(e) }; }
}

export function RealmActionPanel() {
  const [realmList, setRealmList] = useState<Realm[]>([]);
  const [myRealm, setMyRealm] = useState<Realm | null>(null);
  const [targetRealmId, setTargetRealmId] = useState('');
  const [decreeKind, setDecreeKind] = useState<'tax' | 'levy' | 'mercy' | 'crackdown' | 'border-watch'>('tax');
  const [decreeRegion, setDecreeRegion] = useState('');
  const [decreeMagnitude, setDecreeMagnitude] = useState('');
  const [recipient, setRecipient] = useState('');

  const [busy, setBusy] = useState<ActionId | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [decreeResult, setDecreeResult] = useState<DecreeResult | null>(null);
  const [loyaltyResult, setLoyaltyResult] = useState<LoyaltyResult | null>(null);
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

  // Auto-load realm list + my realm on mount
  useEffect(() => {
    (async () => {
      try {
        const list = await callKingdoms<{ realms: Realm[] }>('list', {});
        if (list.ok && list.result?.realms) setRealmList(list.result.realms);
      } catch {/* dormant */}
      try {
        const mine = await callKingdoms<{ realm: Realm }>('my_realm', {});
        if (mine.ok && mine.result?.realm) setMyRealm(mine.result.realm);
      } catch {/* dormant */}
    })();
  }, []);

  async function actList() {
    setBusy('list'); setFeedback(null);
    const r = await callKingdoms<{ realms: Realm[] }>('list', {});
    if (r.ok && r.result?.realms) {
      setRealmList(r.result.realms);
      pipe.publish('kingdoms.realmList', r.result.realms, { label: `${r.result.realms.length} realms` });
      ok(`${r.result.realms.length} realms.`);
    }
    else err(r.error ?? r.reason ?? 'list failed');
    setBusy(null);
  }
  async function actMine() {
    setBusy('mine'); setFeedback(null);
    const r = await callKingdoms<{ realm: Realm }>('my_realm', {});
    if (r.ok && r.result?.realm) {
      setMyRealm(r.result.realm);
      pipe.publish('kingdoms.myRealm', r.result.realm, { label: r.result.realm.name });
      ok(`My realm: ${r.result.realm.name}.`);
    }
    else err(r.error ?? r.reason ?? 'no realm');
    setBusy(null);
  }
  async function actDecree() {
    if (!decreeRegion.trim()) { err('Region required.'); return; }
    setBusy('decree'); setFeedback(null);
    const r = await callKingdoms<DecreeResult>('propose_decree', {
      region: decreeRegion.trim(), kind: decreeKind, magnitude: parseFloat(decreeMagnitude),
    });
    if (r.ok && r.result) {
      setDecreeResult(r.result);
      pipe.publish('kingdoms.decree', r.result, { label: `${decreeKind} · ${r.result.region ?? decreeRegion}` });
      ok(`Decree proposed: ${r.result.decreeId ?? r.result.effect}.`);
    }
    else err(r.error ?? r.reason ?? 'decree failed');
    setBusy(null);
  }
  async function actLoyalty() {
    if (!targetRealmId.trim() && !myRealm) { err('Pick a target realm.'); return; }
    setBusy('loyalty'); setFeedback(null);
    const realmId = targetRealmId.trim() || myRealm?.id;
    const r = await callKingdoms<LoyaltyResult>('recompute_loyalty', { realmId });
    if (r.ok && r.result) {
      setLoyaltyResult(r.result);
      pipe.publish('kingdoms.loyalty', r.result, { label: `loyalty ${r.result.loyalty}` });
      ok(`Loyalty ${r.result.loyalty}${r.result.delta != null ? ` (Δ ${r.result.delta})` : ''}.`);
    }
    else err(r.error ?? r.reason ?? 'loyalty failed');
    setBusy(null);
  }
  async function actTakeover(method: 'conquest' | 'inheritance' | 'election') {
    if (!targetRealmId.trim()) { err('Target realm id required.'); return; }
    setBusy(method); setFeedback(null);
    const macroName = method === 'conquest' ? 'takeover_conquest' : method === 'inheritance' ? 'takeover_inheritance' : 'takeover_election';
    const r = await callKingdoms<TakeoverResult>(macroName, { realmId: targetRealmId.trim() });
    if (r.ok) {
      const next = { ...r.result, method };
      setTakeoverResult(next);
      pipe.publish('kingdoms.takeover', next, { label: `${method} · ${next.ok ? 'success' : 'failed'}` });
      ok(`${method}: ${r.result?.ok ? 'success' : 'failed'}.`);
    }
    else err(r.error ?? r.reason ?? `${method} failed`);
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
      myRealm ? `From: ${myRealm.name} (capital ${myRealm.capital ?? '—'})` : '',
      loyaltyResult ? `Loyalty: ${loyaltyResult.loyalty} (Δ ${loyaltyResult.delta ?? 0})` : '',
      decreeResult ? `Recent decree: ${decreeResult.decreeId ?? decreeResult.effect ?? '—'} in ${decreeResult.region}` : '',
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
            title: `Public decree — ${decreeResult.region}`,
            tags: ['kingdoms', 'decree', 'public', decreeKind],
            source: 'kingdoms:decree:publish',
            meta: { visibility: 'public', consent: { allowCitations: true }, decree: { region: decreeResult.region, kind: decreeKind, magnitude: parseFloat(decreeMagnitude), effect: decreeResult.effect } },
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
        `Realm context: ${myRealm ? `${myRealm.name} (capital ${myRealm.capital}, loyalty ${loyaltyResult?.loyalty ?? '?'})` : 'no realm yet'}.`,
        realmList.length ? `${realmList.length} realms on the map.` : '',
        decreeResult ? `Recent decree: ${decreeKind} in ${decreeResult.region}.` : '',
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
        <input type="text" value={targetRealmId} onChange={(e) => setTargetRealmId(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[12px] text-white" placeholder="Target realm id" />
        <select value={decreeKind} onChange={(e) => setDecreeKind(e.target.value as typeof decreeKind)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white">
          {(['tax', 'levy', 'mercy', 'crackdown', 'border-watch'] as const).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input type="text" value={decreeRegion} onChange={(e) => setDecreeRegion(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white" placeholder="Decree region" />
        <input type="text" value={decreeMagnitude} onChange={(e) => setDecreeMagnitude(e.target.value.replace(/[^\d.]/g, ''))} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-[11px] text-white font-mono" placeholder="magnitude (1-10)" />
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
              <div className="text-[10px] text-zinc-500 leading-tight line-clamp-2">{a.desc}</div>
            </button>
          );
        })}
      </div>

      {realmList.length > 0 && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2.5 max-h-40 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5"><Map className="w-3 h-3" /> Realms on the map ({realmList.length})</div>
          {realmList.slice(0, 20).map(r => (
            <button key={r.id} onClick={() => setTargetRealmId(r.id)} className="block w-full text-left text-[11px] text-zinc-300 hover:text-cyan-200 py-0.5">
              <span className="font-mono text-cyan-300">{r.id.slice(0, 8)}</span> {r.name} <span className="text-zinc-500">{r.capital ? `· ${r.capital}` : ''} {r.loyalty != null ? `· loyalty ${r.loyalty}` : ''}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {decreeResult && (
          <div className="rounded-md border border-purple-500/30 bg-purple-500/5 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold flex items-center gap-1.5"><Scroll className="w-3 h-3" /> Decree</div>
            <div className="text-[11px] text-zinc-300 mt-1">In <strong className="text-purple-200">{decreeResult.region}</strong>: {decreeResult.effect ?? decreeResult.decreeId ?? '(processed)'}</div>
          </div>
        )}
        {loyaltyResult && (
          <div className={cn('rounded-md border p-2.5', (loyaltyResult.loyalty ?? 0) >= 70 ? 'border-emerald-500/40 bg-emerald-500/5' : (loyaltyResult.loyalty ?? 0) >= 40 ? 'border-amber-500/40 bg-amber-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider text-pink-300 font-semibold flex items-center gap-1.5"><Heart className="w-3 h-3" /> Loyalty</div>
            <div className="text-2xl font-bold text-zinc-100 mt-1">{loyaltyResult.loyalty}{loyaltyResult.delta != null && <span className={cn('text-sm ml-2', loyaltyResult.delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>Δ {loyaltyResult.delta >= 0 ? '+' : ''}{loyaltyResult.delta}</span>}</div>
            {loyaltyResult.reason && <p className="text-[10px] text-zinc-400 italic">{loyaltyResult.reason}</p>}
          </div>
        )}
        {takeoverResult && (
          <div className={cn('rounded-md border p-2.5', takeoverResult.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
            <div className="text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5 capitalize"
                 style={{ color: takeoverResult.ok ? '#86efac' : '#fda4af' }}>
              {takeoverResult.method === 'conquest' ? <Sword className="w-3 h-3" /> : takeoverResult.method === 'inheritance' ? <FileText className="w-3 h-3" /> : <Vote className="w-3 h-3" />}
              {takeoverResult.method}: {takeoverResult.ok ? 'success' : 'failed'}
            </div>
            {takeoverResult.newRulerUserId && <div className="text-[11px] text-zinc-300 mt-1">New ruler: <span className="font-mono">{takeoverResult.newRulerUserId.slice(0, 8)}</span></div>}
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
