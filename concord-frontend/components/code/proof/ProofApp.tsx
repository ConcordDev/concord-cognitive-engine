'use client';

/**
 * Proof — the Code lens. A calm, keyboard-first editor where every change
 * carries its evidence (types, lint, tests, a real run, a read diff) and
 * GitHub opens only when that proof is green. The open project lives in the
 * URL (?p=), so back, reload and shared links land in the same place.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { proofFontVars } from './proofFonts';
import { StartScreen } from './StartScreen';
import { Workbench } from './Workbench';
import { ensureLocalMonaco } from './monacoLocal';
import './proof.css';

export function projectFromSearch(search: string): string | null {
  const p = new URLSearchParams(search).get('p');
  return p && /^[\w-]{1,80}$/.test(p) ? p : null;
}

export function ProofApp() {
  const [projectId, setProjectId] = useState<string | null>(() => (typeof window === 'undefined' ? null : projectFromSearch(window.location.search)));

  // An editor fills exactly the space below the platform's bars: measure where we start, take the rest.
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = root.current; if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      // On a phone the platform pins its own bar to the bottom of the screen;
      // stop above it so the workbench's tabs stay reachable.
      let bottom = window.innerHeight;
      for (const node of document.elementsFromPoint(window.innerWidth / 2, window.innerHeight - 2)) {
        if (el.contains(node)) continue;
        const pos = getComputedStyle(node).position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        // Only a bar pinned to the bottom counts. A full-screen overlay (a
        // dialog, a scrim) also sits under that point; it is not a bar.
        const r = node.getBoundingClientRect();
        if (r.top > top && r.height < window.innerHeight * 0.25) { bottom = Math.min(bottom, r.top); break; }
      }
      setHeight(Math.max(420, bottom - top));
    };
    fit();
    window.addEventListener('resize', fit);
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit());
    // Watch every sibling on the way up: a status row added above the
    // scroll area moves the lens down without resizing the window.
    for (let node: Element | null = root.current; ro && node && node !== document.body; node = node.parentElement) {
      const up = node.parentElement;
      if (up) for (const c of Array.from(up.children)) if (c !== node) ro.observe(c);
    }
    return () => { window.removeEventListener('resize', fit); ro?.disconnect(); };
  }, []);

  const go = useCallback((id: string | null) => {
    setProjectId(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('p', id); else u.searchParams.delete('p');
    window.history.pushState({}, '', u.toString());
  }, []);

  // Load the editor from our own bundle before any editor mounts (no CDN).
  const [editorReady, setEditorReady] = useState(false);
  useEffect(() => {
    if (!projectId || editorReady) return;
    let live = true;
    ensureLocalMonaco().then(() => { if (live) setEditorReady(true); }, () => { if (live) setEditorReady(true); });
    return () => { live = false; };
  }, [projectId, editorReady]);

  useEffect(() => {
    const onPop = () => setProjectId(projectFromSearch(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div ref={root} className={cn('pf min-h-0 overflow-hidden', proofFontVars)} style={{ height: height ?? 'calc(100dvh - 4.5rem)' }} data-testid="pf-app" data-lens="code">
      {projectId ? (editorReady ? <Workbench key={projectId} projectId={projectId} onExit={() => go(null)} /> : <div className="h-full animate-pulse" role="status" aria-label="Loading the editor" />) : <StartScreen onOpen={go} />}
      {!projectId && (
        <LensAgentFab
          lensId="code"
          lensPrompt="You're inside Concord Code (Proof): an editor where every change carries evidence — types, lint, tests, a real run and a read diff — and pushes to GitHub only when that proof is green. Help with writing and reviewing code, tests, and getting a change proved."
        />
      )}
    </div>
  );
}

export default ProofApp;
