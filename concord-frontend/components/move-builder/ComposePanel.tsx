'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  ASPECTS, EMPTY_ALLOC, card, lbl, inp, stepBtn, primaryBtn,
  type Aspect, type Alloc, type Catalog, type Composed,
} from './types';

/** Compose + mint — catalog / compose / mint macros. */
export function ComposePanel({ onMinted }: { onMinted?: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
      const cat = await lensRun('move-builder', 'catalog', {});
      if (cat.data?.ok === false && !cat.data?.result) {
        throw new Error(cat.data?.error || 'Failed to load move catalog');
      }
      setCatalog((cat.data?.result as Catalog) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load move builder');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
        onMinted?.();
      } else {
        setMintMsg(`Could not mint: ${res.data?.result?.reason ?? res.data?.error ?? 'unknown'}`);
      }
    } catch (e) {
      setMintMsg(`Mint failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setMinting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" style={card}>
        Loading move builder…
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" style={{ ...card, borderColor: '#7a2e2e' }}>
        <div style={{ marginBottom: 10 }}>{error}</div>
        <button type="button" onClick={() => void load()} style={primaryBtn} aria-label="Retry loading move builder">
          Retry
        </button>
      </div>
    );
  }
  if (!catalog) return null;

  return (
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

        <div className="flex flex-col sm:flex-row" style={{ gap: 12 }}>
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
              <button type="button" onClick={() => setAspect(a, alloc[a] - 1)} aria-label={`Decrease ${a}`} className="transition-colors hover:brightness-125" style={stepBtn}>−</button>
              <span style={{ width: 24, textAlign: 'center' }} aria-label={`${a} points`}>{alloc[a]}</span>
              <button type="button" onClick={() => setAspect(a, alloc[a] + 1)} aria-label={`Increase ${a}`} className="transition-colors hover:brightness-125" style={stepBtn}>+</button>
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
          className="transition-colors"
          style={{ ...primaryBtn, opacity: canMint ? 1 : 0.5, cursor: canMint ? 'pointer' : 'not-allowed' }}>
          {minting ? 'Minting…' : 'Mint move'}
        </button>
        {mintMsg && <span role="status" aria-live="polite" style={{ opacity: 0.85, fontSize: 13 }}>{mintMsg}</span>}
      </div>
    </>
  );
}
