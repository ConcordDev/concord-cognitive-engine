'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TimelineEvent } from '@/components/viz';
import {
  run,
  type Listing, type Beneficiary, type WillVersion, type Asset,
  type Executor, type Lock, type Notice, type Overview,
  type IntestacyStateSummary, type IntestacyLookupResult,
} from './inheritance-shared';


type EstateCtx = ReturnType<typeof useEstateValue>;

const EstateContext = createContext<EstateCtx | null>(null);

function useEstateValue(onNavigate?: (tab: string) => void) {
  const navigate = onNavigate;

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
  const loadAllRef = useRef<(() => Promise<void>) | null>(null);

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

  useEffect(() => { loadAllRef.current = loadAll; void loadAll(); }, [loadAll]);

  // ── Beneficiary form ───────────────────────────────────────────────
  const [bName, setBName] = useState('');
  const [bRel, setBRel] = useState('');
  const [bShare, setBShare] = useState('');
  const [bContingentOn, setBContingentOn] = useState('');
  const [bHeir, setBHeir] = useState('');
  // Per-beneficiary "notify heir" inline editor: beneficiaryId → typed heir user id.
  const [notifyDraft, setNotifyDraft] = useState<Record<string, string>>({});
  const [notifyBusy, setNotifyBusy] = useState<string | null>(null);

  const addBeneficiary = async () => {
    if (!bName.trim()) return flash('Beneficiary needs a name.');
    const r = await run('add_beneficiary', {
      name: bName, relationship: bRel, sharePct: Number(bShare) || 0,
      contingent: !!bContingentOn.trim(), contingentOn: bContingentOn.trim() || null,
      heirUserId: bHeir.trim() || null,
    });
    if (r?.ok) { setBName(''); setBRel(''); setBShare(''); setBContingentOn(''); setBHeir(''); flash('Beneficiary added.'); void loadAll(); }
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
  // Send a designation notice to an heir user so they can accept/decline
  // (the receiving half — My Notices — was already wired; this closes the loop).
  const notifyHeir = async (b: Beneficiary, heirUserId: string) => {
    const heir = heirUserId.trim();
    if (!heir) return flash('Enter the heir’s user ID first.');
    setNotifyBusy(b.id);
    flash(`Notifying ${b.name}…`);
    const r = await run('notify_heir', { heirUserId: heir, beneficiaryId: b.id });
    setNotifyBusy(null);
    if (r?.ok) {
      setNotifyDraft((d) => { const n = { ...d }; delete n[b.id]; return n; });
      flash(`✓ Designation notice sent to ${heir.slice(0, 12)}.`);
    } else flash(`Failed: ${r?.error || 'unknown'}`);
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
  // Mentor side: list a dying NPC's heir slot for another player to lock.
  const [olNpc, setOlNpc] = useState('');
  const [olPrice, setOlPrice] = useState('10');
  const [olBusy, setOlBusy] = useState(false);
  const openListing = async () => {
    if (!olNpc.trim()) return flash('Enter the dying NPC id to list.');
    setOlBusy(true);
    const r = (await run('open_listing', {
      dyingNpcId: olNpc.trim(), heirSlotPriceCc: Number(olPrice) || 10,
    })) as any;
    setOlBusy(false);
    if (r?.ok) { setOlNpc(''); setOlPrice('10'); flash(`✓ Heir slot listed (#${r.result?.listingId ?? ''}).`); void loadAll(); }
    else flash(`Failed: ${r?.error || r?.reason || 'unknown'}`);
  };

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

  // ── Intestacy reference (Track D, CURATION) ──────────────────────────
  // Real, authored, cited state intestate-succession share tables — a
  // representative subset of states, not full 50-state coverage. Backed
  // by content/intestacy-reference.json via inheritance.intestacy-lookup.
  const [intestacyStates, setIntestacyStates] = useState<IntestacyStateSummary[]>([]);
  const [intestacySelected, setIntestacySelected] = useState('');
  const [intestacyResult, setIntestacyResult] = useState<IntestacyLookupResult | null>(null);
  const [intestacyBusy, setIntestacyBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await run('intestacy-states-list');
        if (r?.ok) {
          const states: IntestacyStateSummary[] = r.result?.statesCovered || [];
          setIntestacyStates(states);
          if (states.length > 0) setIntestacySelected(states[0].stateCode);
        }
      } catch {
        // Reference-data tab; a fetch failure here shouldn't crash the
        // effect or surface as an unhandled rejection — the intestacy
        // tab simply stays empty until the next successful load.
      }
    })();
  }, []);

  const lookupIntestacy = async (stateCode: string) => {
    if (!stateCode) return;
    setIntestacyBusy(true);
    const r = await run('intestacy-lookup', { state: stateCode });
    setIntestacyBusy(false);
    if (r?.ok) setIntestacyResult(r.result);
    else flash(`Failed: ${r?.error || 'unknown'}`);
  };

  useEffect(() => {
    if (intestacySelected) void lookupIntestacy(intestacySelected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intestacySelected]);

  const inp = 'rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100';
  const btn = 'rounded bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-600';
  const tone = (s: string) => s === 'accepted' ? 'text-emerald-300' : s === 'declined' || s === 'revoked' ? 'text-rose-300' : s === 'amended' ? 'text-amber-300' : 'text-zinc-400';


  return {
    onNavigate: navigate,
    status,
    setStatus,
    overview,
    setOverview,
    beneficiaries,
    setBeneficiaries,
    remainderPct,
    setRemainderPct,
    wills,
    setWills,
    activeWill,
    setActiveWill,
    assets,
    setAssets,
    assetByCat,
    setAssetByCat,
    executors,
    setExecutors,
    locks,
    setLocks,
    escrowedCc,
    setEscrowedCc,
    timeline,
    setTimeline,
    pendingTransfers,
    setPendingTransfers,
    notices,
    setNotices,
    listings,
    setListings,
    loading,
    setLoading,
    loadError,
    setLoadError,
    bName,
    setBName,
    bRel,
    setBRel,
    bShare,
    setBShare,
    bContingentOn,
    setBContingentOn,
    bHeir,
    setBHeir,
    notifyDraft,
    setNotifyDraft,
    notifyBusy,
    setNotifyBusy,
    wTitle,
    setWTitle,
    wBody,
    setWBody,
    wKind,
    setWKind,
    aLabel,
    setALabel,
    aCat,
    setACat,
    aValue,
    setAValue,
    aLoc,
    setALoc,
    aNotes,
    setANotes,
    eName,
    setEName,
    eRole,
    setERole,
    olNpc,
    setOlNpc,
    olPrice,
    setOlPrice,
    olBusy,
    setOlBusy,
    intestacyStates,
    setIntestacyStates,
    intestacySelected,
    setIntestacySelected,
    intestacyResult,
    setIntestacyResult,
    intestacyBusy,
    setIntestacyBusy,
    loadAll,
    loadAllRef,
    inp,
    btn,
    flash,
    tone,
    // action handlers
    addBeneficiary,
    removeBeneficiary,
    reShare,
    notifyHeir,
    authorWill,
    viewWill,
    restoreWill,
    addAsset,
    removeAsset,
    assignExecutor,
    respondConsent,
    removeExecutor,
    amendLock,
    revokeLock,
    respondNotice,
    openListing,
    claimSlot,
    lookupIntestacy,
  };
}

export function EstateProvider({ children, onNavigate }: { children: ReactNode; onNavigate?: (tab: string) => void }) {
  const value = useEstateValue(onNavigate);
  return <EstateContext.Provider value={value}>{children}</EstateContext.Provider>;
}

export function useEstate() {
  const ctx = useContext(EstateContext);
  if (!ctx) throw new Error('useEstate requires EstateProvider');
  return ctx;
}
