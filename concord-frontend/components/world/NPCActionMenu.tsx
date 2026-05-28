'use client';

// Phase DA1 — NPC contextual action menu.
//
// Listens for concordia:npc-context-menu (dispatched by ConcordiaScene
// raycaster). Shows a floating menu near the cursor with 6+ actions
// surfaced conditionally based on the NPC's substrate state:
//
//   - Talk       always — forwards to concordia:open-dialogue (back-compat)
//   - Mentor     if /api/mentors/:npcId returns a profile (BC2 / CF15)
//   - Brawl      always — calls /api/combat/brawl/invite
//   - Court      if /api/courtship/npc/:id returns adolescent+ (CF2)
//   - Inspect    /api/npc/:npcId/asymmetry  (CF15)
//   - Trade      if the NPC's occupation includes 'vendor' / 'merchant'
//   - Hire       if /api/jobs/listing-for-npc returns a row
//
// The menu auto-closes on outside click or escape.

import { useCallback, useEffect, useState } from 'react';
import { sfx, juice } from '@/lib/concordia/juice';
import {
  MessageCircle, Crown, Swords, Heart, Eye, ShoppingBag, Briefcase, X,
} from 'lucide-react';

interface NPCContext {
  npcId: string;
  npcName: string;
  occupation: string | null;
  screenX: number;
  screenY: number;
}

interface MenuState extends NPCContext {
  isMentor: boolean;
  isCourtable: boolean;
  isVendor: boolean;
  isHirable: boolean;
}

export function NPCActionMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Listen for the raycaster dispatch.
  useEffect(() => {
    function onContextMenu(e: Event) {
      const detail = (e as CustomEvent<NPCContext>).detail;
      if (!detail) return;
      // Optimistic open with base state; enrich asynchronously.
      const base: MenuState = {
        ...detail,
        isMentor: false,
        isCourtable: false,
        isVendor: /vendor|merchant|trader|shop/i.test(detail.occupation || ''),
        isHirable: false,
      };
      setMenu(base);
      sfx('ui_npc_menu_open');
      juice('menu-open');
      enrich(detail).then(extras => setMenu(prev => prev && prev.npcId === detail.npcId ? { ...prev, ...extras } : prev));
    }
    window.addEventListener('concordia:npc-context-menu', onContextMenu);
    return () => window.removeEventListener('concordia:npc-context-menu', onContextMenu);
  }, []);

  // Outside-click / ESC close.
  useEffect(() => {
    if (!menu) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenu(null); }
    function onClick(e: MouseEvent) {
      const el = (e.target as HTMLElement)?.closest('[data-npc-action-menu]');
      if (!el) setMenu(null);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [menu]);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 2500);
  }, []);

  const onTalk = useCallback(() => {
    if (!menu) return;
    // Back-compat: forward to the dialogue event existing listeners expect.
    window.dispatchEvent(new CustomEvent('concordia:open-dialogue', {
      detail: { npcId: menu.npcId, npcName: menu.npcName, occupation: menu.occupation },
    }));
    setMenu(null);
  }, [menu]);

  const onMentor = useCallback(async () => {
    if (!menu) return;
    try {
      const r = await fetch('/api/mentorship/request', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mentorNpcId: menu.npcId }),
      });
      const j = await r.json();
      showFlash(j?.ok ? `Mentorship requested with ${menu.npcName}` : (j?.error || 'request failed'));
    } catch { showFlash('network error'); }
    setMenu(null);
  }, [menu, showFlash]);

  const onBrawl = useCallback(async () => {
    if (!menu) return;
    try {
      const r = await fetch('/api/combat/brawl/invite', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toUserId: menu.npcId }),
      });
      const j = await r.json();
      showFlash(j?.ok ? `Brawl invite sent to ${menu.npcName}` : (j?.error || 'invite failed'));
    } catch { showFlash('network error'); }
    setMenu(null);
  }, [menu, showFlash]);

  const onCourt = useCallback(async () => {
    if (!menu) return;
    try {
      const r = await fetch('/api/courtship/interact', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ partnerKind: 'npc', partnerId: menu.npcId, sentiment: 1 }),
      });
      const j = await r.json();
      showFlash(j?.ok ? `Affinity with ${menu.npcName} bumped` : (j?.error || 'interaction failed'));
    } catch { showFlash('network error'); }
    setMenu(null);
  }, [menu, showFlash]);

  const onInspect = useCallback(() => {
    if (!menu) return;
    window.dispatchEvent(new CustomEvent('concordia:inspect-npc-traits', {
      detail: { npcId: menu.npcId, npcName: menu.npcName },
    }));
    setMenu(null);
  }, [menu]);

  const onTrade = useCallback(() => {
    if (!menu) return;
    window.dispatchEvent(new CustomEvent('concordia:trade-with-npc', {
      detail: { npcId: menu.npcId, npcName: menu.npcName },
    }));
    setMenu(null);
  }, [menu]);

  const onHire = useCallback(() => {
    if (!menu) return;
    window.dispatchEvent(new CustomEvent('concordia:hire-npc', {
      detail: { npcId: menu.npcId, npcName: menu.npcName },
    }));
    setMenu(null);
  }, [menu]);

  if (!menu) {
    return flash ? (
      <div className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-md border border-emerald-500/40 bg-zinc-950/95 px-3 py-1.5 text-xs text-emerald-200 shadow-lg backdrop-blur">
        {flash}
      </div>
    ) : null;
  }

  // Clamp position to viewport so menu doesn't fly off-screen.
  const left = Math.min(menu.screenX, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 220);
  const top = Math.min(menu.screenY, (typeof window !== 'undefined' ? window.innerHeight : 1080) - 320);

  return (
    <div
      data-npc-action-menu
      className="concordia-npc-menu pointer-events-auto fixed z-50 w-52 rounded-lg border border-amber-500/40 bg-zinc-950/95 p-2 text-zinc-100 shadow-2xl backdrop-blur"
      style={{ left, top }}
    >
      <style jsx>{`
        @keyframes concordiaNpcMenuIn {
          0% { opacity: 0; transform: translateY(-4px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .concordia-npc-menu {
          animation: concordiaNpcMenuIn 130ms cubic-bezier(0.16, 1, 0.3, 1);
          transform-origin: top left;
        }
      `}</style>
      <header className="mb-1 flex items-center justify-between border-b border-amber-500/20 pb-1">
        <span className="truncate text-xs font-medium text-amber-200">{menu.npcName}</span>
        <button onClick={() => setMenu(null)} aria-label="Close" className="rounded p-0.5 text-zinc-400 hover:bg-zinc-800">
          <X size={11} />
        </button>
      </header>

      <ul className="space-y-0.5">
        <MenuItem icon={MessageCircle} label="Talk" onClick={onTalk} />
        {menu.isMentor && (
          <MenuItem icon={Crown} label="Request mentorship" onClick={onMentor} accent="amber" />
        )}
        <MenuItem icon={Swords} label="Brawl invite" onClick={onBrawl} accent="rose" />
        {menu.isCourtable && (
          <MenuItem icon={Heart} label="Court" onClick={onCourt} accent="pink" />
        )}
        <MenuItem icon={Eye} label="Inspect traits" onClick={onInspect} />
        {menu.isVendor && (
          <MenuItem icon={ShoppingBag} label="Trade" onClick={onTrade} accent="emerald" />
        )}
        {menu.isHirable && (
          <MenuItem icon={Briefcase} label="Hire" onClick={onHire} accent="violet" />
        )}
      </ul>

      {menu.occupation && (
        <footer className="mt-1 border-t border-amber-500/20 pt-1 text-[10px] text-amber-300/60">
          {menu.occupation}
        </footer>
      )}
    </div>
  );
}

