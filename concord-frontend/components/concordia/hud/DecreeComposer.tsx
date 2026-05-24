'use client';

/**
 * DecreeComposer — Sprint C/D3 + Sprint D/AA1 (design-system migration)
 *
 * Player ruler issues a decree. Each kind has an inline body schema.
 */

import React, { useCallback, useState } from 'react';
import { ds } from '@/lib/design-system';

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
    <div className={`${ds.modalBackdrop} z-[70]`} onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div className={ds.modalContainer}>
        <div onClick={(e) => e.stopPropagation()} className={`${ds.modalPanel} max-w-md p-6`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <h3 className={`${ds.heading3} mb-3`}>Issue decree</h3>

          <select
            value={kind}
            onChange={(e) => { setKind(e.target.value as DecreeKind); setBody({}); }}
            className={`${ds.select} mb-3`}
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

          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} disabled={submitting} className={ds.btnSecondary}>Cancel</button>
            <button onClick={submit} disabled={submitting} className={ds.btnPrimary}>
              {submitting ? 'Issuing…' : 'Issue'}
            </button>
          </div>
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
    <label className="block mb-2">
      <div className={ds.label}>{label}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={ds.input} />
    </label>
  );
}
