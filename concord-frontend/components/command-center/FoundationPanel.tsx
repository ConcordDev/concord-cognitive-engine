'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import {
  Globe
} from 'lucide-react';
import FoundationCard from '@/components/chat/FoundationCard';


export function FoundationPanel() {
  const { data: statusData } = useQuery({
    queryKey: ['foundation-status'],
    queryFn: () => apiHelpers.foundation.status().then(r => r.data),
    refetchInterval: 15000,
  });
  const { data: senseData } = useQuery({
    queryKey: ['foundation-sense'],
    queryFn: () => apiHelpers.foundation.senseReadings(20).then(r => r.data),
    refetchInterval: 10000,
  });
  const { data: energyData } = useQuery({
    queryKey: ['foundation-energy'],
    queryFn: () => apiHelpers.foundation.energyMap().then(r => r.data),
    refetchInterval: 15000,
  });
  const { data: spectrumData } = useQuery({
    queryKey: ['foundation-spectrum'],
    queryFn: () => apiHelpers.foundation.spectrumAvailable(20).then(r => r.data),
    refetchInterval: 15000,
  });
  const { data: protocolData } = useQuery({
    queryKey: ['foundation-protocol'],
    queryFn: () => apiHelpers.foundation.protocolStats().then(r => r.data),
    refetchInterval: 30000,
  });
  const { data: emergencyData } = useQuery({
    queryKey: ['foundation-emergency'],
    queryFn: () => apiHelpers.foundation.emergencyStatus().then(r => r.data),
    refetchInterval: 10000,
  });

  const [section, setSection] = useState<'status' | 'sense' | 'energy' | 'emergency' | 'protocol'>('status');

  const sections = [
    { id: 'status' as const, label: 'Status' },
    { id: 'sense' as const, label: 'Sensors' },
    { id: 'energy' as const, label: 'Energy' },
    { id: 'emergency' as const, label: 'Emergency' },
    { id: 'protocol' as const, label: 'Protocol' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
        <Globe className="w-4 h-4 text-violet-400" /> Foundation Layer
      </h3>

      {/* Section tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
              section === s.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      {section === 'status' && statusData && (
        <FoundationCard type="status" status={statusData} />
      )}
      {section === 'sense' && (
        <FoundationCard type="sense" readings={senseData?.readings || []} />
      )}
      {section === 'energy' && (
        <FoundationCard type="energy" energyReadings={energyData?.readings || []} />
      )}
      {section === 'emergency' && (
        <FoundationCard type="emergency" alerts={emergencyData?.alerts || []} />
      )}
      {section === 'protocol' && protocolData && (
        <FoundationCard type="protocol" protocolMetrics={protocolData} />
      )}

      {/* Spectrum availability summary */}
      {spectrumData?.channels && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
          <p className="text-xs font-semibold text-zinc-400 mb-2">Spectrum Availability</p>
          <div className="text-xs text-zinc-400">
            {Array.isArray(spectrumData.channels)
              ? `${spectrumData.channels.length} channels available`
              : 'Checking spectrum...'}
          </div>
        </div>
      )}
    </div>
  );
}
