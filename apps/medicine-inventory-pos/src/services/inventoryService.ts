import { invoke } from "@tauri-apps/api/core";
import { applyPharmacyMutation } from "./pharmacyWriteService";
import type {
  EntityId,
  ExpiryAlert,
  ExpiryHorizonDays,
  FefoAllocation,
  ImportedMedicineRecord,
  InventoryFilter,
  LowStockAlert,
  MedicineBatch,
  MedicineFormValues,
  MedicineInventoryRow,
  MedicineOrderUsage,
  MedicineSearchResult,
} from "../types";

interface MedicineSearchRow {
  id: EntityId;
  name: string;
  generic_name: string | null;
  company: string | null;
  product_type: string | null;
  strength: string | null;
  composition: string | null;
  medicine_barcode: string | null;
  uses: string | null;
  adult_dose: string | null;
  child_dose: string | null;
  photo_ref: string | null;
  rack_location: string | null;
  min_stock_alert: number;
  gst_rate_basis_points: number | null;
  created_at: string;
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

function normalizeMedicineInput(input: MedicineFormValues): {
  name: string;
  generic_name: string | null;
  company: string | null;
  product_type: string | null;
  strength: string | null;
  composition: string | null;
  barcode: string | null;
  uses: string | null;
  adult_dose: string | null;
  child_dose: string | null;
  photo_ref: string | null;
  rack_location: string | null;
  min_stock_alert: number;
  gst_rate_basis_points: number | null;
} {
  const name = input.name.trim();
  const genericName = input.generic_name.trim();
  const company = input.company.trim();
  const productType = input.product_type.trim();
  const strength = input.strength.trim();
  const composition = input.composition.trim();
  const barcode = input.barcode.trim().toUpperCase();
  const uses = input.uses.trim();
  const adultDose = input.adult_dose.trim();
  const childDose = input.child_dose.trim();
  const photoRef = input.photo_ref?.trim() || null;
  const rackLocation = input.rack_location.trim();
  if (!name || name.length > 120) {
    throw new InventoryError("Medicine name is required and must be 120 characters or fewer.");
  }
  if (
    genericName.length > 150 ||
    company.length > 120 ||
    productType.length > 80 ||
    strength.length > 80 ||
    composition.length > 500 ||
    barcode.length > 128 ||
    uses.length > 1000 ||
    adultDose.length > 500 ||
    childDose.length > 500 ||
    rackLocation.length > 80
  ) {
    throw new InventoryError("One or more medicine fields exceeds its character limit.");
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
  return {
    name,
    generic_name: genericName || null,
    company: company || null,
    product_type: productType || null,
    strength: strength || null,
    composition: composition || null,
    barcode: barcode || null,
    uses: uses || null,
    adult_dose: adultDose || null,
    child_dose: childDose || null,
    photo_ref: input.photo_remove ? null : photoRef,
    rack_location: rackLocation || null,
    min_stock_alert: input.min_stock_alert,
    gst_rate_basis_points: input.gst_rate_basis_points,
  };
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
  const medicine = normalizeMedicineInput(input);
  const result = await applyPharmacyMutation({
    kind: "create_medicine",
    ...medicine,
  });
  const medicineId = result.entityId;
  if (medicineId === null || !Number.isSafeInteger(medicineId) || medicineId <= 0) {
    throw new InventoryError("The medicine could not be saved.");
  }
  if (input.photo_upload_bytes?.length) {
    try {
      await saveMedicinePhoto(medicineId, input.photo_upload_bytes);
    } catch (error) {
      try {
        await deleteMedicine(medicineId);
      } catch {
        throw new InventoryError(
          `The medicine was created, but its photo could not be stored and the new record could not be rolled back. ${error instanceof Error ? error.message : ""}`,
        );
      }
      throw error;
    }
  }
  return medicineId;
}

export async function updateMedicine(
  medicineId: EntityId,
  input: MedicineFormValues,
): Promise<void> {
  assertPositiveInteger(medicineId, "Medicine id");
  const medicine = normalizeMedicineInput(input);
  await applyPharmacyMutation({
    kind: "update_medicine",
    medicine_id: medicineId,
    ...medicine,
  });
  if (input.photo_upload_bytes?.length) {
    await saveMedicinePhoto(medicineId, input.photo_upload_bytes);
  } else if (input.photo_remove) {
    await removeMedicinePhoto(medicineId);
  }
}

export async function getMedicinePhoto(medicineId: EntityId): Promise<number[] | null> {
  assertPositiveInteger(medicineId, "Medicine id");
  return invoke<number[] | null>("get_medicine_photo", { medicineId });
}

export async function saveMedicinePhoto(
  medicineId: EntityId,
  photoBytes: number[],
): Promise<string> {
  assertPositiveInteger(medicineId, "Medicine id");
  if (
    photoBytes.length < 4 ||
    photoBytes.length > 2_000_000 ||
    photoBytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
  ) {
    throw new InventoryError("Medicine photo must be a valid JPEG no larger than 2 MB.");
  }
  return invoke<string>("save_medicine_photo", { medicineId, photoBytes });
}

export async function removeMedicinePhoto(medicineId: EntityId): Promise<void> {
  assertPositiveInteger(medicineId, "Medicine id");
  await invoke<void>("remove_medicine_photo", { medicineId });
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

export async function getMedicineOrderUsage(
  medicineId: EntityId,
): Promise<MedicineOrderUsage> {
  assertPositiveInteger(medicineId, "Medicine id");
  return invoke<MedicineOrderUsage>("get_medicine_order_usage", { medicineId });
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

export interface BulkStockAdjustmentInput {
  batchId: EntityId;
  medicineId: EntityId;
  quantityChange: number;
}

export async function adjustBatchStockBulk(input: {
  adjustments: BulkStockAdjustmentInput[];
  reason: string;
}): Promise<void> {
  if (input.adjustments.length < 1 || input.adjustments.length > 100) {
    throw new InventoryError("Select between 1 and 100 batches for a bulk stock adjustment.");
  }
  const batchIds = new Set<number>();
  const adjustments = input.adjustments.map((adjustment) => {
    assertPositiveInteger(adjustment.batchId, "Batch id");
    assertPositiveInteger(adjustment.medicineId, "Medicine id");
    if (!Number.isSafeInteger(adjustment.quantityChange) || adjustment.quantityChange === 0) {
      throw new InventoryError("Each bulk adjustment must be a non-zero whole number.");
    }
    if (Math.abs(adjustment.quantityChange) > 1_000_000_000) {
      throw new InventoryError("A bulk stock adjustment cannot exceed 1,000,000,000 units.");
    }
    if (batchIds.has(adjustment.batchId)) {
      throw new InventoryError("A batch can only be included once in a bulk adjustment.");
    }
    batchIds.add(adjustment.batchId);
    return {
      batch_id: adjustment.batchId,
      medicine_id: adjustment.medicineId,
      quantity_change: adjustment.quantityChange,
    };
  });
  const reason = input.reason.trim();
  if (!reason || reason.length > 250) {
    throw new InventoryError("Enter a bulk adjustment reason of 1 to 250 characters.");
  }
  await applyPharmacyMutation({
    kind: "adjust_batch_stock_bulk",
    adjustments,
    reason,
  });
}

export async function updateBulkReorderThresholds(input: {
  medicineIds: EntityId[];
  minStockAlert: number;
}): Promise<void> {
  if (input.medicineIds.length < 1 || input.medicineIds.length > 100) {
    throw new InventoryError("Select between 1 and 100 medicines for a bulk reorder-level update.");
  }
  if (
    !Number.isSafeInteger(input.minStockAlert) ||
    input.minStockAlert < 0 ||
    input.minStockAlert > 1_000_000_000
  ) {
    throw new InventoryError("Reorder level must be a whole number between 0 and 1,000,000,000.");
  }
  const seen = new Set<number>();
  const updates = input.medicineIds.map((medicineId) => {
    assertPositiveInteger(medicineId, "Medicine id");
    if (seen.has(medicineId)) {
      throw new InventoryError("A medicine can only be included once in a bulk reorder-level update.");
    }
    seen.add(medicineId);
    return {
      medicine_id: medicineId,
      min_stock_alert: input.minStockAlert,
    };
  });
  await applyPharmacyMutation({
    kind: "update_bulk_reorder_thresholds",
    updates,
  });
}

export async function importMedicines(records: ImportedMedicineRecord[]): Promise<void> {
  if (records.length < 1 || records.length > 1_000) {
    throw new InventoryError("Import between 1 and 1,000 valid medicine rows at a time.");
  }
  const medicineIds = new Set<number>();
  const barcodes = new Set<string>();
  const identities = new Set<string>();
  for (const record of records) {
    if (!record.name.trim() || record.name.trim().length > 120) {
      throw new InventoryError("Every imported medicine needs a name of 1 to 120 characters.");
    }
    if (record.medicine_id !== null) {
      assertPositiveInteger(record.medicine_id, "Medicine id");
      if (medicineIds.has(record.medicine_id)) {
        throw new InventoryError("A medicine can only appear once in an import.");
      }
      medicineIds.add(record.medicine_id);
    }
    if (record.barcode) {
      const barcode = record.barcode.trim().toLocaleUpperCase();
      if (barcodes.has(barcode)) throw new InventoryError("A barcode can only appear once in an import.");
      barcodes.add(barcode);
    }
    const identity = [
      record.name,
      record.company ?? "",
      record.product_type ?? "",
      record.strength ?? "",
    ]
      .map((value) => value.trim().toLocaleLowerCase())
      .join("|");
    if (identities.has(identity)) {
      throw new InventoryError("A medicine can only appear once in an import.");
    }
    identities.add(identity);
    if (
      record.min_stock_alert !== null &&
      (!Number.isSafeInteger(record.min_stock_alert) ||
        record.min_stock_alert < 0 ||
        record.min_stock_alert > 1_000_000_000)
    ) {
      throw new InventoryError("Reorder levels must be whole numbers between 0 and 1,000,000,000.");
    }
    if (
      record.gst_rate_basis_points !== null &&
      (!Number.isSafeInteger(record.gst_rate_basis_points) ||
        record.gst_rate_basis_points < 0 ||
        record.gst_rate_basis_points > 10_000)
    ) {
      throw new InventoryError("GST rates must be between 0% and 100%.");
    }
    if (record.opening_batch) {
      const batch = record.opening_batch;
      if (!batch.batch_no.trim() || batch.batch_no.trim().length > 120) {
        throw new InventoryError("Batch Number must contain 1 to 120 characters.");
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(batch.expiry_date)) {
        throw new InventoryError("Expiry Date must use YYYY-MM-DD format.");
      }
      for (const value of [
        batch.purchase_rate_cents,
        batch.mrp_cents,
        batch.sale_rate_cents,
      ]) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 100_000_000_000) {
          throw new InventoryError("Batch prices must be valid amounts between 0 and 1,000,000,000.");
        }
      }
      if (
        !Number.isSafeInteger(batch.opening_stock) ||
        batch.opening_stock < 0 ||
        batch.opening_stock > 1_000_000_000
      ) {
        throw new InventoryError("Opening Stock must be a whole number between 0 and 1,000,000,000.");
      }
    }
  }
  await applyPharmacyMutation({ kind: "import_medicines", records });
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
      product_type: row.product_type,
      strength: row.strength,
      composition: row.composition,
      barcode: row.medicine_barcode,
      uses: row.uses,
      adult_dose: row.adult_dose,
      child_dose: row.child_dose,
      photo_ref: row.photo_ref,
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