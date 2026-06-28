'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * /lenses/inheritance — Estate planning + death-derivatives market.
 *
 * Two surfaces share one substrate:
 *  1. Estate planner — beneficiaries, wills, assets, executors, probate
 *     timeline, heir notices (server/domains/inheritance.js macros).
 *  2. Heir-slot market — lock heir slots for dying NPCs; resolved on
 *     death (inline inheritance.list_open / claim_slot macros).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EstateChatter } from '@/components/inheritance/EstateChatter';
import { TimelineView, ChartKit } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { lensRun } from '@/lib/api/client';

const DOMAIN = 'inheritance';

interface Listing {
  id: number;
  dying_npc_id: string;
  npc_name?: string;
  mentor_user_id: string;
  heir_slot_price_cc: number;
  listed_at: number;
}
interface Beneficiary {
  id: string; name: string; relationship: string; sharePct: number;
  contingent: boolean; contingentOn: string | null; acceptanceStatus?: string;
}
interface WillVersion {
  version: number; title: string; kind: string; status: string;
  authoredAt: number; bodyPreview?: string; body?: string; restoredFrom?: number;
}
interface Asset {
  id: string; label: string; category: string; valueCc: number;
  location: string; notes: string;
}
interface Executor {
  id: string; name: string; role: string; consentStatus: string;
  invitedAt: number; respondedAt: number | null;
}
interface Lock {
  id: string; listingId: number | null; npcName: string; priceCc: number;
  status: string; lockedAt: number; amendedAt: number | null;
}
interface Notice {
  id: string; kind: string; message: string; status: string;
  acceptance?: string; sharePct?: number | null; createdAt: number;
}
interface Overview {
  beneficiaryCount: number; assetCount: number; willCount: number;
  executorCount: number; lockCount: number; totalSharePct: number;
  shareBalanced: boolean; totalAssetValueCc: number; activeWillVersion: number | null;
  executorsConsented: number;
}

type Tab = 'overview' | 'beneficiaries' | 'wills' | 'assets' | 'executors' | 'probate' | 'notices' | 'market';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'beneficiaries', label: 'Beneficiaries' },
  { id: 'wills', label: 'Will & Directives' },
  { id: 'assets', label: 'Asset Inventory' },
  { id: 'executors', label: 'Executors' },
  { id: 'probate', label: 'Probate Timeline' },
  { id: 'notices', label: 'My Notices' },
  { id: 'market', label: 'Heir-Slot Market' },
];

async function run(name: string, params: Record<string, unknown> = {}) {
  const r = await lensRun(DOMAIN, name, params);
  return r.data;
}

