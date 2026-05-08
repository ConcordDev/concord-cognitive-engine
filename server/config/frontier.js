/**
 * Frontier Features Configuration
 *
 * Central configuration for all 16 frontier feature modules in the
 * Concord Cognitive Engine platform. Each section governs limits,
 * defaults, and behavioral parameters for its respective subsystem.
 *
 * Modify values here to tune platform behavior without touching
 * route or service logic. All timeouts are in milliseconds unless
 * otherwise noted.
 */

module.exports = {

  // ─────────────────────────────────────────────────────────────────
  // 1. Fabrication — CNC / 3D-print / laser-cut export pipeline
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} FabricationConfig
   * @property {number}   maxExportsPerDay   - Hard cap on export jobs per user per calendar day
   * @property {string[]} supportedFormats   - File formats the export pipeline can produce
   * @property {string}   maxFileSize        - Human-readable max upload / output size
   * @property {number}   jobTimeout         - Max wall-clock time (ms) before a job is killed
   */
  fabrication: {
    maxExportsPerDay: 50,
    supportedFormats: ['gcode', 'stl', 'dxf', 'step', 'obj', 'iges'],
    maxFileSize: '100MB',
    jobTimeout: 120000,
  },

  // ─────────────────────────────────────────────────────────────────
  // 2. Sensors — IoT device ingestion and anomaly detection
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} SensorsConfig
   * @property {number} maxDevicesPerUser       - Max registered devices per account
   * @property {number} maxReadingsPerMinute    - Rate limit on inbound telemetry per device
   * @property {number} retentionDays           - How long raw readings are retained
   * @property {string} anomalyDetectionModel   - Algorithm used for real-time anomaly flagging
   */
  sensors: {
    maxDevicesPerUser: 20,
    maxReadingsPerMinute: 60,
    retentionDays: 365,
    anomalyDetectionModel: 'statistical',
  },

  // ─────────────────────────────────────────────────────────────────
  // 3. Notarization — On-chain timestamping of DTU hashes
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} NotarizationConfig
   * @property {string}   defaultChain             - Blockchain used when none is specified
   * @property {string[]} supportedChains          - All available target chains
   * @property {number}   maxNotarizationsPerDay   - Daily quota per user
   */
  notarization: {
    defaultChain: 'base',
    supportedChains: ['base', 'arbitrum', 'polygon'],
    maxNotarizationsPerDay: 10,
  },

  // ─────────────────────────────────────────────────────────────────
  // 4. Shell — In-browser terminal emulator for platform commands
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} ShellConfig
   * @property {number} maxCommandsPerMinute - Rate limit on command execution
   * @property {number} historySize          - Number of history entries retained per session
   * @property {number} sessionTimeout       - Idle timeout (ms) before shell session is reaped
   */
  shell: {
    maxCommandsPerMinute: 60,
    historySize: 1000,
    sessionTimeout: 3600000,
  },

  // ─────────────────────────────────────────────────────────────────
  // 5. Notebooks — Computational notebook environment
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} NotebooksConfig
   * @property {number}   maxCellsPerNotebook  - Cap on cells in a single notebook
   * @property {number}   maxNotebooksPerUser  - Cap on notebooks per account
   * @property {number}   executionTimeout     - Max execution time (ms) per cell run
   * @property {string[]} exportFormats        - Supported notebook export targets
   */
  notebooks: {
    maxCellsPerNotebook: 200,
    maxNotebooksPerUser: 100,
    executionTimeout: 30000,
    exportFormats: ['pdf', 'html', 'dtu-bundle', 'markdown'],
  },

  // ─────────────────────────────────────────────────────────────────
  // 6. Service Marketplace — Peer-to-peer professional services
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} ServiceMarketplaceConfig
   * @property {number} platformFeePercent - Percentage taken by the platform on each sale
   * @property {number} minPrice           - Minimum listing price (USD)
   * @property {number} maxActiveListings  - Max concurrent active listings per seller
   * @property {number} escrowHoldDays     - Days funds are held in escrow after delivery
   */
  serviceMarketplace: {
    platformFeePercent: 5,
    minPrice: 1,
    maxActiveListings: 50,
    escrowHoldDays: 7,
  },

  // ─────────────────────────────────────────────────────────────────
  // 7. Certificates — Learning-path credentials and verification
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} CertificatesConfig
   * @property {boolean} autoNotarize        - Automatically notarize certificates on-chain
   * @property {string}  verificationUrlBase - Public URL prefix for QR-code verification links
   */
  certificates: {
    autoNotarize: true,
    verificationUrlBase: 'https://concord-os.org/verify',
  },

  // ─────────────────────────────────────────────────────────────────
  // 8. Federation — Cross-instance synchronization protocol
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} FederationConfig
   * @property {number} maxInstances        - Max federated peers this instance will track
   * @property {number} syncIntervalMinutes - Default sync cadence in minutes
   * @property {number} maxDTUsPerSync      - Payload cap per sync batch
   */
  federation: {
    maxInstances: 100,
    syncIntervalMinutes: 60,
    maxDTUsPerSync: 1000,
  },

  // ─────────────────────────────────────────────────────────────────
  // 9. Compiler — DTU source-to-bundle compilation pipeline
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} CompilerConfig
   * @property {number} maxSourceLength  - Max characters in source input
   * @property {number} maxGeneratedDTUs - Max DTUs a single compile run may produce
   * @property {number} executionTimeout - Pipeline timeout (ms)
   */
  compiler: {
    maxSourceLength: 100000,
    maxGeneratedDTUs: 500,
    executionTimeout: 60000,
  },

  // ─────────────────────────────────────────────────────────────────
  // 10. Digital Twins — Living structural / system replicas
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} DigitalTwinsConfig
   * @property {number} maxTwinsPerUser      - Max digital twins per account
   * @property {number} assessmentInterval   - Min interval (ms) between scheduled assessments
   * @property {number} alertCooldown        - Min interval (ms) between repeated alerts for same twin
   */
  digitalTwins: {
    maxTwinsPerUser: 10,
    assessmentInterval: 3600000,
    alertCooldown: 1800000,
  },

  // ─────────────────────────────────────────────────────────────────
  // 11. Voice — Speech-to-text and conversational voice interface
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} VoiceConfig
   * @property {string} whisperModel             - OpenAI Whisper model variant for STT
   * @property {string} ttsProvider              - Text-to-speech backend
   * @property {number} maxAudioLength           - Max audio clip duration (ms)
   * @property {number} conversationHistoryLimit - Max turns retained in voice conversation memory
   */
  voice: {
    whisperModel: 'large-v3',
    ttsProvider: 'elevenlabs',
    maxAudioLength: 30000,
    conversationHistoryLimit: 50,
  },

  // ─────────────────────────────────────────────────────────────────
  // 12. Replay — Historical event playback and forensic analysis
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} ReplayConfig
   * @property {number}   maxTimelapseLength    - Max timelapse duration (seconds)
   * @property {number}   maxEventsPerQuery     - Query result cap
   * @property {string[]} timelapseResolutions  - Available render resolutions
   */
  replay: {
    maxTimelapseLength: 300,
    maxEventsPerQuery: 10000,
    timelapseResolutions: ['720p', '1080p', '4k'],
  },

  // ─────────────────────────────────────────────────────────────────
  // 13. Agents — Autonomous background task runners
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} AgentsConfig
   * @property {number} maxAgentsPerUser  - Max agents a single user may own
   * @property {number} defaultDailyQuota - Default daily action quota for new agents
   * @property {number} maxDailyQuota     - Absolute max daily actions (even if user raises quota)
   * @property {number} minRunInterval    - Minimum interval (ms) between consecutive agent runs
   */
  agents: {
    maxAgentsPerUser: 10,
    defaultDailyQuota: 100,
    maxDailyQuota: 1000,
    minRunInterval: 60000,
  },

  // ─────────────────────────────────────────────────────────────────
  // 14. Standards — Building codes and engineering standards library
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} StandardsConfig
   * @property {string[]} availableCodes  - Codes/standards currently loaded in the engine
   * @property {boolean}  autoUpdateCheck - Periodically check for newer code editions
   */
  standards: {
    availableCodes: [
      'IBC-2024',
      'ASCE-7-22',
      'ACI-318-19',
      'AISC-360-22',
      'Eurocode-2',
      'Eurocode-3',
    ],
    autoUpdateCheck: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // 15. DTU Diffing — Side-by-side and visual overlay comparison
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} DiffConfig
   * @property {number}  maxComparisonSize    - Max DTU node count for a single diff operation
   * @property {boolean} visualOverlayEnabled - Whether the visual overlay renderer is active
   */
  diff: {
    maxComparisonSize: 10000,
    visualOverlayEnabled: true,
  },

  // ─────────────────────────────────────────────────────────────────
  // 16. Dependency Graph — DTU relationship visualization
  // ─────────────────────────────────────────────────────────────────

  /**
   * @typedef {Object} GraphConfig
   * @property {number} maxDepth         - Maximum traversal depth for graph queries
   * @property {number} maxNodes         - Hard cap on nodes returned in a single query
   * @property {string} layoutAlgorithm  - Default graph layout algorithm for rendering
   */
  graph: {
    maxDepth: 10,
    maxNodes: 5000,
    layoutAlgorithm: 'force-directed',
  },
};
