'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function IntestacyPanel() {
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
  } = useEstate();

  return (
              <div className="space-y-4">
                <p className="text-xs text-zinc-400">
                  What happens to an estate when there&apos;s no will? A small, cited reference
                  set of real state intestate-succession statutes — a <strong>representative
                  subset</strong> of US states, not full 50-state coverage.
                </p>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <label htmlFor="intestacy-state-select" className="mb-1 block text-xs font-semibold text-zinc-300">Select a state</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      id="intestacy-state-select" className={inp}
                      value={intestacySelected}
                      onChange={(e) => setIntestacySelected(e.target.value)}
                    >
                      {intestacyStates.length === 0 && <option value="">Loading…</option>}
                      {intestacyStates.map((s) => (
                        <option key={s.stateCode} value={s.stateCode}>{s.state} ({s.stateCode})</option>
                      ))}
                    </select>
                    {intestacyBusy && <span className="text-[10px] text-zinc-500">Looking up…</span>}
                  </div>
                </div>
                {intestacyResult && (
                  intestacyResult.covered ? (
                    <div className="space-y-3">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                        <h3 className="text-sm font-semibold text-zinc-100">
                          {intestacyResult.state}
                          {intestacyResult.propertyRegime && (
                            <span className="ml-2 text-[10px] font-normal uppercase tracking-wider text-amber-400">
                              {intestacyResult.propertyRegime === 'community_property' ? 'Community property state' : 'Common-law property state'}
                            </span>
                          )}
                        </h3>
                        <p className="mt-1 font-mono text-[10px] text-cyan-300">{intestacyResult.citation}</p>
                        <p className="mt-0.5 text-[10px] text-zinc-500">{intestacyResult.source}</p>
                        <p className="mt-2 text-xs text-zinc-300">{intestacyResult.summary}</p>
                      </div>
                      <table className="w-full text-left text-xs">
                        <thead className="text-zinc-400">
                          <tr><th className="py-1">If survived by…</th><th>Default intestate share</th></tr>
                        </thead>
                        <tbody>
                          {(intestacyResult.scenarios || []).map((sc, i) => (
                            <tr key={i} className="border-t border-zinc-800 align-top">
                              <td className="py-1.5 pr-3 text-zinc-100">{sc.survivedBy}</td>
                              <td className="py-1.5 text-zinc-300">{sc.share}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[10px] text-amber-200">
                        {intestacyResult.disclaimer}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-zinc-800 py-8 text-center">
                      <p className="text-xs italic text-zinc-400">{intestacyResult.message}</p>
                      <div className="mx-auto mt-3 max-w-md rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[10px] text-amber-200">
                        {intestacyResult.disclaimer}
                      </div>
                    </div>
                  )
                )}
              </div>
  );
}
