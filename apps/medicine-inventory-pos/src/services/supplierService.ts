import { invoke } from "@tauri-apps/api/core";
import { applyPharmacyMutation } from "./pharmacyWriteService";
import type { EntityId, Supplier, SupplierFormValues } from "../types";

export class SupplierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierError";
  }
}

function normalizeSupplierInput(input: SupplierFormValues) {
  const name = input.name.trim();
  const contactPerson = input.contact_person.trim();
  const phone = input.phone.trim();
  const whatsappPhone = input.whatsapp_phone.trim();
  const address = input.address.trim();
  const notes = input.notes.trim();
  const stateCode = input.state_code?.trim() ?? "";
  if (!name || name.length > 120) {
    throw new SupplierError("Supplier name is required and must be 120 characters or fewer.");
  }
  if (
    contactPerson.length > 120 ||
    phone.length > 40 ||
    whatsappPhone.length > 40 ||
    address.length > 500 ||
    notes.length > 1000
  ) {
    throw new SupplierError("Supplier contact details exceed their character limits.");
  }
  if (stateCode && !/^\d{2}$/.test(stateCode)) {
    throw new SupplierError("State code must contain two digits.");
  }
  return {
    name,
    contact_person: contactPerson || null,
    phone: phone || null,
    whatsapp_phone: whatsappPhone || null,
    address: address || null,
    notes: notes || null,
    state_code: stateCode || null,
  };
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
      ...values,
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
    ...values,
  });
  return supplierId;
}

export async function deleteSupplier(supplierId: EntityId): Promise<void> {
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) {
    throw new SupplierError("Supplier id must be a positive whole number.");
  }
  await applyPharmacyMutation({
    kind: "delete_supplier",
    supplier_id: supplierId,
  });
}