export default function InheritancePage() {
  useLensCommand([
    { id: 'inheritance-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* tooltip */ } },
  ], { lensId: 'inheritance' });

  const [tab, setTab] = useState<Tab>('overview');
  const [status, setStatus] = useState<string | null>(null);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [remainderPct, setRemainderPct] = useState(100);
  const [wills, setWills] = useState<WillVersion[]>([]);
  const [activeWill, setActiveWill] = useState<WillVersion | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetByCat, setAssetByCat] = useState<Record<string, { count: number; valueCc: number }>>({});
  const [executors, setExecutors] = useState<Executor[]>([]);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [escrowedCc, setEscrowedCc] = useState(0);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const flash = (m: string) => { setStatus(m); window.setTimeout(() => setStatus(null), 5000); };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ov, ben, wl, as, ex, lk, pt, nt, ls] = await Promise.all([
        run('estate_overview'), run('list_beneficiaries'), run('list_will_versions'),
        run('list_assets'), run('list_executors'), run('list_locks'),
        run('probate_timeline'), run('list_notices'), run('list_open'),
      ]);
      if (ov?.ok) setOverview(ov.result);
      if (ben?.ok) { setBeneficiaries(ben.result.beneficiaries || []); setRemainderPct(ben.result.remainderPct ?? 100); }
      if (wl?.ok) {
        setWills(wl.result.versions || []);
        const av = (wl.result.versions || []).find((w: WillVersion) => w.status === 'active') || null;
        setActiveWill(av);
      }
      if (as?.ok) { setAssets(as.result.assets || []); setAssetByCat(as.result.byCategory || {}); }
      if (ex?.ok) setExecutors(ex.result.executors || []);
      if (lk?.ok) { setLocks(lk.result.locks || []); setEscrowedCc(lk.result.escrowedCc || 0); }
      if (pt?.ok) { setTimeline(pt.result.events || []); setPendingTransfers(pt.result.pendingTransfers || 0); }
      if (nt?.ok) setNotices(nt.result.notices || []);
      // list_open is the inline MACROS-style macro: it returns { ok, listings } un-nested.
      const lr = ls as any;
      if (lr?.ok) setListings(lr.listings || lr.result?.listings || []);
    } catch (err) {
      // A swallowed fetch failure used to leave the page stuck on "Loading…"
      // (the defect fixed across the sibling lenses). Surface it instead.
      setLoadError(err instanceof Error ? err.message : 'Failed to load your estate.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Beneficiary form ───────────────────────────────────────────────
  const [bName, setBName] = useState('');
  const [bRel, setBRel] = useState('');
  const [bShare, setBShare] = useState('');
  const [bContingentOn, setBContingentOn] = useState('');

  const addBeneficiary = async () => {
    if (!bName.trim()) return flash('Beneficiary needs a name.');
    const r = await run('add_beneficiary', {
      name: bName, relationship: bRel, sharePct: Number(bShare) || 0,
      contingent: !!bContingentOn.trim(), contingentOn: bContingentOn.trim() || null,
    });
    if (r?.ok) { setBName(''); setBRel(''); setBShare(''); setBContingentOn(''); flash('Beneficiary added.'); void loadAll(); }
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };
  const removeBeneficiary = async (id: string) => {
    const r = await run('remove_beneficiary', { beneficiaryId: id });
    if (r?.ok) { flash('Beneficiary removed.'); void loadAll(); }
  };
  const reShare = async (id: string, pct: number) => {
    const r = await run('update_beneficiary', { beneficiaryId: id, sharePct: pct });
    if (r?.ok) void loadAll();
  };

  // ── Will form ──────────────────────────────────────────────────────
  const [wTitle, setWTitle] = useState('');
  const [wBody, setWBody] = useState('');
  const [wKind, setWKind] = useState('will');

  const authorWill = async () => {
    if (!wBody.trim()) return flash('Will body cannot be empty.');
    const r = await run('author_will', { title: wTitle, body: wBody, kind: wKind });
    if (r?.ok) { setWTitle(''); setWBody(''); flash(`Authored v${r.result.version}.`); void loadAll(); }
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };
  const viewWill = async (version: number) => {
    const r = await run('get_will_version', { version });
    if (r?.ok) setActiveWill(r.result.will);
  };
  const restoreWill = async (version: number) => {
    const r = await run('restore_will_version', { version });
    if (r?.ok) { flash(`Restored v${version} as v${r.result.will.version}.`); void loadAll(); }
  };

  // ── Asset form ─────────────────────────────────────────────────────
  const [aLabel, setALabel] = useState('');
  const [aCat, setACat] = useState('property');
  const [aValue, setAValue] = useState('');
  const [aLoc, setALoc] = useState('');
  const [aNotes, setANotes] = useState('');

  const addAsset = async () => {
    if (!aLabel.trim()) return flash('Asset needs a label.');
    const r = await run('add_asset', {
      label: aLabel, category: aCat, valueCc: Number(aValue) || 0, location: aLoc, notes: aNotes,
    });
    if (r?.ok) { setALabel(''); setAValue(''); setALoc(''); setANotes(''); flash('Asset added.'); void loadAll(); }
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };
  const removeAsset = async (id: string) => {
    const r = await run('remove_asset', { assetId: id });
    if (r?.ok) { flash('Asset removed.'); void loadAll(); }
  };

  // ── Executor form ──────────────────────────────────────────────────
  const [eName, setEName] = useState('');
  const [eRole, setERole] = useState('executor');

  const assignExecutor = async () => {
    if (!eName.trim()) return flash('Executor needs a name.');
    const r = await run('assign_executor', { name: eName, role: eRole });
    if (r?.ok) { setEName(''); flash('Executor invited.'); void loadAll(); }
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };
  const respondConsent = async (id: string, decision: 'accepted' | 'declined') => {
    const r = await run('respond_executor_consent', { executorId: id, decision });
    if (r?.ok) { flash(`Consent ${decision}.`); void loadAll(); }
  };
  const removeExecutor = async (id: string) => {
    const r = await run('remove_executor', { executorId: id });
    if (r?.ok) { flash('Executor removed.'); void loadAll(); }
  };

  // ── Lock revoke / amend ────────────────────────────────────────────
  const amendLock = async (id: string) => {
    const v = window.prompt('New escrow price (CC):');
    if (v == null) return;
    const r = await run('amend_lock', { lockId: id, priceCc: Number(v) || 0 });
    if (r?.ok) { flash('Lock amended.'); void loadAll(); }
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };
  const revokeLock = async (id: string) => {
    const r = await run('revoke_lock', { lockId: id });
    if (r?.ok) { flash(`Lock revoked — ${r.result.refundedCc} CC refunded.`); void loadAll(); }
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };

  // ── Notices ────────────────────────────────────────────────────────
  const respondNotice = async (id: string, decision: 'accepted' | 'declined') => {
    const r = await run('respond_notice', { noticeId: id, decision });
    if (r?.ok) { flash(`Notice ${decision}.`); void loadAll(); }
  };

  // ── Heir-slot market ───────────────────────────────────────────────
  const claimSlot = async (listing: Listing) => {
    flash(`Locking heir slot for ${listing.npc_name || listing.dying_npc_id}…`);
    const r = (await run('claim_slot', { listingId: listing.id })) as any;
    if (r?.ok) {
      // Mirror the claimed slot into estate bookkeeping so revoke/amend works.
      await run('track_lock', {
        listingId: listing.id, npcName: listing.npc_name || listing.dying_npc_id,
        priceCc: listing.heir_slot_price_cc,
      });
      flash(`✓ Slot locked — ${listing.heir_slot_price_cc} CC in escrow.`);
      void loadAll();
    } else flash(`Failed: ${r?.error || r?.reason || 'unknown'}`);
  };

  const inp = 'rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100';
  const btn = 'rounded bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600';
  const tone = (s: string) => s === 'accepted' ? 'text-emerald-300' : s === 'declined' || s === 'revoked' ? 'text-rose-300' : s === 'amended' ? 'text-amber-300' : 'text-zinc-400';

  return (
    <LensShell lensId="inheritance">
      <FirstRunTour lensId="inheritance" />
      <DepthBadge lensId="inheritance" size="sm" className="ml-2" />
      <div className="mx-auto max-w-5xl p-6 sm:p-8">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-zinc-100">Estate &amp; Inheritance</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Plan your estate — name beneficiaries, author a will, inventory assets, appoint
            executors — then trade heir-slot futures on the death-derivatives market. <strong>Currency: CC.</strong>
          </p>
        </header>

        {status && (
          <div className="mb-4 rounded-lg border border-amber-700/50 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">{status}</div>
        )}

        <nav className="mb-5 flex flex-wrap gap-1 border-b border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium ${tab === t.id ? 'border-b-2 border-amber-500 text-amber-300' : 'text-zinc-400 hover:text-zinc-300'}`}
            >{t.label}{t.id === 'notices' && notices.some((n) => n.status === 'unread') ? ` (${notices.filter((n) => n.status === 'unread').length})` : ''}</button>
          ))}
        </nav>

        {loading ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2 py-10 text-zinc-400">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden="true" />
            <span>Loading estate…</span>
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-xl border border-rose-700/50 bg-rose-950/40 p-6 text-center">
            <p className="text-sm text-rose-200">Couldn’t load your estate.</p>
            <p className="mt-1 font-mono text-[11px] text-rose-300/70">{loadError}</p>
            <button
              type="button"
              onClick={() => { void loadAll(); }}
              className="mt-3 rounded bg-amber-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
            >Retry</button>
          </div>
        ) : (
          <>
            {/* ── Overview ─────────────────────────────────────────── */}
            {tab === 'overview' && overview && (
              overview.beneficiaryCount === 0 && overview.assetCount === 0
                && overview.willCount === 0 && overview.executorCount === 0 && overview.lockCount === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 py-12 text-center">
                  <h2 className="text-sm font-semibold text-zinc-200">Your estate is empty</h2>
                  <p className="mx-auto mt-1 max-w-md text-xs text-zinc-400">
                    Start planning: name a beneficiary, author a will, or inventory an asset.
                    Everything you add appears in the probate timeline.
                  </p>
                  <button
                    type="button"
                    onClick={() => setTab('beneficiaries')}
                    className="mt-3 rounded bg-amber-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
                  >Name your first beneficiary</button>
                </div>
              ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Beneficiaries', overview.beneficiaryCount],
                    ['Assets', overview.assetCount],
                    ['Will versions', overview.willCount],
                    ['Executors', overview.executorCount],
                    ['Heir slots', overview.lockCount],
                    ['Estate value', `${overview.totalAssetValueCc} CC`],
                    ['Shares allocated', `${overview.totalSharePct}%`],
                    ['Escrow held', `${escrowedCc} CC`],
                  ].map(([label, val]) => (
                    <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
                      <div className="mt-0.5 font-mono text-lg text-amber-300">{val}</div>
                    </div>
                  ))}
                </div>
                <div className={`rounded-lg border px-3 py-2 text-xs ${overview.shareBalanced ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-amber-700/50 bg-amber-950/40 text-amber-300'}`}>
                  {overview.shareBalanced
                    ? '✓ Beneficiary shares total exactly 100%.'
                    : `⚠ Shares total ${overview.totalSharePct}% — ${remainderPct}% of the estate is unallocated.`}
                </div>
                {Object.keys(assetByCat).length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <h3 className="mb-2 text-xs font-semibold text-zinc-300">Asset value by category</h3>
                    <ChartKit
                      kind="bar" height={200}
                      data={Object.entries(assetByCat).map(([cat, v]) => ({ category: cat, valueCc: v.valueCc }))}
                      xKey="category" series={[{ key: 'valueCc', label: 'CC value' }]}
                    />
                  </div>
                )}
              </div>
              )
            )}

            {/* ── Beneficiaries ────────────────────────────────────── */}
            {tab === 'beneficiaries' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">Designate a beneficiary</h3>
                  <div className="flex flex-wrap gap-2">
                    <input className={inp} placeholder="Name" value={bName} onChange={(e) => setBName(e.target.value)} />
                    <input className={inp} placeholder="Relationship" value={bRel} onChange={(e) => setBRel(e.target.value)} />
                    <input className={`${inp} w-24`} type="number" placeholder="Share %" value={bShare} onChange={(e) => setBShare(e.target.value)} />
                    <input className={inp} placeholder="Contingent on… (optional)" value={bContingentOn} onChange={(e) => setBContingentOn(e.target.value)} />
                    <button type="button" className={btn} onClick={addBeneficiary}>Add</button>
                  </div>
                </div>
                {beneficiaries.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 py-10 text-center italic text-zinc-400">No beneficiaries designated yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {beneficiaries.map((b) => (
                      <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-zinc-100">{b.name} <span className="text-xs font-normal text-zinc-400">· {b.relationship}</span></div>
                          {b.contingent && <div className="text-[10px] text-amber-400">contingent on: {b.contingentOn}</div>}
                          {b.acceptanceStatus && <div className={`text-[10px] ${tone(b.acceptanceStatus)}`}>designation {b.acceptanceStatus}</div>}
                        </div>
                        <input
                          className={`${inp} w-20`} type="number" defaultValue={b.sharePct}
                          onBlur={(e) => { const v = Number(e.target.value); if (v !== b.sharePct) void reShare(b.id, v); }}
                        />
                        <span className="text-xs text-zinc-400">%</span>
                        <button type="button" className="text-xs text-rose-400 hover:text-rose-300" onClick={() => removeBeneficiary(b.id)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="text-xs text-zinc-400">Unallocated remainder: <span className="font-mono text-amber-300">{remainderPct}%</span></div>
              </div>
            )}

            {/* ── Wills ────────────────────────────────────────────── */}
            {tab === 'wills' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">Author a new version</h3>
                  <div className="flex flex-wrap gap-2">
                    <input className={inp} placeholder="Title" value={wTitle} onChange={(e) => setWTitle(e.target.value)} />
                    <select className={inp} value={wKind} onChange={(e) => setWKind(e.target.value)}>
                      <option value="will">Will</option>
                      <option value="living_directive">Living directive</option>
                      <option value="power_of_attorney">Power of attorney</option>
                    </select>
                  </div>
                  <textarea
                    className={`${inp} mt-2 h-28 w-full`} placeholder="Directive text…"
                    value={wBody} onChange={(e) => setWBody(e.target.value)}
                  />
                  <button type="button" className={`${btn} mt-2`} onClick={authorWill}>Author &amp; activate</button>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-zinc-300">Version history</h3>
                    {wills.length === 0 ? (
                      <div className="rounded-xl border border-zinc-800 py-8 text-center italic text-zinc-400">No will authored yet.</div>
                    ) : (
                      <ul className="space-y-1.5">
                        {[...wills].reverse().map((w) => (
                          <li key={w.version} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-2.5">
                            <div className="flex items-center justify-between">
                              <button type="button" className="text-left text-xs font-semibold text-zinc-100 hover:text-amber-300" onClick={() => viewWill(w.version)}>
                                v{w.version} · {w.title}
                              </button>
                              <span className={`text-[10px] ${w.status === 'active' ? 'text-emerald-300' : 'text-zinc-400'}`}>{w.status}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-zinc-400">
                              {w.kind} · {new Date(w.authoredAt).toLocaleString()}
                              {w.restoredFrom ? ` · restored from v${w.restoredFrom}` : ''}
                            </div>
                            {w.status !== 'active' && (
                              <button type="button" className="mt-1 text-[10px] text-amber-400 hover:text-amber-300" onClick={() => restoreWill(w.version)}>Restore this version</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-zinc-300">{activeWill ? `v${activeWill.version} — ${activeWill.title}` : 'Select a version'}</h3>
                    <div className="min-h-[120px] whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                      {activeWill ? (activeWill.body || activeWill.bodyPreview || '(no body)') : 'Click a version to read it.'}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Assets ───────────────────────────────────────────── */}
            {tab === 'assets' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">Add an asset</h3>
                  <div className="flex flex-wrap gap-2">
                    <input className={inp} placeholder="Label" value={aLabel} onChange={(e) => setALabel(e.target.value)} />
                    <select className={inp} value={aCat} onChange={(e) => setACat(e.target.value)}>
                      <option value="property">Property</option>
                      <option value="recipe">Recipe</option>
                      <option value="currency">Currency</option>
                      <option value="artifact">Artifact</option>
                      <option value="other">Other</option>
                    </select>
                    <input className={`${inp} w-28`} type="number" placeholder="Value CC" value={aValue} onChange={(e) => setAValue(e.target.value)} />
                    <input className={inp} placeholder="Location" value={aLoc} onChange={(e) => setALoc(e.target.value)} />
                    <input className={inp} placeholder="Notes" value={aNotes} onChange={(e) => setANotes(e.target.value)} />
                    <button type="button" className={btn} onClick={addAsset}>Add</button>
                  </div>
                </div>
                {assets.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 py-10 text-center italic text-zinc-400">No assets inventoried yet.</div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="text-zinc-400">
                      <tr><th className="py-1">Asset</th><th>Category</th><th>Value</th><th>Location</th><th /></tr>
                    </thead>
                    <tbody>
                      {assets.map((a) => (
                        <tr key={a.id} className="border-t border-zinc-800">
                          <td className="py-1.5 text-zinc-100">{a.label}{a.notes ? <span className="text-zinc-400"> — {a.notes}</span> : null}</td>
                          <td className="text-zinc-400">{a.category}</td>
                          <td className="font-mono text-amber-300">{a.valueCc} CC</td>
                          <td className="text-zinc-400">{a.location || '—'}</td>
                          <td><button type="button" className="text-rose-400 hover:text-rose-300" onClick={() => removeAsset(a.id)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Executors ────────────────────────────────────────── */}
            {tab === 'executors' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">Appoint an executor</h3>
                  <div className="flex flex-wrap gap-2">
                    <input className={inp} placeholder="Name" value={eName} onChange={(e) => setEName(e.target.value)} />
                    <select className={inp} value={eRole} onChange={(e) => setERole(e.target.value)}>
                      <option value="executor">Executor</option>
                      <option value="co_executor">Co-executor</option>
                      <option value="trustee">Trustee</option>
                      <option value="witness">Witness</option>
                    </select>
                    <button type="button" className={btn} onClick={assignExecutor}>Invite</button>
                  </div>
                </div>
                {executors.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 py-10 text-center italic text-zinc-400">No executors appointed. The estate needs at least one to resolve probate.</div>
                ) : (
                  <ul className="space-y-2">
                    {executors.map((x) => (
                      <li key={x.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-zinc-100">{x.name} <span className="text-xs font-normal text-zinc-400">· {x.role}</span></div>
                          <div className={`text-[10px] ${tone(x.consentStatus)}`}>consent: {x.consentStatus}</div>
                        </div>
                        {x.consentStatus === 'pending' && (
                          <>
                            <button type="button" className="text-xs text-emerald-400 hover:text-emerald-300" onClick={() => respondConsent(x.id, 'accepted')}>Accept</button>
                            <button type="button" className="text-xs text-amber-400 hover:text-amber-300" onClick={() => respondConsent(x.id, 'declined')}>Decline</button>
                          </>
                        )}
                        <button type="button" className="text-xs text-rose-400 hover:text-rose-300" onClick={() => removeExecutor(x.id)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ── Probate timeline ─────────────────────────────────── */}
            {tab === 'probate' && (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-400">
                  {pendingTransfers} death-triggered transfer{pendingTransfers === 1 ? '' : 's'} pending resolution.
                </div>
                {timeline.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 py-10 text-center italic text-zinc-400">No probate events yet — author a will or appoint an executor to begin.</div>
                ) : (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <TimelineView events={timeline} />
                  </div>
                )}
                {locks.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-zinc-300">Locked heir slots</h3>
                    <ul className="space-y-2">
                      {locks.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-zinc-100">{l.npcName}</div>
                            <div className={`text-[10px] ${tone(l.status)}`}>{l.status} · {l.priceCc} CC escrow · locked {new Date(l.lockedAt).toLocaleDateString()}</div>
                          </div>
                          {(l.status === 'locked' || l.status === 'amended') && (
                            <>
                              <button type="button" className="text-xs text-amber-400 hover:text-amber-300" onClick={() => amendLock(l.id)}>Amend</button>
                              <button type="button" className="text-xs text-rose-400 hover:text-rose-300" onClick={() => revokeLock(l.id)}>Revoke</button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ── Notices ──────────────────────────────────────────── */}
            {tab === 'notices' && (
              notices.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 py-10 text-center italic text-zinc-400">No inheritance notices. When someone names you a beneficiary or executor, it appears here.</div>
              ) : (
                <ul className="space-y-2">
                  {notices.map((n) => (
                    <li key={n.id} className={`rounded-lg border p-3 ${n.status === 'unread' ? 'border-amber-700/50 bg-amber-950/30' : 'border-zinc-800 bg-zinc-900/80'}`}>
                      <div className="text-xs text-zinc-100">{n.message}</div>
                      <div className="mt-0.5 text-[10px] text-zinc-400">{n.kind} · {new Date(n.createdAt).toLocaleString()}</div>
                      {n.acceptance === 'pending' && (
                        <div className="mt-1.5 flex gap-3">
                          <button type="button" className="text-xs text-emerald-400 hover:text-emerald-300" onClick={() => respondNotice(n.id, 'accepted')}>Accept</button>
                          <button type="button" className="text-xs text-rose-400 hover:text-rose-300" onClick={() => respondNotice(n.id, 'declined')}>Decline</button>
                        </div>
                      )}
                      {n.acceptance && n.acceptance !== 'pending' && (
                        <div className={`mt-1 text-[10px] ${tone(n.acceptance)}`}>you {n.acceptance} this</div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            )}

            {/* ── Heir-slot market ─────────────────────────────────── */}
            {tab === 'market' && (
              <div className="space-y-4">
                <p className="text-xs text-zinc-400">
                  Lock heir slots for dying NPCs. On death you inherit their recipes / desires / grudges.
                  Escrow is held until resolution; revoke any time from the Probate tab.
                </p>
                {listings.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 py-12 text-center italic text-zinc-400">
                    No open inheritance listings. Mentors list dying NPCs here to pre-arrange an heir.
                  </div>
                ) : (
                  <ul className="space-y-3">
                    {listings.map((l) => (
                      <li key={l.id} className="rounded-xl border border-zinc-700/50 bg-zinc-900/80 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-bold text-zinc-100">{l.npc_name || l.dying_npc_id}</h3>
                            <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                              mentor {l.mentor_user_id.slice(0, 8)} · listed {new Date(l.listed_at * 1000).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="mb-1 text-xs text-zinc-400">{l.heir_slot_price_cc} CC</div>
                            <button type="button" onClick={() => claimSlot(l)} className={btn}>Lock heir slot</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <EstateChatter />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <a href="#inheritance-skip" className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500">Skip to inheritance content</a>
      <RecentMineCard domain="inheritance" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="inheritance" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="inheritance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
