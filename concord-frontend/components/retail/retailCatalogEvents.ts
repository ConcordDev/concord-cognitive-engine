/**
 * Retail catalog change signal.
 *
 * The Retail Workbench catalog (ProductCatalogPanel) and the Storefront POS
 * card (LivePosTerminal) both read the same real `retail.product-list`
 * macro, but they live in separate trees, so the storefront kept showing a
 * stale "Catalog (0)" after a product was added in the workbench drawer.
 * After a successful write the catalog announces it; listeners re-read the
 * real list. The event carries no product data — nothing is faked locally.
 */

export const RETAIL_CATALOG_CHANGED = 'concord:retail-catalog-changed';

export function announceRetailCatalogChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RETAIL_CATALOG_CHANGED));
}

/** Subscribe; returns the unsubscribe function. */
export function onRetailCatalogChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(RETAIL_CATALOG_CHANGED, cb);
  return () => window.removeEventListener(RETAIL_CATALOG_CHANGED, cb);
}
