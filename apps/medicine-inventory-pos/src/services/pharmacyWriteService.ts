import { invoke } from "@tauri-apps/api/core";
import type { StoreSettings } from "../types";

export type PharmacyMutation =
  | {
      kind: "create_medicine";
      name: string;
      generic_name: string | null;
      company: string | null;
      rack_location: string | null;
      min_stock_alert: number;
    }
  | {
      kind: "update_medicine";
      medicine_id: number;
      name: string;
      generic_name: string | null;
      company: string | null;
      rack_location: string | null;
      min_stock_alert: number;
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
    }
  | { kind: "delete_supplier"; supplier_id: number }
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