import { invoke } from "@tauri-apps/api/core";
import { applyPharmacyMutation } from "./pharmacyWriteService";
import type {
  EntityId,
  ExpiryAlert,
  ExpiryHorizonDays,
  FefoAllocation,
  InventoryFilter,
  LowStockAlert,
  Medicine,
  MedicineBatch,
  MedicineFormValues,
  MedicineInventoryRow,
  MedicineSearchResult,
} from "../types";

interface MedicineSearchRow extends Medicine {
  available_stock: number;
  batch_id: EntityId | null;
  batch_medicine_id: EntityId | null;
  batch_no: string | null;
  expiry_date: string | null;
  purchase_rate: number | null;
  mrp: number | null;
  sale_rate: number | null;
  current_stock: number | null;
  barcode: string | null;
}

interface BatchRow extends MedicineBatch {
  medicine_name: string;
  days_until_expiry: number;
  status: "expired" | "expiring";
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InventoryError(`${label} must be a positive whole number.`);
  }
}

function normalizeMedicineInput(
  input: MedicineFormValues,
): [string, string | null, string | null, string | null, number, number | null] {
  const name = input.name.trim();
  const genericName = input.generic_name.trim();
  const company = input.company.trim();
  const rackLocation = input.rack_location.trim();
  if (!name || name.length > 120) {
    throw new InventoryError("Medicine name is required and must be 120 characters or fewer.");
  }
  if (genericName.length > 150 || company.length > 120 || rackLocation.length > 80) {
    throw new InventoryError("Generic name, company, or rack location exceeds its character limit.");
  }
  if (!Number.isSafeInteger(input.min_stock_alert) || input.min_stock_alert < 0 || input.min_stock_alert > 1_000_000_000) {
    throw new InventoryError("Low-stock alert must be a whole number from 0 to 1,000,000,000.");
  }
  if (
    input.gst_rate_basis_points !== null &&
    (!Number.isSafeInteger(input.gst_rate_basis_points) ||
      input.gst_rate_basis_points < 0 ||
      input.gst_rate_basis_points > 10_000)
  ) {
    throw new InventoryError("GST rate must be between 0% and 100%, in 0.01% increments.");
  }
  return [
    name,
    genericName || null,
    company || null,
    rackLocation || null,
    input.min_stock_alert,
    input.gst_rate_basis_points,
  ];
}

function normalizeRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InventoryError(`${label} must be a valid non-negative amount.`);
  }
  const cents = Math.round((value + Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new InventoryError(`${label} exceeds the supported amount.`);
  }
  return cents / 100;
}

export async function getInventoryMedicines(
  searchTerm = "",
): Promise<MedicineInventoryRow[]> {
  const term = searchTerm.trim();
  return invoke<MedicineInventoryRow[]>("get_inventory_medicines", {
    searchTerm: term,
  });
}

export async function createMedicine(input: MedicineFormValues): Promise<EntityId> {
  const [name, genericName, company, rackLocation, minStockAlert, gstRate] =
    normalizeMedicineInput(input);
  const result = await applyPharmacyMutation({
    kind: "create_medicine",
    name,
    generic_name: genericName,
    company,
    rack_location: rackLocation,
    min_stock_alert: minStockAlert,
    gst_rate_basis_points: gstRate,
  });
  const medicineId = result.entityId;
  if (medicineId === null || !Number.isSafeInteger(medicineId) || medicineId <= 0) {
    throw new InventoryError("The medicine could not be saved.");
  }
  return medicineId;
}

export async function updateMedicine(
  medicineId: EntityId,
  input: MedicineFormValues,
): Promise<void> {
  assertPositiveInteger(medicineId, "Medicine id");
  const [name, genericName, company, rackLocation, minStockAlert, gstRate] =
    normalizeMedicineInput(input);
  await applyPharmacyMutation({
    kind: "update_medicine",
    medicine_id: medicineId,
    name,
    generic_name: genericName,
    company,
    rack_location: rackLocation,
    min_stock_alert: minStockAlert,
    gst_rate_basis_points: gstRate,
  });
}

export async function deleteMedicine(medicineId: EntityId): Promise<void> {
  assertPositiveInteger(medicineId, "Medicine id");
  await applyPharmacyMutation({ kind: "delete_medicine", medicine_id: medicineId });
}

export async function getMedicineBatches(
  medicineId: EntityId,
): Promise<MedicineBatch[]> {
  assertPositiveInteger(medicineId, "Medicine id");
  return invoke<MedicineBatch[]>("get_medicine_batches", { medicineId });
}

export async function updateBatchDetails(input: {
  batchId: EntityId;
  medicineId: EntityId;
  mrp: number;
  saleRate: number;
  rackLocation: string;
}): Promise<void> {
  assertPositiveInteger(input.batchId, "Batch id");
  assertPositiveInteger(input.medicineId, "Medicine id");
  const mrp = normalizeRate(input.mrp, "MRP");
  const saleRate = normalizeRate(input.saleRate, "Sale rate");
  const rackLocation = input.rackLocation.trim();
  if (rackLocation.length > 80) {
    throw new InventoryError("Rack location must be 80 characters or fewer.");
  }
  await applyPharmacyMutation({
    kind: "update_batch_details",
    batch_id: input.batchId,
    medicine_id: input.medicineId,
    mrp_cents: Math.round(mrp * 100),
    sale_rate_cents: Math.round(saleRate * 100),
    rack_location: rackLocation || null,
  });
}

