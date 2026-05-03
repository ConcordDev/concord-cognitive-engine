/**
 * Concord Single-Origin Storage Model Constants — v1.0
 *
 * IMMUTABLE TIER — Constitutional
 *
 * Concord stores exactly ONE copy of every artifact.
 * Purchases grant download rights, not storage allocation.
 * Downloaded copies exist on user devices, never on Concord infrastructure.
 * Storage costs are paid once at upload and never again regardless of purchase volume.
 */

// ── Core Invariant ───────────────────────────────────────────────────
export const STORAGE_INVARIANT = Object.freeze({
  rule: "Concord stores exactly ONE copy of every artifact. "
    + "Purchases grant download rights, not storage allocation. "
    + "Downloaded copies exist on user devices, never on Concord infrastructure. "
    + "Storage costs are paid once at upload and never again regardless of purchase volume.",

  concordStores: [
    "one_original_artifact_per_upload",
    "dtu_metadata_layers",
    "usage_license_records",
    "lineage_graph",
    "cascade_ledger",
  ],

  concordNeverStores: [
    "per_user_copies",
    "cached_duplicates",
    "cdn_edge_copies",
    "stream_buffers",
    "download_history_files",
    "user_device_backups",
  ],

  growthModel: "linear_with_creators_not_buyers",
});

// ── Artifact Storage ─────────────────────────────────────────────────
export const ARTIFACT_STORAGE = Object.freeze({
  upload: {
    flow: [
      "creator_uploads_file",
      "system_validates_file_type_and_size",
      "system_compresses_with_zstd",
      "system_generates_content_hash_sha256",
      "system_checks_hash_against_existing",
      "system_stores_in_artifact_vault",
      "system_creates_dtu_with_artifact_reference",
      "system_generates_signature",
      "done_storage_cost_paid_forever",
    ],
    dedup: {
      method: "sha256_content_hash",
      onDuplicate: "reference_existing_artifact",
    },
  },

  vault: {
    structure: {
      keyType: "sha256_hash",
      valueType: "compressed_binary",
      organization: "flat_hash_addressed",
    },
    retention: {
      policy: "reference_counted",
      cleanupTick: "every_1000th_heartbeat",
    },
    redundancy: {
      primary: "local_vault",
      backup: "single_offsite_backup",
      totalCopies: 2,
    },
  },
});

// ── Download Flow ────────────────────────────────────────────────────
export const DOWNLOAD_FLOW = Object.freeze({
  purchase: {
    step1: "Buyer pays Concord Coin",
    step2: "Marketplace processes fees and cascade",
    step3: "System creates usage_license record (~200 bytes)",
    step4: "Buyer receives download rights",
    step5: "NO storage allocated for buyer on Concord",
  },

  download: {
    step1: "Buyer requests download",
    step2: "System checks usage_license table",
    step3: "License valid → read artifact from vault",
    step4: "Stream compressed artifact to buyer",
    step5: "Buyer's device receives and stores file",
    step6: "Connection closes",
    step7: "Concord stores nothing new",
  },

  redownload: {
    limits: null,
    cost: "bandwidth_only",
    storageCost: "zero",
  },
});

// ── Storage Economics ────────────────────────────────────────────────
export const STORAGE_ECONOMICS = Object.freeze({
  traditional: {
    model: "cost_scales_with_consumption",
    example: {
      songs: 100000000,
      avgSizeMB: 8,
      cdnRegions: 12,
      effectiveStorageTB: 9600,
      monthlyCostUSD: 200000,
    },
  },

  concord: {
    model: "cost_fixed_at_upload",
    example: {
      songs: 100000000,
      avgCompressedMB: 6,
      copies: 2,
      artifactStorageTB: 1200,
      licenseRecords: 100000000000,
      licenseStorageTB: 20,
      totalStorageTB: 1220,
      monthlyCostUSD: 25000,
    },
    savings: "87% less storage than traditional model",
  },

  consolidation: {
    model: "storage_efficiency_improves_over_time",
  },
});

// ── Vault Reference System ───────────────────────────────────────────
export const VAULT_REFERENCE_SYSTEM = Object.freeze({
  onDTUCreate: {
    action: "increment_vault_reference",
  },
  onDTUDelete: {
    action: "decrement_vault_reference",
  },
  cleanup: {
    frequency: "every_1000th_heartbeat",
    action: "delete_unreferenced_artifacts",
    gracePeriodDays: 30,
  },
});

// ── Bandwidth Management ─────────────────────────────────────────────
export const BANDWIDTH_MANAGEMENT = Object.freeze({
  downloadModel: {
    type: "one_time_transfer",
    persistentConnection: false,
  },

  optimization: {
    transferCompressed: true,
    resumable: true,
    resumeMethod: "http_range_headers",
    perUserRateLimit: {
      maxConcurrentDownloads: 5,
      maxBandwidthMBps: 50,
    },
  },

  costStructure: {
    perDownloadCost: "fixed_one_time",
    perListenCost: "zero_after_download",
    breakEvenListens: 2,
    averageListensPerSong: 20,
    bandwidthSavingsPercent: 90,
  },
});

// ── CRI Cache ────────────────────────────────────────────────────────
export const CRI_CACHE = Object.freeze({
  purpose: "local_serving_speed_only",

  cachePolicy: {
    strategy: "most_downloaded_regional",
    maxCacheSizeGB: 100,
    evictionPolicy: "lru",
    ttlHours: 168,
    disposable: true,
    fallback: "central_vault",
  },

  metricsExclusion: true,
  backup: false,
  selfHealing: true,
});

// ── Flat Constants ───────────────────────────────────────────────────
export const STORAGE_CONSTANTS = Object.freeze({
  // Vault
  VAULT_DIR: "/data/vault",
  VAULT_BACKUP_DIR: "/backup/vault",
  VAULT_HASH_ALGORITHM: "sha256",
  VAULT_COMPRESSION: "zstd",
  VAULT_COMPRESSION_LEVEL: 3,

  // Reference counting
  VAULT_CLEANUP_TICK: 1000,
  VAULT_GRACE_PERIOD_DAYS: 30,

  // Downloads — bumped 5→25 + 50→200 Mbps for 32GB / fast-network deployments.
  MAX_CONCURRENT_DOWNLOADS_PER_USER: Number(process.env.CONCORD_DOWNLOADS_PER_USER) || 25,
  MAX_BANDWIDTH_PER_USER_MBPS: Number(process.env.CONCORD_BANDWIDTH_PER_USER_MBPS) || 200,
  DOWNLOAD_RESUME_ENABLED: true,

  // CRI cache
  CRI_CACHE_MAX_GB: 100,
  CRI_CACHE_TTL_HOURS: 168,
  CRI_CACHE_EVICTION: "lru",

  // Upload limits
  UPLOAD_MAX_SIZE_MB: 5000,
  UPLOAD_CHUNK_SIZE_MB: 10,

  // License record size (approximate)
  LICENSE_RECORD_BYTES: 200,

  // Storage metrics
  BYTES_PER_LICENSE: 200,
});
