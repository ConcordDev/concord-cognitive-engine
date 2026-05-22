'use client';

/**
 * ConsultingWorkbench — the practice-management surface that closes the
 * Bonsai+Harvest workflow loop: live timer, invoicing, proposal builder,
 * staffing planner, expenses, retainers, profitability, and client portal.
 * Every panel wires real consulting.* macros; the shared engagement list
 * is fetched once and passed down so child panels stay consistent.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Timer, FileText, FileSignature, Users, Receipt, Repeat, TrendingUp, Share2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { LiveTimer } from './LiveTimer';
import { InvoiceManager } from './InvoiceManager';
import { ProposalBuilder } from './ProposalBuilder';
import { StaffingPlanner } from './StaffingPlanner';
import { ExpenseTracker } from './ExpenseTracker';
import { RetainerManager } from './RetainerManager';
import { ProfitabilityReport } from './ProfitabilityReport';
import { ClientPortal } from './ClientPortal';

interface EngagementOption { id: string; name: string }
type Panel = 'timer' | 'invoices' | 'proposals' | 'staffing' | 'expenses' | 'retainers' | 'profit' | 'portal';

const PANELS: { id: Panel; label: string; icon: typeof Timer }[] = [
  { id: 'timer', label: 'Timer', icon: Timer },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'proposals', label: 'Proposals', icon: FileSignature },
  { id: 'staffing', label: 'Staffing', icon: Users },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'retainers', label: 'Retainers', icon: Repeat },
  { id: 'profit', label: 'Profitability', icon: TrendingUp },
  { id: 'portal', label: 'Client Portal', icon: Share2 },
];

export function ConsultingWorkbench() {
  const [panel, setPanel] = useState<Panel>('timer');
  const [engagements, setEngagements] = useState<EngagementOption[]>([]);
  // Bumping this key forces panels that depend on logged time to reload.
  const [refreshKey, setRefreshKey] = useState(0);

  const loadEngagements = useCallback(async () => {
    const r = await lensRun('consulting', 'engagement-list', {});
    const res = r.data?.result as { engagements?: EngagementOption[] } | null;
    setEngagements((res?.engagements || []).map(e => ({ id: e.id, name: e.name })));
  }, []);
  useEffect(() => { void loadEngagements(); }, [loadEngagements]);

  const onTimeLogged = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <h3 className="text-sm font-bold text-zinc-100 mb-3">Practice Management</h3>
      <nav className="flex flex-wrap gap-1.5 mb-4">
        {PANELS.map(p => {
          const Icon = p.icon;
          return (
            <button key={p.id} onClick={() => setPanel(p.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                panel === p.id ? 'bg-indigo-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
              }`}>
              <Icon className="w-3.5 h-3.5" />{p.label}
            </button>
          );
        })}
      </nav>

      {panel === 'timer' && <LiveTimer engagements={engagements} onLogged={onTimeLogged} />}
      {panel === 'invoices' && <InvoiceManager key={refreshKey} engagements={engagements} />}
      {panel === 'proposals' && <ProposalBuilder />}
      {panel === 'staffing' && <StaffingPlanner engagements={engagements} />}
      {panel === 'expenses' && <ExpenseTracker engagements={engagements} />}
      {panel === 'retainers' && <RetainerManager />}
      {panel === 'profit' && <ProfitabilityReport key={refreshKey} />}
      {panel === 'portal' && <ClientPortal engagements={engagements} />}
    </div>
  );
}
