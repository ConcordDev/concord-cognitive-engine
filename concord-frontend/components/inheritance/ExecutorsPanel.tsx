'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function ExecutorsPanel() {
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
    inp,
    btn,
    tone,
    assignExecutor,
    respondConsent,
    removeExecutor,
  } = useEstate();

  return (
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
  );
}
