'use client';

import React from 'react';
import {
  Building2, Droplets, Zap, Leaf, Box, ChevronRight, CheckCircle2,
  AlertTriangle, XCircle, Quote, Shield, Thermometer,
  Wind, Activity, Flame,
} from 'lucide-react';
import type {
  PlacedBuildingDTU, InfrastructureDTU, ValidationReport,
  Citation, MaterialDTU, TerrainCell,
} from '@/lib/world-lens/types';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

interface InspectorPanelProps {
  selectedBuilding: PlacedBuildingDTU | null;
  selectedInfra: InfrastructureDTU | null;
  selectedTerrain: TerrainCell | null;
  validationReport: ValidationReport | null;
  citations: Citation[];
  materials: MaterialDTU[];
  onClose: () => void;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    validated: 'bg-green-500/20 text-green-400 border-green-500/40',
    experimental: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    superseded: 'bg-gray-500/20 text-gray-400 border-gray-500/40',
    foundation: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
    'at-risk': 'bg-red-500/20 text-red-400 border-red-500/40',
  };
  return (
    <span className={`px-2 py-0.5 text-[10px] rounded border ${colors[status] || colors.experimental}`}>
      {status}
    </span>
  );
}

function ValidationBar({ label, pass, icon: Icon, detail }: {
  label: string;
  pass: boolean;
  icon: React.ComponentType<{ className?: string }>;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/5 last:border-0">
      <Icon className={`w-4 h-4 ${pass ? 'text-green-400' : 'text-red-400'}`} />
      <span className="text-xs flex-1">{label}</span>
      {pass ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
      ) : (
        <XCircle className="w-3.5 h-3.5 text-red-400" />
      )}
      {detail && <span className="text-[10px] text-gray-400">{detail}</span>}
    </div>
  );
}

