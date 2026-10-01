import {
  executeSql,
  runInTransaction,
  selectSql,
} from "./db";
import type { EntityId, Supplier, SupplierFormValues } from "../types";

export class SupplierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierError";
  }
}

function normalizeSupplierInput(input: SupplierFormValues): [string, string | null, string | null] {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const address = input.address.trim();
  if (!name || name.length > 120) {
    throw new SupplierError("Supplier name is required and must be 120 characters or fewer.");
  }
  if (phone.length > 40 || address.length > 500) {
    throw new SupplierError("Supplier phone or address exceeds its character limit.");
  }
  return [name, phone || null, address || null];
}

export async function getSuppliers(searchTerm = ""): Promise<Supplier[]> {
  const term = searchTerm.trim();
  const pattern = term ? `%${term.replace(/[!%_]/g, "!$&")}%` : null;
  return selectSql<Supplier[]>(
    `SELECT id, name, phone, address, balance_due
     FROM suppliers
     WHERE $1 IS NULL
        OR name LIKE $1 ESCAPE '!'
        OR COALESCE(phone, '') LIKE $1 ESCAPE '!'
        OR COALESCE(address, '') LIKE $1 ESCAPE '!'
     ORDER BY name COLLATE NOCASE ASC, id ASC`,
    [pattern],
  );
}

export async function saveSupplier(
  input: SupplierFormValues,
  supplierId?: EntityId,
): Promise<EntityId> {
  const values = normalizeSupplierInput(input);
  if (supplierId === undefined) {
    const result = await executeSql(
      "INSERT INTO suppliers (name, phone, address) VALUES ($1, $2, $3)",
      values,
    );
    const supplierId = result.lastInsertId;
    if (
      result.rowsAffected !== 1 ||
      typeof supplierId !== "number" ||
      !Number.isSafeInteger(supplierId) ||
      supplierId <= 0
    ) {
      throw new SupplierError("The supplier could not be saved.");
    }
    return supplierId;
  }
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
    throw new SupplierError("Supplier id must be a positive whole number.");
  }
  await runInTransaction([
    {
      query: "UPDATE suppliers SET name = $1, phone = $2, address = $3 WHERE id = $4",
      values: [...values, supplierId],
      expectedRowsAffected: 1,
    },
  ]);
  return supplierId;
}