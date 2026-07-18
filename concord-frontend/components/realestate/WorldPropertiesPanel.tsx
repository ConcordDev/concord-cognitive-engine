'use client';

/**
 * WorldPropertiesPanel — the real in-world property market.
 *
 * Wires the `real_estate` (underscore) domain — server/domains/real-estate.js
 * + server/lib/real-estate-engine.js — a genuine building-ownership /
 * property-listing / rental-agreement engine over `world_buildings` +
 * `property_listings` + `rental_agreements`. Before this panel existed the
 * only reference to this domain in the whole lens was a generic
 * <LensFeaturePanel lensId="real_estate" /> button-wall fallback; none of
 * the 10 real macros (list_for_sale / delist / active_listings / purchase /
 * owned / lease / dissolve_lease / my_rentals / tick_rentals / constants)
 * were ever called. This is the Concordia-world counterpart to the
 * Zillow/Redfin-shape consumer workbench elsewhere on this page — that one
 * is a personal listing/search CRM; this one moves real in-world buildings
 * between real players.
 *
 * Rent collection — two paths, both honest about what they actually are:
 *  - AUTOMATIC: the "real-estate-rent-collection" heartbeat
 *    (server/domains/real-estate.js) calls the real `tickRentals` engine
 *    on an ~hourly cadence (frequency 240 on the 15s governor tick), so a
 *    lease's rent is collected on its own without anyone visiting this
 *    panel. There is no realtime push for this (no socket event fires when
 *    it runs) — the per-row "auto-collects" indicator below is computed
 *    from the same `next_due_at` field the backend heartbeat itself reads,
 *    not a live subscription.
 *  - MANUAL: "Collect due rent" calls `tick_rentals` directly — the
 *    original path, kept as an honest fallback for forcing an immediate
 *    collection pass instead of waiting up to ~1h for the next automatic
 *    sweep.
 */

