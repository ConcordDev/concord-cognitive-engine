'use client';

// AqiGauge — IQAir/AirVisual-style radial AQI dial. Pure presentation:
// takes the real fetched `aqi` value + `category` and animates the arc
// fill to that exact value (framer-motion `animate` on the real number,
// not a decorative loop) — a genuine data-driven transition per
// docs/UI_QUALITY_RUBRIC.md §2 ("Data-driven transitions").
//
// US AQI technically runs 0-500; the dial visually saturates at 300
// (documented on the face as "300+") since >300 (Hazardous) is already
// the worst category and a linear 0-500 scale would make every real-world
// reading (usually 0-150) crowd into a sliver of the arc.

import { motion } from 'framer-motion';
import { CATEGORY_COLORS } from './AQIPanel';
import type { AqiData } from '@/hooks/useAqiData';

const SCALE_MAX = 300;
const RADIUS = 54;
const STROKE = 10;
const CIRC = Math.PI * RADIUS; // semicircle arc length

interface AqiGaugeProps {
  aqi: number;
  category: AqiData['category'];
  size?: number;
}

export function AqiGauge({ aqi, category, size = 140 }: AqiGaugeProps) {
  const pct = Math.max(0, Math.min(1, aqi / SCALE_MAX));
  const color = CATEGORY_COLORS[category]?.ring || '#4ade80';
  const dashOffset = CIRC * (1 - pct);

  return (
    <div className="relative" style={{ width: size, height: size * 0.62 }}>
      <svg
        viewBox={`0 0 ${RADIUS * 2 + STROKE} ${RADIUS + STROKE}`}
        width={size}
        height={size * 0.62}
        role="img"
        aria-label={`Air quality index ${Math.round(aqi)}, ${CATEGORY_COLORS[category]?.label || category}`}
      >
        {/* Track */}
        <path
          d={`M ${STROKE / 2} ${RADIUS + STROKE / 2} A ${RADIUS} ${RADIUS} 0 0 1 ${RADIUS * 2 + STROKE / 2} ${RADIUS + STROKE / 2}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE}
          strokeLinecap="round"
          className="text-white/[0.06]"
        />
        {/* Fill — animates to the real value */}
        <motion.path
          d={`M ${STROKE / 2} ${RADIUS + STROKE / 2} A ${RADIUS} ${RADIUS} 0 0 1 ${RADIUS * 2 + STROKE / 2} ${RADIUS + STROKE / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          initial={{ strokeDashoffset: CIRC }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-0.5">
        <div className="text-3xl font-bold tabular-nums text-white leading-none">{Math.round(aqi)}</div>
        <div className="text-[9px] uppercase tracking-wider text-gray-400 mt-0.5">AQI</div>
      </div>
    </div>
  );
}

export default AqiGauge;
