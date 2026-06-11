'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Maintenance — the repair-telemetry operator lens. "Query what the world
 * repaired while you slept." Surfaces the autonomic nervous system: the
 * Homeostasis ledger (healed vs escalated), the escalation inbox (the value/arc
 * calls the cortex refused to make — approve/dismiss), and Repair Memory stats.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun, isForbidden } from '@/lib/api/client';
import { AdminRequiredState } from '@/components/common/EmptyState';

interface HealthEntry { id: string; pathology: string; category: string; disposition: string; subject_id: string; checked_at: number }
interface Escalation { id: string; message: string; priority: string; status: string; created_at: string }
interface MemStats { totalPatterns: number; totalRepairs: number; avgSuccessRate: number; deprecatedFixes: number }

export default function RepairTelemetryPage() {
  const [log, setLog] = useState<HealthEntry[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [mem, setMem] = useState<MemStats | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const refresh = useCallback(async () => {
    const [l, e, m] = await Promise.all([
      lensRun('repair', 'health_log', { limit: 100 }),
      lensRun('repair', 'escalations', {}),
      lensRun('repair', 'memory', {}),
    ]);
    if ([l, e, m].some(r => isForbidden(r.data))) { setForbidden(true); return; }
    if (l.data?.ok) setLog((l.data.result as { entries: HealthEntry[] }).entries || []);
    if (e.data?.ok) setEscalations((e.data.result as { escalations: Escalation[] }).escalations || []);
    if (m.data?.ok) setMem((m.data.result as { stats: MemStats }).stats || null);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function resolve(id: string, resolution: 'approved' | 'dismissed') {
    await lensRun('repair', 'resolve_escalation', { id, resolution });
    void refresh();
  }

  const dispColor: Record<string, string> = { healed: '#4caf50', escalated: '#e0a030', noted: '#888' };

  if (forbidden) return <AdminRequiredState roles={['admin']} />;

  return (
    <LensShell lensId="repair-telemetry">
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px', color: '#e8e4dc' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Repair Telemetry</h1>
      <p style={{ opacity: 0.7, marginBottom: 20 }}>What the world repaired — and what it refused to decide — while you were away.</p>

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
    </div>
    </LensShell>
  );
}

function btn(bg: string): React.CSSProperties {
  return { background: bg, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
}
