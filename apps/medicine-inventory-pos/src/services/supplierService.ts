import { invoke } from "@tauri-apps/api/core";
import { applyPharmacyMutation } from "./pharmacyWriteService";
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
  return invoke<Supplier[]>("get_suppliers", { searchTerm: term });
}

export async function saveSupplier(
  input: SupplierFormValues,
  supplierId?: EntityId,
): Promise<EntityId> {
  const values = normalizeSupplierInput(input);
  if (supplierId === undefined) {
    const result = await applyPharmacyMutation({
      kind: "create_supplier",
      name: values[0],
      phone: values[1],
      address: values[2],
    });
    const createdSupplierId = result.entityId;
    if (
      createdSupplierId === null ||
      !Number.isSafeInteger(createdSupplierId) ||
      createdSupplierId <= 0
    ) {
      throw new SupplierError("The supplier could not be saved.");
    }
    return createdSupplierId;
  }
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
    throw new SupplierError("Supplier id must be a positive whole number.");
  }
  await applyPharmacyMutation({
    kind: "update_supplier",
    supplier_id: supplierId,
    name: values[0],
    phone: values[1],
    address: values[2],
  });
  return supplierId;
}