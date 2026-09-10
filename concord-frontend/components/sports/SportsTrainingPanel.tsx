'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Clock, Plus, Target } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { EmptyState, ErrorState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

interface TrainingLog {
  name: string;
  type: string;
  duration: number;
  intensity: 'light' | 'moderate' | 'intense';
  date: string;
  notes: string;
}

const INTENSITY_COLORS: Record<string, string> = {
  light: 'text-green-400 bg-green-400/10',
  moderate: 'text-yellow-400 bg-yellow-400/10',
  intense: 'text-red-400 bg-red-400/10',
};

const EMPTY = {
  name: '',
  type: '',
  duration: 60,
  intensity: 'moderate' as TrainingLog['intensity'],
  date: '',
  notes: '',
};

export function SportsTrainingPanel() {
  const reduceMotion = useReducedMotion();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const { items, isLoading, isError, error, refetch, create, createMut } =
    useLensData<TrainingLog>('sports', 'TrainingLog', { seed: [] });

  const handleAdd = useCallback(async () => {
    if (!form.name.trim()) return;
    const date = form.date || new Date().toISOString().slice(0, 10);
    await create({
      title: form.name,
      data: { ...form, date },
    });
    setForm(EMPTY);
    setShowAdd(false);
  }, [form, create]);

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8" role="alert">
        <ErrorState message={error?.message || 'Could not load training log'} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
          <Target className="w-4 h-4" style={{ color: 'var(--lens-accent)' }} />
          Training log
        </h3>
        <button type="button" onClick={() => setShowAdd((v) => !v)} className={ds.btnSecondary}>
          <Plus className="w-3 h-3" /> Log session
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={cn(ds.panel, 'space-y-3')}>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Session name"
                  className={ds.input}
                />
                <input
                  value={form.type}
                  onChange={(e) => setForm((p) => ({ ...p, type: e.target.value }))}
                  placeholder="Type (cardio, drills…)"
                  className={ds.input}
                />
                <input
                  type="number"
                  value={form.duration}
                  onChange={(e) => setForm((p) => ({ ...p, duration: Number(e.target.value) }))}
                  placeholder="Duration (min)"
                  className={ds.input}
                />
                <select
                  value={form.intensity}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      intensity: e.target.value as TrainingLog['intensity'],
                    }))
                  }
                  className={ds.select}
                >
                  <option value="light">Light</option>
                  <option value="moderate">Moderate</option>
                  <option value="intense">Intense</option>
                </select>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                  className={ds.input}
                />
              </div>
              <button
                type="button"
                onClick={handleAdd}
                disabled={createMut.isPending || !form.name.trim()}
                className={ds.btnPrimary}
              >
                {createMut.isPending ? 'Saving…' : 'Log training'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className={cn(ds.panel, 'text-center text-gray-400')} role="status">
          Loading sessions…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Target className="w-10 h-10" />}
          title="No sessions logged"
          description="Persist a training session — this is stored as a sports artifact, not a local list."
        />
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const log = item.data;
            return (
              <div key={item.id} className={cn(ds.panel, 'py-3 flex items-center justify-between')}>
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={cn(
                      'w-1.5 h-8 rounded-full',
                      log.intensity === 'intense'
                        ? 'bg-red-400'
                        : log.intensity === 'moderate'
                          ? 'bg-yellow-400'
                          : 'bg-green-400',
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{item.title || log.name}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {log.type && <span>{log.type}</span>}
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" />
                        {log.duration}m
                      </span>
                      <span className={cn('px-1.5 py-0.5 rounded', INTENSITY_COLORS[log.intensity])}>
                        {log.intensity}
                      </span>
                    </div>
                  </div>
                </div>
                <span className="text-xs text-gray-400 font-mono">{log.date}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
