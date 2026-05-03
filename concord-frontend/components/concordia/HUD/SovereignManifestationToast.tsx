'use client';

// SovereignManifestationToast — listens for the realtime
// 'world:sovereign-manifest' event (fired by raid combat when the
// Sovereign draws a fused power) and surfaces the blueprint as a
// brief toast. The blueprint shape comes from
// draftSovereignManifestation() in refusal-archive.js: name + summary
// + sources[] + damageRange + refusedLimits[].

import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { Flame } from 'lucide-react';

interface Manifestation {
  name: string;
  summary: string;
  sources: string[];
  damageRange: [number, number];
  refusedLimits: string[];
}

export default function SovereignManifestationToast() {
  const [active, setActive] = useState<Manifestation | null>(null);
  const socket = useSocket();

  useEffect(() => {
    if (!socket) return;
    const onManifest = (...args: unknown[]) => {
      const payload = args[0] as Manifestation | undefined;
      if (!payload?.name) return;
      setActive(payload);
      window.setTimeout(() => setActive(null), 6000);
    };
    socket.on('world:sovereign-manifest', onManifest);
    return () => {
      const off = (socket as unknown as { off?: (event: string, cb: (...args: unknown[]) => void) => void }).off;
      if (off) off.call(socket, 'world:sovereign-manifest', onManifest);
    };
  }, [socket]);

  if (!active) return null;

  return (
    <div className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 max-w-md">
      <div className="bg-gradient-to-r from-purple-900/90 via-indigo-900/90 to-purple-900/90 border-2 border-purple-400/50 rounded-xl p-4 text-white shadow-2xl animate-pulse">
        <div className="flex items-center gap-2 mb-2">
          <Flame className="w-5 h-5 text-purple-300" />
          <p className="font-bold text-sm tracking-wider uppercase text-purple-200">
            The Sovereign manifests
          </p>
        </div>
        <p className="text-base font-semibold mb-1">{active.name}</p>
        <p className="text-xs text-white/70 italic mb-2">"{active.summary}"</p>
        <div className="flex items-center justify-between text-[11px] text-white/60">
          <span>damage {active.damageRange?.[0]}–{active.damageRange?.[1]}</span>
          <span className="font-mono">
            refused: {active.refusedLimits?.join(', ') || 'nothing'}
          </span>
        </div>
        {active.sources?.length > 0 && (
          <p className="text-[10px] text-white/40 mt-2">
            fused from {active.sources.length} observed power{active.sources.length === 1 ? '' : 's'}
          </p>
        )}
      </div>
    </div>
  );
}
