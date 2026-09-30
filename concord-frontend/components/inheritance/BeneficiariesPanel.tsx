'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function BeneficiariesPanel() {
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
    addBeneficiary,
    removeBeneficiary,
    reShare,
    notifyHeir,
  } = useEstate();

  return (
              <div className="space-y-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">Designate a beneficiary</h3>
                  <div className="flex flex-wrap gap-2">
                    <input className={inp} placeholder="Name" value={bName} onChange={(e) => setBName(e.target.value)} />
                    <input className={inp} placeholder="Relationship" value={bRel} onChange={(e) => setBRel(e.target.value)} />
                    <input className={`${inp} w-24`} type="number" placeholder="Share %" value={bShare} onChange={(e) => setBShare(e.target.value)} />
                    <input className={inp} placeholder="Contingent on… (optional)" value={bContingentOn} onChange={(e) => setBContingentOn(e.target.value)} />
                    <input className={inp} placeholder="Heir user ID (optional)" value={bHeir} onChange={(e) => setBHeir(e.target.value)} />
                    <button type="button" className={btn} onClick={addBeneficiary}>Add</button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-500">Link an heir user ID to send them a designation notice they can accept or decline.</p>
                </div>
                {beneficiaries.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 py-10 text-center italic text-zinc-400">No beneficiaries designated yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {beneficiaries.map((b) => {
                      const draftOpen = b.id in notifyDraft;
                      return (
                      <li key={b.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-zinc-100">{b.name} <span className="text-xs font-normal text-zinc-400">· {b.relationship}</span></div>
                            {b.contingent && <div className="text-[10px] text-amber-400">contingent on: {b.contingentOn}</div>}
                            {b.heirUserId && <div className="text-[10px] text-zinc-500">heir: {b.heirUserId.slice(0, 16)}</div>}
                            {b.acceptanceStatus
                              ? <div className={`text-[10px] ${tone(b.acceptanceStatus)}`}>designation {b.acceptanceStatus}</div>
                              : <div className="text-[10px] text-zinc-500">designation not yet sent</div>}
                          </div>
                          <input
                            className={`${inp} w-20`} type="number" defaultValue={b.sharePct}
                            onBlur={(e) => { const v = Number(e.target.value); if (v !== b.sharePct) void reShare(b.id, v); }}
                          />
                          <span className="text-xs text-zinc-400">%</span>
                          {b.heirUserId ? (
                            <button
                              type="button" disabled={notifyBusy === b.id}
                              className="text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50"
                              onClick={() => notifyHeir(b, b.heirUserId as string)}
                            >{notifyBusy === b.id ? 'Notifying…' : 'Notify heir'}</button>
                          ) : (
                            <button
                              type="button"
                              className="text-xs text-cyan-400 hover:text-cyan-300"
                              onClick={() => setNotifyDraft((d) => (b.id in d ? (() => { const n = { ...d }; delete n[b.id]; return n; })() : { ...d, [b.id]: '' }))}
                            >{draftOpen ? 'Cancel' : 'Notify heir'}</button>
                          )}
                          <button type="button" className="text-xs text-rose-400 hover:text-rose-300" onClick={() => removeBeneficiary(b.id)}>Remove</button>
                        </div>
                        {draftOpen && !b.heirUserId && (
                          <div className="mt-2 flex items-center gap-2 border-t border-zinc-800 pt-2">
                            <input
                              className={`${inp} flex-1`} placeholder="Heir user ID to notify"
                              value={notifyDraft[b.id]} autoFocus
                              onChange={(e) => setNotifyDraft((d) => ({ ...d, [b.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter') void notifyHeir(b, notifyDraft[b.id] || ''); }}
                            />
                            <button
                              type="button" disabled={notifyBusy === b.id}
                              className={`${btn} disabled:opacity-50`}
                              onClick={() => notifyHeir(b, notifyDraft[b.id] || '')}
                            >{notifyBusy === b.id ? 'Sending…' : 'Send notice'}</button>
                          </div>
                        )}
                      </li>
                      );
                    })}
                  </ul>
                )}
                <div className="text-xs text-zinc-400">Unallocated remainder: <span className="font-mono text-amber-300">{remainderPct}%</span></div>
              </div>
  );
}
