'use client';

/**
 * EventLogPanel — ATS event timeline with type/dimension filters.
 */
import { useMemo, useState } from 'react';
import { Clock, Filter, ChevronDown, ChevronUp } from 'lucide-react';
import { useAffectAts } from '@/components/affect/useAffectAts';
import { EVENT_TYPES, DIMS, eventTypeColor, formatTimeShort } from '@/components/affect/affect-model';
import { ErrorState } from '@/components/common/EmptyState';

export function EventLogPanel() {
  const { eventList, isLoading, isError, errorMessage, refetchAll } = useAffectAts();
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [eventDimFilter, setEventDimFilter] = useState<string>('all');
  const [expandedEvent, setExpandedEvent] = useState<number | null>(null);

  const filteredEvents = useMemo(() => {
    let filtered = [...eventList];
    if (eventFilter !== 'all') {
      filtered = filtered.filter(
        (evt: Record<string, unknown>) =>
          String(evt.type).toUpperCase() === eventFilter.toUpperCase()
      );
    }
    if (eventDimFilter !== 'all') {
      filtered = filtered.filter((evt: Record<string, unknown>) => {
        const dims = evt.dimensions || evt.affected_dimensions || evt.changes;
        if (Array.isArray(dims)) return dims.includes(eventDimFilter);
        if (dims && typeof dims === 'object')
          return eventDimFilter in (dims as Record<string, unknown>);
        return true;
      });
    }
    return filtered;
  }, [eventList, eventFilter, eventDimFilter]);

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (isError) {
    return <ErrorState error={errorMessage} onRetry={refetchAll} />;
  }

  return (
        <div className="space-y-6">
          {/* Filters */}
          <div className="panel p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-400">Filters:</span>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Event Type</label>
                <select
                  value={eventFilter}
                  onChange={(e) => setEventFilter(e.target.value)}
                  className="input-lattice text-sm"
                >
                  <option value="all">All Types</option>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Dimension</label>
                <select
                  value={eventDimFilter}
                  onChange={(e) => setEventDimFilter(e.target.value)}
                  className="input-lattice text-sm"
                >
                  <option value="all">All Dimensions</option>
                  {DIMS.map((d) => (
                    <option key={d.key} value={d.key}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ml-auto text-xs text-gray-400">
                Showing {filteredEvents.length} of {eventList.length} events
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-neon-green" />
              Event Timeline
            </h2>
            {filteredEvents.length > 0 ? (
              <div className="space-y-1 max-h-[32rem] overflow-y-auto">
                {[...filteredEvents]
                  .reverse()
                  .slice(0, 50)
                  .map((evt: Record<string, unknown>, i: number) => {
                    const isExpanded = expandedEvent === i;
                    return (
                      <div key={i} className="lens-card text-sm">
                        <div
                          className="flex items-center gap-3 cursor-pointer"
                          onClick={() => setExpandedEvent(isExpanded ? null : i)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                          <div className="w-1 h-8 rounded-full bg-gray-700 shrink-0 relative">
                            <div
                              className={`absolute inset-0 rounded-full ${
                                (typeof evt.intensity === 'number' ? evt.intensity : 0.5) > 0.7
                                  ? 'bg-red-500'
                                  : (typeof evt.intensity === 'number' ? evt.intensity : 0.5) > 0.4
                                    ? 'bg-yellow-500'
                                    : 'bg-green-500'
                              }`}
                              style={{
                                top: `${(1 - (typeof evt.intensity === 'number' ? evt.intensity : 0.5)) * 100}%`,
                              }}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs font-mono font-medium px-2 py-0.5 rounded ${eventTypeColor(
                                  String(evt.type)
                                )}`}
                              >
                                {String(evt.type)}
                              </span>
                              <span className="text-xs text-gray-400">
                                i={typeof evt.intensity === 'number' ? evt.intensity.toFixed(2) : '--'}{' '}
                                p={typeof evt.polarity === 'number' ? evt.polarity.toFixed(2) : '--'}
                              </span>
                            </div>
                            {!!(evt.trigger || evt.cause || evt.description) && (
                              <p className="text-xs text-gray-400 mt-0.5 truncate">
                                {String(evt.trigger || evt.cause || evt.description)}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 shrink-0">
                            {formatTimeShort(evt.timestamp || evt.created_at || evt.time)}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          )}
                        </div>
                        {isExpanded && (
                          <div className="mt-2 pt-2 border-t border-gray-700/30 space-y-1 text-xs">
                            {Object.entries(evt)
                              .filter(
                                ([k]) => !['type', 'intensity', 'polarity'].includes(k)
                              )
                              .map(([k, v]) => (
                                <div key={k} className="flex justify-between">
                                  <span className="text-gray-400">{k.replace(/_/g, ' ')}</span>
                                  <span className="font-mono text-gray-400 max-w-[60%] text-right truncate">
                                    {typeof v === 'number'
                                      ? v.toFixed(3)
                                      : typeof v === 'object'
                                        ? JSON.stringify(v)
                                        : String(v)}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                {eventList.length === 0
                  ? 'No events recorded yet. Emit an event to see the timeline.'
                  : 'No events match the current filters.'}
              </p>
            )}
          </div>
        </div>
  );
}
