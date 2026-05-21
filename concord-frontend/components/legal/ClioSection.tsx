'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ClioShell, ClioNav } from './ClioShell';
import { LegalAskBar } from './LegalAskBar';
import { LegalDashboard } from './LegalDashboard';
import { MattersPanel } from './MattersPanel';
import { ContactsPanel } from './ContactsPanel';
import { TimeTracker } from './TimeTracker';
import { TrustAccountsPanel } from './TrustAccountsPanel';
import { InvoicesPanel } from './InvoicesPanel';
import { DocumentsPanel } from './DocumentsPanel';
import { ESignaturePanel } from './ESignaturePanel';
import { CalendarPanel } from './CalendarPanel';
import { IntakeFormsPanel } from './IntakeFormsPanel';
import { ReportsPanel } from './ReportsPanel';

export function ClioSection() {
  const [nav, setNav] = useState<ClioNav>('dashboard');
  const [badges, setBadges] = useState<Partial<Record<ClioNav, number | string>>>({});

  useEffect(() => { refreshBadges(); }, [nav]);

  async function refreshBadges() {
    try {
      const r = await lensRun({ domain: 'legal', action: 'dashboard-summary', input: {} });
      const d = r.data?.result;
      if (d) {
        setBadges({
          matters: d.openMatters || 0,
          time: d.runningTimers > 0 ? '●' : (d.unbilledHours > 0 ? Math.round(d.unbilledHours) : 0),
          invoices: d.overdueInvoices || 0,
          trust: d.trustBalance >= 0 ? '$' : '!',
          calendar: d.upcomingEvents?.length || 0,
        });
      }
    } catch {}
  }

  return (
    <ClioShell
      activeNav={nav}
      onNavChange={setNav}
      badges={badges}
      askBar={<LegalAskBar />}
    >
      {nav === 'dashboard' && <LegalDashboard onJumpTo={(n) => setNav(n)} />}
      {nav === 'intake'    && <IntakeFormsPanel />}
      {nav === 'matters'   && <MattersPanel />}
      {nav === 'contacts'  && <ContactsPanel />}
      {nav === 'calendar'  && <CalendarPanel />}
      {nav === 'time'      && <TimeTracker />}
      {nav === 'invoices'  && <InvoicesPanel />}
      {nav === 'trust'     && <TrustAccountsPanel />}
      {nav === 'documents' && <DocumentsPanel defaultTab="documents" />}
      {nav === 'templates' && <DocumentsPanel defaultTab="templates" />}
      {nav === 'esign'     && <ESignaturePanel />}
      {nav === 'reports'   && <ReportsPanel />}
    </ClioShell>
  );
}

export default ClioSection;
