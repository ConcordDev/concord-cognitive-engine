'use client';

import { useState, type ReactNode } from 'react';
import EquipmentPanel from './EquipmentPanel';
import FarmMapPanel from './FarmMapPanel';
import GrainBinsPanel from './GrainBinsPanel';
import ImageryPanel from './ImageryPanel';
import NitrogenPlanner from './NitrogenPlanner';
import PassesPanel from './PassesPanel';
import PrescriptionsPanel from './PrescriptionsPanel';
import TankMixesPanel from './TankMixesPanel';
import WorkOrdersPanel from './WorkOrdersPanel';
import ZonesPanel from './ZonesPanel';

type BenchTab =
  | 'map'
  | 'equipment'
  | 'zones'
  | 'prescriptions'
  | 'passes'
  | 'nitrogen'
  | 'imagery'
  | 'tankmix'
  | 'workorders'
  | 'grain';

const TABS: { id: BenchTab; label: string }[] = [
  { id: 'map', label: 'Farm map' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'zones', label: 'Zones' },
  { id: 'prescriptions', label: 'Prescriptions' },
  { id: 'passes', label: 'Passes' },
  { id: 'nitrogen', label: 'Nitrogen' },
  { id: 'imagery', label: 'Imagery' },
  { id: 'tankmix', label: 'Tank mixes' },
  { id: 'workorders', label: 'Work orders' },
  { id: 'grain', label: 'Grain bins' },
];

/** John Deere Ops Center workbench — map, fleet, Rx, passes, grain. */
export function DeereWorkbenchPanel() {
  const [tab, setTab] = useState<BenchTab>('map');

  let body: ReactNode = <FarmMapPanel />;
  if (tab === 'equipment') body = <EquipmentPanel />;
  else if (tab === 'zones') body = <ZonesPanel />;
  else if (tab === 'prescriptions') body = <PrescriptionsPanel />;
  else if (tab === 'passes') body = <PassesPanel />;
  else if (tab === 'nitrogen') body = <NitrogenPlanner />;
  else if (tab === 'imagery') body = <ImageryPanel />;
  else if (tab === 'tankmix') body = <TankMixesPanel />;
  else if (tab === 'workorders') body = <WorkOrdersPanel />;
  else if (tab === 'grain') body = <GrainBinsPanel />;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">
        Deere Ops Center
      </h2>
      <nav
        className="flex items-center gap-1 border-b border-emerald-900/30 pb-2 overflow-x-auto"
        aria-label="Ops Center tools"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (tab === t.id
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                : 'text-gray-400 hover:text-emerald-300 hover:bg-emerald-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>{body}</div>
    </section>
  );
}

export default DeereWorkbenchPanel;
