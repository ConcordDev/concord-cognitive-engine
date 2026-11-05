// Same rule as server/domains/parenting.js pgPercentileLabel.
// 3 is "3rd". 11, 12, and 13 stay "th".
export function percentileLabel(n: number): string {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return "N/A";
  const mod100 = Math.abs(v) % 100;
  const mod10 = mod100 % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th"
    : mod10 === 1 ? "st"
    : mod10 === 2 ? "nd"
    : mod10 === 3 ? "rd"
    : "th";
  return `${v}${suffix}`;
}
