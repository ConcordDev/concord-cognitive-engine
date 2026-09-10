'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function ProbatePanel() {
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
    amendLock,
    revokeLock,
  } = useEstate();

  return (
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
  );
}