import { useCallback, useEffect, useState } from 'react';
import { Building2, Coins, KeyRound, Loader2, Store, Tag, Users, XCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ListingRow {
  id: string;
  building_id: string;
  seller_user_id: string;
  price_cents: number;
  listed_at: number;
  world_id?: string;
  archetype?: string;
  pos_x?: number;
  pos_z?: number;
}
interface BuildingRow {
  id: string;
  world_id: string;
  archetype: string;
  pos_x: number;
  pos_z: number;
  deed_dtu_id?: string | null;
  monthly_rent_cents: number;
  for_sale_price_cents: number;
  listed_at: number | null;
}
interface RentalRow {
  id: string;
  building_id: string;
  landlord_user_id: string;
  tenant_kind: string;
  tenant_id: string;
  rent_cents: number;
  period_days: number;
  next_due_at: number;
  dissolved_at: number | null;
  last_paid_at: number | null;
}

type Section = 'marketplace' | 'owned' | 'rentals';

const usd = (cents: number) => `$${(Math.round(cents) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const dateOf = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString();

// The "real-estate-rent-collection" heartbeat (server/domains/real-estate.js)
// runs at frequency 240 on the 15s governor tick — an ~hourly cadence. This
// label is derived from the same `next_due_at` field the backend heartbeat
// itself reads (server/lib/real-estate-engine.js#listMyRentals /
// #tickRentals), not a separate live subscription — there is no realtime
// socket push for this sweep, so "next auto-collection" is a computed
// estimate, honestly bounded by the sweep's own cadence rather than implying
// second-precision.
const RENT_SWEEP_INTERVAL_S = 3600;
function autoCollectLabel(nextDueAtSeconds: number): string {
  const nowS = Math.floor(Date.now() / 1000);
  const delta = nextDueAtSeconds - nowS;
  if (delta <= 0) return 'auto-collects on the next hourly sweep';
  if (delta <= RENT_SWEEP_INTERVAL_S) return 'auto-collects within the hour';
  return `auto-collects ~${dateOf(nextDueAtSeconds)}`;
}

export function WorldPropertiesPanel() {
  const [section, setSection] = useState<Section>('marketplace');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [worldFilter, setWorldFilter] = useState('');
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [owned, setOwned] = useState<BuildingRow[]>([]);
  const [rentalsAsLandlord, setRentalsAsLandlord] = useState<RentalRow[]>([]);
  const [rentalsAsTenant, setRentalsAsTenant] = useState<RentalRow[]>([]);
  const [defaultPeriodDays, setDefaultPeriodDays] = useState(30);

  const [saleForm, setSaleForm] = useState<{ buildingId: string; price: string }>({ buildingId: '', price: '' });
  const [leaseForm, setLeaseForm] = useState<{ buildingId: string; tenantKind: 'player' | 'npc'; tenantId: string; rent: string; periodDays: string }>({
    buildingId: '', tenantKind: 'player', tenantId: '', rent: '', periodDays: '',
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listingsRes, ownedRes, landlordRes, tenantRes, constantsRes] = await Promise.all([
        lensRun({ domain: 'real_estate', action: 'active_listings', input: worldFilter.trim() ? { worldId: worldFilter.trim() } : {} }),
        lensRun({ domain: 'real_estate', action: 'owned', input: {} }),
        lensRun({ domain: 'real_estate', action: 'my_rentals', input: { role: 'landlord' } }),
        lensRun({ domain: 'real_estate', action: 'my_rentals', input: { role: 'tenant' } }),
        lensRun({ domain: 'real_estate', action: 'constants', input: {} }),
      ]);
      if (listingsRes.data?.ok) setListings((listingsRes.data.result?.listings as ListingRow[]) || []);
      else setError(listingsRes.data?.error || 'Could not load listings.');
      if (ownedRes.data?.ok) setOwned((ownedRes.data.result?.buildings as BuildingRow[]) || []);
      if (landlordRes.data?.ok) setRentalsAsLandlord((landlordRes.data.result?.rentals as RentalRow[]) || []);
      if (tenantRes.data?.ok) setRentalsAsTenant((tenantRes.data.result?.rentals as RentalRow[]) || []);
      const days = (constantsRes.data?.result?.constants as { DEFAULT_RENTAL_PERIOD_DAYS?: number } | undefined)?.DEFAULT_RENTAL_PERIOD_DAYS;
      if (days) setDefaultPeriodDays(days);
    } catch (e) {
      console.error('[WorldProperties] refresh failed', e);
      setError('Could not reach the world property market.');
    } finally {
      setLoading(false);
    }
  }, [worldFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  // Cross-reference: which of my owned buildings currently has an active
  // listing (needed to resolve a listingId for delist — `owned` only
  // exposes for_sale_price_cents/listed_at on world_buildings, the
  // listingId itself lives on property_listings).
  const listingIdForBuilding = useCallback(
    (buildingId: string) => listings.find((l) => l.building_id === buildingId)?.id,
    [listings]
  );

  async function buy(listingId: string) {
    setBusy(listingId);
    setError(null);
    try {
      const r = await lensRun({ domain: 'real_estate', action: 'purchase', input: { listingId } });
      if (r.data?.ok) await refresh();
      else setError(r.data?.error || 'Purchase failed.');
    } catch (e) {
      console.error('[WorldProperties] purchase failed', e);
      setError('Purchase failed.');
    } finally {
      setBusy(null);
    }
  }

  async function listForSale(buildingId: string, price: string) {
    const priceCents = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      setError('Enter a valid asking price.');
      return;
    }
    setBusy(buildingId);
    setError(null);
    try {
      const r = await lensRun({ domain: 'real_estate', action: 'list_for_sale', input: { buildingId, priceCents } });
      if (r.data?.ok) {
        setSaleForm({ buildingId: '', price: '' });
        await refresh();
      } else setError(r.data?.error || 'Could not list building for sale.');
    } catch (e) {
      console.error('[WorldProperties] list_for_sale failed', e);
      setError('Could not list building for sale.');
    } finally {
      setBusy(null);
    }
  }

  async function delistBuilding(buildingId: string) {
    const listingId = listingIdForBuilding(buildingId);
    if (!listingId) { setError('No active listing found for that building.'); return; }
    setBusy(buildingId);
    setError(null);
    try {
      const r = await lensRun({ domain: 'real_estate', action: 'delist', input: { listingId } });
      if (r.data?.ok) await refresh();
      else setError(r.data?.error || 'Delist failed.');
    } catch (e) {
      console.error('[WorldProperties] delist failed', e);
      setError('Delist failed.');
    } finally {
      setBusy(null);
    }
  }

  async function createLease() {
    const rentCents = Math.round(Number(leaseForm.rent) * 100);
    if (!leaseForm.buildingId || !leaseForm.tenantId.trim() || !Number.isFinite(rentCents) || rentCents <= 0) {
      setError('Building, tenant, and monthly rent are required.');
      return;
    }
    setBusy('lease');
    setError(null);
    try {
      const r = await lensRun({
        domain: 'real_estate', action: 'lease',
        input: {
          buildingId: leaseForm.buildingId,
          tenantKind: leaseForm.tenantKind,
          tenantId: leaseForm.tenantId.trim(),
          rentCents,
          periodDays: leaseForm.periodDays ? Number(leaseForm.periodDays) : defaultPeriodDays,
        },
      });
      if (r.data?.ok) {
        setLeaseForm({ buildingId: '', tenantKind: 'player', tenantId: '', rent: '', periodDays: '' });
        await refresh();
      } else setError(r.data?.error || 'Could not create lease.');
    } catch (e) {
      console.error('[WorldProperties] lease failed', e);
      setError('Could not create lease.');
    } finally {
      setBusy(null);
    }
  }

  async function dissolve(agreementId: string) {
    setBusy(agreementId);
    setError(null);
    try {
      const r = await lensRun({ domain: 'real_estate', action: 'dissolve_lease', input: { agreementId } });
      if (r.data?.ok) await refresh();
      else setError(r.data?.error || 'Could not dissolve lease.');
    } catch (e) {
      console.error('[WorldProperties] dissolve_lease failed', e);
      setError('Could not dissolve lease.');
    } finally {
      setBusy(null);
    }
  }

  async function collectRentNow() {
    setBusy('tick');
    setError(null);
    try {
      const r = await lensRun({ domain: 'real_estate', action: 'tick_rentals', input: {} });
      if (r.data?.ok) await refresh();
      else setError(r.data?.error || 'Rent collection failed.');
    } catch (e) {
      console.error('[WorldProperties] tick_rentals failed', e);
      setError('Rent collection failed.');
    } finally {
      setBusy(null);
    }
  }

  const myOwnedIds = new Set(owned.map((b) => b.id));

  const SECTIONS: { id: Section; label: string; icon: typeof Store }[] = [
    { id: 'marketplace', label: 'Marketplace', icon: Store },
    { id: 'owned', label: 'My buildings', icon: Building2 },
    { id: 'rentals', label: 'Rentals', icon: KeyRound },
  ];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">World property market</span>
        <span className="ml-auto text-[10px] text-gray-400">buy / sell / lease real in-world buildings</span>
      </header>

      <nav className="flex items-center gap-1 px-3 pt-2 border-b border-white/10 pb-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono transition',
              section === s.id
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                : 'text-gray-400 hover:text-cyan-300 border border-transparent'
            )}
          >
            <s.icon className="w-3.5 h-3.5" />{s.label}
            {s.id === 'owned' && owned.length > 0 && <span className="text-[9px] bg-white/10 px-1 rounded">{owned.length}</span>}
            {s.id === 'rentals' && (rentalsAsLandlord.length + rentalsAsTenant.length) > 0 && (
              <span className="text-[9px] bg-white/10 px-1 rounded">{rentalsAsLandlord.length + rentalsAsTenant.length}</span>
            )}
          </button>
        ))}
      </nav>

      {error && (
        <p className="mx-3 mt-2 text-[11px] text-rose-400 flex items-center gap-1"><XCircle className="w-3 h-3" />{error}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="p-3 space-y-3">
          {section === 'marketplace' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  value={worldFilter}
                  onChange={(e) => setWorldFilter(e.target.value)}
                  placeholder="Filter by world id (blank = all worlds)"
                  className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <button onClick={refresh} className="px-2.5 py-1.5 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10">Refresh</button>
              </div>
              {listings.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-4 text-center">No active listings{worldFilter ? ' in that world' : ''}. Owned buildings can be listed from the &quot;My buildings&quot; tab.</p>
              ) : (
                <ul className="space-y-1.5">
                  {listings.map((l) => {
                    const mine = myOwnedIds.has(l.building_id);
                    return (
                      <li key={l.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-semibold text-white">{usd(l.price_cents)}</span>
                            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{l.archetype || 'building'}</span>
                            {mine && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">yours</span>}
                          </div>
                          <div className="text-[10px] text-gray-400">world {l.world_id || '?'} · listed {dateOf(l.listed_at)}</div>
                        </div>
                        {!mine && (
                          <button
                            onClick={() => buy(l.id)}
                            disabled={busy === l.id}
                            className="px-3 py-1.5 text-[11px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1"
                          >
                            {busy === l.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />} Buy
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {section === 'owned' && (
            <div className="space-y-2">
              {owned.length === 0 ? (
                <p className="text-[11px] text-gray-400 py-4 text-center">No owned buildings yet. Buildings are claimed in the Concordia world lens; once you own one it shows up here to sell or lease.</p>
              ) : (
                <ul className="space-y-1.5">
                  {owned.map((b) => {
                    const listingId = listingIdForBuilding(b.id);
                    const isListed = !!b.listed_at || !!listingId;
                    const draftingSale = saleForm.buildingId === b.id;
                    const draftingLease = leaseForm.buildingId === b.id;
                    return (
                      <li key={b.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-white">{b.archetype || 'building'}</span>
                          <span className="text-[10px] text-gray-400">world {b.world_id} · ({b.pos_x?.toFixed(0)}, {b.pos_z?.toFixed(0)})</span>
                          {isListed && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 ml-auto">for sale {usd(b.for_sale_price_cents)}</span>}
                          {b.monthly_rent_cents > 0 && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">rented {usd(b.monthly_rent_cents)}/mo</span>}
                        </div>
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          {isListed ? (
                            <button onClick={() => delistBuilding(b.id)} disabled={busy === b.id} className="px-2.5 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40 inline-flex items-center gap-1">
                              {busy === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />} Delist
                            </button>
                          ) : (
                            <button onClick={() => setSaleForm(draftingSale ? { buildingId: '', price: '' } : { buildingId: b.id, price: '' })} className="px-2.5 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10 inline-flex items-center gap-1">
                              <Tag className="w-3 h-3" /> List for sale
                            </button>
                          )}
                          <button onClick={() => setLeaseForm(draftingLease ? { buildingId: '', tenantKind: 'player', tenantId: '', rent: '', periodDays: '' } : { buildingId: b.id, tenantKind: 'player', tenantId: '', rent: '', periodDays: '' })} className="px-2.5 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10 inline-flex items-center gap-1">
                            <Users className="w-3 h-3" /> {b.monthly_rent_cents > 0 ? 'New lease' : 'Lease out'}
                          </button>
                        </div>
                        {draftingSale && (
                          <div className="mt-2 flex items-center gap-2">
                            <input type="number" value={saleForm.price} onChange={(e) => setSaleForm({ ...saleForm, price: e.target.value })} placeholder="Asking price $" className="flex-1 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                            <button onClick={() => listForSale(b.id, saleForm.price)} disabled={busy === b.id} className="px-3 py-1 text-[11px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40">List</button>
                          </div>
                        )}
                        {draftingLease && (
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            <select value={leaseForm.tenantKind} onChange={(e) => setLeaseForm({ ...leaseForm, tenantKind: e.target.value as 'player' | 'npc' })} className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                              <option value="player">Player tenant</option>
                              <option value="npc">NPC tenant</option>
                            </select>
                            <input value={leaseForm.tenantId} onChange={(e) => setLeaseForm({ ...leaseForm, tenantId: e.target.value })} placeholder="Tenant user/NPC id" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                            <input type="number" value={leaseForm.rent} onChange={(e) => setLeaseForm({ ...leaseForm, rent: e.target.value })} placeholder="Rent $/period" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                            <input type="number" value={leaseForm.periodDays} onChange={(e) => setLeaseForm({ ...leaseForm, periodDays: e.target.value })} placeholder={`Period days (${defaultPeriodDays})`} className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                            <button onClick={createLease} disabled={busy === 'lease'} className="col-span-4 px-3 py-1 text-[11px] rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40">Create lease</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {section === 'rentals' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase tracking-wider text-gray-400">
                  Rent collects automatically on an hourly sweep (server-side, no tab needed) — use this button to force an immediate check instead of waiting.
                </span>
                <button onClick={collectRentNow} disabled={busy === 'tick'} className="px-2.5 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-white/10 disabled:opacity-40 inline-flex items-center gap-1 flex-shrink-0">
                  {busy === 'tick' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Coins className="w-3 h-3" />} Collect due rent now (manual)
                </button>
              </div>

              <section>
                <span className="text-[10px] uppercase tracking-wider text-gray-400">As landlord</span>
                {rentalsAsLandlord.length === 0 ? (
                  <p className="text-[11px] text-gray-400 py-1">No tenants yet.</p>
                ) : (
                  <ul className="space-y-1.5 mt-1.5">
                    {rentalsAsLandlord.map((r) => (
                      <li key={r.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0 text-xs">
                          <span className="text-white font-semibold">{usd(r.rent_cents)}</span>
                          <span className="text-gray-400"> / {r.period_days}d from {r.tenant_kind} {r.tenant_id}</span>
                          <div className="text-[10px] text-gray-400">
                            next due {dateOf(r.next_due_at)} · <span className="text-emerald-400/80">{autoCollectLabel(r.next_due_at)}</span>
                          </div>
                        </div>
                        <button onClick={() => dissolve(r.id)} disabled={busy === r.id} className="px-2.5 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40">
                          {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'End lease'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <span className="text-[10px] uppercase tracking-wider text-gray-400">As tenant</span>
                {rentalsAsTenant.length === 0 ? (
                  <p className="text-[11px] text-gray-400 py-1">You aren&apos;t renting anywhere.</p>
                ) : (
                  <ul className="space-y-1.5 mt-1.5">
                    {rentalsAsTenant.map((r) => (
                      <li key={r.id} className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0 text-xs">
                          <span className="text-white font-semibold">{usd(r.rent_cents)}</span>
                          <span className="text-gray-400"> / {r.period_days}d to {r.landlord_user_id}</span>
                          <div className="text-[10px] text-gray-400">
                            next due {dateOf(r.next_due_at)} · <span className="text-emerald-400/80">{autoCollectLabel(r.next_due_at)}</span>
                          </div>
                        </div>
                        <button onClick={() => dissolve(r.id)} disabled={busy === r.id} className="px-2.5 py-1 text-[10px] rounded bg-white/5 text-gray-300 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40">
                          {busy === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'End lease'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorldPropertiesPanel;
