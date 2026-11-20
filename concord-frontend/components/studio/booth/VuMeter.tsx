'use client';

/**
 * An analog VU meter. The needle is driven every animation frame from a real
 * analyser reading (`read` returns RMS dBFS) through VU ballistics; it rests
 * on the left peg when nothing is playing. No React state per frame.
 */

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { useBeatFrame } from '../daw/engine-hooks';
import { dbfsToVu, vuAngle, vuStep, VU_MIN } from './vu';

const MARKS: Array<[number, string]> = [[-20, '20'], [-10, '10'], [-7, '7'], [-5, '5'], [-3, '3'], [-2, ''], [-1, ''], [0, '0'], [1, ''], [2, ''], [3, '+3']];
const CX = 60;
const CY = 62;
const R = 50;

function polar(deg: number, r: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

export function VuMeter({ read, label, size = 'md', testId }: { read: () => number; label: string; size?: 'sm' | 'md'; testId?: string }) {
  const needle = useRef<SVGLineElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const state = useRef({ vu: VU_MIN, t: 0 });
  useBeatFrame(() => {
    const now = performance.now();
    const dt = state.current.t ? (now - state.current.t) / 1000 : 0;
    state.current.t = now;
    const target = dbfsToVu(read());
    state.current.vu = vuStep(state.current.vu, target, dt);
    const ang = vuAngle(state.current.vu);
    if (needle.current) needle.current.setAttribute('transform', `rotate(${ang.toFixed(2)} ${CX} ${CY})`);
    if (readout.current) readout.current.textContent = state.current.vu <= VU_MIN + 0.05 ? '−∞' : `${state.current.vu >= 0 ? '+' : ''}${state.current.vu.toFixed(1)}`;
  });
  return (
    <figure className={cn('flex flex-col items-center gap-1', size === 'sm' ? 'w-28' : 'w-36')} data-testid={testId}>
      <div className="bo-well w-full rounded-md p-1.5">
        <svg viewBox="0 0 120 70" className="bo-vu-face block w-full rounded-sm" role="img" aria-label={`${label} VU meter`}>
          <path d={`M ${polar(-48, R).join(' ')} A ${R} ${R} 0 0 1 ${polar(vuAngle(0), R).join(' ')}`} className="bo-vu-ink" fill="none" strokeWidth={1} />
          <path d={`M ${polar(vuAngle(0), R).join(' ')} A ${R} ${R} 0 0 1 ${polar(48, R).join(' ')}`} className="bo-vu-red" fill="none" strokeWidth={3} />
          {MARKS.map(([vu, text]) => {
            const ang = vuAngle(vu);
            const [x1, y1] = polar(ang, R);
            const [x2, y2] = polar(ang, R - (text ? 6 : 4));
            const [tx, ty] = polar(ang, R - 13);
            return (
              <g key={vu}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={vu > 0 ? 'bo-vu-red' : 'bo-vu-ink'} strokeWidth={1} />
                {text && <text x={tx} y={ty + 2} fontSize={6.5} textAnchor="middle" className="bo-vu-ink" stroke="none">{text}</text>}
              </g>
            );
          })}
          <text x={CX} y={44} fontSize={9} textAnchor="middle" className="bo-vu-ink" stroke="none" style={{ letterSpacing: '0.12em' }}>VU</text>
          <line ref={needle} x1={CX} y1={CY} x2={CX} y2={CY - R - 2} className="bo-vu-needle" strokeWidth={1.4} strokeLinecap="round" transform={`rotate(${vuAngle(VU_MIN)} ${CX} ${CY})`} />
          <circle cx={CX} cy={CY} r={4} className="bo-vu-ink" />
        </svg>
      </div>
      <figcaption className="flex w-full items-baseline justify-between px-0.5">
        <span className="bo-engrave text-[11px]">{label}</span>
        <span ref={readout} className="bo-led text-[11px]">−∞</span>
      </figcaption>
    </figure>
  );
}
