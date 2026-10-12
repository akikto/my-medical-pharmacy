use std::{
    fs::{self, OpenOptions},
    io::Write,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const MAX_LOG_BYTES: u64 = 512 * 1024;
static PRINT_DIAGNOSTIC_FILE_LOCK: Mutex<()> = Mutex::new(());

const ALLOWED_EVENTS: &[&str] = &[
    "receipt_window_open_started",
    "receipt_window_open_succeeded",
    "receipt_window_open_failed",
    "receipt_data_load_started",
    "receipt_data_load_succeeded",
    "receipt_data_not_found",
    "receipt_data_load_failed",
    "receipt_data_load_timed_out",
    "receipt_settings_load_started",
    "receipt_settings_load_succeeded",
    "receipt_settings_load_failed",
    "receipt_document_ready",
    "receipt_native_protection_enabled",
    "receipt_window_print_called",
    "receipt_print_started",
    "receipt_afterprint",
    "receipt_afterprint_missing",
    "receipt_protection_reset_failed",
    "receipt_protection_reset",
    "receipt_print_failed",
    "receipt_close_started",
    "receipt_close_succeeded",
    "receipt_close_failed",
    "barcode_print_started",
    "barcode_print_afterprint",
    "barcode_print_timed_out",
    "barcode_print_failed",
    "order_list_print_started",
    "order_list_print_failed",
    "report_data_load_started",
    "report_data_load_succeeded",
    "report_data_load_failed",
    "report_print_started",
    "report_print_afterprint",
    "report_print_failed",
];

const ALLOWED_ERRORS: &[&str] = &[
    "data_load_rejected",
    "settings_load_rejected",
    "settings_not_ready",
    "native_invoke_rejected",
    "document_not_ready",
    "print_exception",
    "close_rejected",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticRecord {
    timestamp_ms: u128,
    event: String,
    elapsed_ms: Option<u64>,
    error_code: Option<String>,
}

fn valid_record(event: &str, error_code: Option<&str>) -> bool {
    ALLOWED_EVENTS.contains(&event) && error_code.is_none_or(|code| ALLOWED_ERRORS.contains(&code))
}

fn write_record(path: &std::path::Path, record: &DiagnosticRecord) -> Result<(), String> {
    let _guard = PRINT_DIAGNOSTIC_FILE_LOCK
        .lock()
        .map_err(|error| format!("Could not lock print diagnostics: {error}"))?;
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_LOG_BYTES {
            let previous = path.with_extension("jsonl.1");
            let _ = fs::remove_file(&previous);
            fs::rename(path, previous)
                .map_err(|error| format!("Could not rotate print diagnostics: {error}"))?;
        }
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("Could not open print diagnostics: {error}"))?;
    let mut line = serde_json::to_vec(record)
        .map_err(|error| format!("Could not encode print diagnostics: {error}"))?;
    line.push(b'\n');
    file.write_all(&line)
        .map_err(|error| format!("Could not write print diagnostics: {error}"))
}

#[tauri::command]
pub(crate) async fn record_print_diagnostic(
    app: AppHandle,
    event: String,
    elapsed_ms: Option<u64>,
    error_code: Option<String>,
) -> Result<(), String> {
    if !valid_record(&event, error_code.as_deref()) {
        return Err("Unsupported print diagnostic event.".to_owned());
    }
    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not timestamp print diagnostic: {error}"))?
        .as_millis();
    let record = DiagnosticRecord {
        timestamp_ms,
        event,
        elapsed_ms,
        error_code,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("Could not locate print diagnostics directory: {error}"))?;
        fs::create_dir_all(&directory)
            .map_err(|error| format!("Could not create print diagnostics directory: {error}"))?;
        write_record(&directory.join("print-diagnostics.jsonl"), &record)
    })
    .await
    .map_err(|error| format!("Could not finish print diagnostics write: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{valid_record, write_record, DiagnosticRecord};
    use std::{fs, time::SystemTime};

    #[test]
    fn diagnostic_records_reject_free_text_and_unknown_events() {
        assert!(valid_record("receipt_data_load_started", None));
        assert!(valid_record(
            "receipt_print_failed",
            Some("print_exception")
        ));
        assert!(!valid_record("customer_9876543210", None));
        assert!(!valid_record(
            "receipt_print_failed",
            Some("invoice INV-123 failed")
        ));
    }

    #[test]
    fn diagnostic_file_contains_only_allowlisted_fields() {
        let path = std::env::temp_dir().join(format!(
            "my-medical-print-diagnostics-{}.jsonl",
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let record = DiagnosticRecord {
            timestamp_ms: 123,
            event: "receipt_afterprint".to_owned(),
            elapsed_ms: Some(45),
            error_code: None,
        };
        write_record(&path, &record).expect("write safe diagnostic event");
        let contents = fs::read_to_string(&path).expect("read diagnostic event");
        assert!(contents.contains("\"event\":\"receipt_afterprint\""));
        assert!(!contents.contains("invoice"));
        fs::remove_file(path).expect("remove test diagnostic file");
    }
}
