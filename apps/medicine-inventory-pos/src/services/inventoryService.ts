import {
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
  LowStockAlert,
  Medicine,
  MedicineBatch,
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

  const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
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
           AND stock_batch.expiry_date >= date('now')
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
           AND candidate.expiry_date >= date('now')
         ORDER BY candidate.expiry_date ASC, candidate.id ASC
         LIMIT 1
       )
     WHERE m.name LIKE $1 ESCAPE '\\'
        OR COALESCE(m.generic_name, '') LIKE $1 ESCAPE '\\'
        OR COALESCE(m.company, '') LIKE $1 ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM medicine_batches AS barcode_batch
          WHERE barcode_batch.medicine_id = m.id
            AND (
              barcode_batch.barcode = $2
              OR barcode_batch.barcode LIKE $1 ESCAPE '\\'
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
       AND expiry_date >= date('now')
     ORDER BY expiry_date ASC, id ASC
     LIMIT 1`,
    [medicineId],
  );
  return batches[0] ?? null;
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
       AND expiry_date >= date('now')
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
                AND expiry_date >= date('now')`,
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
      AND b.expiry_date >= date('now')
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
       CAST(julianday(b.expiry_date) - julianday(date('now')) AS INTEGER)
         AS days_until_expiry,
       CASE
         WHEN b.expiry_date < date('now') THEN 'expired'
         ELSE 'expiring'
       END AS status
     FROM medicine_batches AS b
     INNER JOIN medicines AS m ON m.id = b.medicine_id
     WHERE b.current_stock > 0
       AND b.expiry_date <= date('now', $1)
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