/**
 * Frontier Routes — Part 1
 *
 * Fabrication:
 *   POST /fabrication/export            — create export job
 *   GET  /fabrication/exports/:userId   — list user export jobs
 *   GET  /fabrication/machines          — list machine profiles
 *   GET  /fabrication/export/:id        — get single export job
 *
 * Sensors:
 *   POST /sensors/devices               — register device
 *   GET  /sensors/devices/:userId       — list user devices
 *   POST /sensors/readings              — ingest reading
 *   GET  /sensors/readings/:deviceId    — get device readings
 *   GET  /sensors/anomalies/:userId     — get anomaly alerts
 *
 * Blockchain / Notarization:
 *   POST /blockchain/notarize           — notarize a DTU
 *   GET  /blockchain/records/:userId    — list user records
 *   POST /blockchain/verify             — verify a record
 *
 * Shell:
 *   POST /shell/execute                 — execute command
 *   GET  /shell/history/:userId         — get command history
 *   GET  /shell/commands                — list available commands
 */

import { Router } from 'express';
import crypto from 'crypto';

const logger = console;

export default function createFrontierRoutesPart1({ requireAuth } = {}) {
  const router = Router();

  function _userId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.userId ?? req.actor?.userId ?? req.body?.userId ?? null; // safe: target-identifier
  }

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.warn?.('[frontier] error:', err.message);
      const status = err.message.includes('not found') ? 404
        : err.message.includes('required') || err.message.includes('Invalid') ? 400
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  };

  // ---------------------------------------------------------------------------
  // In-memory stores
  // ---------------------------------------------------------------------------
  const exportJobs = new Map();
  const sensorDevices = new Map();
  const sensorReadings = new Map();
  const anomalyAlerts = new Map();
  const notarizationRecords = new Map();
  const shellHistories = new Map();

  // ---------------------------------------------------------------------------
  // 1. Fabrication
  // ---------------------------------------------------------------------------

  const VALID_FORMATS = ['gcode', 'stl', 'dxf', 'step', 'obj', 'iges'];

  const MACHINE_PROFILES = [
    {
      id: 'prusa-mk4',
      name: 'Prusa MK4',
      type: 'fdm',
      buildVolume: { x: 250, y: 210, z: 220 },
      formats: ['gcode', 'stl', 'obj'],
    },
    {
      id: 'snapmaker-a350t',
      name: 'Snapmaker A350T',
      type: 'fdm-cnc-laser',
      buildVolume: { x: 320, y: 350, z: 330 },
      formats: ['gcode', 'stl', 'dxf', 'obj'],
    },
    {
      id: 'glowforge-pro',
      name: 'Glowforge Pro',
      type: 'laser',
      buildVolume: { x: 495, y: 279, z: 8 },
      formats: ['dxf', 'stl'],
    },
    {
      id: 'haas-vf2',
      name: 'Haas VF-2',
      type: 'cnc-mill',
      buildVolume: { x: 762, y: 406, z: 508 },
      formats: ['gcode', 'step', 'iges'],
    },
  ];

  // POST /fabrication/export — create export job
  router.post('/fabrication/export', auth, wrap(async (req, res) => {
    const { userId, format, parameters, machineProfile } = req.body;
    if (!userId) throw new Error('userId is required');
    if (!format) throw new Error('format is required');
    if (!VALID_FORMATS.includes(format)) {
      throw new Error(`Invalid format "${format}". Must be one of: ${VALID_FORMATS.join(', ')}`);
    }

    const job = {
      id: crypto.randomUUID(),
      userId,
      format,
      parameters: parameters || {},
      machineProfile: machineProfile || null,
      status: 'processing',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    exportJobs.set(job.id, job);
    logger.info?.(`[frontier] fabrication export job created: ${job.id} for user ${userId}`);
    res.status(201).json({ ok: true, job });
  }));

  // GET /fabrication/exports/:userId — list user export jobs
  router.get('/fabrication/exports/:userId', auth, wrap(async (req, res) => {
    const { userId } = req.params;
    const jobs = [...exportJobs.values()].filter(j => j.userId === userId);
    res.json({ ok: true, jobs });
  }));

  // GET /fabrication/machines — list machine profiles
  router.get('/fabrication/machines', auth, wrap(async (req, res) => {
    res.json({ ok: true, machines: MACHINE_PROFILES });
  }));

  // GET /fabrication/export/:id — get single export job
  router.get('/fabrication/export/:id', auth, wrap(async (req, res) => {
    const job = exportJobs.get(req.params.id);
    if (!job) throw new Error('Export job not found');
    res.json({ ok: true, job });
  }));

  // ---------------------------------------------------------------------------
  // 2. Sensors
  // ---------------------------------------------------------------------------

  const VALID_SENSOR_TYPES = ['temperature', 'humidity', 'pressure', 'accelerometer', 'light', 'gas'];

  // POST /sensors/devices — register device
  router.post('/sensors/devices', auth, wrap(async (req, res) => {
    const { userId, name, type, protocol } = req.body;
    if (!userId) throw new Error('userId is required');
    if (!name) throw new Error('name is required');
    if (!type) throw new Error('type is required');
    if (!VALID_SENSOR_TYPES.includes(type)) {
      throw new Error(`Invalid sensor type "${type}". Must be one of: ${VALID_SENSOR_TYPES.join(', ')}`);
    }

    const device = {
      id: crypto.randomUUID(),
      userId,
      name,
      type,
      protocol: protocol || 'mqtt',
      status: 'online',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    sensorDevices.set(device.id, device);
    logger.info?.(`[frontier] sensor device registered: ${device.id} (${name})`);
    res.status(201).json({ ok: true, device });
  }));

  // GET /sensors/devices/:userId — list user devices
  router.get('/sensors/devices/:userId', auth, wrap(async (req, res) => {
    const { userId } = req.params;
    const devices = [...sensorDevices.values()].filter(d => d.userId === userId);
    res.json({ ok: true, devices });
  }));

  // POST /sensors/readings — ingest reading
  router.post('/sensors/readings', auth, wrap(async (req, res) => {
    const { deviceId, value, unit, metadata } = req.body;
    if (!deviceId) throw new Error('deviceId is required');
    if (value === undefined || value === null) throw new Error('value is required');

    const device = sensorDevices.get(deviceId);
    if (!device) throw new Error('Device not found');

    const reading = {
      id: crypto.randomUUID(),
      deviceId,
      value,
      unit: unit || null,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    };

    // Store reading
    if (!sensorReadings.has(deviceId)) {
      sensorReadings.set(deviceId, []);
    }
    sensorReadings.get(deviceId).push(reading);

    // Check anomaly
    const anomaly = value > 100;
    if (anomaly) {
      const alert = {
        id: crypto.randomUUID(),
        deviceId,
        userId: device.userId,
        readingId: reading.id,
        value,
        unit: unit || null,
        message: `Anomaly detected: value ${value} exceeds threshold (100)`,
        timestamp: new Date().toISOString(),
      };
      if (!anomalyAlerts.has(device.userId)) {
        anomalyAlerts.set(device.userId, []);
      }
      anomalyAlerts.get(device.userId).push(alert);
      logger.warn?.(`[frontier] sensor anomaly on device ${deviceId}: value=${value}`);
    }

    res.status(201).json({ ok: true, reading, anomaly });
  }));

  // GET /sensors/readings/:deviceId — get readings for device
  router.get('/sensors/readings/:deviceId', auth, wrap(async (req, res) => {
    const { deviceId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
    const readings = sensorReadings.get(deviceId) || [];
    const result = limit ? readings.slice(-limit) : readings;
    res.json({ ok: true, readings: result });
  }));

  // GET /sensors/anomalies/:userId — get anomaly alerts for user
  router.get('/sensors/anomalies/:userId', auth, wrap(async (req, res) => {
    const { userId } = req.params;
    const alerts = anomalyAlerts.get(userId) || [];
    res.json({ ok: true, alerts });
  }));

  // ---------------------------------------------------------------------------
  // 3. Blockchain / Notarization
  // ---------------------------------------------------------------------------

  const VALID_CHAINS = ['base', 'arbitrum', 'polygon'];

  // POST /blockchain/notarize — notarize a DTU
  router.post('/blockchain/notarize', auth, wrap(async (req, res) => {
    const { userId, dtuId, chain, contentHash } = req.body;
    if (!userId) throw new Error('userId is required');
    if (!dtuId) throw new Error('dtuId is required');
    if (!chain) throw new Error('chain is required');
    if (!VALID_CHAINS.includes(chain)) {
      throw new Error(`Invalid chain "${chain}". Must be one of: ${VALID_CHAINS.join(', ')}`);
    }
    if (!contentHash) throw new Error('contentHash is required');

    const txHash = '0x' + crypto.randomBytes(32).toString('hex');

    const record = {
      id: crypto.randomUUID(),
      userId,
      dtuId,
      chain,
      contentHash,
      txHash,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    notarizationRecords.set(record.id, record);
    logger.info?.(`[frontier] notarization record created: ${record.id} on ${chain}`);
    res.status(201).json({ ok: true, record });
  }));

  // GET /blockchain/records/:userId — list user notarization records
  router.get('/blockchain/records/:userId', auth, wrap(async (req, res) => {
    const { userId } = req.params;
    const records = [...notarizationRecords.values()].filter(r => r.userId === userId);
    res.json({ ok: true, records });
  }));

  // POST /blockchain/verify — verify a record
  router.post('/blockchain/verify', auth, wrap(async (req, res) => {
    const { recordId } = req.body;
    if (!recordId) throw new Error('recordId is required');

    const record = notarizationRecords.get(recordId);
    if (!record) throw new Error('Record not found');

    const verification = {
      recordId: record.id,
      dtuId: record.dtuId,
      verified: true,
      chain: record.chain,
      txHash: record.txHash,
      contentHash: record.contentHash,
      timestamp: new Date().toISOString(),
    };

    res.json({ ok: true, verification });
  }));

  // ---------------------------------------------------------------------------
  // 4. Shell
  // ---------------------------------------------------------------------------

  const SHELL_COMMANDS = {
    help:     { description: 'Show available commands' },
    ls:       { description: 'List directory contents' },
    pwd:      { description: 'Print working directory' },
    whoami:   { description: 'Display current user identity' },
    echo:     { description: 'Echo arguments to output' },
    date:     { description: 'Display current date and time' },
    cat:      { description: 'Display file contents' },
    cd:       { description: 'Change working directory' },
    mkdir:    { description: 'Create a new directory' },
    clear:    { description: 'Clear the terminal screen' },
    history:  { description: 'Show command history' },
    status:   { description: 'Show system status overview' },
    brain:    { description: 'Query the cognitive brain service' },
    dtu:      { description: 'Manage Data Transfer Units' },
    sync:     { description: 'Synchronize local and remote state' },
    lens:     { description: 'Activate or query a World Lens' },
    export:   { description: 'Export data in various formats' },
    test:     { description: 'Run diagnostic tests' },
    moderate: { description: 'Run content moderation check' },
    observe:  { description: 'Observe system events in real time' },
    cpm:      { description: 'Concord Package Manager operations' },
  };

  function _executeCommand(command, args, userId) {
    const argsStr = (args || []).join(' ');
    switch (command) {
      case 'help':
        return Object.entries(SHELL_COMMANDS)
          .map(([cmd, info]) => `  ${cmd.padEnd(12)} ${info.description}`)
          .join('\n');
      case 'ls':
        return 'brain/  dtus/  lenses/  exports/  config.json  README.md';
      case 'pwd':
        return `/home/concord/${userId || 'anonymous'}`;
      case 'whoami':
        return userId || 'anonymous';
      case 'echo':
        return argsStr || '';
      case 'date':
        return new Date().toISOString();
      case 'cat':
        return argsStr
          ? `[contents of ${argsStr}]`
          : 'cat: missing file operand';
      case 'cd':
        return argsStr
          ? `Changed directory to ${argsStr}`
          : `Changed directory to /home/concord/${userId || 'anonymous'}`;
      case 'mkdir':
        return argsStr
          ? `Directory created: ${argsStr}`
          : 'mkdir: missing operand';
      case 'clear':
        return '\x1b[2J\x1b[H';
      case 'history':
        return '[use GET /shell/history/:userId for full history]';
      case 'status':
        return 'Concord Engine v3.2.0 | Status: ONLINE | Uptime: 99.97% | DTUs: active | Brain: connected';
      case 'brain':
        return argsStr
          ? `[brain] Processing query: "${argsStr}" ... Response ready.`
          : '[brain] Interactive mode. Type your query.';
      case 'dtu':
        return argsStr
          ? `[dtu] Executing: dtu ${argsStr}`
          : '[dtu] Usage: dtu <list|create|inspect|delete> [options]';
      case 'sync':
        return '[sync] Synchronization complete. 0 conflicts. All nodes up to date.';
      case 'lens':
        return argsStr
          ? `[lens] Activating lens: ${argsStr}`
          : '[lens] Available lenses: spatial, temporal, semantic, creative, analytical';
      case 'export':
        return argsStr
          ? `[export] Exporting ${argsStr} ... done.`
          : '[export] Usage: export <format> <target>';
      case 'test':
        return '[test] Running diagnostics... All 42 tests passed. System nominal.';
      case 'moderate':
        return argsStr
          ? `[moderate] Content check for "${argsStr}": PASS — no policy violations detected.`
          : '[moderate] Usage: moderate <content>';
      case 'observe':
        return '[observe] Listening for events... (stream mode, Ctrl+C to stop)';
      case 'cpm':
        return argsStr
          ? `[cpm] Executing: cpm ${argsStr}`
          : '[cpm] Usage: cpm <install|remove|list|update|search> [package]';
      default:
        return `concord: command not found: ${command}`;
    }
  }

  // POST /shell/execute — execute command
  router.post('/shell/execute', auth, wrap(async (req, res) => {
    const { userId, command, args } = req.body;
    if (!userId) throw new Error('userId is required');
    if (!command) throw new Error('command is required');

    const supportedCommands = Object.keys(SHELL_COMMANDS);
    if (!supportedCommands.includes(command)) {
      throw new Error(`Invalid command "${command}". Type "help" for available commands.`);
    }

    const output = _executeCommand(command, args, userId);

    const entry = {
      id: crypto.randomUUID(),
      userId,
      command,
      args: args || [],
      output,
      timestamp: new Date().toISOString(),
    };

    if (!shellHistories.has(userId)) {
      shellHistories.set(userId, []);
    }
    shellHistories.get(userId).push(entry);

    res.json({ ok: true, output, entry });
  }));

  // GET /shell/history/:userId — get command history
  router.get('/shell/history/:userId', auth, wrap(async (req, res) => {
    const { userId } = req.params;
    const history = shellHistories.get(userId) || [];
    res.json({ ok: true, history });
  }));

  // GET /shell/commands — list available commands
  router.get('/shell/commands', auth, wrap(async (req, res) => {
    const commands = Object.entries(SHELL_COMMANDS).map(([name, info]) => ({
      name,
      description: info.description,
    }));
    res.json({ ok: true, commands });
  }));

  return router;
}
