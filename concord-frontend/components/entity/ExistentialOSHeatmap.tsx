'use client';

interface OSEntry {
  key: string;
  label: string;
  category: string;
  description: string;
  numeric_channels: string[];
}

interface QualiaState {
  activeOS: string[];
  channels: Record<string, number>;
}

export function ExistentialOSHeatmap({ grouped, qualiaState }: {
  grouped: Record<string, OSEntry[]>;
  qualiaState?: QualiaState | null;
}) {
  const channels = qualiaState?.channels || {};
  const activeOS = new Set(qualiaState?.activeOS || []);

  // Color intensity based on float value 0-1
  function intensityColor(value: number): string {
    if (value <= 0) return 'bg-zinc-800';
    if (value < 0.2) return 'bg-blue-900/60';
    if (value < 0.4) return 'bg-blue-700/60';
    if (value < 0.6) return 'bg-cyan-600/60';
    if (value < 0.8) return 'bg-cyan-500/70';
    return 'bg-cyan-400/80';
  }

  function intensityText(value: number): string {
    if (value <= 0) return 'text-zinc-600';
    if (value < 0.3) return 'text-blue-400';
    if (value < 0.6) return 'text-cyan-400';
    return 'text-cyan-300';
  }

  const tierOrder = [
    'Tier 0 \u2014 Core',
    'Tier 1 \u2014 Sensory',
    'Tier 2 \u2014 Simulation',
    'Tier 3 \u2014 Human Interface',
    'Tier 4 \u2014 Cosmic',
    'Tier 5 \u2014 Self/Meta',
    'Tier 6 \u2014 Presence',
  ];

  const sortedTiers = tierOrder.filter(t => grouped[t]);

  return (
    <div className="space-y-3">
      {!qualiaState && (
        <div className="text-xs text-zinc-400 bg-zinc-900 rounded p-2">
          No live qualia state for this entity. Showing registry structure.
        </div>
      )}
      {sortedTiers.map(tierName => {
        const osEntries = grouped[tierName] || [];
        return (
          <div key={tierName}>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{tierName}</h4>
            <div className="space-y-1.5">
              {osEntries.map(os => {
                const isActive = activeOS.has(os.key);
                return (
                  <div
                    key={os.key}
                    className={`bg-zinc-900 rounded-lg p-2 border ${
                      isActive ? 'border-cyan-800/50' : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                      <span className="text-xs font-medium text-white">{os.label}</span>
                      {!isActive && <span className="text-[10px] text-zinc-400">(inactive)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {os.numeric_channels.map(ch => {
                        const channelKey = `${os.key}.${ch}`;
                        const value = channels[channelKey] ?? 0;
                        return (
                          <div
                            key={ch}
                            className={`${intensityColor(value)} rounded px-1.5 py-0.5 text-[10px] flex items-center gap-1`}
                            title={`${ch}: ${value.toFixed(3)}`}
                          >
                            <span className="text-zinc-400 truncate max-w-[80px]">{ch.replace(/_/g, ' ')}</span>
                            <span className={`font-mono font-bold ${intensityText(value)}`}>{value.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
