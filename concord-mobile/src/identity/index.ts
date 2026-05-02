// Concord Mobile — Identity barrel export

export { createIdentityManager } from './identity-manager';
export type { SecureStorage, IdentityManager } from './identity-manager';

// Production-ready SecureStorage backends (replaces the placeholder
// flagged in CLAUDE.md).
export {
  createExpoSecureStorage,
  createWebSecureStorage,
  createInMemorySecureStorage,
  createSecureStorageForPlatform,
} from './secure-storage-expo';
