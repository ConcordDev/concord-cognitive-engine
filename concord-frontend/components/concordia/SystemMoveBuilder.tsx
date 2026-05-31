'use client';

/**
 * MS-P2 — the System Move Builder (the Solo-Leveling-flavoured creation surface).
 * The player composes a move: element + skill-kind + a modifier budget allocated
 * across aspects under Enhancement-Diversification rules (so it can't be trivially
 * one-shot). A LIVE preview runs resolveMove() so the player sees exactly how it
 * will animate (motion family + tier + VFX/SFX) before minting — the creation→verb
 * loop made legible. Mints through the existing glyph-spells path.
 */

import { useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { resolveBudget, budgetForTier, MOVE_ASPECTS, type MoveAspect } from '@/lib/concordia/move-budget';
import { resolveMove } from '@/lib/concordia/move-resolver';

const ELEMENTS = ['physical', 'fire', 'water', 'ice', 'lightning', 'bio', 'energy', 'wind', 'earth'];
const SKILL_KINDS = ['strike', 'projectile', 'channel', 'buff', 'movement', 'summon', 'trap'];

export default function SystemMoveBuilder({ skillLevel = 1 }: { skillLevel?: number }) {
  const [name, setName] = useState('');
  const [element, setElement] = useState('fire');
  const [skillKind, setSkillKind] = useState('projectile');
  const [alloc, setAlloc] = useState<Record<MoveAspect, number>>({ power: 2, speed: 1, area: 1, efficiency: 1, control: 0 });
  const [minted, setMinted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tier = Math.max(1, Math.min(5, Math.floor((skillLevel - 1) / 30) + 1));
  const budget = budgetForTier(tier);
  const budgetResult = useMemo(() => resolveBudget(alloc, budget), [alloc, budget]);
  const preview = useMemo(() => resolveMove({ skillKind, element, skillLevel }), [skillKind, element, skillLevel]);

  function setAspect(a: MoveAspect, v: number) {
    setAlloc((prev) => ({ ...prev, [a]: Math.max(0, Math.min(7, v)) }));
  }

  async function mint() {
    if (!budgetResult.ok || !name.trim()) return;
    setBusy(true);
    try {
      const res = await lensRun('glyph_spells', 'mint', {
        name: name.trim(), element, skillKind, allocation: alloc,
        motion: { motionFamily: preview.motionFamily, motionArchetype: preview.motionArchetype, element },
      });
      setMinted(res.data?.ok ? 'Minted ✓' : `Could not mint: ${res.data?.result?.reason ?? 'unknown'}`);
    } catch {
      setMinted('Mint failed');
    } finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 640, color: '#e8e4dc', padding: 16 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>System · Move Builder</h2>

      <label style={lbl}>Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your move…"
          style={inp} />
      </label>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
        <label style={lbl}>Element
          <select value={element} onChange={(e) => setElement(e.target.value)} style={inp}>
            {ELEMENTS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label style={lbl}>Kind
          <select value={skillKind} onChange={(e) => setSkillKind(e.target.value)} style={inp}>
            {SKILL_KINDS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong>Modifier budget</strong>
          <span style={{ color: budgetResult.overspent ? '#e05050' : '#8a8' }}>{budgetResult.spent} / {budget}</span>
        </div>
        {MOVE_ASPECTS.map((a) => (
          <div key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ width: 90, textTransform: 'capitalize' }}>{a}</span>
            <button onClick={() => setAspect(a, alloc[a] - 1)} style={stepBtn}>−</button>
            <span style={{ width: 24, textAlign: 'center' }}>{alloc[a]}</span>
            <button onClick={() => setAspect(a, alloc[a] + 1)} style={stepBtn}>+</button>
            <span style={{ opacity: 0.5, fontSize: 12 }}>eff {budgetResult.effective[a]}</span>
          </div>
        ))}
        {!budgetResult.balanced && (
          <div style={{ color: '#e0a030', fontSize: 13, marginTop: 4 }}>
            Over-invested in {budgetResult.dominantAspect} — diminishing returns (spread for a stronger move).
          </div>
        )}
      </div>

      {/* Live resolveMove preview — what it will ACTUALLY animate as. */}
      <div style={{ background: '#15151c', border: '1px solid #2a2a35', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <strong style={{ display: 'block', marginBottom: 6 }}>Preview</strong>
        <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.7 }}>
          motion <b>{preview.motionFamily}</b> · archetype <b>{preview.motionArchetype}</b> · tier <b>{preview.tier}</b><br />
          effect <b>{preview.effectArchetype}</b> · vfx <b>{preview.vfx}</b> · sfx <b>{preview.sfxId}</b>
        </div>
      </div>

      <button onClick={mint} disabled={busy || budgetResult.overspent || !name.trim()}
        style={{ ...stepBtn, padding: '10px 20px', background: '#2e7d32', opacity: (busy || budgetResult.overspent || !name.trim()) ? 0.5 : 1 }}>
        {busy ? 'Minting…' : 'Mint move'}
      </button>
      {minted && <span style={{ marginLeft: 12, opacity: 0.8 }}>{minted}</span>}
    </div>
  );
}

const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, flex: 1, marginBottom: 8 };
const inp: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, background: '#1a1a22', border: '1px solid #333', color: '#e8e4dc' };
const stepBtn: React.CSSProperties = { background: '#2a2a35', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' };
