import type { StoreSettings } from "../types";
import { runInTransaction, selectSql } from "./db";

interface StoreSettingRow {
  setting_key: string;
  setting_value: string;
}

const settingKeys: Array<keyof StoreSettings> = [
  "pharmacy_name",
  "address",
  "contact_number",
  "drug_license_number",
  "receipt_footer_note",
];

const defaults: StoreSettings = {
  pharmacy_name: "",
  address: "",
  contact_number: "",
  drug_license_number: "",
  receipt_footer_note: "Thank you for choosing us. Please retain this receipt for your records.",
};

const maximumLengths: Record<keyof StoreSettings, number> = {
  pharmacy_name: 160,
  address: 500,
  contact_number: 40,
  drug_license_number: 100,
  receipt_footer_note: 300,
};

export async function getStoreSettings(): Promise<StoreSettings> {
  const rows = await selectSql<StoreSettingRow[]>(
    "SELECT setting_key, setting_value FROM app_settings",
  );
  const settings = { ...defaults };

  for (const row of rows) {
    if (settingKeys.includes(row.setting_key as keyof StoreSettings)) {
      settings[row.setting_key as keyof StoreSettings] = row.setting_value;
    }
  }

  return settings;
}

export async function saveStoreSettings(
  input: StoreSettings,
): Promise<void> {
  const statements = settingKeys.map((settingKey) => {
    const value = input[settingKey].trim();
    if (value.length > maximumLengths[settingKey]) {
      throw new Error(
        `${settingKey.replaceAll("_", " ")} must be ${maximumLengths[settingKey]} characters or fewer.`,
      );
    }
    return {
      query: `INSERT INTO app_settings (setting_key, setting_value)
              VALUES ($1, $2)
              ON CONFLICT(setting_key) DO UPDATE
              SET setting_value = excluded.setting_value`,
      values: [settingKey, value],
      expectedRowsAffected: 1,
    };
  });

  await runInTransaction(statements);
}