use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{
    params, params_from_iter, types::Value as SqliteValue, Connection, OpenFlags,
    OptionalExtension, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

const LATEST_DATABASE_VERSION: i64 = 4;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransactionStatement {
    query: String,
    #[serde(default)]
    values: Vec<Value>,
    expected_rows_affected: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionStatementResult {
    rows_affected: usize,
    last_insert_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleCheckoutItem {
    medicine_id: i64,
    batch_id: i64,
    quantity: i64,
    unit_price_cents: i64,
    item_discount_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleCheckoutRequest {
    customer_name: Option<String>,
    customer_phone: Option<String>,
    payment_mode: String,
    flat_discount_cents: i64,
    cash_tendered_cents: i64,
    items: Vec<SaleCheckoutItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaleCheckoutResult {
    sale_id: i64,
    invoice_no: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseItemRequest {
    medicine_id: i64,
    batch_no: String,
    expiry_date: String,
    purchase_rate_cents: i64,
    mrp_cents: i64,
    sale_rate_cents: i64,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseRequest {
    supplier_id: i64,
    invoice_no: String,
    purchase_date: String,
    items: Vec<PurchaseItemRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseResult {
    purchase_id: i64,
    total_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseBackupResult {
    path: String,
}

fn to_sqlite_value(value: &Value) -> Result<SqliteValue, String> {
    match value {
        Value::Null => Ok(SqliteValue::Null),
        Value::Bool(value) => Ok(SqliteValue::Integer(if *value { 1 } else { 0 })),
        Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(SqliteValue::Integer(integer))
            } else if let Some(unsigned) = value.as_u64() {
                i64::try_from(unsigned)
                    .map(SqliteValue::Integer)
                    .map_err(|_| "Integer bind value exceeds SQLite's supported range.".to_owned())
            } else if let Some(float) = value.as_f64() {
                Ok(SqliteValue::Real(float))
            } else {
                Err("Unsupported numeric bind value.".to_owned())
            }
        }
        Value::String(value) => Ok(SqliteValue::Text(value.clone())),
        Value::Array(_) | Value::Object(_) => {
            Err("SQL bind values must be scalar values.".to_owned())
        }
    }
}

fn pharmacy_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not locate the app configuration directory: {error}"))?;
    std::fs::create_dir_all(&app_config_dir)
        .map_err(|error| format!("Could not create the app configuration directory: {error}"))?;

    Ok(app_config_dir.join("pharmacy.db"))
}

fn open_pharmacy_connection(app: &AppHandle) -> Result<Connection, String> {
    let connection = Connection::open(pharmacy_database_path(app)?)
        .map_err(|error| format!("Could not open the local pharmacy database: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Could not configure the database timeout: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Could not enable database foreign keys: {error}"))?;
    connection
        .query_row("PRAGMA journal_mode = WAL", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| format!("Could not enable the SQLite write-ahead log: {error}"))?;
    Ok(connection)
}

fn database_timestamp(database_path: &Path) -> Result<String, String> {
    let connection = Connection::open(database_path)
        .map_err(|error| format!("Could not read the local database clock: {error}"))?;
    connection
        .query_row(
            "SELECT strftime('%Y-%m-%d_%H-%M-%S', 'now', 'localtime')",
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Could not create a local backup timestamp: {error}"))
}

fn unique_internal_path(directory: &Path, prefix: &str, extension: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    directory.join(format!(".{prefix}-{nanos}.{extension}"))
}

fn sqlite_sidecar_path(database_path: &Path, suffix: &str) -> PathBuf {
    let mut path = database_path.as_os_str().to_os_string();
    path.push(suffix);
    PathBuf::from(path)
}

fn require_backup_columns(
    connection: &Connection,
    table: &str,
    required_columns: &[&str],
) -> Result<(), String> {
    let query = format!("PRAGMA table_info({table})");
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("Could not inspect the backup's {table} table: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Could not inspect the backup's {table} columns: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read the backup's {table} columns: {error}"))?;

    if let Some(missing) = required_columns
        .iter()
        .find(|required| !columns.iter().any(|column| column == **required))
    {
        return Err(format!(
            "The selected backup is missing the {table}.{missing} field."
        ));
    }
    Ok(())
}

fn validate_backup_database(database_path: &Path) -> Result<(), String> {
    if !database_path.is_file() {
        return Err("The selected backup is not a database file.".to_owned());
    }

    let connection = Connection::open_with_flags(database_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("Could not open the selected backup: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("Could not configure backup validation: {error}"))?;

    let integrity_results = {
        let mut statement = connection
            .prepare("PRAGMA integrity_check")
            .map_err(|error| format!("Could not check backup integrity: {error}"))?;
        let mapped_rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("Could not check backup integrity: {error}"))?;
        let results = mapped_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read backup integrity results: {error}"))?;
        results
    };
    if integrity_results.len() != 1 || integrity_results[0] != "ok" {
        let detail = integrity_results
            .first()
            .map(String::as_str)
            .unwrap_or("SQLite returned no integrity result.");
        return Err(format!("The selected backup failed its integrity check: {detail}"));
    }

    let foreign_key_errors = {
        let mut statement = connection
            .prepare("PRAGMA foreign_key_check")
            .map_err(|error| format!("Could not check backup relationships: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| format!("Could not check backup relationships: {error}"))?;
        let results = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read backup relationship results: {error}"))?;
        results
    };
    if let Some((table, row_id, parent_table)) = foreign_key_errors.first() {
        return Err(format!(
            "The selected backup has an invalid relationship in {table} row {} referencing {parent_table}.",
            row_id
                .map(|value| value.to_string())
                .unwrap_or_else(|| "without a row id".to_owned())
        ));
    }

    for table in [
        "schema_migrations",
        "medicines",
        "medicine_batches",
        "suppliers",
        "purchases",
        "purchase_items",
        "sales",
        "sale_items",
    ] {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM sqlite_master
                   WHERE type = 'table' AND name = ?1
                 )",
                [table],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not validate the backup's {table} table: {error}"))?;
        if !exists {
            return Err(format!(
                "The selected file is not a PharmaDesk backup: {table} is missing."
            ));
        }
    }

    let versions = {
        let mut statement = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
            .map_err(|error| format!("Could not read the backup's schema version: {error}"))?;
        let mapped_rows = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("Could not read the backup's schema version: {error}"))?;
        let results = mapped_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read the backup's schema version: {error}"))?;
        results
    };
    if versions.is_empty() {
        return Err("The selected database has no PharmaDesk migration history.".to_owned());
    }
    for (index, version) in versions.iter().enumerate() {
        if *version != index as i64 + 1 {
            return Err("The selected backup has an incomplete migration history.".to_owned());
        }
    }
    let version = *versions.last().expect("validated non-empty migration history");
    if version > LATEST_DATABASE_VERSION {
        return Err(format!(
            "This backup was created by a newer PharmaDesk database version ({version})."
        ));
    }

    require_backup_columns(
        &connection,
        "schema_migrations",
        &["version", "applied_at"],
    )?;
    require_backup_columns(
        &connection,
        "medicines",
        &[
            "id",
            "name",
            "generic_name",
            "company",
            "rack_location",
            "min_stock_alert",
            "created_at",
        ],
    )?;
    require_backup_columns(
        &connection,
        "medicine_batches",
        &[
            "id",
            "medicine_id",
            "batch_no",
            "expiry_date",
            "purchase_rate",
            "mrp",
            "sale_rate",
            "current_stock",
            "barcode",
        ],
    )?;
    require_backup_columns(
        &connection,
        "suppliers",
        &["id", "name", "phone", "address", "balance_due"],
    )?;
    require_backup_columns(
        &connection,
        "purchases",
        &["id", "invoice_no", "supplier_id", "total_amount", "purchase_date"],
    )?;
    require_backup_columns(
        &connection,
        "purchase_items",
        &["id", "purchase_id", "batch_id", "quantity", "rate", "total"],
    )?;
    require_backup_columns(
        &connection,
        "sales",
        &[
            "id",
            "invoice_no",
            "customer_name",
            "customer_phone",
            "subtotal",
            "discount",
            "grand_total",
            "payment_mode",
            "created_at",
        ],
    )?;
    require_backup_columns(
        &connection,
        "sale_items",
        &["id", "sale_id", "batch_id", "quantity", "unit_price", "total_price"],
    )?;
    if version >= 2 {
        require_backup_columns(
            &connection,
            "sales",
            &["flat_discount", "cash_tendered", "change_due"],
        )?;
        require_backup_columns(&connection, "sale_items", &["item_discount"])?;
    }
    if version >= 3 {
        require_backup_columns(
            &connection,
            "stock_adjustments",
            &["id", "medicine_id", "batch_id", "reason", "created_at"],
        )?;
    }
    if version >= 4 {
        require_backup_columns(&connection, "sale_items", &["purchase_rate_at_sale"])?;
        require_backup_columns(
            &connection,
            "app_settings",
            &["setting_key", "setting_value"],
        )?;
    }

    Ok(())
}

fn create_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.is_file() {
        return Err("The local pharmacy database does not exist yet.".to_owned());
    }
    if destination.exists() || fs::symlink_metadata(destination).is_ok() {
        return Err("A file already exists at the selected backup location.".to_owned());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Choose a valid backup folder.".to_owned())?;
    if !parent.is_dir() {
        return Err("The selected backup folder does not exist or is unavailable.".to_owned());
    }
    let destination_text = destination
        .to_str()
        .ok_or_else(|| "The backup path cannot be represented as a valid file path.".to_owned())?;

    let snapshot_result = (|| {
        let connection = Connection::open(source)
            .map_err(|error| format!("Could not open the pharmacy database for backup: {error}"))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| format!("Could not configure the database backup: {error}"))?;
        connection
            .execute("VACUUM INTO ?1", [destination_text])
            .map_err(|error| format!("Could not create the database snapshot: {error}"))?;
        drop(connection);
        validate_backup_database(destination)
    })();

    if snapshot_result.is_err() {
        let _ = fs::remove_file(destination);
    }
    snapshot_result
}

fn next_dated_backup_path(
    directory: &Path,
    prefix: &str,
    timestamp: &str,
) -> Result<PathBuf, String> {
    let base_name = format!("{prefix}_{timestamp}.db");
    let candidate = directory.join(&base_name);
    if !candidate.exists() {
        return Ok(candidate);
    }

    for suffix in 2..=999 {
        let candidate = directory.join(format!("{prefix}_{timestamp}_{suffix}.db"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not choose a unique internal backup filename.".to_owned())
}

fn create_internal_snapshot(
    app: &AppHandle,
    prefix: &str,
) -> Result<Option<PathBuf>, String> {
    let database_path = pharmacy_database_path(app)?;
    if !database_path.is_file() {
        return Ok(None);
    }
    let backup_directory = database_path
        .parent()
        .ok_or_else(|| "Could not locate the internal backup folder.".to_owned())?
        .join("backups");
    fs::create_dir_all(&backup_directory)
        .map_err(|error| format!("Could not create the internal backup folder: {error}"))?;
    let timestamp = database_timestamp(&database_path)?;
    let destination = next_dated_backup_path(&backup_directory, prefix, &timestamp)?;
    create_snapshot(&database_path, &destination)?;
    Ok(Some(destination))
}

fn validate_database_extension(path: &Path) -> Result<(), String> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("db"))
    {
        return Err("Choose a PharmaDesk .db backup file.".to_owned());
    }
    Ok(())
}

fn selected_backup_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("The selected backup path is not absolute.".to_owned());
    }
    validate_database_extension(path)?;
    fs::canonicalize(path).map_err(|error| format!("Could not access the selected backup: {error}"))
}

fn backup_destination_path(
    active_database: &Path,
    destination: &Path,
) -> Result<PathBuf, String> {
    if !destination.is_absolute() {
        return Err("Choose an absolute path for the backup file.".to_owned());
    }
    validate_database_extension(destination)?;
    if destination.exists() || fs::symlink_metadata(destination).is_ok() {
        return Err("A file already exists at the selected backup location.".to_owned());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Choose a valid backup folder.".to_owned())?;
    if !parent.is_dir() {
        return Err("The selected backup folder does not exist or is unavailable.".to_owned());
    }
    let file_name = destination
        .file_name()
        .ok_or_else(|| "Choose a valid backup filename.".to_owned())?;
    let normalized_destination = fs::canonicalize(parent)
        .map_err(|error| format!("Could not access the selected backup folder: {error}"))?
        .join(file_name);
    let active_database = fs::canonicalize(active_database)
        .map_err(|error| format!("Could not locate the local pharmacy database: {error}"))?;
    if normalized_destination == active_database {
        return Err("The backup destination cannot replace the active pharmacy database.".to_owned());
    }
    Ok(normalized_destination)
}

#[tauri::command]
fn create_database_backup(
    app: AppHandle,
    destination_path: String,
) -> Result<DatabaseBackupResult, String> {
    let active_database = pharmacy_database_path(&app)?;
    if !active_database.is_file() {
        return Err("The local pharmacy database does not exist yet.".to_owned());
    }
    let destination =
        backup_destination_path(&active_database, Path::new(&destination_path))?;
    create_snapshot(&active_database, &destination)?;
    Ok(DatabaseBackupResult {
        path: destination.display().to_string(),
    })
}

fn rollback_database_replacement(
    active_database: &Path,
    previous_database: &Path,
    moved_sidecars: &[(PathBuf, PathBuf)],
    previous_database_moved: bool,
    replacement_installed: bool,
) {
    if replacement_installed {
        let _ = fs::remove_file(active_database);
        for suffix in ["-wal", "-shm"] {
            let _ = fs::remove_file(sqlite_sidecar_path(active_database, suffix));
        }
    }
    for (original_sidecar, previous_sidecar) in moved_sidecars.iter().rev() {
        if previous_sidecar.exists() {
            let _ = fs::rename(previous_sidecar, original_sidecar);
        }
    }
    if previous_database_moved && previous_database.exists() {
        let _ = fs::rename(previous_database, active_database);
    }
}

#[tauri::command]
fn restore_database_backup(app: AppHandle, source_path: String) -> Result<(), String> {
    let active_database = pharmacy_database_path(&app)?;
    if !active_database.is_file() {
        return Err("The local pharmacy database is not available to restore.".to_owned());
    }

    let source = selected_backup_path(Path::new(&source_path))?;
    let active_canonical = fs::canonicalize(&active_database)
        .map_err(|error| format!("Could not locate the local pharmacy database: {error}"))?;
    if source == active_canonical {
        return Err("Choose a backup file other than the active pharmacy database.".to_owned());
    }
    validate_backup_database(&source)?;

    let config_directory = active_database
        .parent()
        .ok_or_else(|| "Could not locate the local pharmacy database folder.".to_owned())?;
    let staged_database = unique_internal_path(config_directory, "restore-stage", "db");
    create_snapshot(&source, &staged_database)?;
    if let Err(error) = validate_backup_database(&staged_database) {
        let _ = fs::remove_file(&staged_database);
        return Err(error);
    }

    if create_internal_snapshot(&app, "before-restore")?.is_none() {
        let _ = fs::remove_file(&staged_database);
        return Err("A safety backup could not be created before restore.".to_owned());
    }

    let current_connection = open_pharmacy_connection(&app)?;
    let (checkpoint_busy, _, _): (i64, i64, i64) = current_connection
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| {
            let _ = fs::remove_file(&staged_database);
            format!("Could not safely close the current database: {error}")
        })?;
    if checkpoint_busy != 0 {
        let _ = fs::remove_file(&staged_database);
        return Err("The database is busy. Close other database activity and try again.".to_owned());
    }
    drop(current_connection);

    let previous_database = unique_internal_path(config_directory, "restore-previous", "db");
    if let Err(error) = fs::rename(&active_database, &previous_database) {
        let _ = fs::remove_file(&staged_database);
        return Err(format!("Could not prepare the current database for restore: {error}"));
    }

    let mut moved_sidecars = Vec::new();
    for suffix in ["-wal", "-shm"] {
        let original_sidecar = sqlite_sidecar_path(&active_database, suffix);
        if !original_sidecar.exists() {
            continue;
        }
        let previous_sidecar = sqlite_sidecar_path(&previous_database, suffix);
        if let Err(error) = fs::rename(&original_sidecar, &previous_sidecar) {
            rollback_database_replacement(
                &active_database,
                &previous_database,
                &moved_sidecars,
                true,
                false,
            );
            let _ = fs::remove_file(&staged_database);
            return Err(format!("Could not safely move the current database files: {error}"));
        }
        moved_sidecars.push((original_sidecar, previous_sidecar));
    }

    if let Err(error) = fs::rename(&staged_database, &active_database) {
        rollback_database_replacement(
            &active_database,
            &previous_database,
            &moved_sidecars,
            true,
            false,
        );
        let _ = fs::remove_file(&staged_database);
        return Err(format!("Could not install the selected database backup: {error}"));
    }

    let restored_connection = match open_pharmacy_connection(&app) {
        Ok(connection) => connection,
        Err(error) => {
            rollback_database_replacement(
                &active_database,
                &previous_database,
                &moved_sidecars,
                true,
                true,
            );
            return Err(format!(
                "The restored database could not be opened; the original database was put back: {error}"
            ));
        }
    };
    drop(restored_connection);

    let _ = fs::remove_file(&previous_database);
    for (_, previous_sidecar) in moved_sidecars {
        let _ = fs::remove_file(previous_sidecar);
    }
    Ok(())
}

fn register_auto_backup_on_close(
    app: &mut tauri::App,
) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "main window not found"))?;
    let app_handle = app.handle().clone();
    let backup_started = Arc::new(AtomicBool::new(false));
    let backup_complete = Arc::new(AtomicBool::new(false));
    let started_state = Arc::clone(&backup_started);
    let complete_state = Arc::clone(&backup_complete);
    let window_for_closing = window.clone();

    window.on_window_event(move |event| {
        let WindowEvent::CloseRequested { api, .. } = event else {
            return;
        };
        if complete_state.load(Ordering::SeqCst) {
            return;
        }

        api.prevent_close();
        if started_state.swap(true, Ordering::SeqCst) {
            return;
        }

        let app_handle = app_handle.clone();
        let closing_window = window_for_closing.clone();
        let started_state = Arc::clone(&started_state);
        let complete_state = Arc::clone(&complete_state);
        std::thread::spawn(move || {
            match create_internal_snapshot(&app_handle, "backup") {
                Ok(Some(path)) => eprintln!("Automatic pharmacy backup saved to {}", path.display()),
                Ok(None) => {}
                Err(error) => {
                    started_state.store(false, Ordering::SeqCst);
                    if let Err(emit_error) =
                        app_handle.emit("pharmadesk:auto-backup-failed", error.clone())
                    {
                        eprintln!("Could not report the automatic backup failure: {emit_error}");
                    }
                    return;
                }
            }

            complete_state.store(true, Ordering::SeqCst);
            if let Err(error) = closing_window.close() {
                eprintln!("Could not close the pharmacy window after backup: {error}");
            }
        });
    });
    Ok(())
}

#[tauri::command]
fn execute_sql_transaction(
    app: AppHandle,
    statements: Vec<TransactionStatement>,
) -> Result<Vec<TransactionStatementResult>, String> {
    if statements.is_empty() {
        return Ok(Vec::new());
    }

    let mut connection = open_pharmacy_connection(&app)?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the database transaction: {error}"))?;
    let mut results = Vec::with_capacity(statements.len());

    for statement in statements {
        let values = statement
            .values
            .iter()
            .map(to_sqlite_value)
            .collect::<Result<Vec<_>, _>>()?;
        let rows_affected = transaction
            .execute(&statement.query, params_from_iter(values.iter()))
            .map_err(|error| format!("Database transaction statement failed: {error}"))?;

        if let Some(expected) = statement.expected_rows_affected {
            if rows_affected != expected {
                return Err(format!(
                    "Database transaction expected to affect {expected} row(s), but affected {rows_affected}."
                ));
            }
        }

        results.push(TransactionStatementResult {
            rows_affected,
            last_insert_id: transaction.last_insert_rowid(),
        });
    }

    transaction
        .commit()
        .map_err(|error| format!("Could not commit the database transaction: {error}"))?;
    Ok(results)
}

#[tauri::command]
fn complete_sale(
    app: AppHandle,
    checkout: SaleCheckoutRequest,
) -> Result<SaleCheckoutResult, String> {
    if checkout.items.is_empty() {
        return Err("Add at least one medicine before completing checkout.".to_owned());
    }
    if !matches!(
        checkout.payment_mode.as_str(),
        "CASH" | "CARD" | "UPI" | "CREDIT" | "OTHER"
    ) {
        return Err("The selected payment mode is not supported.".to_owned());
    }
    if checkout.flat_discount_cents < 0 || checkout.cash_tendered_cents < 0 {
        return Err("Discount and cash amounts cannot be negative.".to_owned());
    }
    if checkout.payment_mode != "CASH" && checkout.cash_tendered_cents != 0 {
        return Err("Cash tendered is only used for cash payments.".to_owned());
    }

    let mut subtotal_cents = 0_i64;
    let mut item_discount_cents = 0_i64;
    for item in &checkout.items {
        if item.medicine_id <= 0
            || item.batch_id <= 0
            || item.quantity <= 0
            || item.unit_price_cents < 0
            || item.item_discount_cents < 0
        {
            return Err(
                "Sale items contain an invalid id, quantity, price, or discount.".to_owned(),
            );
        }

        let line_gross_cents = item
            .unit_price_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| "Sale item total exceeds the supported amount.".to_owned())?;
        if item.item_discount_cents > line_gross_cents {
            return Err("An item discount cannot exceed that item's total.".to_owned());
        }
        subtotal_cents = subtotal_cents
            .checked_add(line_gross_cents)
            .ok_or_else(|| "Sale subtotal exceeds the supported amount.".to_owned())?;
        item_discount_cents = item_discount_cents
            .checked_add(item.item_discount_cents)
            .ok_or_else(|| "Item discounts exceed the supported amount.".to_owned())?;
    }

    let total_discount_cents = item_discount_cents
        .checked_add(checkout.flat_discount_cents)
        .ok_or_else(|| "Total discount exceeds the supported amount.".to_owned())?;
    if total_discount_cents > subtotal_cents {
        return Err("The combined discounts cannot exceed the sale subtotal.".to_owned());
    }
    let grand_total_cents = subtotal_cents - total_discount_cents;
    if checkout.payment_mode == "CASH" && checkout.cash_tendered_cents < grand_total_cents {
        return Err("Cash tendered must cover the final amount due.".to_owned());
    }
    let change_due_cents = if checkout.payment_mode == "CASH" {
        checkout.cash_tendered_cents - grand_total_cents
    } else {
        0
    };

    let mut connection = open_pharmacy_connection(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the sale transaction: {error}"))?;

    let invoice_no = transaction
        .query_row(
            r#"SELECT
                 'INV-' || strftime('%Y%m%d', 'now', 'localtime') || '-' ||
                 printf(
                   '%04d',
                   COALESCE(MAX(CAST(substr(invoice_no, 14) AS INTEGER)), 0) + 1
                 )
               FROM sales
               WHERE substr(invoice_no, 1, 13) =
                 'INV-' || strftime('%Y%m%d', 'now', 'localtime') || '-'"#,
            [],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("Could not generate the sale invoice number: {error}"))?;

    let customer_name = checkout
        .customer_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let customer_phone = checkout
        .customer_phone
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    transaction
        .execute(
            r#"INSERT INTO sales (
                 invoice_no, customer_name, customer_phone, subtotal, discount,
                 flat_discount, grand_total, payment_mode, cash_tendered, change_due
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
            params![
                invoice_no,
                customer_name,
                customer_phone,
                subtotal_cents as f64 / 100.0,
                total_discount_cents as f64 / 100.0,
                checkout.flat_discount_cents as f64 / 100.0,
                grand_total_cents as f64 / 100.0,
                checkout.payment_mode,
                checkout.cash_tendered_cents as f64 / 100.0,
                change_due_cents as f64 / 100.0,
            ],
        )
        .map_err(|error| format!("Could not create the sale invoice: {error}"))?;
    let sale_id = transaction.last_insert_rowid();

    for item in checkout.items {
        let rows_affected = transaction
            .execute(
                r#"UPDATE medicine_batches
                   SET current_stock = current_stock - ?1
                   WHERE id = ?2
                     AND medicine_id = ?3
                     AND current_stock >= ?1
                     AND expiry_date >= date('now', 'localtime')"#,
                params![item.quantity, item.batch_id, item.medicine_id],
            )
            .map_err(|error| format!("Could not deduct medicine stock: {error}"))?;
        if rows_affected != 1 {
            return Err(format!(
                "Batch {} is expired or no longer has enough stock. Refresh the cart and try again.",
                item.batch_id
            ));
        }

        let purchase_rate_cents: i64 = transaction
            .query_row(
                r#"SELECT CAST(round(purchase_rate * 100) AS INTEGER)
                   FROM medicine_batches
                   WHERE id = ?1 AND medicine_id = ?2"#,
                params![item.batch_id, item.medicine_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not capture the batch cost for the sale: {error}"))?;

        let line_gross_cents = item
            .unit_price_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| "Sale item total exceeds the supported amount.".to_owned())?;
        let line_total_cents = line_gross_cents - item.item_discount_cents;
        transaction
            .execute(
                r#"INSERT INTO sale_items (
                     sale_id, batch_id, quantity, unit_price, item_discount, total_price,
                     purchase_rate_at_sale
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                params![
                    sale_id,
                    item.batch_id,
                    item.quantity,
                    item.unit_price_cents as f64 / 100.0,
                    item.item_discount_cents as f64 / 100.0,
                    line_total_cents as f64 / 100.0,
                    purchase_rate_cents as f64 / 100.0,
                ],
            )
            .map_err(|error| format!("Could not add a sale item: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Could not commit the completed sale: {error}"))?;
    Ok(SaleCheckoutResult {
        sale_id,
        invoice_no,
    })
}

fn record_purchase(
    connection: &mut Connection,
    purchase: PurchaseRequest,
) -> Result<PurchaseResult, String> {
    let invoice_no = purchase.invoice_no.trim();
    if invoice_no.is_empty() || invoice_no.len() > 100 {
        return Err("Enter a purchase invoice number of 1 to 100 characters.".to_owned());
    }
    if purchase.supplier_id <= 0 {
        return Err("Select a supplier before saving the purchase.".to_owned());
    }
    if purchase.items.is_empty() {
        return Err("Add at least one line item to the purchase.".to_owned());
    }
    if purchase.items.len() > 500 {
        return Err("A purchase cannot contain more than 500 line items.".to_owned());
    }

    let mut total_cents = 0_i64;
    for item in &purchase.items {
        let batch_no = item.batch_no.trim();
        if item.medicine_id <= 0
            || item.quantity <= 0
            || item.quantity > 1_000_000_000
            || batch_no.is_empty()
            || batch_no.len() > 80
            || item.purchase_rate_cents < 0
            || item.mrp_cents < 0
            || item.sale_rate_cents < 0
        {
            return Err("Purchase lines need a medicine, batch number, valid prices, and a positive quantity.".to_owned());
        }
        let line_total = item
            .purchase_rate_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| "A purchase line total exceeds the supported amount.".to_owned())?;
        total_cents = total_cents
            .checked_add(line_total)
            .ok_or_else(|| "The purchase total exceeds the supported amount.".to_owned())?;
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the purchase transaction: {error}"))?;

    let valid_purchase_date: bool = transaction
        .query_row(
            "SELECT COALESCE(date(?1) = ?1, 0)",
            [&purchase.purchase_date],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not validate the purchase date: {error}"))?;
    if !valid_purchase_date {
        return Err("Enter a valid purchase date.".to_owned());
    }

    let supplier_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM suppliers WHERE id = ?1)",
            [purchase.supplier_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not validate the supplier: {error}"))?;
    if !supplier_exists {
        return Err("The selected supplier no longer exists. Refresh the supplier list.".to_owned());
    }

    let duplicate_invoice: bool = transaction
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM purchases
               WHERE supplier_id = ?1 AND invoice_no = ?2 COLLATE NOCASE
             )",
            params![purchase.supplier_id, invoice_no],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check the supplier invoice number: {error}"))?;
    if duplicate_invoice {
        return Err("That invoice number is already recorded for this supplier.".to_owned());
    }

    transaction
        .execute(
            "INSERT INTO purchases (invoice_no, supplier_id, total_amount, purchase_date)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                invoice_no,
                purchase.supplier_id,
                total_cents as f64 / 100.0,
                purchase.purchase_date,
            ],
        )
        .map_err(|error| format!("Could not create the purchase invoice: {error}"))?;
    let purchase_id = transaction.last_insert_rowid();

    for item in purchase.items {
        let batch_no = item.batch_no.trim();
        let valid_expiry: bool = transaction
            .query_row(
                "SELECT COALESCE(
                   date(?1) = ?1 AND ?1 >= date('now', 'localtime'),
                   0
                 )",
                [&item.expiry_date],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not validate the expiry date for batch {batch_no}: {error}"))?;
        if !valid_expiry {
            return Err(format!(
                "Batch {batch_no} needs a valid expiry date that is today or later."
            ));
        }

        let medicine_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM medicines WHERE id = ?1)",
                [item.medicine_id],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not validate medicine for batch {batch_no}: {error}"))?;
        if !medicine_exists {
            return Err("A selected medicine no longer exists. Refresh the purchase form.".to_owned());
        }

        let existing_batch: Option<(i64, i64)> = transaction
            .query_row(
                r#"SELECT id, current_stock
                 FROM medicine_batches
                 WHERE medicine_id = ?1
                   AND batch_no = ?2 COLLATE NOCASE
                   AND expiry_date = ?3
                 ORDER BY id ASC
                 LIMIT 1"#,
                params![item.medicine_id, batch_no, item.expiry_date],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("Could not find batch {batch_no}: {error}"))?;

        let batch_id = if let Some((batch_id, current_stock)) = existing_batch {
            let updated_stock = current_stock
                .checked_add(item.quantity)
                .ok_or_else(|| format!("Stock for batch {batch_no} exceeds the supported amount."))?;
            transaction
                .execute(
                    r#"UPDATE medicine_batches
                     SET purchase_rate = ?1,
                         mrp = ?2,
                         sale_rate = ?3,
                         current_stock = ?4
                     WHERE id = ?5"#,
                    params![
                        item.purchase_rate_cents as f64 / 100.0,
                        item.mrp_cents as f64 / 100.0,
                        item.sale_rate_cents as f64 / 100.0,
                        updated_stock,
                        batch_id,
                    ],
                )
                .map_err(|error| format!("Could not add stock to batch {batch_no}: {error}"))?;
            batch_id
        } else {
            transaction
                .execute(
                    r#"INSERT INTO medicine_batches (
                       medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                       sale_rate, current_stock
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                    params![
                        item.medicine_id,
                        batch_no,
                        item.expiry_date,
                        item.purchase_rate_cents as f64 / 100.0,
                        item.mrp_cents as f64 / 100.0,
                        item.sale_rate_cents as f64 / 100.0,
                        item.quantity,
                    ],
                )
                .map_err(|error| format!("Could not create batch {batch_no}: {error}"))?;
            transaction.last_insert_rowid()
        };

        let line_total_cents = item.purchase_rate_cents * item.quantity;
        transaction
            .execute(
                r#"INSERT INTO purchase_items (purchase_id, batch_id, quantity, rate, total)
                 VALUES (?1, ?2, ?3, ?4, ?5)"#,
                params![
                    purchase_id,
                    batch_id,
                    item.quantity,
                    item.purchase_rate_cents as f64 / 100.0,
                    line_total_cents as f64 / 100.0,
                ],
            )
            .map_err(|error| format!("Could not record purchase line for batch {batch_no}: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Could not commit the purchase and stock-in: {error}"))?;
    Ok(PurchaseResult {
        purchase_id,
        total_cents,
    })
}

#[tauri::command]
fn complete_purchase(app: AppHandle, purchase: PurchaseRequest) -> Result<PurchaseResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    record_purchase(&mut connection, purchase)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(register_auto_backup_on_close)
        .invoke_handler(tauri::generate_handler![
            execute_sql_transaction,
            complete_sale,
            complete_purchase,
            create_database_backup,
            restore_database_backup
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Medicine Inventory POS");
}

#[cfg(test)]
mod purchase_tests {
    use super::*;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(
                r#"
                PRAGMA foreign_keys = ON;
                CREATE TABLE medicines (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                );
                CREATE TABLE suppliers (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                );
                CREATE TABLE medicine_batches (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
                    batch_no TEXT NOT NULL,
                    expiry_date TEXT NOT NULL,
                    purchase_rate REAL NOT NULL,
                    mrp REAL NOT NULL,
                    sale_rate REAL NOT NULL,
                    current_stock INTEGER NOT NULL,
                    barcode TEXT
                );
                CREATE TABLE purchases (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    invoice_no TEXT NOT NULL,
                    supplier_id INTEGER REFERENCES suppliers(id),
                    total_amount REAL NOT NULL,
                    purchase_date TEXT NOT NULL
                );
                CREATE TABLE purchase_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
                    batch_id INTEGER NOT NULL REFERENCES medicine_batches(id),
                    quantity INTEGER NOT NULL,
                    rate REAL NOT NULL,
                    total REAL NOT NULL
                );
                INSERT INTO medicines (id, name) VALUES (1, 'Test medicine');
                INSERT INTO suppliers (id, name) VALUES (1, 'Test supplier');
                "#,
            )
            .expect("create purchase schema");
        connection
    }

    fn purchase_item(medicine_id: i64, quantity: i64) -> PurchaseItemRequest {
        PurchaseItemRequest {
            medicine_id,
            batch_no: "LOT-A".to_owned(),
            expiry_date: "2099-12-31".to_owned(),
            purchase_rate_cents: 1_234,
            mrp_cents: 2_000,
            sale_rate_cents: 1_800,
            quantity,
        }
    }

    fn purchase(invoice_no: &str, items: Vec<PurchaseItemRequest>) -> PurchaseRequest {
        PurchaseRequest {
            supplier_id: 1,
            invoice_no: invoice_no.to_owned(),
            purchase_date: "2026-10-01".to_owned(),
            items,
        }
    }

    #[test]
    fn purchase_rolls_back_invoice_items_and_existing_batch_stock_on_line_failure() {
        let mut connection = test_connection();
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                   id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                   sale_rate, current_stock
                 ) VALUES (1, 1, 'LOT-A', '2099-12-31', 10, 20, 18, 2)"#,
                [],
            )
            .expect("seed existing batch");

        let result = record_purchase(
            &mut connection,
            purchase("INV-ROLLBACK", vec![purchase_item(1, 3), purchase_item(999, 4)]),
        );

        assert!(result.is_err());
        let invoice_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM purchases", [], |row| row.get(0))
            .expect("count purchases");
        let item_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM purchase_items", [], |row| row.get(0))
            .expect("count purchase items");
        let current_stock: i64 = connection
            .query_row(
                "SELECT current_stock FROM medicine_batches WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read existing stock");

        assert_eq!(invoice_count, 0);
        assert_eq!(item_count, 0);
        assert_eq!(current_stock, 2);
    }

    #[test]
    fn purchase_creates_and_increments_matching_batch_and_rejects_duplicate_invoice() {
        let mut connection = test_connection();
        let first = record_purchase(
            &mut connection,
            purchase("INV-1", vec![purchase_item(1, 3)]),
        )
        .expect("save first purchase");
        assert_eq!(first.total_cents, 3_702);

        let mut second_item = purchase_item(1, 4);
        second_item.purchase_rate_cents = 1_300;
        let second = record_purchase(
            &mut connection,
            purchase("INV-2", vec![second_item]),
        )
        .expect("save second purchase");
        assert_eq!(second.total_cents, 5_200);

        let duplicate_result = record_purchase(
            &mut connection,
            purchase("INV-2", vec![purchase_item(1, 1)]),
        );
        assert!(duplicate_result.is_err());

        let (current_stock, purchase_rate): (i64, f64) = connection
            .query_row(
                "SELECT current_stock, purchase_rate FROM medicine_batches WHERE batch_no = 'LOT-A'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read replenished batch");
        let purchase_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM purchases", [], |row| row.get(0))
            .expect("count purchases");
        let item_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM purchase_items", [], |row| row.get(0))
            .expect("count purchase items");

        assert_eq!(current_stock, 7);
        assert_eq!(purchase_rate, 13.0);
        assert_eq!(purchase_count, 2);
        assert_eq!(item_count, 2);
    }
}