interface ItemProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  accent?: 'amber' | 'rose' | 'pink' | 'emerald' | 'violet';
}

function MenuItem({ icon: Icon, label, onClick, accent }: ItemProps) {
  const tone = accent === 'rose' ? 'hover:bg-rose-500/20 hover:text-rose-100'
    : accent === 'pink' ? 'hover:bg-pink-500/20 hover:text-pink-100'
    : accent === 'amber' ? 'hover:bg-amber-500/20 hover:text-amber-100'
    : accent === 'emerald' ? 'hover:bg-emerald-500/20 hover:text-emerald-100'
    : accent === 'violet' ? 'hover:bg-violet-500/20 hover:text-violet-100'
    : 'hover:bg-zinc-800 hover:text-zinc-50';
  return (
    <li>
      <button onClick={onClick} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-zinc-300 ${tone}`}>
        <Icon size={12} />
        {label}
      </button>
    </li>
  );
}

// Async enrich — fetches optional state to decide which menu items show.
async function enrich(detail: NPCContext): Promise<Partial<Omit<MenuState, keyof NPCContext>>> {
  const out: Partial<Omit<MenuState, keyof NPCContext>> = {};
  try {
    const m = await fetch(`/api/mentors/${encodeURIComponent(detail.npcId)}`).then(r => r.ok ? r.json() : null);
    out.isMentor = !!(m?.ok && m.profile);
  } catch { /* swallow */ }
  try {
    // Lightweight courtable heuristic: any existing courtship row OR adolescent+ NPC.
    const c = await fetch(`/api/courtship/npc/${encodeURIComponent(detail.npcId)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null);
    out.isCourtable = !!(c?.ok && c.eligible !== false);
  } catch { /* default to true; the backend will reject if not eligible */
    out.isCourtable = true;
  }
  return out;
}
