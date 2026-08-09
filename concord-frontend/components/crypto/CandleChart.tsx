// Moved to components/charts/CandleChart.tsx (domain-agnostic shared primitive).
// This re-export exists as a one-cycle safety net for any stray import path —
// new code should import from '@/components/charts/CandleChart' directly.
export { default } from '@/components/charts/CandleChart';
export type { Candle } from '@/components/charts/CandleChart';
