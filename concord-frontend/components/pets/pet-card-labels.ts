/** Profile weight and the latest weigh-in are different stored figures. */

export function profileWeightLabel(weightKg: number | null | undefined): string | null {
  if (typeof weightKg !== 'number' || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  return `Profile weight ${weightKg} kg`;
}

export function latestWeighInLabel(
  entry: { weightKg?: number | null; date?: string | null } | null | undefined,
): string {
  if (!entry || typeof entry.weightKg !== 'number' || !Number.isFinite(entry.weightKg)) {
    return 'No weigh-in on this record';
  }
  const when = entry.date ? ` · ${entry.date}` : '';
  return `Latest weigh-in ${entry.weightKg} kg${when}`;
}
