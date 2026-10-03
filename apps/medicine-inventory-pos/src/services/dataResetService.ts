import { invoke } from "@tauri-apps/api/core";
import type { DataResetScope, DataResetSummary } from "../types";

export async function resetBusinessData(
  scope: DataResetScope,
  confirmationPhrase: string,
): Promise<DataResetSummary> {
  return invoke<DataResetSummary>("reset_business_data", {
    scope,
    confirmationPhrase,
  });
}