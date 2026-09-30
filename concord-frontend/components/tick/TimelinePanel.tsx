'use client';

/**
 * TimelinePanel — chronological tick events with gap markers.
 * Extracted from lenses/tick/page.tsx.
 */

import { Clock, Zap, Activity, AlertTriangle, Timer } from 'lucide-react';
import { useTickStream } from '@/components/tick/TickStreamContext';
import { EventTimelineCanvas } from '@/components/tick/tick-model';

export function TimelinePanel() {
  const { tickHistory, formatMs, stats } = useTickStream();
  return (
        <div className="space-y-6">
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Timer className="w-4 h-4 text-neon-cyan" />
              Event Timeline
            </h2>
            <div className="h-64 rounded-lg overflow-hidden border border-white/5">
              <EventTimelineCanvas ticks={tickHistory} />
            </div>
            <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-neon-green" /> Signal (upper)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" /> Stress (lower)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-neon-blue" /> Info
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-neon-purple" /> Synthesis
              </span>
            </div>
          </div>

          {/* Scrollable event list with timestamps */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4">Event Sequence</h2>
            <div className="relative max-h-96 overflow-auto">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-px bg-white/5" />
              <div className="space-y-1 pl-10">
                {tickHistory.map((tick, i) => {
                  const prevTick = tickHistory[i + 1];
                  const gap = prevTick
                    ? new Date(tick.timestamp).getTime() - new Date(prevTick.timestamp).getTime()
                    : 0;
                  const isGap = gap > stats.avgInterval * 3 && stats.avgInterval > 0;
                  return (
                    <div key={tick.id} className="relative">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[26px] top-3 w-2.5 h-2.5 rounded-full border ${
                          tick.stress > 0.2
                            ? 'bg-red-500/50 border-red-500'
                            : 'bg-neon-green/50 border-neon-green'
                        }`}
                      />
                      <div className={`flex items-center justify-between p-2 rounded-lg hover:bg-white/[0.02] ${
                        isGap ? 'border-l-2 border-yellow-500/30' : ''
                      }`}>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono text-gray-400 w-20">
                            {new Date(tick.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="text-xs font-medium text-gray-300">{tick.type}</span>
                          <span className="text-[10px] text-gray-400">{tick.organ}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono">
                          <span className="text-neon-cyan">{(tick.signal * 100).toFixed(0)}%</span>
                          <span className={tick.stress > 0.2 ? 'text-red-400' : 'text-gray-600'}>
                            S:{(tick.stress * 100).toFixed(0)}%
                          </span>
                          {isGap && (
                            <span className="text-yellow-500 text-[10px]">gap: {formatMs(gap)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
  );
}
