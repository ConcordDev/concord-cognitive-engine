/**
 * The lens kit — the pieces every lens redesign used to rebuild by hand.
 * Start a new lens from it: `node scripts/new-lens.mjs <lens> --identity "<Name>"`.
 * See docs/LENS_KIT.md.
 */
import './lens-kit.css';
export { SourcedNumber } from './SourcedNumber';
export { ReceiptCard, receiptFromServer, describeUnsigned, type Receipt, type ReceiptVerdict } from './ReceiptCard';
export { LensAsync, LensLoading, LensEmpty, LensError, statusOf, reasonOf, type LensAsyncStatus } from './LensStates';
export { LensBody, LensColumns, LensTabStrip, type LensTab } from './LensBody';
export { LensDialog } from './LensDialog';
export { sourced, mustSource, isSourced, formatValue, formatUncertainty, formatSource, fromMargin, fromProbability, ledgerAmount, counted, type Source, type Uncertainty, type SourcedInput, type SourcedResult } from '@/lib/lens-kit/sourced';
export { checkLensTokens, contrastRatio, parseColor, REQUIRED_TOKENS, CONTRAST_PAIRS } from '@/lib/lens-kit/contrast';
export { lensCall, unwrapLensResponse, type LensEnvelope } from '@/lib/lens-kit/api';
