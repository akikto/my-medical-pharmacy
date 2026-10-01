import {
  executeSql,
  runInTransaction,
  selectSql,
  type SqlValue,
  type TransactionStatement,
} from "./db";
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

function escapeLikeTerm(term: string): string {
  return `%${term.replace(/[!%_]/g, "!$&")}%`;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InventoryError(`${label} must be a positive whole number.`);
  }
}

function normalizeMedicineInput(input: MedicineFormValues): SqlValue[] {
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
  return [
    name,
    genericName || null,
    company || null,
    rackLocation || null,
    input.min_stock_alert,
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
  const pattern = term ? escapeLikeTerm(term) : null;
  return selectSql<MedicineInventoryRow[]>(
    `SELECT
       m.id,
       m.name,
       m.generic_name,
       m.company,
       m.rack_location,
       m.min_stock_alert,
       m.created_at,
       COALESCE(SUM(CASE
         WHEN b.expiry_date >= date('now', 'localtime')
         THEN b.current_stock ELSE 0 END), 0) AS available_stock,
       COALESCE(SUM(CASE
         WHEN b.expiry_date < date('now', 'localtime')
         THEN b.current_stock ELSE 0 END), 0) AS expired_stock,
       COALESCE(SUM(CASE
         WHEN b.expiry_date >= date('now', 'localtime')
          AND b.expiry_date <= date('now', 'localtime', '+30 days')
         THEN b.current_stock ELSE 0 END), 0) AS near_expiry_stock,
       COUNT(b.id) AS batch_count
     FROM medicines AS m
     LEFT JOIN medicine_batches AS b ON b.medicine_id = m.id
     WHERE $1 IS NULL
        OR m.name LIKE $1 ESCAPE '!'
        OR COALESCE(m.generic_name, '') LIKE $1 ESCAPE '!'
        OR COALESCE(m.company, '') LIKE $1 ESCAPE '!'
        OR COALESCE(m.rack_location, '') LIKE $1 ESCAPE '!'
     GROUP BY m.id
     ORDER BY m.name COLLATE NOCASE ASC, m.id ASC`,
    [pattern],
  );
}

export async function createMedicine(input: MedicineFormValues): Promise<EntityId> {
  const [name, genericName, company, rackLocation, minStockAlert] =
    normalizeMedicineInput(input);
  const result = await executeSql(
    `INSERT INTO medicines (name, generic_name, company, rack_location, min_stock_alert)
     VALUES ($1, $2, $3, $4, $5)`,
    [name, genericName, company, rackLocation, minStockAlert],
  );
  const medicineId = result.lastInsertId;
  if (
    result.rowsAffected !== 1 ||
    typeof medicineId !== "number" ||
    !Number.isSafeInteger(medicineId) ||
    medicineId <= 0
  ) {
    throw new InventoryError("The medicine could not be saved.");
  }
  return medicineId;
}

export async function updateMedicine(
  medicineId: EntityId,
  input: MedicineFormValues,
): Promise<void> {
  assertPositiveInteger(medicineId, "Medicine id");
  const [name, genericName, company, rackLocation, minStockAlert] =
    normalizeMedicineInput(input);
  await runInTransaction([
    {
      query: `UPDATE medicines
              SET name = $1, generic_name = $2, company = $3,
                  rack_location = $4, min_stock_alert = $5
              WHERE id = $6`,
      values: [name, genericName, company, rackLocation, minStockAlert, medicineId],
      expectedRowsAffected: 1,
    },
  ]);
}

export async function deleteMedicine(medicineId: EntityId): Promise<void> {
  assertPositiveInteger(medicineId, "Medicine id");
  await runInTransaction([
    {
      query: "DELETE FROM medicines WHERE id = $1",
      values: [medicineId],
      expectedRowsAffected: 1,
    },
  ]);
}

export async function getMedicineBatches(
  medicineId: EntityId,
): Promise<MedicineBatch[]> {
  assertPositiveInteger(medicineId, "Medicine id");
  return selectSql<MedicineBatch[]>(
    `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
            sale_rate, current_stock, barcode
     FROM medicine_batches
     WHERE medicine_id = $1
     ORDER BY expiry_date ASC, batch_no COLLATE NOCASE ASC, id ASC`,
    [medicineId],
  );
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
  await runInTransaction([
    {
      query: "UPDATE medicine_batches SET mrp = $1, sale_rate = $2 WHERE id = $3 AND medicine_id = $4",
      values: [mrp, saleRate, input.batchId, input.medicineId],
      expectedRowsAffected: 1,
    },
    {
      query: "UPDATE medicines SET rack_location = $1 WHERE id = $2",
      values: [rackLocation || null, input.medicineId],
      expectedRowsAffected: 1,
    },
  ]);
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
  await runInTransaction([
    {
      query: `UPDATE medicine_batches
              SET current_stock = current_stock + $1
              WHERE id = $2 AND medicine_id = $3
                AND current_stock + $1 BETWEEN 0 AND 1000000000`,
      values: [input.quantityChange, input.batchId, input.medicineId],
      expectedRowsAffected: 1,
    },
    {
      query: `INSERT INTO stock_adjustments (medicine_id, batch_id, quantity_change, reason)
              VALUES ($1, $2, $3, $4)`,
      values: [input.medicineId, input.batchId, input.quantityChange, reason],
      expectedRowsAffected: 1,
    },
  ]);
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

  const pattern = escapeLikeTerm(term);
  const rows = await selectSql<MedicineSearchRow[]>(
    `SELECT
       m.id,
       m.name,
       m.generic_name,
       m.company,
       m.rack_location,
       m.min_stock_alert,
       m.created_at,
       COALESCE((
         SELECT SUM(stock_batch.current_stock)
         FROM medicine_batches AS stock_batch
         WHERE stock_batch.medicine_id = m.id
            AND stock_batch.expiry_date >= date('now', 'localtime')
       ), 0) AS available_stock,
       b.id AS batch_id,
       b.medicine_id AS batch_medicine_id,
       b.batch_no,
       b.expiry_date,
       b.purchase_rate,
       b.mrp,
       b.sale_rate,
       b.current_stock,
       b.barcode
     FROM medicines AS m
     LEFT JOIN medicine_batches AS b
       ON b.id = (
         SELECT candidate.id
         FROM medicine_batches AS candidate
         WHERE candidate.medicine_id = m.id
           AND candidate.current_stock > 0
            AND candidate.expiry_date >= date('now', 'localtime')
          ORDER BY
            CASE WHEN candidate.barcode = $2 THEN 0 ELSE 1 END,
            candidate.expiry_date ASC,
            candidate.id ASC
         LIMIT 1
       )
      WHERE m.name LIKE $1 ESCAPE '!'
         OR COALESCE(m.generic_name, '') LIKE $1 ESCAPE '!'
         OR COALESCE(m.company, '') LIKE $1 ESCAPE '!'
        OR EXISTS (
          SELECT 1 FROM medicine_batches AS barcode_batch
          WHERE barcode_batch.medicine_id = m.id
            AND (
              barcode_batch.barcode = $2
              OR barcode_batch.barcode LIKE $1 ESCAPE '!'
            )
        )
     ORDER BY
       CASE WHEN EXISTS (
         SELECT 1 FROM medicine_batches AS exact_barcode
         WHERE exact_barcode.medicine_id = m.id
           AND exact_barcode.barcode = $2
       ) THEN 0 ELSE 1 END,
       m.name COLLATE NOCASE ASC,
       m.id ASC
     LIMIT $3`,
    [pattern, term, limit],
  );

  return rows.map((row) => ({
    medicine: {
      id: row.id,
      name: row.name,
      generic_name: row.generic_name,
      company: row.company,
      rack_location: row.rack_location,
      min_stock_alert: row.min_stock_alert,
      created_at: row.created_at,
    },
    available_stock: row.available_stock,
    fefo_batch: toMedicineBatch(row),
  }));
}

export async function getFefoBatch(
  medicineId: EntityId,
): Promise<MedicineBatch | null> {
  const batches = await selectSql<MedicineBatch[]>(
    `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
            sale_rate, current_stock, barcode
     FROM medicine_batches
     WHERE medicine_id = $1
       AND current_stock > 0
       AND expiry_date >= date('now', 'localtime')
     ORDER BY expiry_date ASC, id ASC
     LIMIT 1`,
    [medicineId],
  );
  return batches[0] ?? null;
}

export async function getSellableBatches(
  medicineId: EntityId,
): Promise<MedicineBatch[]> {
  assertPositiveInteger(medicineId, "Medicine id");
  return selectSql<MedicineBatch[]>(
    `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
            sale_rate, current_stock, barcode
     FROM medicine_batches
     WHERE medicine_id = $1
       AND current_stock > 0
       AND expiry_date >= date('now', 'localtime')
     ORDER BY expiry_date ASC, id ASC`,
    [medicineId],
  );
}

export async function allocateFefoStock(
  medicineId: EntityId,
  quantity: number,
): Promise<FefoAllocation[]> {
  assertPositiveInteger(quantity, "Quantity");

  const batches = await selectSql<MedicineBatch[]>(
    `SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
            sale_rate, current_stock, barcode
     FROM medicine_batches
     WHERE medicine_id = $1
       AND current_stock > 0
       AND expiry_date >= date('now', 'localtime')
     ORDER BY expiry_date ASC, id ASC`,
    [medicineId],
  );

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

  const statements: TransactionStatement[] = [...combined].map(
    ([batchId, quantity]) => ({
      query: `UPDATE medicine_batches
              SET current_stock = current_stock - $1
              WHERE id = $2
                AND current_stock >= $1
                AND expiry_date >= date('now', 'localtime')`,
      values: [quantity, batchId],
      expectedRowsAffected: 1,
    }),
  );

  await runInTransaction(statements);
}

export async function addStockToBatch(
  batchId: EntityId,
  quantity: number,
): Promise<void> {
  assertPositiveInteger(batchId, "Batch id");
  assertPositiveInteger(quantity, "Quantity");

  await runInTransaction([
    {
      query: `UPDATE medicine_batches
              SET current_stock = current_stock + $1
              WHERE id = $2`,
      values: [quantity, batchId],
      expectedRowsAffected: 1,
    },
  ]);
}

export async function getLowStockAlerts(): Promise<LowStockAlert[]> {
  return selectSql<LowStockAlert[]>(
    `SELECT
       m.id AS medicine_id,
       m.name,
       m.generic_name,
       m.company,
       m.rack_location,
       m.min_stock_alert,
       COALESCE(SUM(b.current_stock), 0) AS available_stock
     FROM medicines AS m
     LEFT JOIN medicine_batches AS b
       ON b.medicine_id = m.id
       AND b.expiry_date >= date('now', 'localtime')
     GROUP BY m.id
     HAVING COALESCE(SUM(b.current_stock), 0) <= m.min_stock_alert
     ORDER BY available_stock ASC, m.name COLLATE NOCASE ASC`,
  );
}

export async function getExpiryAlerts(
  horizonDays: ExpiryHorizonDays = 30,
): Promise<ExpiryAlert[]> {
  const modifier: SqlValue = `+${horizonDays} days`;
  const rows = await selectSql<BatchRow[]>(
    `SELECT
       b.id,
       b.medicine_id,
       b.batch_no,
       b.expiry_date,
       b.purchase_rate,
       b.mrp,
       b.sale_rate,
       b.current_stock,
       b.barcode,
       m.name AS medicine_name,
       CAST(julianday(b.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER)
         AS days_until_expiry,
       CASE
         WHEN b.expiry_date < date('now', 'localtime') THEN 'expired'
         ELSE 'expiring'
       END AS status
     FROM medicine_batches AS b
     INNER JOIN medicines AS m ON m.id = b.medicine_id
     WHERE b.current_stock > 0
       AND b.expiry_date <= date('now', 'localtime', $1)
     ORDER BY b.expiry_date ASC, m.name COLLATE NOCASE ASC, b.id ASC`,
    [modifier],
  );

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