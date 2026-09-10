'use client';

import { useCallback, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import { lensRun } from '@/lib/api/client';
import { ASPECTS, card, primaryBtn, type MintedMove, type MoveDetail } from './types';

export type MintedMovesHandle = { reload: () => void };

/** Your moves library — list + get macros. */
export const MintedMovesPanel = forwardRef<MintedMovesHandle>(function MintedMovesPanel(_props, ref) {
  const [moves, setMoves] = useState<MintedMove[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MoveDetail['move'] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await lensRun('move-builder', 'list', {});
      const l = list.data?.result as { moves?: MintedMove[] } | null;
      setMoves(Array.isArray(l?.moves) ? l!.moves : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load moves');
    } finally {
      setLoading(false);
    }
  }, []);

  useImperativeHandle(ref, () => ({ reload: () => { void load(); } }), [load]);
  useEffect(() => { void load(); }, [load]);

  const fetchDetail = useCallback(async (moveId: string) => {
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const r = await lensRun<MoveDetail>('move-builder', 'get', { moveId });
      const out = r.data?.result as MoveDetail | undefined;
      if (r.data?.ok === false || !out || out.ok === false) {
        setDetailError(out?.reason || r.data?.error || 'unavailable');
        return;
      }
      setDetail(out.move ?? null);
    } catch {
      setDetailError('request_failed');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleDetail = useCallback((moveId: string) => {
    if (expandedId === moveId) { setExpandedId(null); return; }
    setExpandedId(moveId);
    void fetchDetail(moveId);
  }, [expandedId, fetchDetail]);

  if (loading) {
    return <div role="status" aria-live="polite" style={card}>Loading your moves…</div>;
  }
  if (error) {
    return (
      <div role="alert" style={{ ...card, borderColor: '#7a2e2e' }}>
        <div style={{ marginBottom: 10 }}>{error}</div>
        <button type="button" onClick={() => void load()} style={primaryBtn}>Retry</button>
      </div>
    );
  }

  return (
    <section aria-label="Your minted moves">
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Your moves</h2>
      {moves && moves.length === 0 ? (
        <div style={{ ...card, opacity: 0.7 }}>
          No moves yet. Compose one and mint it to start your library.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {(moves ?? []).map((m) => (
            <li key={m.id} style={{ ...card, marginBottom: 8, padding: '10px 14px' }}>
              <button
                type="button"
                onClick={() => void toggleDetail(m.id)}
                aria-expanded={expandedId === m.id}
                className="transition-colors hover:brightness-125"
                style={{ background: 'none', border: 'none', color: 'inherit', padding: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}
              >
                <b>{m.name}</b>
                <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>
                  {m.element ?? '—'} · {m.skillKind ?? '—'} · tier {m.tier ?? 1}
                </span>
                <span style={{ opacity: 0.4, fontSize: 11, marginLeft: 8 }}>{expandedId === m.id ? '▲ hide detail' : '▼ show detail'}</span>
              </button>

              {expandedId === m.id && (
                <div data-testid="move-detail" style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #2a2a35', fontSize: 13 }}>
                  {detailLoading && <div role="status" aria-live="polite" style={{ opacity: 0.6 }}>Loading move detail…</div>}
                  {!detailLoading && detailError && (
                    <div role="alert" style={{ color: '#e0a0a0', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span>Couldn&apos;t load this move ({detailError}).</span>
                      <button type="button" onClick={() => void fetchDetail(m.id)} style={{ color: '#e8b0b0', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>Retry</button>
                    </div>
                  )}
                  {!detailLoading && !detailError && detail && (
                    <>
                      {detail.motion && (
                        <div style={{ opacity: 0.85, lineHeight: 1.7, marginBottom: 6 }}>
                          motion <b>{detail.motion.motionFamily}</b> · archetype <b>{detail.motion.motionArchetype}</b><br />
                          effect <b>{detail.motion.effectArchetype}</b> · gauge <b>{detail.motion.resourceGauge}</b> · limb <b>{detail.motion.leadingLimb}</b>
                        </div>
                      )}
                      {detail.allocation && (
                        <div style={{ opacity: 0.7, fontSize: 12 }}>
                          {ASPECTS.map((a) => `${a} ${detail.allocation?.[a] ?? 0}`).join(' · ')}
                          {detail.balanced === false && <span style={{ color: '#e0a030' }}> — over-invested</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
