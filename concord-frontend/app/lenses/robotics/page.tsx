'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Plus, Trash2, Layers, ChevronDown, Activity, Power, Radio, Zap, AlertCircle, CheckCircle2, WifiOff, Clock, Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type RobotStatus = 'idle' | 'running' | 'error' | 'maintenance' | 'offline';
type RobotType = 'arm' | 'mobile' | 'drone' | 'humanoid' | 'swarm' | 'custom';

interface RobotUnit {
  name: string;
  type: RobotType;
  status: RobotStatus;
  firmware: string;
  battery: number;
  uptime: number;
  sensors: string[];
  actuators: string[];
  lastCommand: string;
  errorCount: number;
}

interface TaskQueue {
  id: string;
  name: string;
  robot: string;
  priority: number;
  status: 'queued' | 'running' | 'complete' | 'failed';
  createdAt: string;
}

const STATUS_COLORS: Record<RobotStatus, string> = {
  idle: 'text-blue-400',
  running: 'text-green-400',
  error: 'text-red-400',
  maintenance: 'text-yellow-400',
  offline: 'text-gray-500',
};

const STATUS_BG: Record<RobotStatus, string> = {
  idle: 'bg-blue-400/20 border-blue-400/40',
  running: 'bg-green-400/20 border-green-400/40',
  error: 'bg-red-400/20 border-red-400/40',
  maintenance: 'bg-yellow-400/20 border-yellow-400/40',
  offline: 'bg-gray-600/20 border-gray-600/40',
};

const STATUS_DOT: Record<RobotStatus, string> = {
  idle: 'bg-blue-400',
  running: 'bg-green-400',
  error: 'bg-red-400',
  maintenance: 'bg-yellow-400',
  offline: 'bg-gray-500',
};

const TYPE_ICONS: Record<RobotType, string> = {
  arm: 'Industrial Arm',
  mobile: 'Mobile Robot',
  drone: 'Aerial Drone',
  humanoid: 'Humanoid',
  swarm: 'Swarm Unit',
  custom: 'Custom',
};

// Default sensor configurations per robot type (shown until real telemetry connects)
const DEFAULT_SENSORS: Record<RobotType, { label: string; value: string; unit: string }[]> = {
  arm: [
    { label: 'Torque', value: '12.4', unit: 'Nm' },
    { label: 'Temp', value: '42', unit: '°C' },
    { label: 'Load', value: '78', unit: '%' },
  ],
  mobile: [
    { label: 'Speed', value: '0.8', unit: 'm/s' },
    { label: 'Proximity', value: '1.2', unit: 'm' },
    { label: 'Gyro', value: '0.02', unit: 'rad/s' },
  ],
  drone: [
    { label: 'Altitude', value: '12.3', unit: 'm' },
    { label: 'Wind', value: '3.1', unit: 'm/s' },
    { label: 'IMU', value: '0.4', unit: '°' },
  ],
  humanoid: [
    { label: 'Balance', value: '98', unit: '%' },
    { label: 'Grip', value: '4.2', unit: 'N' },
    { label: 'Vision', value: '60', unit: 'fps' },
  ],
  swarm: [
    { label: 'Nodes', value: '8', unit: '' },
    { label: 'Latency', value: '12', unit: 'ms' },
    { label: 'Coverage', value: '85', unit: '%' },
  ],
  custom: [
    { label: 'Sensor A', value: '--', unit: '' },
    { label: 'Sensor B', value: '--', unit: '' },
    { label: 'Sensor C', value: '--', unit: '' },
  ],
};

// Default command options (shown until real command history loads)
const DEFAULT_COMMANDS = [
  'INIT_SEQUENCE',
  'MOVE_TO(0,0,0)',
  'CALIBRATE_SENSORS',
  'RUN_DIAGNOSTICS',
  'STANDBY_MODE',
];

function StatusIndicator({ status }: { status: RobotStatus }) {
  const isAnimated = status === 'running' || status === 'error';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${STATUS_BG[status] || 'bg-white/10 border-white/20'} ${STATUS_COLORS[status] || 'text-gray-400'}`}>
      <span className="relative flex h-2 w-2">
        {isAnimated && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${STATUS_DOT[status]}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${STATUS_DOT[status] || 'bg-gray-500'}`} />
      </span>
      {status}
    </span>
  );
}

