'use client';

/** Integrated loudness and true peak of the mix bus, read every frame from the engine's live loudness meter. */

import { useRef } from 'react';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { useBeatFrame } from '../daw/engine-hooks';

export function MasterLoudness() {
  const lufs = useRef<HTMLSpanElement>(null);
  const tp = useRef<HTMLSpanElement>(null);
  useBeatFrame(() => {
    const l = getStudioEngine().masterLoudness();
    if (lufs.current) lufs.current.textContent = Number.isFinite(l.integratedLufs) ? l.integratedLufs.toFixed(1) : '—';
    if (tp.current) {
      tp.current.textContent = Number.isFinite(l.truePeakDbtp) ? l.truePeakDbtp.toFixed(1) : '—';
      tp.current.dataset.zone = Number.isFinite(l.truePeakDbtp) && l.truePeakDbtp > -1 ? 'clip' : 'ok';
    }
  });
  return (
    <div className="bo-well mt-2 grid grid-cols-2 gap-2 rounded-md p-2" data-testid="booth-loudness">
      <div>
        <div className="bo-engrave text-[10px]">Integrated</div>
        <div><span ref={lufs} className="bo-led text-lg">—</span> <span className="text-[10px] text-zinc-500">LUFS</span></div>
      </div>
      <div>
        <div className="bo-engrave text-[10px]">True peak</div>
        <div><span ref={tp} className="bo-led bo-peak text-lg">—</span> <span className="text-[10px] text-zinc-500">dBTP</span></div>
      </div>
      <p className="col-span-2 text-[10px] leading-snug text-zinc-500">Streaming targets sit near −14 LUFS with true peak under −1 dBTP. Measured over the current play; resets when you stop.</p>
    </div>
  );
}
