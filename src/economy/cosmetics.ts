export const MIN_COSMETIC_PRICE = 201;
export const COSMETIC_PURCHASES_ENABLED = false;

export type CosmeticCategory = 'avatar' | 'ring' | 'card-back' | 'table-theme' | 'profile-frame';

export interface CosmeticCatalogItem {
  id: string;
  name: string;
  category: CosmeticCategory;
  price: number;
  payload?: Record<string, unknown>;
}

export interface CosmeticPurchaseRequest {
  accountId: string;
  itemId: string;
  expectedPrice: number;
}

export interface CosmeticPurchaseResult {
  ok: boolean;
  newChipBalance?: number;
  ownedItemId?: string;
  error?: string;
}

export function validateCosmetic(item: CosmeticCatalogItem): CosmeticCatalogItem {
  if (!Number.isInteger(item.price) || item.price < MIN_COSMETIC_PRICE) {
    throw new Error(`Cosmetics must cost at least ${MIN_COSMETIC_PRICE} chips.`);
  }
  if (!item.id.trim() || !item.name.trim()) throw new Error('Cosmetic id and name are required.');
  return item;
}

/**
 * Integration boundary for Liminal Chat. Purchasing is intentionally disabled
 * until the Chat-side inventory/store backend exists. Do not deduct chips here.
 */
export async function purchaseCosmeticScaffold(
  _request: CosmeticPurchaseRequest,
): Promise<CosmeticPurchaseResult> {
  return {
    ok: false,
    error: 'Cosmetic purchasing is scaffolded but not enabled yet.',
  };
}