export default function InspectorPanel({
  selectedBuilding,
  selectedInfra,
  selectedTerrain,
  validationReport,
  citations,
  materials: _materials,
  onClose,
}: InspectorPanelProps) {
  const hasSelection = selectedBuilding || selectedInfra || selectedTerrain;

  if (!hasSelection) {
    return (
      <div className={`w-72 flex-shrink-0 ${panel} p-4`}>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">Inspector</h3>
        <p className="text-xs text-gray-400">Click any element in the district to inspect it.</p>
      </div>
    );
  }

  return (
    <div className={`w-72 flex-shrink-0 ${panel} p-4 space-y-4 overflow-y-auto`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Inspector</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-xs">Close</button>
      </div>

      {/* Building Inspector */}
      {selectedBuilding && (
        <>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="w-5 h-5 text-cyan-400" />
              <div>
                <p className="text-sm font-medium text-white">{selectedBuilding.dtuId}</p>
                <p className="text-[10px] text-gray-400">by {selectedBuilding.creator}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={selectedBuilding.validationStatus} />
              <span className="text-[10px] text-gray-400">
                Placed {selectedBuilding.placedAt}
              </span>
            </div>
          </div>

          {/* Validation Report */}
          {validationReport && (
            <div>
              <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" />
                Validation Report
              </h4>
              <div className="space-y-0">
                <ValidationBar
                  label="Load Bearing"
                  pass={validationReport.categories.loadBearing.pass}
                  icon={Building2}
                />
                <ValidationBar
                  label="Wind Shear"
                  pass={validationReport.categories.windShear.pass}
                  icon={Wind}
                  detail={`${validationReport.categories.windShear.maxWindSurvived.toFixed(0)} m/s`}
                />
                <ValidationBar
                  label="Seismic"
                  pass={validationReport.categories.seismic.pass}
                  icon={Activity}
                  detail={`M${validationReport.categories.seismic.maxMagnitude.toFixed(1)}`}
                />
                <ValidationBar
                  label="Thermal"
                  pass={validationReport.categories.thermal.pass}
                  icon={Thermometer}
                  detail={`${validationReport.categories.thermal.tempRange.min}°–${validationReport.categories.thermal.tempRange.max}°C`}
                />
                <ValidationBar
                  label="Fire Resistance"
                  pass={validationReport.categories.fire.pass}
                  icon={Flame}
                  detail={`${validationReport.categories.fire.resistanceHours}h`}
                />
              </div>

              {/* Habitability Score */}
              <div className="mt-3 p-2 rounded bg-white/5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-400">Habitability</span>
                  <span className="text-sm font-bold text-cyan-300">
                    {validationReport.categories.habitability.score}/100
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-300"
                    style={{ width: `${validationReport.categories.habitability.score}%` }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[10px] text-gray-400">
                  {Object.entries(validationReport.categories.habitability.factors).map(([key, val]) => (
                    <div key={key} className="flex justify-between">
                      <span>{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span className="text-gray-400">{(val as number).toFixed(0)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Failure Points */}
              {validationReport.failurePoints.length > 0 && (
                <div className="mt-3">
                  <h5 className="text-xs text-red-400 font-semibold mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Failure Points ({validationReport.failurePoints.length})
                  </h5>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {validationReport.failurePoints.map((fp, i) => (
                      <div key={i} className="p-2 rounded bg-red-500/10 border border-red-500/20 text-[10px]">
                        <p className="text-red-300 font-medium">{fp.memberType} {fp.memberId}</p>
                        <p className="text-red-400/70">{fp.failureMode}</p>
                        <p className="text-gray-400 mt-0.5">{fp.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Infrastructure Inspector */}
      {selectedInfra && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            {selectedInfra.type === 'water' && <Droplets className="w-5 h-5 text-blue-400" />}
            {selectedInfra.type === 'power' && <Zap className="w-5 h-5 text-yellow-400" />}
            {selectedInfra.type === 'drainage' && <Leaf className="w-5 h-5 text-green-400" />}
            {selectedInfra.type === 'road' && <Box className="w-5 h-5 text-gray-400" />}
            {selectedInfra.type === 'data' && <Activity className="w-5 h-5 text-purple-400" />}
            <div>
              <p className="text-sm font-medium text-white capitalize">{selectedInfra.type} Network</p>
              <p className="text-[10px] text-gray-400">by {selectedInfra.creator}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-white/5">
              <p className="text-gray-400">Capacity</p>
              <p className="font-medium text-white">{selectedInfra.capacity.toLocaleString()}</p>
            </div>
            <div className="p-2 rounded bg-white/5">
              <p className="text-gray-400">Citations</p>
              <p className="font-medium text-white">{selectedInfra.citations}</p>
            </div>
            <div className="p-2 rounded bg-white/5 col-span-2">
              <p className="text-gray-400">Nodes</p>
              <p className="font-medium text-white">{selectedInfra.path.length} connection points</p>
            </div>
          </div>
        </div>
      )}

      {/* Terrain Inspector */}
      {selectedTerrain && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Box className="w-5 h-5 text-amber-400" />
            <p className="text-sm font-medium text-white">Terrain</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-white/5">
              <p className="text-gray-400">Soil Type</p>
              <p className="font-medium text-white capitalize">{selectedTerrain.soilType}</p>
            </div>
            <div className="p-2 rounded bg-white/5">
              <p className="text-gray-400">Elevation</p>
              <p className="font-medium text-white">{selectedTerrain.elevation.toFixed(1)}m</p>
            </div>
            <div className="p-2 rounded bg-white/5">
              <p className="text-gray-400">Bedrock</p>
              <p className="font-medium text-white">{selectedTerrain.bedrockDepth.toFixed(1)}m</p>
            </div>
            <div className="p-2 rounded bg-white/5">
              <p className="text-gray-400">Water Table</p>
              <p className="font-medium text-white">{selectedTerrain.waterTableDepth.toFixed(1)}m</p>
            </div>
            <div className="p-2 rounded bg-white/5 col-span-2">
              <p className="text-gray-400">Seismic Zone</p>
              <p className="font-medium text-white">Zone {selectedTerrain.seismicZone}</p>
            </div>
          </div>
        </div>
      )}

      {/* Citation Tree */}
      {citations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1">
            <Quote className="w-3.5 h-3.5" />
            Citations ({citations.length})
          </h4>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {citations.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-white/5">
                <ChevronRight className="w-3 h-3 text-gray-600" />
                <span className="text-gray-400">{c.context}</span>
                <span className="text-cyan-400">by {c.citedCreator}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
