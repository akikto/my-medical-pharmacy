import type { StoreSettings } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { applyPharmacyMutation } from "./pharmacyWriteService";

interface StoreSettingRow {
  setting_key: string;
  setting_value: string;
}

const textSettingKeys: Array<keyof Pick<
  StoreSettings,
  | "pharmacy_name"
  | "address"
  | "contact_number"
  | "drug_license_number"
  | "receipt_footer_note"
  | "upi_id"
  | "upi_display_name"
  | "gst_pharmacy_state_code"
>> = [
  "pharmacy_name",
  "address",
  "contact_number",
  "drug_license_number",
  "receipt_footer_note",
  "upi_id",
  "upi_display_name",
  "gst_pharmacy_state_code",
];

const defaults: StoreSettings = {
  pharmacy_name: "",
  address: "",
  contact_number: "",
  drug_license_number: "",
  receipt_footer_note: "Thank you for choosing us. Please retain this receipt for your records.",
  upi_id: "",
  upi_display_name: "",
  gst_enabled: false,
  gst_default_rate_basis_points: null,
  gst_pricing_mode: "EXCLUSIVE",
  gst_pharmacy_state_code: "",
};

const maximumLengths: Record<(typeof textSettingKeys)[number], number> = {
  pharmacy_name: 160,
  address: 500,
  contact_number: 40,
  drug_license_number: 100,
  receipt_footer_note: 300,
  upi_id: 100,
  upi_display_name: 120,
  gst_pharmacy_state_code: 2,
};

export async function getStoreSettings(): Promise<StoreSettings> {
  const rows = await invoke<StoreSettingRow[]>("get_store_settings");
  const settings = { ...defaults };

  for (const row of rows) {
    if (textSettingKeys.includes(row.setting_key as (typeof textSettingKeys)[number])) {
      const key = row.setting_key as (typeof textSettingKeys)[number];
      settings[key] = row.setting_value;
    } else if (row.setting_key === "gst_enabled") {
      settings.gst_enabled = row.setting_value.toLowerCase() === "true";
    } else if (row.setting_key === "gst_default_rate_basis_points") {
      const rate = Number(row.setting_value);
      settings.gst_default_rate_basis_points =
        row.setting_value === "" || !Number.isSafeInteger(rate) ? null : rate;
    } else if (row.setting_key === "gst_pricing_mode") {
      settings.gst_pricing_mode =
        row.setting_value === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE";
    }
  }

  return settings;
}

export async function saveStoreSettings(
  input: StoreSettings,
): Promise<void> {
  const settings = { ...defaults };
  for (const settingKey of textSettingKeys) {
    const value = input[settingKey].trim();
    if (value.length > maximumLengths[settingKey]) {
      throw new Error(
        `${settingKey.replaceAll("_", " ")} must be ${maximumLengths[settingKey]} characters or fewer.`,
      );
    }
    settings[settingKey] = value;
  }
  if (
    input.gst_default_rate_basis_points !== null &&
    (!Number.isSafeInteger(input.gst_default_rate_basis_points) ||
      input.gst_default_rate_basis_points < 0 ||
      input.gst_default_rate_basis_points > 10_000)
  ) {
    throw new Error("Default GST rate must be between 0% and 100%, in 0.01% increments.");
  }
  if (!["INCLUSIVE", "EXCLUSIVE"].includes(input.gst_pricing_mode)) {
    throw new Error("Choose inclusive or exclusive GST pricing.");
  }
  if (input.gst_pharmacy_state_code && !/^\d{2}$/.test(input.gst_pharmacy_state_code)) {
    throw new Error("Choose a valid pharmacy GST state.");
  }
  if (input.gst_enabled && !input.gst_pharmacy_state_code) {
    throw new Error("Set the pharmacy state before enabling GST.");
  }
  if (
    input.upi_id &&
    (!input.upi_id.includes("@") ||
      input.upi_id.startsWith("@") ||
      input.upi_id.endsWith("@") ||
      /\s/.test(input.upi_id))
  ) {
    throw new Error("Enter a valid UPI ID, or leave it blank.");
  }
  settings.gst_enabled = input.gst_enabled;
  settings.gst_default_rate_basis_points = input.gst_default_rate_basis_points;
  settings.gst_pricing_mode = input.gst_pricing_mode;

  await applyPharmacyMutation({ kind: "save_settings", settings });
}