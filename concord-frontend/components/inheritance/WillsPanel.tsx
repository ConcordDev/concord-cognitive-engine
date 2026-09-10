'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function WillsPanel() {
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
    authorWill,
    viewWill,
    restoreWill,
  } = useEstate();

  return (
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
  );
}
