'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time?: string;
  color?: string;
  dtuId?: string;
  type: 'note' | 'reminder' | 'task' | 'event';
}

interface CalendarViewProps {
  events: CalendarEvent[];
  onSelectDate?: (date: string) => void;
  onSelectEvent?: (event: CalendarEvent) => void;
  onCreateEvent?: (date: string) => void;
  className?: string;
}

type ViewMode = 'month' | 'week' | 'day';

export function CalendarView({
  events,
  onSelectDate,
  onSelectEvent,
  onCreateEvent,
  className
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = new Date().toISOString().split('T')[0];

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(event => {
      const existing = map.get(event.date) || [];
      map.set(event.date, [...existing, event]);
    });
    return map;
  }, [events]);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: (Date | null)[] = [];

    // Add padding for first week
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null);
    }

    // Add days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push(new Date(year, month, i));
    }

    return days;
  };

  const getWeekDays = (date: Date) => {
    const day = date.getDay();
    const start = new Date(date);
    start.setDate(date.getDate() - day);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  };

  const formatDateKey = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const handleDateClick = (date: Date) => {
    const dateStr = formatDateKey(date);
    setSelectedDate(dateStr);
    onSelectDate?.(dateStr);
  };

  const navigate = (direction: -1 | 1) => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + direction);
    } else if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + (direction * 7));
    } else {
      newDate.setDate(newDate.getDate() + direction);
    }
    setCurrentDate(newDate);
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(today);
  };

  const getEventColor = (type: string) => {
    switch (type) {
      case 'note': return 'bg-neon-cyan';
      case 'reminder': return 'bg-yellow-400';
      case 'task': return 'bg-neon-purple';
      case 'event': return 'bg-green-400';
      default: return 'bg-gray-400';
    }
  };

  const days = viewMode === 'month' ? getDaysInMonth(currentDate) : getWeekDays(currentDate);

  const renderDayCell = (date: Date | null, index: number) => {
    if (!date) {
      return <div key={index} className="h-32" />;
    }

    const dateStr = formatDateKey(date);
    const dayEvents = eventsByDate.get(dateStr) || [];
    const isToday = dateStr === today;
    const isSelected = dateStr === selectedDate;

    return (
      <div
        key={dateStr}
        onClick={() => handleDateClick(date)}
        className={cn(
          'h-32 border border-lattice-border p-1 cursor-pointer transition-colors',
          'hover:bg-lattice-surface/50',
          isSelected && 'ring-2 ring-neon-cyan',
          isToday && 'bg-neon-cyan/5'
        )} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between mb-1">
          <span className={cn(
            'text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full',
            isToday && 'bg-neon-cyan text-black',
            !isToday && 'text-gray-400'
          )}>
            {date.getDate()}
          </span>
          {onCreateEvent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCreateEvent(dateStr);
              }}
              className="p-1 text-gray-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              aria-label={`Add event on ${dateStr}`}
            >
              <Plus className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="space-y-0.5 overflow-hidden">
          {dayEvents.slice(0, 3).map(event => (
            <button
              key={event.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectEvent?.(event);
              }}
              className={cn(
                'w-full text-left px-1.5 py-0.5 text-xs rounded truncate',
                getEventColor(event.type),
                'text-black font-medium hover:opacity-80 transition-opacity'
              )}
            >
              {event.time && <span className="opacity-75">{event.time} </span>}
              {event.title}
            </button>
          ))}
          {dayEvents.length > 3 && (
            <span className="text-xs text-gray-500 px-1">
              +{dayEvents.length - 3} more
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-lattice-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-neon-cyan" />
            <h2 className="text-lg font-semibold text-white">
              {currentDate.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric'
              })}
            </h2>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate(-1)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={goToToday}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white transition-colors"
            >
              Today
            </button>
            <button
              onClick={() => navigate(1)}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* View mode selector */}
        <div className="flex items-center gap-1 bg-lattice-surface rounded-lg p-1">
          {(['month', 'week', 'day'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={cn(
                'px-3 py-1 text-xs rounded transition-colors capitalize',
                viewMode === mode
                  ? 'bg-neon-cyan text-black font-medium'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-lattice-border">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
          <div
            key={day}
            className="px-2 py-2 text-xs text-gray-500 text-center font-medium"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'day' ? (
          <DayView
            date={currentDate}
            events={eventsByDate.get(formatDateKey(currentDate)) || []}
            onSelectEvent={onSelectEvent}
          />
        ) : (
          <div className={cn(
            'grid grid-cols-7',
            viewMode === 'week' && 'h-full'
          )}>
            {days.map((day, index) => renderDayCell(day, index))}
          </div>
        )}
      </div>

      {/* Selected date events */}
      {selectedDate && (
        <AnimatePresence>
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-lattice-border overflow-hidden"
          >
            <div className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-white">
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric'
                  })}
                </h3>
                {onCreateEvent && (
                  <button
                    onClick={() => onCreateEvent(selectedDate)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-neon-cyan text-black rounded hover:bg-neon-cyan/90 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Add
                  </button>
                )}
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {(eventsByDate.get(selectedDate) || []).map(event => (
                  <button
                    key={event.id}
                    onClick={() => onSelectEvent?.(event)}
                    className="w-full flex items-center gap-3 p-2 bg-lattice-surface rounded-lg hover:bg-lattice-surface/80 transition-colors text-left"
                  >
                    <div className={cn('w-2 h-2 rounded-full', getEventColor(event.type))} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{event.title}</div>
                      {event.time && (
                        <div className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {event.time}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
                {(eventsByDate.get(selectedDate) || []).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-2">
                    No events for this day
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function DayView({
  date: _date,
  events,
  onSelectEvent
}: {
  date: Date;
  events: CalendarEvent[];
  onSelectEvent?: (event: CalendarEvent) => void;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const eventsByHour = useMemo(() => {
    const map = new Map<number, CalendarEvent[]>();
    events.forEach(event => {
      if (event.time) {
        const hour = parseInt(event.time.split(':')[0]);
        const existing = map.get(hour) || [];
        map.set(hour, [...existing, event]);
      }
    });
    return map;
  }, [events]);

  return (
    <div className="h-full overflow-y-auto">
      {hours.map(hour => (
        <div
          key={hour}
          className="flex border-b border-lattice-border/50 min-h-[60px]"
        >
          <div className="w-16 py-2 px-2 text-xs text-gray-500 flex-shrink-0">
            {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
          </div>
          <div className="flex-1 py-1 px-2 space-y-1">
            {(eventsByHour.get(hour) || []).map(event => (
              <button
                key={event.id}
                onClick={() => onSelectEvent?.(event)}
                className="w-full text-left px-2 py-1 text-sm bg-neon-cyan/20 border-l-2 border-neon-cyan rounded text-white hover:bg-neon-cyan/30 transition-colors"
              >
                {event.title}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
