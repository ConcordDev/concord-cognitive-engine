'use client';

import { useState } from 'react';
import { Map, Gauge, BookOpen, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { PipingProvider } from '@/components/panel-polish';
import { AirportBrief } from './AirportBrief';
import { AviationActionPanel } from './AviationActionPanel';
import AviationWorkbench from './AviationWorkbench';
import EFBSuite from './EFBSuite';
import AircraftPanel from './AircraftPanel';
import LogbookPanel from './LogbookPanel';
import CurrencyPanel from './CurrencyPanel';
import BriefingPanel from './BriefingPanel';
import RouteAdvisor from './RouteAdvisor';
import TrackLogsPanel from './TrackLogsPanel';
import FuelStopsCalc from './FuelStopsCalc';
import LiveFlightsPanel from './LiveFlightsPanel';

type EfbSection = 'map' | 'planning' | 'records' | 'brief';

const SECTIONS: { id: EfbSection; label: string; icon: typeof Map }[] = [
  { id: 'map', label: 'Moving map', icon: Map },
  { id: 'planning', label: 'Planning', icon: Gauge },
  { id: 'records', label: 'Logbook & tracks', icon: BookOpen },
  { id: 'brief', label: 'Brief', icon: ClipboardList },
];

const RECORD_TABS = [
  { id: 'aircraft', label: 'Aircraft' },
  { id: 'logbook', label: 'Logbook' },
  { id: 'currency', label: 'Currency' },
  { id: 'briefing', label: 'Briefing' },
  { id: 'route', label: 'Route advisor' },
  { id: 'tracks', label: 'Track logs' },
  { id: 'fuel', label: 'Fuel stops' },
  { id: 'live', label: 'Live tracking' },
] as const;

type RecordTab = typeof RECORD_TABS[number]['id'];

export function EfbPanel() {
  const [section, setSection] = useState<EfbSection>('map');
  const [recordTab, setRecordTab] = useState<RecordTab>('aircraft');

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1 border-b border-sky-900/40 pb-2 overflow-x-auto" aria-label="EFB sections">
        {SECTIONS.map((t) => {
          const Icon = t.icon;
          const active = section === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSection(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition',
                active
                  ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30'
                  : 'text-gray-400 hover:text-sky-200 border border-transparent',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {section === 'map' && <EFBSuite />}

      {section === 'planning' && <AviationWorkbench embedded />}

      {section === 'records' && (
        <section className="space-y-3">
          <LensFeedButton domain="aviation" />
          <nav className="flex items-center gap-1 border-b border-cyan-900/30 pb-2 overflow-x-auto">
            {RECORD_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setRecordTab(t.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition',
                  recordTab === t.id
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20'
                    : 'text-gray-400 hover:text-cyan-300 hover:bg-cyan-900/10 border border-transparent',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div>
            {recordTab === 'aircraft' && <AircraftPanel />}
            {recordTab === 'logbook' && <LogbookPanel />}
            {recordTab === 'currency' && <CurrencyPanel />}
            {recordTab === 'briefing' && <BriefingPanel />}
            {recordTab === 'route' && <RouteAdvisor />}
            {recordTab === 'tracks' && <TrackLogsPanel />}
            {recordTab === 'fuel' && <FuelStopsCalc />}
            {recordTab === 'live' && <LiveFlightsPanel />}
          </div>
        </section>
      )}

      {section === 'brief' && (
        <PipingProvider>
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <AirportBrief />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <AviationActionPanel />
            </section>
          </div>
        </PipingProvider>
      )}
    </div>
  );
}

export default EfbPanel;
