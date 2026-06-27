'use client';

/**
 * MS-P2 — the System Move Builder lens. The player's creation surface for moves:
 * pick element + skill-kind, allocate a diminishing-returns modifier budget,
 * preview EXACTLY how it will animate (the server's move-descriptor — same twin
 * the client resolver reads), then mint it as a real move_recipe DTU.
 *
 * Wired front-to-back: every panel below is a pure function of a real
 * `move-builder.*` macro (compose / mint / list / catalog) via lensRun — no
 * fabricated rows, no fake progress. The four UX states (empty / loading /
 * error+retry / populated) are all driven by real macro responses.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { lensRun } from '@/lib/api/client';

const ASPECTS = ['power', 'speed', 'area', 'efficiency', 'control'] as const;
type Aspect = (typeof ASPECTS)[number];
type Alloc = Record<Aspect, number>;

interface Catalog { skillKinds: string[]; elements: string[]; aspects: string[]; }
interface MotionBlock {
  motionFamily: string; motionArchetype: string; effectArchetype: string;
  element: string; resourceGauge: string; leadingLimb: string; targetShape: string;
}
interface Composed {
  ok: boolean; skillKind: string; element: string; tier: number;
  motion: MotionBlock;
  budget: { ok: boolean; spent: number; budget: number; overspent: boolean; balanced: boolean; dominantAspect: string | null; effective: Record<string, number>; };
}
interface MintedMove { id: string; name: string; element: string | null; skillKind: string | null; tier: number | null; }

const EMPTY_ALLOC: Alloc = { power: 2, speed: 1, area: 1, efficiency: 1, control: 0 };

export default function MoveBuilderLensPage() {
  // ── catalog + minted-list load (the lens's own data surface) ──
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [moves, setMoves] = useState<MintedMove[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── composition state ──
  const [name, setName] = useState('');
  const [element, setElement] = useState('fire');
  const [skillKind, setSkillKind] = useState('spell');
  const [alloc, setAlloc] = useState<Alloc>({ ...EMPTY_ALLOC });
  const [skillLevel] = useState(1);
  const [composed, setComposed] = useState<Composed | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintMsg, setMintMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, list] = await Promise.all([
        lensRun('move-builder', 'catalog', {}),
        lensRun('move-builder', 'list', {}),
      ]);
      if (cat.data?.ok === false && !cat.data?.result) {
        throw new Error(cat.data?.error || 'Failed to load move catalog');
      }
      const c = cat.data?.result as Catalog | null;
      const l = list.data?.result as { moves?: MintedMove[] } | null;
      setCatalog(c ?? null);
      setMoves(Array.isArray(l?.moves) ? l!.moves : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load move builder');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live preview — every allocation/element/kind change recomposes via the
  // real `move-builder.compose` macro (server-authoritative descriptor).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await lensRun('move-builder', 'compose', { skillKind, element, allocation: alloc, skillLevel });
      if (!cancelled) setComposed((res.data?.result as Composed) ?? null);
    })();
    return () => { cancelled = true; };
  }, [skillKind, element, alloc, skillLevel]);

  const overspent = composed?.budget?.overspent ?? false;
  const spent = composed?.budget?.spent ?? 0;
  const budget = composed?.budget?.budget ?? 6;
  const balanced = composed?.budget?.balanced ?? true;

  function setAspect(a: Aspect, v: number) {
    setAlloc((prev) => ({ ...prev, [a]: Math.max(0, Math.min(7, v)) }));
  }

  const canMint = useMemo(
    () => !!name.trim() && !overspent && !minting,
    [name, overspent, minting],
  );

  async function mint() {
    if (!canMint) return;
    setMinting(true);
    setMintMsg(null);
    try {
      const res = await lensRun('move-builder', 'mint', {
        name: name.trim(), element, skillKind, allocation: alloc, skillLevel,
      });
      if (res.data?.result?.ok) {
        setMintMsg(`Minted "${name.trim()}" ✓`);
        setName('');
        await load(); // refresh the minted list from the real macro
      } else {
        setMintMsg(`Could not mint: ${res.data?.result?.reason ?? res.data?.error ?? 'unknown'}`);
      }
    } catch (e) {
      setMintMsg(`Mint failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setMinting(false);
    }
  }

  return (
    <LensShell lensId="move-builder">
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', color: '#e8e4dc' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>System · Move Builder</h1>
        <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 20 }}>
          Compose a move — element, kind, and a diminishing-returns modifier budget — preview how it animates, then mint it.
        </p>

        {/* ── LOADING ── */}
        {loading && (
          <div role="status" aria-live="polite" aria-busy="true" style={card}>
            Loading move builder…
          </div>
        )}

        {/* ── ERROR + RETRY ── */}
        {!loading && error && (
          <div role="alert" style={{ ...card, borderColor: '#7a2e2e' }}>
            <div style={{ marginBottom: 10 }}>{error}</div>
            <button type="button" onClick={() => void load()} style={primaryBtn} aria-label="Retry loading move builder">
              Retry
            </button>
          </div>
        )}

        {/* ── POPULATED ── */}
        {!loading && !error && catalog && (
          <>
            <section aria-label="Compose a move" style={card}>
              <label style={lbl}>
                <span>Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name your move…"
                  aria-label="Move name"
                  style={inp}
                />
              </label>

              <div style={{ display: 'flex', gap: 12 }}>
                <label style={lbl}>
                  <span>Element</span>
                  <select value={element} onChange={(e) => setElement(e.target.value)} aria-label="Element" style={inp}>
                    {catalog.elements.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label style={lbl}>
                  <span>Kind</span>
                  <select value={skillKind} onChange={(e) => setSkillKind(e.target.value)} aria-label="Skill kind" style={inp}>
                    {catalog.skillKinds.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>Modifier budget</strong>
                  <span style={{ color: overspent ? '#e05050' : '#8a8' }} aria-live="polite">
                    {spent} / {budget}
                  </span>
                </div>
                {ASPECTS.map((a) => (
                  <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ width: 90, textTransform: 'capitalize' }}>{a}</span>
                    <button type="button" onClick={() => setAspect(a, alloc[a] - 1)} aria-label={`Decrease ${a}`} style={stepBtn}>−</button>
                    <span style={{ width: 24, textAlign: 'center' }} aria-label={`${a} points`}>{alloc[a]}</span>
                    <button type="button" onClick={() => setAspect(a, alloc[a] + 1)} aria-label={`Increase ${a}`} style={stepBtn}>+</button>
                    <span style={{ opacity: 0.5, fontSize: 12 }}>eff {composed?.budget?.effective?.[a] ?? 0}</span>
                  </div>
                ))}
                {!balanced && (
                  <div style={{ color: '#e0a030', fontSize: 13, marginTop: 4 }}>
                    Over-invested in {composed?.budget?.dominantAspect} — diminishing returns (spread for a stronger move).
                  </div>
                )}
              </div>
            </section>

            {/* Live descriptor preview — server-authoritative. */}
            {composed?.motion && (
              <section aria-label="Move preview" style={{ ...card, background: '#15151c' }}>
                <strong style={{ display: 'block', marginBottom: 6 }}>Preview</strong>
                <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.7 }}>
                  motion <b>{composed.motion.motionFamily}</b> · archetype <b>{composed.motion.motionArchetype}</b> · tier <b>{composed.tier}</b><br />
                  effect <b>{composed.motion.effectArchetype}</b> · gauge <b>{composed.motion.resourceGauge}</b> · limb <b>{composed.motion.leadingLimb}</b>
                </div>
              </section>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button type="button" onClick={() => void mint()} disabled={!canMint}
                style={{ ...primaryBtn, opacity: canMint ? 1 : 0.5, cursor: canMint ? 'pointer' : 'not-allowed' }}>
                {minting ? 'Minting…' : 'Mint move'}
              </button>
              {mintMsg && <span role="status" aria-live="polite" style={{ opacity: 0.85, fontSize: 13 }}>{mintMsg}</span>}
            </div>

            {/* Minted moves — the lens's own artifact list. */}
            <section aria-label="Your minted moves" style={{ marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Your moves</h2>
              {moves && moves.length === 0 ? (
                <div style={{ ...card, opacity: 0.7 }}>
                  No moves yet. Compose one above and mint it to start your library.
                </div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {(moves ?? []).map((m) => (
                    <li key={m.id} style={{ ...card, marginBottom: 8, padding: '10px 14px' }}>
                      <b>{m.name}</b>
                      <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>
                        {m.element ?? '—'} · {m.skillKind ?? '—'} · tier {m.tier ?? 1}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </LensShell>
  );
}

const card: React.CSSProperties = {
  background: '#1a1a22', border: '1px solid #2a2a35', borderRadius: 10, padding: 16, marginBottom: 16,
};
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: 1, marginBottom: 8 };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, background: '#13131a', border: '1px solid #333', color: '#e8e4dc' };
const stepBtn: React.CSSProperties = { background: '#2a2a35', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 };