#[cfg(test)]
mod backup_tests {
    use super::*;

    #[test]
    fn vacuum_snapshot_preserves_pharmacy_schema_and_data() {
        let directory = unique_internal_path(&std::env::temp_dir(), "pharmadesk-backup-test", "dir");
        fs::create_dir_all(&directory).expect("create temporary backup directory");
        let source = directory.join("pharmacy.db");
        let destination = directory.join("backup.db");
        let connection = Connection::open(&source).expect("open source database");
        connection
            .execute_batch(
                r#"
                CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO schema_migrations (version) VALUES (1);
                CREATE TABLE medicines (
                    id INTEGER PRIMARY KEY, name TEXT, generic_name TEXT, company TEXT,
                    rack_location TEXT, min_stock_alert INTEGER, created_at TEXT
                );
                CREATE TABLE medicine_batches (
                    id INTEGER PRIMARY KEY, medicine_id INTEGER, batch_no TEXT, expiry_date TEXT,
                    purchase_rate REAL, mrp REAL, sale_rate REAL, current_stock INTEGER, barcode TEXT
                );
                CREATE TABLE suppliers (
                    id INTEGER PRIMARY KEY, name TEXT, phone TEXT, address TEXT, balance_due REAL
                );
                CREATE TABLE purchases (
                    id INTEGER PRIMARY KEY, invoice_no TEXT, supplier_id INTEGER,
                    total_amount REAL, purchase_date TEXT
                );
                CREATE TABLE purchase_items (
                    id INTEGER PRIMARY KEY, purchase_id INTEGER, batch_id INTEGER,
                    quantity INTEGER, rate REAL, total REAL
                );
                CREATE TABLE sales (
                    id INTEGER PRIMARY KEY,
                    invoice_no TEXT NOT NULL,
                    customer_name TEXT,
                    customer_phone TEXT,
                    subtotal REAL NOT NULL,
                    discount REAL NOT NULL DEFAULT 0,
                    grand_total REAL NOT NULL,
                    payment_mode TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE sale_items (
                    id INTEGER PRIMARY KEY,
                    sale_id INTEGER NOT NULL,
                    batch_id INTEGER NOT NULL,
                    quantity INTEGER NOT NULL,
                    unit_price REAL NOT NULL,
                    total_price REAL NOT NULL
                );
                INSERT INTO sales (
                    invoice_no, customer_name, subtotal, grand_total, payment_mode, created_at
                ) VALUES ('INV-TEST', 'Test customer', 100, 100, 'CASH', '2026-10-01 10:00:00');
                "#,
            )
            .expect("create source pharmacy schema");
        drop(connection);

        create_snapshot(&source, &destination).expect("create SQLite snapshot");
        validate_backup_database(&destination).expect("validate SQLite snapshot");

        let backup = Connection::open_with_flags(&destination, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open backup database");
        let invoice_count: i64 = backup
            .query_row("SELECT COUNT(*) FROM sales", [], |row| row.get(0))
            .expect("read backed up invoices");
        assert_eq!(invoice_count, 1);

        drop(backup);
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }
}
