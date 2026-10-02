import { invoke } from "@tauri-apps/api/core";
import type {
  CompletePurchaseResponse,
  CreatePurchaseInput,
  EntityId,
  RecentPurchase,
} from "../types";
import { toCents } from "../utils/money";

export class PurchaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseError";
  }
}

function amountToCents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new PurchaseError(`${label} must be a valid non-negative amount.`);
  }
  const cents = toCents(value);
  if (!Number.isSafeInteger(cents)) {
    throw new PurchaseError(`${label} exceeds the supported amount.`);
  }
  return cents;
}

export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<CompletePurchaseResponse> {
  const invoiceNo = input.invoice_no.trim();
  if (!Number.isSafeInteger(input.supplier_id) || input.supplier_id <= 0) {
    throw new PurchaseError("Select a supplier before saving the purchase.");
  }
  if (!invoiceNo || invoiceNo.length > 100) {
    throw new PurchaseError("Enter a purchase invoice number of 1 to 100 characters.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchase_date)) {
    throw new PurchaseError("Enter a valid purchase date.");
  }
  if (input.items.length === 0 || input.items.length > 500) {
    throw new PurchaseError("A purchase must contain between 1 and 500 line items.");
  }

  const seenBatches = new Set<string>();
  const items = input.items.map((item, index) => {
    const line = index + 1;
    const batchNo = item.batch_no.trim();
    if (!Number.isSafeInteger(item.medicine_id) || item.medicine_id <= 0) {
      throw new PurchaseError(`Choose a medicine on line ${line}.`);
    }
    if (!batchNo || batchNo.length > 80) {
      throw new PurchaseError(`Enter a batch number of 1 to 80 characters on line ${line}.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.expiry_date)) {
      throw new PurchaseError(`Enter an expiry date on line ${line}.`);
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000_000) {
      throw new PurchaseError(`Enter a positive whole-number quantity on line ${line}.`);
    }
    const key = `${item.medicine_id}:${batchNo.toLocaleLowerCase()}:${item.expiry_date}`;
    if (seenBatches.has(key)) {
      throw new PurchaseError(`Combine duplicate batch ${batchNo} into one purchase line.`);
    }
    seenBatches.add(key);
    return {
      medicineId: item.medicine_id,
      batchNo,
      expiryDate: item.expiry_date,
      purchaseRateCents: amountToCents(item.purchase_rate, `Purchase rate on line ${line}`),
      mrpCents: amountToCents(item.mrp, `MRP on line ${line}`),
      saleRateCents: amountToCents(item.sale_rate, `Sale rate on line ${line}`),
      quantity: item.quantity,
    };
  });

  return invoke<CompletePurchaseResponse>("complete_purchase", {
    purchase: {
      supplierId: input.supplier_id,
      invoiceNo,
      purchaseDate: input.purchase_date,
      items,
    },
  });
}

export async function getRecentPurchases(limit = 10): Promise<RecentPurchase[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new PurchaseError("Recent purchase limit must be between 1 and 50.");
  }
  return invoke<RecentPurchase[]>("get_recent_purchases", { limit });
}

export function isEntityId(value: number): value is EntityId {
  return Number.isSafeInteger(value) && value > 0;
}