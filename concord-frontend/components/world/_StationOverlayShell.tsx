'use client';

// Phase DA2 — shared modal shell for station overlays.
//
// Provides the consistent z-50 modal chrome that every workbench
// overlay uses. Reused by FarmTileEditor, RestaurantDashboard, etc.
//
// Phase Z7 polish — adds fade-in + scale-from-95 entry animation
// (Tailwind keyframes, no framer-motion dependency) and dispatches a
// 'menu-open' juice trigger on mount so all 11 router-mounted overlays
// get the same audible+visible feedback as the canonical combat layer.

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { menuOpen, sfx } from '@/lib/concordia/juice';

interface ShellProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  accent?: 'amber' | 'emerald' | 'cyan' | 'violet' | 'pink' | 'rose' | 'slate';
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

const ACCENTS: Record<NonNullable<ShellProps['accent']>, { border: string; text: string }> = {
  amber:   { border: 'border-amber-500/40',   text: 'text-amber-200' },
  emerald: { border: 'border-emerald-500/40', text: 'text-emerald-200' },
  cyan:    { border: 'border-cyan-500/40',    text: 'text-cyan-200' },
  violet:  { border: 'border-violet-500/40',  text: 'text-violet-200' },
  pink:    { border: 'border-pink-500/40',    text: 'text-pink-200' },
  rose:    { border: 'border-rose-500/40',    text: 'text-rose-200' },
  slate:   { border: 'border-slate-500/40',   text: 'text-slate-200' },
};

const SIZES: Record<NonNullable<ShellProps['size']>, string> = {
  sm:   'max-w-md',
  md:   'max-w-lg',
  lg:   'max-w-2xl',
  xl:   'max-w-4xl',
  full: 'max-w-screen-xl',
};

export function StationOverlayShell({ title, subtitle, onClose, children, accent = 'slate', size = 'md' }: ShellProps) {
  const tone = ACCENTS[accent];
  const width = SIZES[size];

  // Fire 'menu-open' juice once on mount.
  useEffect(() => { menuOpen('ui_workbench_open'); }, []);

  const closeWithSfx = () => { sfx('ui_workbench_close'); onClose(); };

  return (
    <div
      className="concordia-overlay-shell fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur"
      onClick={(e) => { if (e.currentTarget === e.target) closeWithSfx(); }}
    >
      <div className={`concordia-overlay-shell-inner w-full ${width} rounded-xl border ${tone.border} bg-zinc-950/95 p-4 shadow-2xl`}>
        <header className="mb-3 flex items-center justify-between border-b border-zinc-800 pb-2">
          <div>
            <h2 className={`text-sm font-semibold ${tone.text}`}>{title}</h2>
            {subtitle && <p className="text-[10px] text-zinc-500">{subtitle}</p>}
          </div>
          <button onClick={closeWithSfx} aria-label="Close" className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100">
            <X size={14} />
          </button>
        </header>
        <div className="text-[12px] text-zinc-200">{children}</div>
      </div>
      <style jsx>{`
        @keyframes concordiaOverlayBackdrop {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes concordiaOverlayPanel {
          0% { opacity: 0; transform: translateY(8px) scale(0.97); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .concordia-overlay-shell {
          animation: concordiaOverlayBackdrop 140ms ease-out;
        }
        .concordia-overlay-shell-inner {
          animation: concordiaOverlayPanel 200ms cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </div>
  );
}
