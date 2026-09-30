'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function OverviewPanel() {
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
    onNavigate,
  } = useEstate();

  if (!overview) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 py-12 text-center text-xs text-zinc-400">
        Loading your estate…
      </div>
    );
  }

  return (
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
                    onClick={() => onNavigate?.('beneficiaries')}
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
  );
}
