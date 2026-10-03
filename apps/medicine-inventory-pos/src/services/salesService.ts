import { invoke } from "@tauri-apps/api/core";
import type {
  CheckoutSaleInput,
  PaymentMode,
  RecentSale,
  Sale,
  SaleDetails,
  SaleItemDetail,
} from "../types";

interface CheckoutSaleResponse {
  saleId: number;
  invoiceNo: string;
}

interface RecentSaleRow extends Sale {
  item_count: number | string;
}

export class SalesError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SalesError";
  }
}

export class SaleDetailsUnavailableError extends SalesError {
  constructor(
    readonly invoiceNo: string,
    cause: unknown,
  ) {
    super(
      `Invoice ${invoiceNo} was saved, but its details could not be loaded. Refresh Recent invoices, then reopen it to print.`,
      { cause },
    );
    this.name = "SaleDetailsUnavailableError";
  }
}

function toCents(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new SalesError(`${label} must be a valid non-negative amount.`);
  }
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new SalesError(`${label} is larger than the supported amount.`);
  }
  return cents;
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function assertPaymentMode(value: PaymentMode): void {
  if (!["CASH", "CARD", "UPI", "CREDIT", "OTHER"].includes(value)) {
    throw new SalesError("Choose a supported payment mode.");
  }
}

function assertLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new SalesError("Recent sales limit must be between 1 and 100.");
  }
}

export async function checkoutSale(input: CheckoutSaleInput): Promise<SaleDetails> {
  if (input.items.length === 0) {
    throw new SalesError("Add at least one medicine before completing checkout.");
  }
  assertPaymentMode(input.payment_mode);
  if (
    input.customer_id !== null &&
    (!Number.isSafeInteger(input.customer_id) || input.customer_id <= 0)
  ) {
    throw new SalesError("Choose a valid saved customer.");
  }
  if (!["INCLUSIVE", "EXCLUSIVE"].includes(input.gst_pricing_mode)) {
    throw new SalesError("Choose inclusive or exclusive GST pricing.");
  }

  const flatDiscountCents = toCents(input.flat_discount, "Flat discount");
  let subtotalCents = 0;
  let totalItemDiscountCents = 0;

  for (const item of input.items) {
    if (
      !Number.isSafeInteger(item.medicine_id) ||
      item.medicine_id <= 0 ||
      !Number.isSafeInteger(item.batch_id) ||
      item.batch_id <= 0 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0
    ) {
      throw new SalesError("A cart item has an invalid medicine, batch, or quantity.");
    }

    const unitPriceCents = toCents(item.unit_price, "Unit price");
    const lineDiscountCents = toCents(item.item_discount, "Item discount");
    if (
      item.gst_rate_override_basis_points !== null &&
      (!Number.isSafeInteger(item.gst_rate_override_basis_points) ||
        item.gst_rate_override_basis_points < 0 ||
        item.gst_rate_override_basis_points > 10_000)
    ) {
      throw new SalesError("GST rate must be between 0% and 100%, in 0.01% increments.");
    }
    const lineGrossCents = unitPriceCents * item.quantity;
    if (!Number.isSafeInteger(lineGrossCents)) {
      throw new SalesError("A cart line total is larger than the supported amount.");
    }
    if (lineDiscountCents > lineGrossCents) {
      throw new SalesError("An item discount cannot exceed that item's total.");
    }

    subtotalCents += lineGrossCents;
    totalItemDiscountCents += lineDiscountCents;
  }

  const totalDiscountCents = totalItemDiscountCents + flatDiscountCents;
  if (
    !Number.isSafeInteger(subtotalCents) ||
    !Number.isSafeInteger(totalDiscountCents) ||
    totalDiscountCents > subtotalCents
  ) {
    throw new SalesError("The combined discounts cannot exceed the sale subtotal.");
  }

  const cashTenderedCents = toCents(input.cash_tendered, "Cash tendered");
  if (input.payment_mode !== "CASH" && cashTenderedCents !== 0) {
    throw new SalesError("Cash tendered is only used for cash payments.");
  }

  const checkout: {
    customerId: number | null;
    customerName: string | null;
    customerPhone: string | null;
    paymentMode: PaymentMode;
    gstPricingMode: "INCLUSIVE" | "EXCLUSIVE";
    upiTransactionId: string | null;
    flatDiscountCents: number;
    cashTenderedCents: number;
    items: Array<{
      medicineId: number;
      batchId: number;
      quantity: number;
      unitPriceCents: number;
      itemDiscountCents: number;
      gstRateOverrideBasisPoints: number | null;
    }>;
  } = {
    customerId: input.customer_id,
    customerName: normalizeOptionalText(input.customer_name),
    customerPhone: normalizeOptionalText(input.customer_phone),
    paymentMode: input.payment_mode,
    gstPricingMode: input.gst_pricing_mode,
    upiTransactionId: normalizeOptionalText(input.upi_transaction_id),
    flatDiscountCents,
    cashTenderedCents,
    items: input.items.map((item) => ({
      medicineId: item.medicine_id,
      batchId: item.batch_id,
      quantity: item.quantity,
      unitPriceCents: toCents(item.unit_price, "Unit price"),
      itemDiscountCents: toCents(item.item_discount, "Item discount"),
      gstRateOverrideBasisPoints: item.gst_rate_override_basis_points,
    })),
  };

  const result = await invoke<CheckoutSaleResponse>("complete_sale", { checkout });
  try {
    const sale = await getSaleDetails(result.invoiceNo);
    if (!sale) {
      throw new SalesError("The completed invoice was not returned by the local database.");
    }
    return sale;
  } catch (error) {
    throw new SaleDetailsUnavailableError(result.invoiceNo, error);
  }
}

export async function getRecentSales(limit = 10): Promise<RecentSale[]> {
  assertLimit(limit);
  const rows = await invoke<RecentSaleRow[]>("get_recent_sales", { limit });
  return rows.map(({ item_count, ...sale }) => ({
    sale,
    item_count: Number(item_count),
  }));
}

export async function getSaleDetails(
  invoiceNo: string,
): Promise<SaleDetails | null> {
  const normalizedInvoice = invoiceNo.trim();
  if (!normalizedInvoice) {
    throw new SalesError("Enter an invoice number.");
  }

  return invoke<SaleDetails | null>("get_sale_details", {
    invoiceNo: normalizedInvoice,
  });
}