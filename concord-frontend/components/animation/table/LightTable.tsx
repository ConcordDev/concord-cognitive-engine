'use client';

/**
 * The Light Table — the Animation lens.
 *
 * A hand animator's desk. The Table is your shots: open one and it lies on
 * the backlit disc with its X-sheet beside it. Screening is the public side:
 * published animations, free or sold in Concord Coin. Reference is your
 * tracing images and frame templates.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { AnimationStudioSection } from '../AnimationStudioSection';
import { AnimationReferenceImages } from '../AnimationReferenceImages';
import { AnimationReference } from '../AnimationReference';
import { Screening } from './Screening';
import { an } from './lt';
import { tableFontVars } from './tableFonts';
import './table.css';

type Phase = 'loading' | 'ready' | 'error';
type Room = 'table' | 'screening' | 'reference';
const ROOMS: { id: Room; label: string }[] = [
  { id: 'table', label: 'The table' }, { id: 'screening', label: 'Screening' }, { id: 'reference', label: 'Reference' },
];

const isWarming = (m: string) => /service_overloaded|event_loop_lag|status code 503/i.test(m);
// The first read waits out the server's boot-time admission gate (a 503
// while the event loop is still lagging), and nothing else.
async function probeReady(): Promise<void> {
  let last = 'Could not reach the light table.';
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await an('anim-list', {});
    if (r.ok) return;
    last = r.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

export default function LightTable() {
  useLensNav('animation');
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [room, setRoom] = useState<Room>('table');
  const [screeningId, setScreeningId] = useState<string | null>(null);

  const load = useCallback(() => {
    setPhase('loading'); setLoadError('');
    probeReady().then(() => setPhase('ready')).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the light table.');
    });
  }, []);
  useEffect(() => {
    let cancelled = false;
    probeReady().then(() => { if (!cancelled) setPhase('ready'); }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the light table.');
    });
    return () => { cancelled = true; };
  }, []);

  const focusNewShot = useCallback(() => {
    setRoom('table');
    setTimeout(() => { const el = document.getElementById('anim-new-title'); if (el instanceof HTMLInputElement) el.focus(); }, 0);
  }, []);
  useLensCommand(
    [{ id: 'animation-new', keys: 'n', description: '+ New shot', category: 'actions', action: focusNewShot }],
    { lensId: 'animation' },
  );

  return (
    <LensShell lensId="animation" asMain={false}>
      <div data-lens-theme="animation" className={`lt ${tableFontVars} relative min-h-full px-4 pb-24 pt-5 sm:px-8`}>
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="lt-title text-[2.3rem] leading-none text-[#fbfaf6] sm:text-[2.9rem]">Animation</h1>
            <p className="lt-pencil mt-1 text-[17px] text-[#c9c2b5]">the light table</p>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-end justify-between gap-2 sm:w-auto sm:justify-end sm:gap-3">
            <nav role="tablist" aria-label="Rooms" className="flex min-w-0 gap-1 overflow-x-auto">
              {ROOMS.map((r) => (
                <button key={r.id} type="button" role="tab" aria-selected={room === r.id} onClick={() => setRoom(r.id)} className="lt-tab" data-testid={`lt-room-${r.id}`}>{r.label}</button>
              ))}
            </nav>
            <button type="button" onClick={focusNewShot} disabled={phase !== 'ready'} className="lt-btn lt-btn-red !min-h-[34px]">+ New shot</button>
          </div>
        </header>

        {phase === 'loading' && (
          <div className="lt-sheet p-5">
            <p data-testid="animation-loading" role="status" aria-busy="true" className="text-[14px]">Turning on the light table.</p>
            <div className="lt-skeleton mt-3 h-28" />
          </div>
        )}
        {phase === 'error' && (
          <div data-testid="animation-error" role="alert" className="lt-sheet p-5">
            <p className="text-[14px]">{loadError || 'Could not load the light table.'}</p>
            <button type="button" onClick={load} className="lt-btn mt-3">Retry</button>
          </div>
        )}
        {phase === 'ready' && room === 'table' && <AnimationStudioSection onOpenScreening={(id) => { setScreeningId(id); setRoom('screening'); }} />}
        {phase === 'ready' && room === 'screening' && <Screening initialId={screeningId} onConsumedInitial={() => setScreeningId(null)} />}
        {phase === 'ready' && room === 'reference' && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="lt-sheet p-4"><AnimationReferenceImages /></div>
            <div className="lt-sheet p-4"><AnimationReference /></div>
          </div>
        )}
      </div>
    </LensShell>
  );
}
