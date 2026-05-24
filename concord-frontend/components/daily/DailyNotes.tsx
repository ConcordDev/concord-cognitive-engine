'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Sunrise,
  Edit,
  Plus,
  BookOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface DailyNote {
  date: string;
  dtu: {
    id: string;
    title: string;
    content: string;
  };
}

interface DailyNotesProps {
  notes: DailyNote[];
  currentNote?: DailyNote;
  onSelectDate?: (date: string) => void;
  onEditNote?: (dtuId: string) => void;
  className?: string;
}

export function DailyNotes({
  notes,
  currentNote,
  onSelectDate,
  onEditNote,
  className
}: DailyNotesProps) {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [viewMonth, setViewMonth] = useState(new Date());

  const today = new Date().toISOString().split('T')[0];

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    onSelectDate?.(date);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days = [];

    // Add padding for first week
    for (let i = 0; i < firstDay.getDay(); i++) {
      days.push(null);
    }

    // Add days
    for (let i = 1; i <= lastDay.getDate(); i++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const hasNote = notes.some(n => n.date === dateStr);
      days.push({ day: i, date: dateStr, hasNote });
    }

    return days;
  };

  const days = getDaysInMonth(viewMonth);
  const noteDates = new Set(notes.map(n => n.date));

  const prevMonth = () => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1));
  };

  const getTimeOfDay = () => {
    const hour = new Date().getHours();
    if (hour < 12) return { icon: Sunrise, label: 'Good morning' };
    if (hour < 18) return { icon: Sun, label: 'Good afternoon' };
    return { icon: Moon, label: 'Good evening' };
  };

  const timeOfDay = getTimeOfDay();
  const TimeIcon = timeOfDay.icon;

  return (
    <div className={cn('flex h-full', className)}>
      {/* Sidebar - Calendar */}
      <div className="w-72 border-r border-lattice-border bg-lattice-surface/50 flex flex-col">
        {/* Month navigation */}
        <div className="px-4 py-3 border-b border-lattice-border">
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={prevMonth}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            aria-label="Previous">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="font-medium text-white">
              {viewMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button
              onClick={nextMonth}
              className="p-1 text-gray-400 hover:text-white transition-colors"
            aria-label="Next">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-gray-400 mb-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
              <div key={day}>{day}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, i) => (
              <button
                key={i}
                onClick={() => day && handleDateSelect(day.date)}
                disabled={!day}
                className={cn(
                  'aspect-square flex items-center justify-center text-sm rounded transition-colors relative',
                  !day && 'invisible',
                  day?.date === selectedDate && 'bg-neon-cyan text-black font-medium',
                  day?.date === today && day?.date !== selectedDate && 'ring-1 ring-neon-cyan/50',
                  day?.date !== selectedDate && 'text-gray-400 hover:bg-lattice-surface hover:text-white'
                )}
              >
                {day?.day}
                {noteDates.has(day?.date ?? '') && day?.date !== selectedDate && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-cyan" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Recent notes list */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-2 text-xs text-gray-400 uppercase tracking-wider">
            Recent Notes
          </div>
          {notes.slice(0, 10).map(note => (
            <button
              key={note.date}
              onClick={() => handleDateSelect(note.date)}
              className={cn(
                'w-full px-4 py-2 text-left hover:bg-lattice-surface transition-colors',
                selectedDate === note.date && 'bg-neon-cyan/10 border-l-2 border-neon-cyan'
              )}
            >
              <div className="text-sm text-white">{note.date}</div>
              <div className="text-xs text-gray-400 truncate">
                {note.dtu.title}
              </div>
            </button>
          ))}
        </div>

        {/* Today button */}
        <div className="p-4 border-t border-lattice-border">
          <button
            onClick={() => handleDateSelect(today)}
            className="w-full py-2 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors flex items-center justify-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            Go to Today
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-lattice-border">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-gray-400 text-sm mb-1">
                <TimeIcon className="w-4 h-4" />
                {timeOfDay.label}
              </div>
              <h1 className="text-2xl font-bold text-white">
                {formatDate(selectedDate)}
              </h1>
            </div>

            {currentNote && (
              <button
                onClick={() => onEditNote?.(currentNote.dtu.id)}
                className="flex items-center gap-2 px-4 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-white hover:border-neon-cyan transition-colors"
              >
                <Edit className="w-4 h-4" />
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Note content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {currentNote ? (
              <motion.div
                key={currentNote.date}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="prose prose-invert max-w-none">
                  {/* Safe rendering without dangerouslySetInnerHTML to prevent XSS */}
                  <div className="text-gray-300 whitespace-pre-wrap">
                    {currentNote.dtu.content
                      .replace(/^# .+\n/, '')
                      .split('\n')
                      .map((line, i) => {
                        const headerMatch = line.match(/^## (.+)$/);
                        if (headerMatch) {
                          return <h2 key={i} className="text-lg font-semibold text-white mt-6 mb-2">{headerMatch[1]}</h2>;
                        }
                        return <p key={i} className="mb-1">{line || '\u00A0'}</p>;
                      })}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center h-full text-center"
              >
                <BookOpen className="w-16 h-16 text-gray-600 mb-4" />
                <h2 className="text-xl font-semibold text-white mb-2">
                  No note for this day
                </h2>
                <p className="text-gray-400 mb-4">
                  Start writing to capture your thoughts
                </p>
                <button
                  onClick={() => onSelectDate?.(selectedDate)}
                  className="flex items-center gap-2 px-4 py-2 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create Note
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
