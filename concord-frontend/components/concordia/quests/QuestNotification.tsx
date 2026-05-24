'use client';

import { useEffect, useState } from 'react';
import type { Quest } from '@/lib/concordia/quest-system';

interface QuestNotificationProps {
  quest: Quest;
  type: 'new' | 'completed' | 'failed';
  onDismiss: () => void;
}

export function QuestNotification({ quest, type, onDismiss }: QuestNotificationProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); setTimeout(onDismiss, 300); }, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const styles = {
    new:       { border: 'border-cyan-500/40',  label: '✦ New Quest',   labelColor: 'text-cyan-400' },
    completed: { border: 'border-green-500/40', label: '✓ Quest Complete', labelColor: 'text-green-400' },
    failed:    { border: 'border-red-500/30',   label: '✗ Quest Failed',  labelColor: 'text-red-400' },
  }[type];

  return (
    <div
      className={`transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}
    >
      <div className={`bg-black/90 border ${styles.border} rounded-lg px-4 py-3 w-72 backdrop-blur-sm`}>
        <div className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${styles.labelColor}`}>
          {styles.label}
        </div>
        <div className="text-xs text-gray-200 font-medium">{quest.title}</div>
        {type === 'new' && (
          <div className="text-[10px] text-gray-400 mt-0.5">{quest.giverName}</div>
        )}
        {type === 'completed' && (
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            <span className="text-yellow-400">+{quest.reward.cc} CC</span>
            <span className="text-cyan-400">+{quest.reward.xp} XP</span>
            {quest.reward.perkPoint && <span className="text-amber-400">★ Perk!</span>}
          </div>
        )}
      </div>
    </div>
  );
}
