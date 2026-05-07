'use client';

/**
 * StealthDetectedOverlay — surfaces `stealth:detected` socket events.
 *
 * When a high-perception observer breaks a hidden actor's cover (typically
 * a failed backstab), the would-be attacker gets a brief flash + warning
 * banner. The DETECTOR also gets a feed entry so they know they spotted
 * something. The asymmetry is the design: stealth-vs-perception is a
 * skill-vs-skill matchup that's now legible to both sides.
 *
 * Reuses BodyLanguageOverlay strip pattern.
 */

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface DetectionEntry {
  id: string;
  detectorId: string;
  hiddenId: string;
  confidence: number;
  bornAt: number;
}

const STRIP_MAX = 4;
const ENTRY_TTL_MS = 4000;

export function StealthDetectedOverlay() {
  const [entries, setEntries] = useState<DetectionEntry[]>([]);

  useEffect(() => {
    const off = subscribe<{ detectorId: string; hiddenId: string; confidence?: number }>(
      'stealth:detected',
      (msg) => {
        const now = Date.now();
        setEntries((prev) =>
          [
            { id: `det-${now}-${Math.random().toString(36).slice(2, 6)}`, detectorId: msg.detectorId, hiddenId: msg.hiddenId, confidence: msg.confidence ?? 0, bornAt: now },
            ...prev,
          ].slice(0, STRIP_MAX),
        );
      },
    );
    return off;
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setEntries((prev) => prev.filter((e) => now - e.bornAt < ENTRY_TTL_MS));
    }, 250);
    return () => clearInterval(id);
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed left-1/2 top-32 z-[36] -translate-x-1/2">
      <div className="flex items-center gap-1.5 rounded-full bg-violet-950/60 px-3 py-1.5 backdrop-blur-sm">
        <Eye className="h-3.5 w-3.5 text-violet-200" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-violet-200">
          Stealth detected
        </span>
        <span className="text-[10px] text-violet-300/60">
          {entries.length} spotted
        </span>
      </div>
    </div>
  );
}
