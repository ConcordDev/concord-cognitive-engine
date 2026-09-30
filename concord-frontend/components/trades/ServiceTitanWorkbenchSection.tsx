'use client';

import { useState } from 'react';
import DispatchBoardPanel from '@/components/trades/DispatchBoardPanel';
import SchedulingCalendarPanel from '@/components/trades/SchedulingCalendarPanel';
import TechniciansPanel from '@/components/trades/TechniciansPanel';
import FieldTrackingPanel from '@/components/trades/FieldTrackingPanel';
import RouteOptimizerPanel from '@/components/trades/RouteOptimizerPanel';
import QuotesPanel from '@/components/trades/QuotesPanel';
import BookingsPanel from '@/components/trades/BookingsPanel';
import TimesheetsPanel from '@/components/trades/TimesheetsPanel';
import InvoicesPanel from '@/components/trades/InvoicesPanel';
import PaymentsPanel from '@/components/trades/PaymentsPanel';
import CustomerPortalPanel from '@/components/trades/CustomerPortalPanel';
import RecurringPlansPanel from '@/components/trades/RecurringPlansPanel';
import PricebookPanel from '@/components/trades/PricebookPanel';
import NotificationsPanel from '@/components/trades/NotificationsPanel';
import ReviewsPanel from '@/components/trades/ReviewsPanel';
import ReportingPanel from '@/components/trades/ReportingPanel';

export function ServiceTitanWorkbenchSection() {
  const [active, setActive] = useState<
    'dispatch' | 'calendar' | 'techs' | 'field' | 'route' | 'quotes' | 'bookings' | 'timesheets'
    | 'invoices' | 'payments' | 'portal' | 'recurring' | 'pricebook' | 'reminders' | 'reviews' | 'reports'
  >('dispatch');
  const TABS = [
    { id: 'dispatch', label: 'Dispatch' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'techs', label: 'Technicians' },
    { id: 'field', label: 'Field/GPS' },
    { id: 'route', label: 'Route opt' },
    { id: 'quotes', label: 'Quotes' },
    { id: 'bookings', label: 'Bookings' },
    { id: 'timesheets', label: 'Timesheets' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'payments', label: 'Payments' },
    { id: 'portal', label: 'Portal' },
    { id: 'recurring', label: 'Recurring' },
    { id: 'pricebook', label: 'Pricebook' },
    { id: 'reminders', label: 'Reminders' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'reports', label: 'Reports' },
  ] as const;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-cyan-300 uppercase tracking-wider">ServiceTitan/Jobber-parity workbench</h2>
      <nav className="flex items-center gap-1 border-b border-cyan-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (active === t.id
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'dispatch' && <DispatchBoardPanel />}
        {active === 'calendar' && <SchedulingCalendarPanel />}
        {active === 'techs' && <TechniciansPanel />}
        {active === 'field' && <FieldTrackingPanel />}
        {active === 'route' && <RouteOptimizerPanel />}
        {active === 'quotes' && <QuotesPanel />}
        {active === 'bookings' && <BookingsPanel />}
        {active === 'timesheets' && <TimesheetsPanel />}
        {active === 'invoices' && <InvoicesPanel />}
        {active === 'payments' && <PaymentsPanel />}
        {active === 'portal' && <CustomerPortalPanel />}
        {active === 'recurring' && <RecurringPlansPanel />}
        {active === 'pricebook' && <PricebookPanel />}
        {active === 'reminders' && <NotificationsPanel />}
        {active === 'reviews' && <ReviewsPanel />}
        {active === 'reports' && <ReportingPanel />}
      </div>
    </section>
  );
}

