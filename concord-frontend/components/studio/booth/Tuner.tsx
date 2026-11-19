'use client';

/**
 * The booth tuner. Its needle is the live Pitch Correct worklet's own meter:
 * how far the voice going through the device sits from the note it is being
 * tuned to. It moves only while that device is processing voiced audio (play
 * the take, or sing with input monitoring on); otherwise it rests and says why.
 */

import { useRef } from 'react';
import { readPitchMeter } from '@/lib/daw/dsp/pitch/runtime';
import { useBeatFrame } from '../daw/engine-hooks';
import { TUNER_LOCK_CENTS, tunerAngle } from './vu';

export function Tuner({ fxId }: { fxId: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGLineElement>(null);
  const note = useRef<HTMLSpanElement>(null);
  const sung = useRef<HTMLSpanElement>(null);
  const cents = useRef<HTMLSpanElement>(null);
  useBeatFrame(() => {
    const m = readPitchMeter();
    const live = !!fxId && m.id === fxId && m.voiced;
    const ang = live ? tunerAngle(m.cents) : 0;
    if (needle.current) needle.current.setAttribute('transform', `rotate(${ang.toFixed(2)} 60 58)`);
    if (root.current) {
      root.current.dataset.live = live ? 'true' : 'false';
      root.current.dataset.locked = live && Math.abs(m.cents) <= TUNER_LOCK_CENTS ? 'true' : 'false';
    }
    if (note.current) note.current.textContent = live ? m.target : '—';
    if (sung.current) sung.current.textContent = live ? `sung ${m.detected}` : fxId ? 'Play or sing through it' : 'Tune a vocal to light this up';
    if (cents.current) cents.current.textContent = live ? `${m.cents >= 0 ? '+' : ''}${m.cents.toFixed(0)}¢` : '';
  });
  return (
    <div ref={root} className="bo-tuner bo-well rounded-lg p-2" data-live="false" data-locked="false" data-testid="booth-tuner">
      <svg viewBox="0 0 120 64" className="block w-full" role="img" aria-label="Tuner: cents from the target note">
        {Array.from({ length: 11 }, (_, i) => {
          const c = -50 + i * 10;
          const a = ((tunerAngle(c) - 90) * Math.PI) / 180;
          const r1 = 48;
          const r2 = c === 0 ? 38 : c % 50 === 0 ? 41 : 44;
          return <line key={c} x1={60 + r1 * Math.cos(a)} y1={58 + r1 * Math.sin(a)} x2={60 + r2 * Math.cos(a)} y2={58 + r2 * Math.sin(a)} className={c === 0 || Math.abs(c) === 50 ? 'bo-tuner-tick-major' : 'bo-tuner-tick'} strokeWidth={c === 0 ? 2 : 1} />;
        })}
        <line ref={needle} x1={60} y1={58} x2={60} y2={14} className="bo-tuner-needle" strokeWidth={2} strokeLinecap="round" />
        <circle cx={60} cy={58} r={3.5} className="bo-vu-ink" />
      </svg>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span ref={note} className="bo-led text-2xl leading-none" data-testid="booth-tuner-note">—</span>
        <span ref={cents} className="bo-led text-sm" data-testid="booth-tuner-cents" />
      </div>
      <span ref={sung} className="mt-0.5 block text-[11px] text-zinc-500">Tune a vocal to light this up</span>
    </div>
  );
}
