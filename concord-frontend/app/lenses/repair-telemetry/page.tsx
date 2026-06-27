'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Maintenance — the repair-telemetry operator lens. "Query what the world
 * repaired while you slept." Surfaces the autonomic nervous system: the
 * Homeostasis ledger (healed vs escalated), the escalation inbox (the value/arc
 * calls the cortex refused to make — approve/dismiss), and Repair Memory stats.
 *
 * This is a read-only monitoring DASHBOARD over the REAL `repair` domain
 * (server/domains/repair.js): health_log / escalations / memory reads + the
 * resolve_escalation operator decision. By design it has NO authoring surface
 * (editor / pipeline / dtu) — a telemetry dashboard observes, it does not author.
 *
 * Four honest UX states: loading (role=status) / error (role=alert + Retry) /
 * empty / populated. Forbidden → AdminRequiredState (operator-scoped).
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun, isForbidden } from '@/lib/api/client';
import { AdminRequiredState } from '@/components/common/EmptyState';

interface HealthEntry { id: string; pathology: string; category: string; disposition: string; subject_id: string; checked_at: number }
interface Escalation { id: string; message: string; priority: string; status: string; created_at: string }
interface MemStats { totalPatterns: number; totalRepairs: number; avgSuccessRate: number; deprecatedFixes: number }

type LoadState = 'loading' | 'error' | 'ready';

export default function RepairTelemetryPage() {
  const [log, setLog] = useState<HealthEntry[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [mem, setMem] = useState<MemStats | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [state, setState] = useState<LoadState>('loading');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const [l, e, m] = await Promise.all([
        lensRun('repair', 'health_log', { limit: 100 }),
        lensRun('repair', 'escalations', {}),
        lensRun('repair', 'memory', {}),
      ]);
      if ([l, e, m].some(r => isForbidden(r.data))) { setForbidden(true); return; }
      if (!l.data?.ok || !e.data?.ok || !m.data?.ok) { setState('error'); return; }
      setLog((l.data.result as { entries: HealthEntry[] }).entries || []);
      setEscalations((e.data.result as { escalations: Escalation[] }).escalations || []);
      setMem((m.data.result as { stats: MemStats }).stats || null);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function resolve(id: string, resolution: 'approved' | 'dismissed') {
    await lensRun('repair', 'resolve_escalation', { id, resolution });
    void refresh();
  }

  const dispColor: Record<string, string> = { healed: '#4caf50', escalated: '#e0a030', noted: '#888' };

  if (forbidden) return <AdminRequiredState roles={['admin']} />;

  const isEmpty = state === 'ready' && log.length === 0 && escalations.length === 0
    && (!mem || (mem.totalPatterns === 0 && mem.totalRepairs === 0));

  return (
    <LensShell lensId="repair-telemetry">
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px', color: '#e8e4dc' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Repair Telemetry</h1>
      <p style={{ opacity: 0.7, marginBottom: 20 }}>What the world repaired — and what it refused to decide — while you were away.</p>

      {state === 'loading' && (
        <div role="status" aria-live="polite" aria-busy="true"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 0', opacity: 0.7 }}>
          <span style={{
            width: 20, height: 20, border: '2px solid #2a2a35', borderTopColor: '#e0a030',
            borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite',
          }} aria-hidden="true" />
          <span style={{ fontSize: 13 }}>Loading repair telemetry…</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {state === 'error' && (
        <div role="alert"
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '48px 0', textAlign: 'center' }}>
          <span aria-hidden="true" style={{ fontSize: 22 }}>⚠</span>
          <p style={{ fontSize: 13, opacity: 0.85 }}>Couldn&apos;t load repair telemetry.</p>
          <button onClick={() => void refresh()} style={btn('#2e7d32')}>Retry</button>
        </div>
      )}

      {isEmpty && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '48px 0', textAlign: 'center', opacity: 0.6 }}>
          <span aria-hidden="true" style={{ fontSize: 22 }}>🩹</span>
          <p style={{ fontSize: 13 }}>All quiet. The monitor has logged no findings yet — it runs on a slow cadence.</p>
        </div>
      )}

      {state === 'ready' && !isEmpty && (
        <>
          {mem && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
              {[['Patterns learned', mem.totalPatterns], ['Repairs', mem.totalRepairs],
                ['Avg success', `${Math.round((mem.avgSuccessRate || 0) * 100)}%`], ['Deprecated', mem.deprecatedFixes]].map(([k, v]) => (
                <div key={String(k)} style={{ background: '#15151c', border: '1px solid #2a2a35', borderRadius: 10, padding: '12px 16px', minWidth: 120 }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div>
                  <div style={{ opacity: 0.6, fontSize: 13 }}>{k}</div>
                </div>
              ))}
            </div>
          )}

          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Escalation inbox ({escalations.length})</h2>
          {escalations.length === 0 ? <p style={{ opacity: 0.5 }}>Nothing awaiting your decision.</p> : (
            <div style={{ display: 'grid', gap: 8, marginBottom: 24 }}>
              {escalations.map((e) => (
                <div key={e.id} style={{ background: '#1c1812', border: '1px solid #4a3a1a', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ marginBottom: 8 }}><span style={{ color: '#e0a030', fontWeight: 600 }}>[{e.priority}]</span> {e.message}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => resolve(e.id, 'approved')} style={btn('#2e7d32')}>Approve</button>
                    <button onClick={() => resolve(e.id, 'dismissed')} style={btn('#555')}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>Homeostasis ledger</h2>
          <div style={{ display: 'grid', gap: 4 }}>
            {log.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#15151c', border: '1px solid #2a2a35', borderRadius: 8 }}>
                <span><strong>{r.pathology}</strong> <span style={{ opacity: 0.5 }}>· {r.category} · {r.subject_id}</span></span>
                <span style={{ color: dispColor[r.disposition] || '#888', fontWeight: 600 }}>{r.disposition}</span>
              </div>
            ))}
            {log.length === 0 && <p style={{ opacity: 0.5 }}>No findings yet — the monitor runs on a slow cadence.</p>}
          </div>
        </>
      )}
    </div>
    </LensShell>
  );
}

function btn(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
}