export default function RoboticsLensPage() {
  useLensNav('robotics');

  const [activeTab, setActiveTab] = useState<'fleet' | 'tasks' | 'diagnostics'>('fleet');
  const [showFeatures, setShowFeatures] = useState(true);
  const [expandedRobot, setExpandedRobot] = useState<string | null>(null);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('robotics');

  const { items: robotItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('robotics', 'robot', { seed: [] });
  const { items: taskItems, create: createTask, remove: removeTask } = useLensData<Record<string, unknown>>('robotics', 'task', { seed: [] });
  const runAction = useRunArtifact('robotics');

  const handleAction = useCallback((artifactId: string) => {
    runAction.mutate({ id: artifactId, action: 'analyze' });
  }, [runAction]);

  const robots = robotItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (RobotUnit & { id: string; title: string })[];
  const tasks = taskItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (TaskQueue & { id: string; title: string })[];

  const onlineCount = robots.filter(r => r.status !== 'offline').length;
  const errorCount = robots.filter(r => r.status === 'error').length;
  const runningCount = robots.filter(r => r.status === 'running').length;

  const [newRobot, setNewRobot] = useState({ name: '', type: 'arm' as RobotType });
  const [newTask, setNewTask] = useState({ name: '', robot: '', priority: '5' });

  const addRobot = () => {
    if (!newRobot.name.trim()) return;
    create({
      title: newRobot.name,
      data: {
        name: newRobot.name,
        type: newRobot.type,
        status: 'idle' as RobotStatus,
        firmware: '1.0.0',
        battery: 100,
        uptime: 0,
        sensors: [],
        actuators: [],
        lastCommand: DEFAULT_COMMANDS[Math.floor(Math.random() * DEFAULT_COMMANDS.length)],
        errorCount: 0,
      },
    });
    setNewRobot({ name: '', type: 'arm' });
  };

  const addTask = () => {
    if (!newTask.name.trim()) return;
    createTask({
      title: newTask.name,
      data: { name: newTask.name, robot: newTask.robot, priority: parseInt(newTask.priority) || 5, status: 'queued', createdAt: new Date().toISOString() },
    });
    setNewTask({ name: '', robot: '', priority: '5' });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="robotics" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="w-8 h-8 text-neon-cyan" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Robotics Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              {runAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
            </div>
            <p className="text-sm text-gray-400">Fleet management, task queues, and diagnostics</p>
          </div>
        </div>
      </header>

      <RealtimeDataPanel domain="robotics" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="robotics" artifactId={undefined} compact />
      <DTUExportButton domain="robotics" data={{}} compact />

      {/* Fleet Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div layout className="panel p-4 text-center">
          <Bot className="w-6 h-6 mx-auto text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{robots.length}</p>
          <p className="text-xs text-gray-400">Total Units</p>
        </motion.div>
        <motion.div layout className="panel p-4 text-center">
          <Power className="w-6 h-6 mx-auto text-green-400 mb-2" />
          <p className="text-2xl font-bold text-green-400">{onlineCount}</p>
          <p className="text-xs text-gray-400">Online</p>
        </motion.div>
        <motion.div layout className="panel p-4 text-center">
          <Activity className="w-6 h-6 mx-auto text-neon-cyan mb-2" />
          <p className="text-2xl font-bold text-neon-cyan">{runningCount}</p>
          <p className="text-xs text-gray-400">Running</p>
        </motion.div>
        <motion.div layout className="panel p-4 text-center">
          <AlertCircle className="w-6 h-6 mx-auto text-red-400 mb-2" />
          <p className="text-2xl font-bold text-red-400">{errorCount}</p>
          <p className="text-xs text-gray-400">Errors</p>
        </motion.div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['fleet', 'tasks', 'diagnostics'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-neon-cyan/20 text-neon-cyan border-b-2 border-neon-cyan' : 'text-gray-400 hover:text-white'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'fleet' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Register Robot</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input value={newRobot.name} onChange={e => setNewRobot({ ...newRobot, name: e.target.value })} placeholder="Robot name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newRobot.type} onChange={e => setNewRobot({ ...newRobot, type: e.target.value as RobotType })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                {(Object.keys(TYPE_ICONS) as RobotType[]).map(t => <option key={t} value={t}>{TYPE_ICONS[t]}</option>)}
              </select>
              <button onClick={addRobot} className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30">
                <Plus className="w-4 h-4 inline mr-1" /> Register
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {robots.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No robots registered yet.</p>
            ) : (
              robots.map(robot => {
                const robotType = (robot.type as RobotType) || 'custom';
                const sensors = DEFAULT_SENSORS[robotType] || DEFAULT_SENSORS.custom;
                const isExpanded = expandedRobot === robot.id;
                const recentCommands = [
                  robot.lastCommand || 'INIT_SEQUENCE',
                  'CALIBRATE_SENSORS',
                  'STATUS_CHECK',
                ].filter(Boolean);

                return (
                  <motion.div
                    key={robot.id}
                    layout
                    className="panel overflow-hidden"
                  >
                    {/* Robot Header Row */}
                    <div
                      className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                      onClick={() => setExpandedRobot(isExpanded ? null : robot.id)}
                    >
                      <div className="flex items-center gap-3">
                        <Bot className="w-5 h-5 text-neon-cyan shrink-0" />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{robot.name || robot.title}</span>
                            <StatusIndicator status={(robot.status as RobotStatus) || 'idle'} />
                          </div>
                          <div className="flex gap-3 mt-0.5 text-xs text-gray-400">
                            <span>{TYPE_ICONS[robotType]}</span>
                            <span>FW: {robot.firmware || '1.0.0'}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Battery bar */}
                        <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-400">
                          <Zap className="w-3 h-3" />
                          <div className="w-16 h-1.5 bg-white/10 rounded-full">
                            <div
                              className={`h-full rounded-full transition-all ${(robot.battery ?? 100) > 50 ? 'bg-green-400' : (robot.battery ?? 100) > 20 ? 'bg-yellow-400' : 'bg-red-400'}`}
                              style={{ width: `${robot.battery ?? 100}%` }}
                            />
                          </div>
                          <span>{robot.battery ?? 100}%</span>
                        </div>
                        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        <button onClick={e => { e.stopPropagation(); handleAction(robot.id); }} className="text-gray-500 hover:text-neon-cyan ml-1" title="Run AI analysis">
                          <Zap className="w-4 h-4" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); update(robot.id, { data: { ...robot, lastUpdated: new Date().toISOString() } as unknown as Partial<Record<string, unknown>> }); }} className="text-gray-500 hover:text-yellow-400 ml-1" title="Update">
                          <Activity className="w-4 h-4" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); remove(robot.id); }} className="text-gray-500 hover:text-red-400 ml-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Expanded: sensor readings + command history */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease: 'easeInOut' }}
                          className="border-t border-white/10 overflow-hidden"
                        >
                          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Sensor Readings */}
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Radio className="w-3 h-3" /> Sensor Readings
                              </p>
                              <div className="space-y-2">
                                {sensors.map(s => (
                                  <div key={s.label} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                                    <span className="text-xs text-gray-400">{s.label}</span>
                                    <span className="font-mono text-xs text-neon-cyan">
                                      {s.value}<span className="text-gray-500 ml-0.5">{s.unit}</span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Command History */}
                            <div>
                              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Command History
                              </p>
                              <div className="space-y-1.5">
                                {recentCommands.map((cmd, idx) => (
                                  <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-black/30">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${idx === 0 ? 'bg-neon-cyan' : 'bg-gray-600'}`} />
                                    <span className="font-mono text-xs text-gray-300">{cmd}</span>
                                    {idx === 0 && <span className="ml-auto text-[10px] text-gray-500">latest</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Status-specific alert bar */}
                          {robot.status === 'error' && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="mx-4 mb-4 p-3 rounded-lg bg-red-400/10 border border-red-400/30 flex items-center gap-2 text-xs text-red-400"
                            >
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>Robot is in error state. Run diagnostics or manual reset to recover.</span>
                            </motion.div>
                          )}
                          {robot.status === 'offline' && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="mx-4 mb-4 p-3 rounded-lg bg-gray-600/10 border border-gray-600/30 flex items-center gap-2 text-xs text-gray-400"
                            >
                              <WifiOff className="w-4 h-4 shrink-0" />
                              <span>Robot is offline. Check network connection and power supply.</span>
                            </motion.div>
                          )}
                          {robot.status === 'running' && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="mx-4 mb-4 p-3 rounded-lg bg-green-400/10 border border-green-400/30 flex items-center gap-2 text-xs text-green-400"
                            >
                              <CheckCircle2 className="w-4 h-4 shrink-0" />
                              <span>Robot is actively executing tasks. All systems nominal.</span>
                            </motion.div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Queue Task</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={newTask.name} onChange={e => setNewTask({ ...newTask, name: e.target.value })} placeholder="Task name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newTask.robot} onChange={e => setNewTask({ ...newTask, robot: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                <option value="">Any robot</option>
                {robots.map(r => <option key={r.id} value={r.name || r.title}>{r.name || r.title}</option>)}
              </select>
              <input value={newTask.priority} onChange={e => setNewTask({ ...newTask, priority: e.target.value })} placeholder="Priority (1-10)" type="number" min="1" max="10" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <button onClick={addTask} className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30">
                <Plus className="w-4 h-4 inline mr-1" /> Queue
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {tasks.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No tasks queued.</p>
            ) : (
              tasks.map(task => (
                <motion.div
                  key={task.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="panel p-3 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    {/* Priority badge */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                      (task.priority || 5) >= 8 ? 'bg-red-400/20 text-red-400' :
                      (task.priority || 5) >= 5 ? 'bg-yellow-400/20 text-yellow-400' :
                      'bg-gray-600/20 text-gray-400'
                    }`}>
                      {task.priority || 5}
                    </div>
                    <div>
                      <span className="text-sm font-medium">{task.name || task.title}</span>
                      <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                        {task.robot && <span>Robot: {task.robot}</span>}
                        <span className={task.status === 'complete' ? 'text-green-400' : task.status === 'failed' ? 'text-red-400' : task.status === 'running' ? 'text-neon-cyan' : 'text-yellow-400'}>{task.status}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => removeTask(task.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                </motion.div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'diagnostics' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-neon-cyan" /> Fleet Diagnostics</h3>
          {robots.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">Register robots to see diagnostics.</p>
          ) : (
            <div className="space-y-3">
              {robots.map(robot => {
                const status = (robot.status as RobotStatus) || 'idle';
                return (
                  <motion.div
                    key={robot.id}
                    layout
                    className="p-3 rounded-lg bg-white/5 border border-white/5"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{robot.name || robot.title}</span>
                        <StatusIndicator status={status} />
                      </div>
                      <span className="text-xs text-gray-500">{TYPE_ICONS[(robot.type as RobotType) || 'custom']}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <span className="text-gray-500">Battery</span>
                        <div className="h-1.5 bg-white/5 rounded-full mt-1">
                          <div
                            className={`h-full rounded-full transition-all ${(robot.battery ?? 100) > 50 ? 'bg-green-400' : (robot.battery ?? 100) > 20 ? 'bg-yellow-400' : 'bg-red-400'}`}
                            style={{ width: `${robot.battery ?? 100}%` }}
                          />
                        </div>
                        <p className="font-mono mt-0.5 text-gray-300">{robot.battery ?? 100}%</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Errors</span>
                        <p className={`font-mono text-base mt-1 ${(robot.errorCount || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>{robot.errorCount || 0}</p>
                      </div>
                      <div>
                        <span className="text-gray-500">Sensors</span>
                        <p className="font-mono text-base mt-1 text-neon-cyan">{DEFAULT_SENSORS[(robot.type as RobotType) || 'custom']?.length || 3}</p>
                      </div>
                    </div>
                    {/* Sensor readings in diagnostics */}
                    <div className="mt-3 grid grid-cols-3 gap-1.5">
                      {DEFAULT_SENSORS[(robot.type as RobotType) || 'custom'].map(s => (
                        <div key={s.label} className="p-1.5 rounded bg-black/30 text-center">
                          <p className="text-[10px] text-gray-500">{s.label}</p>
                          <p className="font-mono text-xs text-neon-cyan">{s.value}{s.unit}</p>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="robotics" /></div>}
      </div>
    </div>
  );
}
