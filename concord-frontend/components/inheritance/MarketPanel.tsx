'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TimelineView, ChartKit } from '@/components/viz';
import { useEstate } from './EstateContext';

export function MarketPanel() {
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
    openListing,
    claimSlot,
  } = useEstate();

  return (
              <div className="space-y-4">
                <p className="text-xs text-zinc-400">
                  Lock heir slots for dying NPCs. On death you inherit their recipes / desires / grudges.
                  Escrow is held until resolution; revoke any time from the Probate tab.
                </p>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <h3 className="mb-2 text-xs font-semibold text-zinc-300">List a dying NPC (mentor)</h3>
                  <p className="mb-2 text-[10px] text-zinc-500">
                    As a mentor, pre-arrange an heir for one of your dying NPCs. Buyers lock the slot; it resolves on the NPC’s death.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input className={`${inp} flex-1 min-w-[180px]`} placeholder="Dying NPC id" value={olNpc} onChange={(e) => setOlNpc(e.target.value)} />
                    <div className="flex items-center gap-1">
                      <input className={`${inp} w-24`} type="number" min={0} placeholder="Slot price" value={olPrice} onChange={(e) => setOlPrice(e.target.value)} />
                      <span className="text-xs text-zinc-400">CC</span>
                    </div>
                    <button type="button" disabled={olBusy} className={`${btn} disabled:opacity-50`} onClick={openListing}>{olBusy ? 'Listing…' : 'Open listing'}</button>
                  </div>
                </div>
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
  );
}
