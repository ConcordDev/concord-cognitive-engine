'use client';

/**
 * DecreeComposer — Sprint C / Track D3
 *
 * Player ruler issues a decree. Each kind has an inline body schema:
 *   tax_change       → new_rate (0..0.5)
 *   pardon / exile   → target_npc_id
 *   conscription     → quota
 *   trade_embargo    → target_kingdom_id?
 *   recipe_grant     → recipe_id
 *   construction     → building_kind
 *   festival         → kind ('harvest', 'memorial', etc.)
 */

import React, { useCallback, useState } from 'react';

interface Props {
  kingdomId: string;
  open: boolean;
  onClose: () => void;
}

const KINDS = [
  { id: 'festival', label: 'Hold a festival (loyalty +12)' },
  { id: 'pardon', label: 'Pardon a citizen (target NPC)' },
  { id: 'recipe_grant', label: 'Grant recipe access' },
  { id: 'construction', label: 'Order construction' },
  { id: 'tax_change', label: 'Change tax rate' },
  { id: 'conscription', label: 'Conscript guards' },
  { id: 'trade_embargo', label: 'Trade embargo' },
  { id: 'exile', label: 'Exile a citizen' },
] as const;

type DecreeKind = typeof KINDS[number]['id'];

export default function DecreeComposer({ kingdomId, open, onClose }: Props) {
  const [kind, setKind] = useState<DecreeKind>('festival');
  const [body, setBody] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setSubmitting(true); setError(null);
    try {
      const r = await fetch('/api/lens/run', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: 'kingdoms', name: 'propose_decree',
          input: { kingdomId, kind, body: parseBody(kind, body) },
        }),
      });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.reason || 'rejected');
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }, [kingdomId, kind, body, onClose]);

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 92vw)', background: '#0c0c0c', color: '#ddd',
          border: '1px solid #2a2a2a', borderRadius: 6,
          padding: '1.25rem 1.5rem', font: '13px/1.5 -apple-system, system-ui, sans-serif',
        }}
      >
        <h3 style={{ margin: 0, marginBottom: '0.75rem' }}>Issue decree</h3>

        <select
          value={kind}
          onChange={(e) => { setKind(e.target.value as DecreeKind); setBody({}); }}
          style={{ width: '100%', padding: '6px 8px', background: '#141414', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: 4, marginBottom: '0.75rem' }}
        >
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>

        {needsField(kind, 'target_npc_id') && (
          <Field label="Target NPC" value={body.target_npc_id || ''} onChange={(v) => setBody({ ...body, target_npc_id: v })} />
        )}
        {needsField(kind, 'new_rate') && (
          <Field label="New tax rate (0.00–0.50)" value={body.new_rate || ''} onChange={(v) => setBody({ ...body, new_rate: v })} />
        )}
        {needsField(kind, 'quota') && (
          <Field label="Conscription quota" value={body.quota || ''} onChange={(v) => setBody({ ...body, quota: v })} />
        )}
        {needsField(kind, 'recipe_id') && (
          <Field label="Recipe ID" value={body.recipe_id || ''} onChange={(v) => setBody({ ...body, recipe_id: v })} />
        )}
        {needsField(kind, 'building_kind') && (
          <Field label="Building kind (e.g. wall, market, shrine)" value={body.building_kind || ''} onChange={(v) => setBody({ ...body, building_kind: v })} />
        )}

        {error && <p style={{ color: '#f88', fontSize: 11 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button onClick={onClose} disabled={submitting} style={{ background: '#222', color: '#aaa', border: '1px solid #333', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
          <button onClick={submit} disabled={submitting} style={{ background: '#2d3a4d', color: '#bcd', border: '1px solid #3d4a5d', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
            {submitting ? 'Issuing…' : 'Issue'}
          </button>
        </div>
      </div>
    </div>
  );
}

function needsField(kind: DecreeKind, field: string): boolean {
  switch (kind) {
    case 'pardon': case 'exile': return field === 'target_npc_id';
    case 'tax_change': return field === 'new_rate';
    case 'conscription': return field === 'quota';
    case 'recipe_grant': return field === 'recipe_id';
    case 'construction': return field === 'building_kind';
    default: return false;
  }
}

function parseBody(kind: DecreeKind, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'new_rate' || k === 'quota') {
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else {
      out[k] = v;
    }
  }
  void kind;
  return out;
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: '0.5rem' }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 3 }}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: '100%', padding: '5px 8px', background: '#141414', color: '#ddd', border: '1px solid #2a2a2a', borderRadius: 4, fontSize: 12 }}
      />
    </label>
  );
}
