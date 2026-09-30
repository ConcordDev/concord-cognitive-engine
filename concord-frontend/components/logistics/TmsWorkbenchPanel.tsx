'use client';

import { useState } from 'react';
import ShipmentsPanel from '@/components/logistics/ShipmentsPanel';
import CarriersPanel from '@/components/logistics/CarriersPanel';
import RateQuoter from '@/components/logistics/RateQuoter';
import PickupsPanel from '@/components/logistics/PickupsPanel';
import DockAppointmentsPanel from '@/components/logistics/DockAppointmentsPanel';
import FleetVehiclesPanel from '@/components/logistics/FleetVehiclesPanel';
import LoadBoardPanel from '@/components/logistics/LoadBoardPanel';
import DeliveryProofPanel from '@/components/logistics/DeliveryProofPanel';
import ShipmentEventsTimeline from '@/components/logistics/ShipmentEventsTimeline';

export function TmsWorkbenchPanel() {
  const [active, setActive] = useState<'shipments' | 'carriers' | 'rates' | 'pickups' | 'docks' | 'fleet' | 'loads' | 'pod' | 'events'>('shipments');
  const TABS = [
    { id: 'shipments', label: 'Shipments' },
    { id: 'carriers', label: 'Carriers' },
    { id: 'rates', label: 'Rate quoter' },
    { id: 'pickups', label: 'Pickups' },
    { id: 'docks', label: 'Dock appts' },
    { id: 'fleet', label: 'Fleet' },
    { id: 'loads', label: 'Load board' },
    { id: 'pod', label: 'POD' },
    { id: 'events', label: 'EDI events' },
  ] as const;
  return (
    <section className="space-y-3">
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
        {active === 'shipments' && <ShipmentsPanel />}
        {active === 'carriers' && <CarriersPanel />}
        {active === 'rates' && <RateQuoter />}
        {active === 'pickups' && <PickupsPanel />}
        {active === 'docks' && <DockAppointmentsPanel />}
        {active === 'fleet' && <FleetVehiclesPanel />}
        {active === 'loads' && <LoadBoardPanel />}
        {active === 'pod' && <DeliveryProofPanel />}
        {active === 'events' && <ShipmentEventsTimeline />}
      </div>
    </section>
  );
}