export async function adjustBatchStock(input: {
  batchId: EntityId;
  medicineId: EntityId;
  quantityChange: number;
  reason: string;
}): Promise<void> {
  assertPositiveInteger(input.batchId, "Batch id");
  assertPositiveInteger(input.medicineId, "Medicine id");
  if (!Number.isSafeInteger(input.quantityChange) || input.quantityChange === 0) {
    throw new InventoryError("Enter a non-zero whole-number stock adjustment.");
  }
  if (Math.abs(input.quantityChange) > 1_000_000_000) {
    throw new InventoryError("A single stock adjustment cannot exceed 1,000,000,000 units.");
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 250) {
    throw new InventoryError("Enter an adjustment reason of 1 to 250 characters.");
  }
  await applyPharmacyMutation({
    kind: "adjust_batch_stock",
    batch_id: input.batchId,
    medicine_id: input.medicineId,
    quantity_change: input.quantityChange,
    reason,
  });
}

function toMedicineBatch(row: MedicineSearchRow): MedicineBatch | null {
  if (
    row.batch_id === null ||
    row.batch_medicine_id === null ||
    row.batch_no === null ||
    row.expiry_date === null ||
    row.purchase_rate === null ||
    row.mrp === null ||
    row.sale_rate === null ||
    row.current_stock === null
  ) {
    return null;
  }

  return {
    id: row.batch_id,
    medicine_id: row.batch_medicine_id,
    batch_no: row.batch_no,
    expiry_date: row.expiry_date,
    purchase_rate: row.purchase_rate,
    mrp: row.mrp,
    sale_rate: row.sale_rate,
    current_stock: row.current_stock,
    barcode: row.barcode,
  };
}

export async function searchMedicines(
  searchTerm: string,
  limit = 30,
): Promise<MedicineSearchResult[]> {
  const term = searchTerm.trim();
  if (!term) {
    return [];
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InventoryError("Search limit must be between 1 and 100.");
  }

  const rows = await invoke<MedicineSearchRow[]>("search_medicines", {
    searchTerm: term,
    limit,
  });

  return rows.map((row) => ({
    medicine: {
      id: row.id,
      name: row.name,
      generic_name: row.generic_name,
      company: row.company,
      rack_location: row.rack_location,
      min_stock_alert: row.min_stock_alert,
      gst_rate_basis_points: row.gst_rate_basis_points,
      created_at: row.created_at,
    },
    available_stock: row.available_stock,
    fefo_batch: toMedicineBatch(row),
  }));
}

export async function getFefoBatch(
  medicineId: EntityId,
): Promise<MedicineBatch | null> {
  return invoke<MedicineBatch | null>("get_fefo_batch", { medicineId });
}

export async function getSellableBatches(
  medicineId: EntityId,
): Promise<MedicineBatch[]> {
  assertPositiveInteger(medicineId, "Medicine id");
  return invoke<MedicineBatch[]>("get_sellable_batches", { medicineId });
}

export async function allocateFefoStock(
  medicineId: EntityId,
  quantity: number,
): Promise<FefoAllocation[]> {
  assertPositiveInteger(quantity, "Quantity");

  const batches = await invoke<MedicineBatch[]>("get_sellable_batches", {
    medicineId,
  });

  let remaining = quantity;
  const allocation: FefoAllocation[] = [];
  for (const batch of batches) {
    const allocated = Math.min(batch.current_stock, remaining);
    if (allocated > 0) {
      allocation.push({ batch, quantity: allocated });
      remaining -= allocated;
    }
    if (remaining === 0) {
      return allocation;
    }
  }

  throw new InventoryError(
    `Insufficient unexpired stock. ${quantity - remaining} unit(s) are available.`,
  );
}

export async function deductStock(
  batchId: EntityId,
  quantity: number,
): Promise<void> {
  await deductStockFromBatches([{ batchId, quantity }]);
}

export async function deductStockFromBatches(
  deductions: readonly { batchId: EntityId; quantity: number }[],
): Promise<void> {
  if (deductions.length === 0) {
    throw new InventoryError("At least one stock deduction is required.");
  }

  const combined = new Map<EntityId, number>();
  for (const deduction of deductions) {
    assertPositiveInteger(deduction.batchId, "Batch id");
    assertPositiveInteger(deduction.quantity, "Quantity");
    combined.set(
      deduction.batchId,
      (combined.get(deduction.batchId) ?? 0) + deduction.quantity,
    );
  }

  await applyPharmacyMutation({
    kind: "deduct_stock",
    deductions: [...combined].map(([batchId, quantity]) => ({
      batch_id: batchId,
      quantity,
    })),
  });
}

export async function addStockToBatch(
  batchId: EntityId,
  quantity: number,
): Promise<void> {
  assertPositiveInteger(batchId, "Batch id");
  assertPositiveInteger(quantity, "Quantity");

  await applyPharmacyMutation({ kind: "add_stock", batch_id: batchId, quantity });
}

export async function getLowStockAlerts(): Promise<LowStockAlert[]> {
  return invoke<LowStockAlert[]>("get_low_stock_alerts");
}

export async function getExpiryAlerts(
  horizonDays: ExpiryHorizonDays = 30,
): Promise<ExpiryAlert[]> {
  const rows = await invoke<BatchRow[]>("get_expiry_alerts", { horizonDays });

  return rows.map((row) => ({
    batch: {
      id: row.id,
      medicine_id: row.medicine_id,
      batch_no: row.batch_no,
      expiry_date: row.expiry_date,
      purchase_rate: row.purchase_rate,
      mrp: row.mrp,
      sale_rate: row.sale_rate,
      current_stock: row.current_stock,
      barcode: row.barcode,
    },
    medicine_name: row.medicine_name,
    days_until_expiry: row.days_until_expiry,
    status: row.status,
  }));
}