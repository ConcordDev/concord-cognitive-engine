'use client';

/**
 * Photos — the Darkroom. A photo editor: the Library (import, cull,
 * organise), Develop (light, colour, curve, colour mixer, detail, crop and
 * straighten, masks, healing; non-destructive, with history and snapshots)
 * and Prints (released photos, free or sold in Concord Coin). The preview is
 * the export's own pipeline at a smaller size; the original is never
 * rewritten. In-game captures from Concordia's photo mode arrive in the
 * library like any import.
 */
import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Library } from './Library';
import { Develop } from './Develop';
import { Prints } from './Prints';
import { dr, type Photo } from './dr';
import { darkroomFontVars } from './darkroomFonts';
import './darkroom.css';

type Room = 'library' | 'develop' | 'prints';

export default function Darkroom() {
  useLensNav('photos');
  const [room, setRoom] = useState<Room>('library');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [list, setList] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ fromId: string; parts: string[] } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // A signed-out visitor is refused before the action runs (401 Unauthorized / login required).
    void dr('preset-list').then((r) => setSignedIn(!(r.ok === false && /sign in|sign up to|unauthori[sz]ed|login required|auth_required|status code 401/i.test(r.error || ''))));
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3600); return () => clearTimeout(t); }, [toast]);

  const develop = useCallback((p: Photo, l?: Photo[]) => { setPhoto(p); if (l) setList(l); setSelectedId(p.id); setRoom('develop'); }, []);
  const onChanged = useCallback((l: Photo[]) => setList(l), []);
  const photoChanged = useCallback((p: Photo) => {
    setPhoto((cur) => (cur && cur.id === p.id ? { ...cur, ...p } : cur));
    setList((l) => l.map((x) => (x.id === p.id ? { ...x, ...p } : x)));
  }, []);

  useLensCommand([
    { id: 'photos-library', keys: 'g', description: 'Library (grid)', category: 'navigation', action: () => { setRoom('library'); setRefreshKey((k) => k + 1); } },
    { id: 'photos-develop', keys: 'd', description: 'Develop the selected photo', category: 'navigation', action: () => { const p = list.find((x) => x.id === selectedId) || photo; if (p) develop(p); } },
    { id: 'photos-prints', keys: '3', description: 'Prints (released photos)', category: 'navigation', action: () => setRoom('prints') },
  ], { lensId: 'photos' });

  return (
    <LensShell lensId="photos" asMain={false}>
      <main className={`dr ${darkroomFontVars} flex h-[calc(100vh-var(--top-bar-height,56px))] min-h-[560px] flex-col`} data-testid="darkroom">
        <header className="flex items-center gap-4 border-b border-[var(--dr-rule)] bg-[var(--dr-void)] px-4">
          <h1 className="dr-head py-3 text-[12px] tracking-[0.22em] text-[var(--dr-ink)]">Darkroom</h1>
          <nav className="flex" role="tablist" aria-label="Rooms">
            <button type="button" role="tab" aria-selected={room === 'library'} className="dr-tab" onClick={() => { setRoom('library'); setRefreshKey((k) => k + 1); }} data-testid="dr-room-library">Library <span className="dr-kbd ml-1">G</span></button>
            <button type="button" role="tab" aria-selected={room === 'develop'} className="dr-tab" disabled={!photo && !selectedId} onClick={() => { const p = list.find((x) => x.id === selectedId) || photo; if (p) develop(p); }} data-testid="dr-room-develop">Develop <span className="dr-kbd ml-1">D</span></button>
            <button type="button" role="tab" aria-selected={room === 'prints'} className="dr-tab" onClick={() => setRoom('prints')} data-testid="dr-room-prints">Prints</button>
          </nav>
          {copied && <span className="ml-auto hidden text-[11.5px] text-[var(--dr-muted)] sm:inline">Settings copied · paste on a selection</span>}
        </header>
        <div className="min-h-0 flex-1">
          {signedIn === false && room !== 'prints' ? (
            <div className="mx-auto mt-20 max-w-md p-6 text-center" data-testid="dr-signed-out">
              <p className="dr-title text-[22px] italic">The darkroom is yours once you sign in.</p>
              <p className="mt-2 text-[12.5px] text-[var(--dr-muted)]">Your photos stay private to you. You can still look at the photos people have released.</p>
              <button type="button" className="dr-btn dr-btn-safe mx-auto mt-4" onClick={() => setRoom('prints')}>See the wall</button>
            </div>
          ) : room === 'library' ? (
            <Library onDevelop={develop} onChanged={onChanged} onToast={setToast} selectedId={selectedId} setSelectedId={setSelectedId} copied={copied} refreshKey={refreshKey} />
          ) : room === 'develop' && photo ? (
            <Develop photo={photo} list={list} onBack={() => { setRoom('library'); setRefreshKey((k) => k + 1); }} onOpen={(p) => develop(p)} onToast={setToast} copied={copied} setCopied={setCopied} onPhotoChanged={photoChanged} />
          ) : (
            <Prints signedIn={signedIn !== false} onToast={setToast} />
          )}
        </div>
        {toast && <div className="dr-toast dr-rise text-[12.5px]" role="status" data-testid="dr-toast">{toast}</div>}
      </main>
    </LensShell>
  );
}
