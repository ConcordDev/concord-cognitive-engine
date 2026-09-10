'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { lensRun } from '@/lib/api/client';
import { COLORS, type LoreEvent } from './types';

/** Deep-link detail — lore.get for /lenses/codex?id=<loreId>. */
export function DeepLinkModal({ deepLinkId }: { deepLinkId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [deepLink, setDeepLink] = useState<{ loading: boolean; error: string | null; event: LoreEvent | null }>(
    { loading: true, error: null, event: null },
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const closeDeepLink = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  useEffect(() => {
    let cancelled = false;
    setDeepLink({ loading: true, error: null, event: null });
    (async () => {
      const r = await lensRun('lore', 'get', { id: deepLinkId });
      if (cancelled) return;
      const event = r.data.ok ? ((r.data.result as { event?: LoreEvent } | null)?.event ?? null) : null;
      if (event) setDeepLink({ loading: false, error: null, event });
      else setDeepLink({ loading: false, error: r.data.error || 'No entry matches this link.', event: null });
    })();
    return () => { cancelled = true; };
  }, [deepLinkId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDeepLink(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeDeepLink]);

  const copyPermalink = useCallback((id: string) => {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const url = `${base}${pathname}?id=${encodeURIComponent(id)}`;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
      }).catch(() => { /* clipboard denied */ });
    }
  }, [pathname]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Codex entry detail"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,0.6)' }}
      onClick={closeDeepLink}
      onKeyDown={(e) => { if (e.key === 'Escape') closeDeepLink(); }}
    >
      <div
        style={{ maxWidth: 640, width: '100%', maxHeight: '82vh', overflowY: 'auto', borderRadius: 12, padding: 20, background: COLORS.panel, border: `1px solid ${COLORS.panelBorder}` }}
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => { if (ev.key === 'Escape') closeDeepLink(); else ev.stopPropagation(); }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{deepLink.event?.title ?? 'Codex entry'}</h2>
          <button onClick={closeDeepLink} aria-label="Close entry detail" style={{ background: 'none', border: 'none', color: COLORS.fg, opacity: 0.6, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
        </div>
        {deepLink.loading ? (
          <p role="status" style={{ opacity: 0.6, marginTop: 10 }}>Consulting the records…</p>
        ) : deepLink.error ? (
          <div role="alert" style={{ marginTop: 12, padding: 12, borderRadius: 8, color: COLORS.error, background: COLORS.errorBg, border: `1px solid ${COLORS.errorBorder}` }}>
            {deepLink.error}
          </div>
        ) : deepLink.event ? (
          <div style={{ marginTop: 10 }}>
            <p style={{ opacity: 0.5, fontSize: 13, margin: '0 0 10px' }}>
              {deepLink.event.type} · {deepLink.event.era}{deepLink.event.world_id ? ` · ${deepLink.event.world_id}` : ''}
            </p>
            <p style={{ opacity: 0.85, margin: 0, lineHeight: 1.55 }}>{deepLink.event.description}</p>
            {deepLink.event.significance && (
              <p style={{ opacity: 0.75, margin: '10px 0 0', lineHeight: 1.5, fontStyle: 'italic', borderLeft: `2px solid ${COLORS.accentBorder}`, paddingLeft: 10 }}>
                {deepLink.event.significance}
              </p>
            )}
            {(deepLink.event.factions_involved && deepLink.event.factions_involved.length > 0) && (
              <p style={{ margin: '10px 0 0', fontSize: 13, opacity: 0.7 }}>
                <strong style={{ opacity: 0.85 }}>Factions:</strong> {deepLink.event.factions_involved.join(', ')}
              </p>
            )}
            {(deepLink.event.known_by && deepLink.event.known_by.length > 0) && (
              <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.7 }}>
                <strong style={{ opacity: 0.85 }}>Known by:</strong> {deepLink.event.known_by.join(', ')}
              </p>
            )}
            <button
              onClick={() => copyPermalink(deepLink.event!.id)}
              style={{ marginTop: 14, padding: '6px 14px', borderRadius: 8, background: COLORS.input, border: `1px solid ${COLORS.inputBorder}`, color: COLORS.fg, cursor: 'pointer', fontSize: 13 }}
            >
              {copiedId === deepLink.event.id ? 'Copied!' : 'Copy permalink'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
