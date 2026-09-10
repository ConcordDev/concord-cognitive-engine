'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function AssetsPanel() {
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
    addAsset,
    removeAsset,
  } = useEstate();

  return (
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
  );
}
