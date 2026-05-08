'use client';

import React, { useState } from 'react';
import {
  Save, Check, Loader2, Clock, Cloud, Download, Upload,
  Globe,
  Cpu, Info, ChevronDown, ChevronUp,
} from 'lucide-react';

/* ── Types ─────────────────────────────────────────────────────── */

type SubsystemStatus = 'saved' | 'saving' | 'pending' | 'error';

interface SubsystemSave {
  name: string;
  status: SubsystemStatus;
  lastSaved: string;
}

interface SaveState {
  autoSaving: boolean;
  lastSaveTime: string;
  subsystems: SubsystemSave[];
}

interface OfflineCalculation {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  change?: string;
}

interface PersistenceEntry {
  label: string;
  lastUpdated: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface WorldPersistence {
  entries: PersistenceEntry[];
}

interface SaveSystemProps {
  saveState: SaveState;
  offlineCalcs: OfflineCalculation[] | null;
  worldPersistence: WorldPersistence;
  onManualSave?: () => void;
}

/* ── Constants ─────────────────────────────────────────────────── */

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const STATUS_STYLES: Record<SubsystemStatus, { color: string; label: string }> = {
  saved: { color: 'text-green-400', label: 'Saved' },
  saving: { color: 'text-cyan-400', label: 'Saving...' },
  pending: { color: 'text-yellow-400', label: 'Pending' },
  error: { color: 'text-red-400', label: 'Error' },
};

/* ── Component ─────────────────────────────────────────────────── */

export default function SaveSystem({ saveState, offlineCalcs, worldPersistence, onManualSave }: SaveSystemProps) {
  const [showPersistence, setShowPersistence] = useState(false);
  const [showOffline, setShowOffline] = useState(offlineCalcs !== null);

  return (
    <div className="space-y-4">
      {/* Auto-save indicator */}
      <div className={`${panel} px-4 py-3 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          {saveState.autoSaving ? (
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
          ) : (
            <Check className="w-4 h-4 text-green-400" />
          )}
          <div>
            <p className="text-sm text-white/80">
              {saveState.autoSaving ? 'Saving...' : 'All changes saved'}
            </p>
            <p className="text-[10px] text-white/40">
              Last saved: {saveState.lastSaveTime}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-white/30" />
          {onManualSave && (
            <button
              onClick={onManualSave}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors"
            >
              <Save className="w-3.5 h-3.5" /> Save Now
            </button>
          )}
        </div>
      </div>

      {/* Subsystem save status */}
      <div className={`${panel} p-4 space-y-3`}>
        <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
          <Cpu className="w-4 h-4" /> Save Status by Subsystem
        </h3>
        <div className="space-y-1">
          {saveState.subsystems.map((sub) => {
            const style = STATUS_STYLES[sub.status];
            return (
              <div key={sub.name} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                <span className="text-xs text-white/60">{sub.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-white/30">{sub.lastSaved}</span>
                  <span className={`text-xs font-medium ${style.color}`}>
                    {sub.status === 'saving' && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                    {style.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Offline calculations ("While you were away...") */}
      {offlineCalcs && offlineCalcs.length > 0 && (
        <div className={`${panel} p-4 space-y-3`}>
          <button
            onClick={() => setShowOffline(!showOffline)}
            className="w-full flex items-center justify-between"
          >
            <h3 className="text-sm font-medium text-amber-400 flex items-center gap-2">
              <Clock className="w-4 h-4" /> While you were away...
            </h3>
            {showOffline ? (
              <ChevronUp className="w-4 h-4 text-white/40" />
            ) : (
              <ChevronDown className="w-4 h-4 text-white/40" />
            )}
          </button>

          {showOffline && (
            <div className="grid grid-cols-2 gap-3">
              {offlineCalcs.map((calc) => (
                <div key={calc.label} className="bg-white/5 rounded-md p-3 space-y-1">
                  <div className="flex items-center gap-2 text-white/50">
                    <calc.icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase tracking-wider">{calc.label}</span>
                  </div>
                  <p className="text-lg font-semibold text-white">{calc.value}</p>
                  {calc.change && (
                    <p className="text-[10px] text-green-400">{calc.change}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* World persistence status */}
      <div className={`${panel} p-4 space-y-3`}>
        <button
          onClick={() => setShowPersistence(!showPersistence)}
          className="w-full flex items-center justify-between"
        >
          <h3 className="text-sm font-medium text-white/70 flex items-center gap-2">
            <Globe className="w-4 h-4" /> World Persistence Status
          </h3>
          {showPersistence ? (
            <ChevronUp className="w-4 h-4 text-white/40" />
          ) : (
            <ChevronDown className="w-4 h-4 text-white/40" />
          )}
        </button>

        {showPersistence && (
          <>
            <div className="space-y-1">
              {worldPersistence.entries.map((entry) => (
                <div key={entry.label} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
                  <span className="text-xs text-white/60 flex items-center gap-2">
                    <entry.icon className="w-3.5 h-3.5" /> {entry.label}
                  </span>
                  <span className="text-[10px] text-white/40">{entry.lastUpdated}</span>
                </div>
              ))}
            </div>

            {/* Backup/Restore for owners */}
            {onManualSave && (
              <div className="flex gap-2 pt-2 border-t border-white/10">
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors">
                  <Download className="w-3.5 h-3.5" /> Backup World
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-white/10 text-white/60 hover:text-white hover:border-white/30 transition-colors">
                  <Upload className="w-3.5 h-3.5" /> Restore from Backup
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex items-start gap-2 p-2 rounded bg-white/5">
          <Info className="w-3.5 h-3.5 text-cyan-400 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-white/40">
            Your world is always live. Buildings, NPCs, infrastructure, weather, and economic systems persist and continue operating even when you are offline. Changes made by visitors are recorded in real time.
          </p>
        </div>
      </div>
    </div>
  );
}
