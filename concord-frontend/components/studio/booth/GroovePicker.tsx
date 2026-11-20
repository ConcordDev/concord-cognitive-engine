'use client';

/** Song feel from the studio groove templates (studio.groove-list): picking one sets the transport swing. */

import { useEffect, useState } from 'react';
import { studio, type Groove } from './boothApi';
import { grooveForSwing, swingFromGroove } from './grooves';

export function GroovePicker({ swing, onSwing }: { swing: number; onSwing: (swing: number) => void }) {
  const [grooves, setGrooves] = useState<Groove[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancel = false;
    void studio<{ grooves: Groove[] }>('groove-list').then((r) => {
      if (cancel) return;
      if (r.ok) setGrooves(r.result?.grooves || []);
      else setFailed(true);
    });
    return () => { cancel = true; };
  }, []);
  if (failed) return null;
  const current = grooveForSwing(grooves, swing);
  return (
    <label className="flex items-center gap-1 text-[11px] text-zinc-400">
      <span className="bo-engrave text-xs">Feel</span>
      <select
        value={current?.id ?? ''}
        onChange={(e) => { const g = grooves.find((x) => x.id === e.target.value); if (g) onSwing(swingFromGroove(g.swing)); }}
        className="h-6 rounded bg-black/40 px-1 text-[11px] text-zinc-100 outline-none"
        aria-label="Groove feel"
        data-testid="booth-groove"
      >
        {!current && <option value="">Custom swing {Math.round(swing)}</option>}
        {grooves.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </label>
  );
}
