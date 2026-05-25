'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BellOff,
  Plus,
  Trash2,
  Clock,
  CheckCircle,
  Repeat
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Reminder {
  id: string;
  title: string;
  dueAt: string;
  dtuId?: string;
  completed: boolean;
  repeat?: 'daily' | 'weekly' | 'monthly' | null;
}

interface ReminderListProps {
  reminders: Reminder[];
  onAdd?: (title: string, dueAt: string, repeat?: string) => void;
  onComplete?: (id: string) => void;
  onDelete?: (id: string) => void;
  onSnooze?: (id: string, minutes: number) => void;
  className?: string;
}

export function ReminderList({
  reminders,
  onAdd,
  onComplete,
  onDelete,
  onSnooze,
  className
}: ReminderListProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDueAt, setNewDueAt] = useState('');
  const [newRepeat, setNewRepeat] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');

  const now = new Date();

  const handleAdd = () => {
    if (newTitle.trim() && newDueAt && onAdd) {
      onAdd(newTitle.trim(), newDueAt, newRepeat || undefined);
      setNewTitle('');
      setNewDueAt('');
      setNewRepeat('');
      setShowAddForm(false);
    }
  };

  const formatDueAt = (dateStr: string) => {
    const date = new Date(dateStr);
    const diff = date.getTime() - now.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (diff < 0) {
      if (minutes > -60) return `${Math.abs(minutes)}m overdue`;
      if (hours > -24) return `${Math.abs(hours)}h overdue`;
      return `${Math.abs(days)}d overdue`;
    }

    if (minutes < 60) return `in ${minutes}m`;
    if (hours < 24) return `in ${hours}h`;
    if (days < 7) return `in ${days}d`;
    return date.toLocaleDateString();
  };

  const isOverdue = (dateStr: string) => {
    return new Date(dateStr) < now;
  };

  const filteredReminders = reminders.filter(r => {
    if (filter === 'pending') return !r.completed;
    if (filter === 'completed') return r.completed;
    return true;
  }).sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());

  const pendingCount = reminders.filter(r => !r.completed).length;
  const overdueCount = reminders.filter(r => !r.completed && isOverdue(r.dueAt)).length;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-yellow-400" />
            <span className="font-medium text-white">Reminders</span>
            {overdueCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs bg-red-500/20 text-red-400 rounded">
                {overdueCount} overdue
              </span>
            )}
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
          aria-label="Add">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-1">
          {[
            { id: 'pending', label: `Pending (${pendingCount})` },
            { id: 'completed', label: 'Completed' },
            { id: 'all', label: 'All' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id as typeof filter)}
              className={cn(
                'px-3 py-1 text-xs rounded transition-colors',
                filter === f.id
                  ? 'bg-yellow-400/20 text-yellow-400'
                  : 'text-gray-400 hover:text-white'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-lattice-border overflow-hidden"
          >
            <div className="p-4 space-y-3">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Reminder title..."
                className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400"
                autoFocus
              />
              <div className="flex gap-2">
                <input
                  type="datetime-local"
                  value={newDueAt}
                  onChange={(e) => setNewDueAt(e.target.value)}
                  className="flex-1 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-yellow-400"
                />
                <select
                  value={newRepeat}
                  onChange={(e) => setNewRepeat(e.target.value)}
                  className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-sm text-white focus:outline-none focus:border-yellow-400"
                >
                  <option value="">No repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAdd}
                  disabled={!newTitle.trim() || !newDueAt}
                  className="flex-1 py-2 bg-yellow-400 text-black text-sm font-medium rounded-lg hover:bg-yellow-400/90 transition-colors disabled:opacity-50"
                >
                  Add Reminder
                </button>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewTitle('');
                    setNewDueAt('');
                    setNewRepeat('');
                  }}
                  className="px-4 py-2 bg-lattice-surface border border-lattice-border text-gray-400 text-sm rounded-lg hover:text-white transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reminders list */}
      <div className="flex-1 overflow-y-auto">
        {filteredReminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <BellOff className="w-12 h-12 text-gray-600 mb-4" />
            <p className="text-gray-400">No reminders</p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {filteredReminders.map(reminder => {
              const overdue = !reminder.completed && isOverdue(reminder.dueAt);

              return (
                <motion.div
                  key={reminder.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  className={cn(
                    'p-3 rounded-lg border transition-colors group',
                    reminder.completed
                      ? 'bg-lattice-surface/50 border-lattice-border opacity-60'
                      : overdue
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-lattice-surface border-lattice-border'
                  )}
                >
                  <div className="flex items-start gap-3">
                    {/* Checkbox */}
                    <button
                      onClick={() => onComplete?.(reminder.id)}
                      className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                        reminder.completed
                          ? 'bg-green-400 border-green-400'
                          : 'border-gray-500 hover:border-yellow-400'
                      )}
                    >
                      {reminder.completed && (
                        <CheckCircle className="w-3 h-3 text-black" />
                      )}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-sm',
                        reminder.completed ? 'text-gray-400 line-through' : 'text-white'
                      )}>
                        {reminder.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className={cn(
                          'flex items-center gap-1 text-xs',
                          overdue ? 'text-red-400' : 'text-gray-400'
                        )}>
                          <Clock className="w-3 h-3" />
                          {formatDueAt(reminder.dueAt)}
                        </span>
                        {reminder.repeat && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Repeat className="w-3 h-3" />
                            {reminder.repeat}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {!reminder.completed && onSnooze && (
                        <button
                          onClick={() => onSnooze(reminder.id, 30)}
                          className="p-1 text-gray-400 hover:text-yellow-400 transition-colors"
                          title="Snooze 30min"
                        >
                          <Clock className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onDelete?.(reminder.id)}
                        className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
