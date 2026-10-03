import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type {
  CompletePurchaseResponse,
  CreatePurchaseInput,
  EntityId,
  PurchaseDetails,
  PurchaseHistoryRecord,
  PurchaseReturnInput,
  PurchaseReturnResponse,
  RecentPurchase,
  SupplierLedger,
  SupplierPaymentInput,
  SupplierPaymentResponse,
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

function preparePurchaseRequest(input: CreatePurchaseInput) {
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
      ...(item.gst_rate_override_basis_points == null
        ? {}
        : { gstRateOverrideBasisPoints: item.gst_rate_override_basis_points }),
    };
  });

  if (
    input.place_of_supply_state_code &&
    !/^\d{2}$/.test(input.place_of_supply_state_code.trim())
  ) {
    throw new PurchaseError("Place of supply must use a two-digit state code.");
  }
  return {
    supplierId: input.supplier_id,
    invoiceNo,
    purchaseDate: input.purchase_date,
    ...(input.gst_pricing_mode ? { gstPricingMode: input.gst_pricing_mode } : {}),
    ...(input.place_of_supply_state_code
      ? { placeOfSupplyStateCode: input.place_of_supply_state_code.trim() }
      : {}),
    items,
  };
}

export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<CompletePurchaseResponse> {
  return invoke<CompletePurchaseResponse>("complete_purchase", {
    purchase: preparePurchaseRequest(input),
  });
}

export async function editPurchase(
  purchaseId: EntityId,
  input: CreatePurchaseInput,
): Promise<CompletePurchaseResponse> {
  if (!isEntityId(purchaseId)) {
    throw new PurchaseError("Purchase id must be a positive whole number.");
  }
  return invoke<CompletePurchaseResponse>("edit_purchase", {
    purchaseId,
    purchase: preparePurchaseRequest(input),
  });
}

export async function getRecentPurchases(limit = 10): Promise<RecentPurchase[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new PurchaseError("Recent purchase limit must be between 1 and 50.");
  }
  return invoke<RecentPurchase[]>("get_recent_purchases", { limit });
}

export async function getPurchaseHistory(filters: {
  searchTerm?: string;
  supplierId?: EntityId | null;
  fromDate?: string | null;
  toDate?: string | null;
} = {}): Promise<PurchaseHistoryRecord[]> {
  if (
    filters.supplierId != null &&
    (!Number.isSafeInteger(filters.supplierId) || filters.supplierId <= 0)
  ) {
    throw new PurchaseError("Supplier id must be a positive whole number.");
  }
  return invoke<PurchaseHistoryRecord[]>("get_purchase_history", {
    searchTerm: filters.searchTerm?.trim() ?? "",
    supplierId: filters.supplierId ?? null,
    fromDate: filters.fromDate ?? null,
    toDate: filters.toDate ?? null,
  });
}

export async function getPurchaseDetails(purchaseId: EntityId): Promise<PurchaseDetails> {
  if (!isEntityId(purchaseId)) {
    throw new PurchaseError("Purchase id must be a positive whole number.");
  }
  return invoke<PurchaseDetails>("get_purchase_details", { purchaseId });
}

export async function cancelPurchase(purchaseId: EntityId): Promise<void> {
  if (!isEntityId(purchaseId)) {
    throw new PurchaseError("Purchase id must be a positive whole number.");
  }
  await invoke("cancel_purchase", { purchaseId });
}

export async function returnPurchase(
  input: PurchaseReturnInput,
): Promise<PurchaseReturnResponse> {
  if (!isEntityId(input.purchase_id) || input.items.length === 0) {
    throw new PurchaseError("Select a purchase and at least one return line.");
  }
  const seen = new Set<number>();
  const items = input.items.map((item) => {
    if (
      !isEntityId(item.purchase_item_id) ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      seen.has(item.purchase_item_id)
    ) {
      throw new PurchaseError("Return lines need unique purchase items and positive quantities.");
    }
    seen.add(item.purchase_item_id);
    return { purchaseItemId: item.purchase_item_id, quantity: item.quantity };
  });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.return_date)) {
    throw new PurchaseError("Enter a valid purchase return date.");
  }
  return invoke<PurchaseReturnResponse>("return_purchase", {
    request: {
      purchaseId: input.purchase_id,
      returnDate: input.return_date,
      note: input.note?.trim() || null,
      items,
    },
  });
}

export async function getSupplierLedger(
  supplierId: EntityId,
  filters: {
    fromDate?: string | null;
    toDate?: string | null;
    entryType?: string | null;
    searchTerm?: string;
  } = {},
): Promise<SupplierLedger> {
  if (!isEntityId(supplierId)) {
    throw new PurchaseError("Supplier id must be a positive whole number.");
  }
  return invoke<SupplierLedger>("get_supplier_ledger", {
    supplierId,
    fromDate: filters.fromDate ?? null,
    toDate: filters.toDate ?? null,
    entryType: filters.entryType ?? null,
    searchTerm: filters.searchTerm?.trim() ?? "",
  });
}

export async function recordSupplierPayment(
  input: SupplierPaymentInput,
): Promise<SupplierPaymentResponse> {
  if (!isEntityId(input.supplier_id)) {
    throw new PurchaseError("Choose a supplier before recording payment.");
  }
  const amountCents = amountToCents(input.amount, "Payment amount");
  if (amountCents <= 0) {
    throw new PurchaseError("Payment amount must be greater than zero.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payment_date)) {
    throw new PurchaseError("Enter a valid payment date.");
  }
  return invoke<SupplierPaymentResponse>("create_supplier_payment", {
    payment: {
      supplierId: input.supplier_id,
      paymentDate: input.payment_date,
      amountCents,
      paymentMethod: input.payment_method,
      transactionReference: input.transaction_reference?.trim() || null,
      note: input.note?.trim() || null,
    },
  });
}

export async function addPurchaseAttachment(
  purchaseId: EntityId,
  sourcePath: string,
): Promise<void> {
  if (!isEntityId(purchaseId) || !sourcePath.trim()) {
    throw new PurchaseError("Choose a purchase and a supported invoice file.");
  }
  await invoke("add_purchase_attachment", {
    purchaseId,
    sourcePath,
  });
}

export async function selectAndAddPurchaseAttachment(
  purchaseId: EntityId,
): Promise<boolean> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Invoice attachment", extensions: ["pdf", "jpg", "jpeg", "png"] }],
  });
  const sourcePath = typeof selected === "string" ? selected : null;
  if (!sourcePath) return false;
  await addPurchaseAttachment(purchaseId, sourcePath);
  return true;
}

export async function openPurchaseAttachment(attachmentId: EntityId): Promise<void> {
  if (!isEntityId(attachmentId)) {
    throw new PurchaseError("Attachment id must be a positive whole number.");
  }
  const path = await invoke<string>("get_purchase_attachment_path", { attachmentId });
  await openPath(path);
}

export function isEntityId(value: number): value is EntityId {
  return Number.isSafeInteger(value) && value > 0;
}