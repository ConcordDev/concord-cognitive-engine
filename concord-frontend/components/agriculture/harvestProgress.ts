/** Harvest lots that have actually come in. Planned and in-field lots are not progress. */
const BROUGHT_IN = new Set(['harvested', 'stored', 'sold']);

export function harvestProgressPct(
  harvests: Array<{ status?: string | null; quantity?: number | null }>,
  estimatedYield: number,
): number {
  if (!(estimatedYield > 0)) return 0;
  const broughtIn = harvests.reduce((sum, lot) => {
    if (!lot.status || !BROUGHT_IN.has(lot.status)) return sum;
    const qty = Number(lot.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
  return Math.min((broughtIn / estimatedYield) * 100, 100);
}
