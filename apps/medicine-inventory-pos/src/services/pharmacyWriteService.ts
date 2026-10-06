import { invoke } from "@tauri-apps/api/core";
import type {
  BulkMedicineFieldUpdate,
  ImportedMedicineRecord,
  StoreSettings,
} from "../types";

export type PharmacyMutation =
  | {
      kind: "create_medicine";
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
      opening_batch: ImportedMedicineRecord["opening_batch"];
    }
  | {
      kind: "update_medicine";
      medicine_id: number;
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
    }
  | { kind: "delete_medicine"; medicine_id: number }
  | {
      kind: "update_batch_details";
      batch_id: number;
      medicine_id: number;
      mrp_cents: number;
      sale_rate_cents: number;
      rack_location: string | null;
    }
  | {
      kind: "adjust_batch_stock";
      batch_id: number;
      medicine_id: number;
      quantity_change: number;
      reason: string;
    }
  | {
      kind: "adjust_batch_stock_bulk";
      adjustments: Array<{
        batch_id: number;
        medicine_id: number;
        quantity_change: number;
      }>;
      reason: string;
    }
  | {
      kind: "bulk_update_medicine_fields";
      medicine_ids: number[];
      updates: BulkMedicineFieldUpdate[];
    }
  | {
      kind: "import_medicines";
      records: ImportedMedicineRecord[];
    }
  | {
      kind: "deduct_stock";
      deductions: Array<{ batch_id: number; quantity: number }>;
    }
  | { kind: "add_stock"; batch_id: number; quantity: number }
  | {
      kind: "create_supplier";
      name: string;
      contact_person: string | null;
      phone: string | null;
      whatsapp_phone: string | null;
      address: string | null;
      notes: string | null;
      state_code: string | null;
    }
  | {
      kind: "update_supplier";
      supplier_id: number;
      name: string;
      contact_person: string | null;
      phone: string | null;
      whatsapp_phone: string | null;
      address: string | null;
      notes: string | null;
      state_code: string | null;
    }
  | { kind: "delete_supplier"; supplier_id: number }
  | {
      kind: "create_customer";
      name: string;
      phone: string | null;
      address: string | null;
      notes: string | null;
      state_code: string | null;
    }
  | {
      kind: "update_customer";
      customer_id: number;
      name: string;
      phone: string | null;
      address: string | null;
      notes: string | null;
      state_code: string | null;
    }
  | { kind: "set_customer_active"; customer_id: number; active: boolean }
  | { kind: "save_settings"; settings: StoreSettings };

interface PharmacyMutationResult {
  entityId: number | null;
}

export function applyPharmacyMutation(
  operation: PharmacyMutation,
): Promise<PharmacyMutationResult> {
  return invoke<PharmacyMutationResult>("apply_pharmacy_mutation", {
    operation,
  });
}