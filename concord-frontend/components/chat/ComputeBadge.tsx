'use client';

// ComputeBadge — surfaces the compute-preflight provenance on a chat
// message. When a chat question matches the compute-registry (math,
// physics, chemistry, quantum, simulation, engineering — 21 caps) the
// backend pre-flight runs the engine BEFORE the conscious brain so the
// brain narrates ground-truth values instead of guessing. This badge is
// the user-facing proof: a small chip that says "Concord computed this
// from the math engine" with the capability key.
//
// Empty / null → renders nothing. Cheap to mount on every assistant msg.

import { Calculator, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

interface ComputeBadgeProps {
  computed: {
    capabilities?: Array<{ key: string; score?: number; description?: string }>;
    engineCount?: number;
  } | null | undefined;
}

export default function ComputeBadge({ computed }: ComputeBadgeProps) {
  const [open, setOpen] = useState(false);
  if (!computed || !computed.capabilities || computed.capabilities.length === 0) return null;
  const caps = computed.capabilities;
  const count = computed.engineCount ?? caps.length;
  const summary = caps.length === 1
    ? caps[0].key
    : `${count} engines`;

  return (
    <div className="mt-1.5 inline-flex flex-col gap-1 text-xs">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/15 transition-colors max-w-fit"
        aria-label="Compute provenance"
      >
        <Calculator className="w-3 h-3" />
        <span className="font-mono text-[11px]">{summary}</span>
        {caps.length > 1 && (open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
      </button>
      {open && caps.length > 1 && (
        <ul className="ml-2 space-y-0.5 text-emerald-300/80">
          {caps.map((c) => (
            <li key={c.key} className="flex items-baseline gap-2">
              <span className="font-mono text-[11px]">{c.key}</span>
              {c.description && <span className="text-gray-500 text-[10px]">{c.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
