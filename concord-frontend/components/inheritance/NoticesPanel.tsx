'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function NoticesPanel() {
  const {
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
    tone,
    respondNotice,
  } = useEstate();

  return (
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
  );
}
