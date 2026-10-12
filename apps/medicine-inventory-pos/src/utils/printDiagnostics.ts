import { invoke } from "@tauri-apps/api/core";

export type PrintDiagnosticEvent =
  | "receipt_window_open_started"
  | "receipt_window_open_succeeded"
  | "receipt_window_open_failed"
  | "receipt_data_load_started"
  | "receipt_data_load_succeeded"
  | "receipt_data_not_found"
  | "receipt_data_load_failed"
  | "receipt_data_load_timed_out"
  | "receipt_settings_load_started"
  | "receipt_settings_load_succeeded"
  | "receipt_settings_load_failed"
  | "receipt_document_ready"
  | "receipt_native_protection_enabled"
  | "receipt_window_print_called"
  | "receipt_print_started"
  | "receipt_afterprint"
  | "receipt_afterprint_missing"
  | "receipt_protection_reset_failed"
  | "receipt_protection_reset"
  | "receipt_print_failed"
  | "receipt_close_started"
  | "receipt_close_succeeded"
  | "receipt_close_failed"
  | "barcode_print_started"
  | "barcode_print_afterprint"
  | "barcode_print_timed_out"
  | "barcode_print_failed"
  | "order_list_print_started"
  | "order_list_print_failed"
  | "report_data_load_started"
  | "report_data_load_succeeded"
  | "report_data_load_failed"
  | "report_print_started"
  | "report_print_afterprint"
  | "report_print_failed";

export type PrintDiagnosticErrorCode =
  | "data_load_rejected"
  | "settings_load_rejected"
  | "settings_not_ready"
  | "native_invoke_rejected"
  | "document_not_ready"
  | "print_exception"
  | "close_rejected";

export function recordPrintDiagnostic(
  event: PrintDiagnosticEvent,
  options: { elapsedMs?: number; errorCode?: PrintDiagnosticErrorCode } = {},
): void {
  const record = {
    event,
    elapsedMs: options.elapsedMs,
    errorCode: options.errorCode,
  };
  console.info("[MY MEDICAL print]", record);
  void invoke("record_print_diagnostic", {
    event,
    elapsedMs: options.elapsedMs ?? null,
    errorCode: options.errorCode ?? null,
  }).catch(() => {
    console.warn("[MY MEDICAL print] Could not persist diagnostic event", { event });
  });
}
