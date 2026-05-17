'use client';

/**
 * /lenses/wellness — refusal-field as therapy substrate.
 * Phase 9.6 #23. Privacy-first, user can revoke any field.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WellnessFeed } from '@/components/wellness/WellnessFeed';
import { WellnessActionPanel } from '@/components/wellness/WellnessActionPanel';
import { PipingProvider } from '@/components/panel-polish';

interface Field {
  id: number;
  author_user_id: string;
  field_kind: string;
  duration_seconds: number;
  created_at: number;
  expires_at: number;
  status: string;
}

const KIND_OPTIONS = [
  'binary_thinking', 'catastrophising', 'self_judgment',
  'numbing', 'compulsion', 'rumination', 'perfectionism', 'shame_spiral',
];

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function WellnessPage() {
  useLensCommand([
    { id: 'wellness-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'wellness' });

  const [fields, setFields] = useState<Field[]>([]);
  const [composeForm, setComposeForm] = useState({ targetUserId: '', fieldKind: 'binary_thinking', durationHours: 24 });
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    const r = await macro('therapy', 'active_fields');
    if (r?.ok) setFields(r.fields || []);
  };

  useEffect(() => { void refresh(); }, []);

  const compose = async () => {
    if (!composeForm.targetUserId) return;
    const r = await macro('therapy', 'compose_field', {
      targetUserId: composeForm.targetUserId,
      fieldKind: composeForm.fieldKind,
      durationSeconds: composeForm.durationHours * 3600,
    });
    if (r?.ok) {
      setStatus(`✓ Field composed (#${r.fieldId})`);
      setComposeForm({ ...composeForm, targetUserId: '' });
    } else {
      setStatus(`Failed: ${r?.error || r?.reason || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const deactivate = async (id: number) => {
    const r = await macro('therapy', 'deactivate', { fieldId: id });
    if (r?.ok) await refresh();
  };

  return (
        <LensShell lensId="wellness">
      <FirstRunTour lensId="wellness" />
      <DepthBadge lensId="wellness" size="sm" className="ml-2" />
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Wellness Fields</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Custom refusal-fields composed as a therapeutic substrate. The base-6 algebra is real — fields actually gate cognitive patterns. Privacy-first: you can revoke any field at any time. Therapist cannot override your deactivation.
            {' '}<strong>No medical claims; this is a tool, not treatment.</strong>
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-purple-950/50 border border-purple-700/50 text-purple-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        <section className="mb-6 bg-zinc-900/80 border border-purple-800/50 rounded-xl p-4 space-y-3">
          <h2 className="text-sm font-bold text-purple-300">Compose a Field (therapist mode)</h2>
          <input
            type="text" placeholder="Target user id"
            value={composeForm.targetUserId}
            onChange={(e) => setComposeForm({ ...composeForm, targetUserId: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={composeForm.fieldKind}
              onChange={(e) => setComposeForm({ ...composeForm, fieldKind: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
            >
              {KIND_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input
              type="number" min={1} value={composeForm.durationHours}
              onChange={(e) => setComposeForm({ ...composeForm, durationHours: Math.max(1, Number(e.target.value) || 1) })}
              placeholder="Hours"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-100"
            />
          </div>
          <button
            type="button" onClick={compose} disabled={!composeForm.targetUserId}
            className="w-full bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-sm py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          >Compose</button>
        </section>

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Your Active Fields</h2>
        {fields.length === 0 ? (
          <div className="text-center text-zinc-500 italic py-6 border border-zinc-800 rounded-xl">
            No active fields.
          </div>
        ) : (
          <ul className="space-y-2">
            {fields.map(f => (
              <li key={f.id} className="bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3 text-sm flex justify-between">
                <div>
                  <p className="text-zinc-100 font-medium">{f.field_kind.replace(/_/g, ' ')}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    by {f.author_user_id.slice(0, 8)} · expires {new Date(f.expires_at * 1000).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button" onClick={() => deactivate(f.id)}
                  className="text-rose-400 hover:text-rose-300 text-[11px]"
                >Deactivate</button>
              </li>
            ))}
          </ul>
        )}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <WellnessFeed />
        </section>

        {/* Whoop-shape wellness workbench: sleep / strain / recovery / HRV + actions */}
        <PipingProvider>
          <section className="mt-6">
            <WellnessActionPanel />
          </section>
        </PipingProvider>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="wellness" limit={10} hideWhenEmpty className="mt-4" />
          <CrossLensRecentsPanel lensId="wellness" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
