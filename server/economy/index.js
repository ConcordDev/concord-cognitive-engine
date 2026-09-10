// economy/index.js
// Entry point for the Concord Economy System.
// Registers all economy + Stripe HTTP endpoints on the Express app.
// Includes: Concord Coin, royalty cascades, emergent accounts,
// marketplace, fee splitting, and treasury reconciliation.

import { registerEconomyRoutes } from "./routes.js";
import { registerCreatorEconomyRoutes } from "./creator-economy-routes.js";

/**
 * Register economy endpoints.
 * Called from server.js: registerEconomyEndpoints(app, db, opts)
 */
export function registerEconomyEndpoints(app, db, opts = {}) {
  registerEconomyRoutes(app, db, opts);
  registerCreatorEconomyRoutes(app, db, opts);
  console.warn("[Concord Economy] All economy + Stripe + marketplace + creator economy endpoints registered");
}

// Re-export core modules for direct use by other server modules
export { getBalance, getBalancePreferSidecar, hasSufficientBalance, getSystemBalanceSummary } from "./balances.js";
export { calculateFee, FEES, PLATFORM_ACCOUNT_ID, FEE_SPLIT, UNIVERSAL_FEE_RATE } from "./fees.js";
export { executeTransfer, executePurchase, executeMarketplacePurchase, executeReversal } from "./transfer.js";
export { recordTransaction, recordTransactionBatch, getTransactions, generateTxId, checkRefIdProcessed } from "./ledger.js";
export { requestWithdrawal, processWithdrawal } from "./withdrawals.js";
export { adminOnly, authRequired, requireAdmin, requireUser } from "./guards.js";
export { economyAudit, auditCtx } from "./audit.js";
export { validateAmount, validateBalance } from "./validators.js";
export { STRIPE_ENABLED, createCheckoutSession, handleWebhook, createConnectOnboarding, getConnectStatus } from "./stripe.js";
export {
  createPurchase, transitionPurchase, recordSettlement, getPurchase,
  getPurchaseByRefId, getUserPurchases, findPurchasesByStatus, getPurchaseHistory, TRANSITIONS,
} from "./purchases.js";
export { runReconciliation, executeCorrection, getPurchaseReceipt, getReconciliationSummary } from "./reconciliation.js";

// New economic system modules
export { mintCoins, burnCoins, getTreasuryState, verifyTreasuryInvariant, getTreasuryEvents } from "./coin-service.js";
export {
  calculateGenerationalRate, registerCitation, getAncestorChain, distributeRoyalties,
  getCreatorRoyalties, getContentRoyalties, getDescendants,
  ROYALTY_FLOOR, DEFAULT_INITIAL_RATE, CONCORD_SYSTEM_ID,
} from "./royalty-cascade.js";
export {
  createEmergentAccount, transferToReserve, creditOperatingWallet, debitReserveAccount,
  getEmergentAccount, listEmergentAccounts, suspendEmergentAccount,
  isEmergentAccount, canWithdrawToFiat,
} from "./emergent-accounts.js";
export {
  createListing, purchaseListing, getListing, searchListings,
  delistListing, updateListingPrice, hashContent, generatePreview, checkWashTrading,
} from "./marketplace-service.js";
export { distributeFee, getFeeSplitBalances, getFeeDistributions } from "./fee-split.js";
export { runTreasuryReconciliation, getReconciliationHistory } from "./treasury-reconciliation.js";

// Creative Artifact Marketplace (Federation v1.2)
export {
  publishArtifact, publishDerivativeArtifact, purchaseArtifact,
  getArtifact, searchArtifacts, discoverLocalArtists, browseRegionArt,
  getDerivativeTree, rateArtifact,
  checkArtifactPromotionEligibility, promoteArtifact,
  awardCreativeXP, completeCreativeQuest, getCreativeXP, getCreativeQuestCompletions,
  getArtifactLicenses, getUserLicenses, hasArtifactAccess,
  getArtifactCascadeEarnings, getCreatorCascadeEarnings,
  pauseArtifact, resumeArtifact, delistArtifact, updateArtifactPrice,
} from "./creative-marketplace.js";

// Lens & Culture System (Federation v1.3)
export {
  postCultureDTU, getCultureDTU, browseCulture,
  resonateCulture, reflectOnCulture, getReflections,
  setLensProtection, getLensProtection, checkProtectionAllows,
  oneTapPurchase, exportArtifact, getExportHistory,
  recordBiomonitorReading, getLatestBiomonitorReading, getBiomonitorHistory,
  initGriefProtocol, activateGriefProtocol, getGriefProtocolStatus, transitionGriefPhase,
  initGreatMerge, getGreatMergeStatus, advanceMergePhase,
  registerLens, getLens, listLenses, registerSystemLenses,
} from "./lens-culture.js";

// DTU File Format System (Universal Container v1.0)
export {
  determinePrimaryType, calculateLayersBitfield,
  buildHeader, parseHeader,
  encodeDTU, decodeDTU, verifyDTU,
  registerDTUExport, lookupDTUByHash, getDTUExports,
  reimportDTU, getReimports,
  DTU_FILE_FORMAT, DTU_BINARY_LAYOUT, DTU_OS_ACTIONS,
  DTU_VIEWER, DTU_CODEC, DTU_SMART_OPEN, DTU_SHARING,
  DTU_PLATFORM_REGISTRATION, DTU_IANA_REGISTRATION,
  DTU_FORMAT_CONSTANTS,
} from "./dtu-format.js";

// API Billing System (v1.0)
export {
  createAPIKey, revokeAPIKey, listAPIKeys, validateAPIKey,
  determineTier, getRateLimits, updateKeyTier,
  categorizeEndpoint, getCategoryCost,
  getMonthlyUsage, getFreeRemaining,
  meterAPICall,
  getUsageSummary, getUsageLog, getDailyUsage, getEndpointUsage,
  createAlert, getAlerts, deleteAlert, checkAlerts,
  getFeeDistributions as getAPIFeeDistributions,
  API_BILLING_MODEL, API_KEY_SYSTEM, API_PRICING,
  API_DASHBOARD, API_BILLING_HEADERS, API_BALANCE_ALERTS,
  API_CONSTANTS,
} from "./api-billing.js";

// Single-Origin Storage Model (v1.0)
export {
  storeInVault, getVaultEntry, incrementVaultRef, decrementVaultRef,
  cleanupUnreferencedArtifacts, getVaultStats,
  recordDownload, getUserDownloads, getArtifactDownloadCount, hasUserDownloaded,
  cacheInCRI, recordCRIServe, evictFromCRI, getCRICacheContents,
  getCRICacheStats, evictExpiredCRIEntries,
  getRegionalStats, getTopRegionalArtifacts,
  calculateStorageSavings,
  STORAGE_INVARIANT, ARTIFACT_STORAGE, DOWNLOAD_FLOW,
  STORAGE_ECONOMICS, VAULT_REFERENCE_SYSTEM, BANDWIDTH_MANAGEMENT,
  CRI_CACHE, STORAGE_CONSTANTS,
} from "./storage.js";

// Rights Enforcement (v1.0)
export {
  ensureLicenseTables, grantLicense, revokeLicense,
  getUserLicenses as getUserDtuLicenses, getHighestTier,
  checkAccess, checkDerivativeRights, checkListingRights,
  streamingGuard, downloadGuard,
  getLicenseCount, getLicenseBreakdown, getUserAllLicenses,
} from "./rights-enforcement.js";
