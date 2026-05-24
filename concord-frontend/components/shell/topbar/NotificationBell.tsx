'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Bell } from 'lucide-react';

interface NotificationEvent {
  id?: string;
  type?: string;
  message?: string;
  summary?: string;
  description?: string;
  created_at?: string;
  timestamp?: string;
  scope?: string;
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: eventsData, refetch } = useQuery({
    queryKey: ['events-paginated-notifs'],
    queryFn: () =>
      api.get('/api/events/paginated', { params: { limit: 20 } }).then((r) => r.data),
    refetchInterval: 60000,
    retry: false,
  });

  const events: NotificationEvent[] = eventsData?.events || eventsData?.items || [];
  const count = events.length;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((prev) => !prev);
          if (!open) refetch();
        }}
        className="relative p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
        aria-label={`Notifications${count > 0 ? ` (${count} recent)` : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5 text-gray-400" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 lg:w-5 lg:h-5 bg-neon-pink text-white text-[10px] lg:text-xs rounded-full flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-96 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden flex flex-col"
          role="menu"
        >
          <div className="px-4 py-3 border-b border-lattice-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Notifications</h3>
            <button
              onClick={() => router.push('/lenses/events')}
              className="text-xs text-neon-cyan hover:text-neon-blue transition-colors"
            >
              View all
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {events.length === 0 ? (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">
                No recent notifications
              </div>
            ) : (
              events.slice(0, 10).map((event, idx) => (
                <button
                  key={event.id || idx}
                  onClick={() => {
                    setOpen(false);
                    router.push('/lenses/events');
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-lattice-elevated transition-colors border-b border-lattice-border/50 last:border-b-0"
                  role="menuitem"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 w-2 h-2 rounded-full bg-neon-cyan flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-200 truncate">
                        {event.message ||
                          event.summary ||
                          event.description ||
                          event.type ||
                          'System event'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {event.type && <span className="text-gray-400">{event.type}</span>}
                        {(event.created_at || event.timestamp) && (
                          <span className="ml-2">
                            {new Date(event.created_at || event.timestamp || '').toLocaleString(
                              undefined,
                              {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
