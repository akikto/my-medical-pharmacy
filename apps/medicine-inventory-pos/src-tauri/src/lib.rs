use std::{
    collections::HashMap,
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{
    params, Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior,
};
#[cfg(debug_assertions)]
use rusqlite::params_from_iter;
use serde::{Deserialize, Serialize};
#[cfg(debug_assertions)]
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

mod backup_package;
mod expenses;
mod financial_reports;
mod purchase_management;
mod reads;
pub(crate) use purchase_management::PurchaseRequest;
#[cfg(test)]
pub(crate) use purchase_management::{record_purchase, PurchaseItemRequest};
use backup_package::{
    create_complete_backup_from_snapshot, staged_purchase_attachment_directory,
    stage_complete_backup, validate_attachment_references, validate_photo_references,
    BackupPhotoSummary, BackupSourceFormat, RestoredPhotoSummary,
};
use reads::{
    get_dashboard_inventory_summary, get_dashboard_purchase_summary, get_expiry_alerts,
    get_customer_ledger, get_customers, get_fefo_batch, get_inventory_medicines,
    get_low_stock_alerts, get_medicine_batches,
    get_medicine_order_usage,
    get_purchase_details, get_purchase_history, get_supplier_ledger,
    get_recent_purchases, get_recent_sales, get_sale_details, get_sales_report_rows,
    get_sales_report_summary, get_sellable_batches, get_store_settings, get_suppliers,
    get_top_selling_medicines, get_weekly_sales, get_order_list, get_sales_history,
    search_medicines,
};

const LATEST_DATABASE_VERSION: i64 = 11;
/// Keep the 30 newest automatically-created close-time database snapshots.
const AUTO_BACKUP_RETENTION_COUNT: usize = 30;
const AUTO_BACKUP_MARKER_CONTENT: &[u8] = b"MY_MEDICAL_AUTO_CLOSE_BACKUP_V1\n";

#[cfg(debug_assertions)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransactionStatement {
    query: String,
    #[serde(default)]
    values: Vec<Value>,
    expected_rows_affected: Option<usize>,
}

#[cfg(debug_assertions)]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TransactionStatementResult {
    rows_affected: usize,
    last_insert_id: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum PharmacyMutation {
    CreateMedicine {
        name: String,
        generic_name: Option<String>,
        company: Option<String>,
        product_type: Option<String>,
        strength: Option<String>,
        composition: Option<String>,
        barcode: Option<String>,
        uses: Option<String>,
        adult_dose: Option<String>,
        child_dose: Option<String>,
        photo_ref: Option<String>,
        rack_location: Option<String>,
        min_stock_alert: i64,
        gst_rate_basis_points: Option<i64>,
        #[serde(default)]
        opening_batch: Option<ImportedOpeningBatch>,
    },
    UpdateMedicine {
        medicine_id: i64,
        name: String,
        generic_name: Option<String>,
        company: Option<String>,
        product_type: Option<String>,
        strength: Option<String>,
        composition: Option<String>,
        barcode: Option<String>,
        uses: Option<String>,
        adult_dose: Option<String>,
        child_dose: Option<String>,
        photo_ref: Option<String>,
        rack_location: Option<String>,
        min_stock_alert: i64,
        gst_rate_basis_points: Option<i64>,
    },
    DeleteMedicine {
        medicine_id: i64,
    },
    UpdateBatchDetails {
        batch_id: i64,
        medicine_id: i64,
        mrp_cents: i64,
        sale_rate_cents: i64,
        rack_location: Option<String>,
    },
    AdjustBatchStock {
        batch_id: i64,
        medicine_id: i64,
        quantity_change: i64,
        reason: String,
    },
    AdjustBatchStockBulk {
        adjustments: Vec<BulkStockAdjustment>,
        reason: String,
    },
    UpdateBulkReorderThresholds {
        updates: Vec<BulkReorderThreshold>,
    },
    ImportMedicines {
        records: Vec<ImportedMedicineRecord>,
    },
    DeductStock {
        deductions: Vec<StockDeduction>,
    },
    AddStock {
        batch_id: i64,
        quantity: i64,
    },
    CreateSupplier {
        name: String,
        contact_person: Option<String>,
        phone: Option<String>,
        whatsapp_phone: Option<String>,
        address: Option<String>,
        notes: Option<String>,
        state_code: Option<String>,
    },
    UpdateSupplier {
        supplier_id: i64,
        name: String,
        contact_person: Option<String>,
        phone: Option<String>,
        whatsapp_phone: Option<String>,
        address: Option<String>,
        notes: Option<String>,
        state_code: Option<String>,
    },
    DeleteSupplier {
        supplier_id: i64,
    },
    CreateCustomer {
        name: String,
        phone: Option<String>,
        address: Option<String>,
        notes: Option<String>,
        state_code: Option<String>,
    },
    UpdateCustomer {
        customer_id: i64,
        name: String,
        phone: Option<String>,
        address: Option<String>,
        notes: Option<String>,
        state_code: Option<String>,
    },
    SetCustomerActive {
        customer_id: i64,
        active: bool,
    },
    SaveSettings {
        settings: StoreSettingsMutation,
    },
}

#[derive(Debug, Deserialize)]
struct StockDeduction {
    batch_id: i64,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
struct BulkStockAdjustment {
    batch_id: i64,
    medicine_id: i64,
    quantity_change: i64,
}

#[derive(Debug, Deserialize)]
struct BulkReorderThreshold {
    medicine_id: i64,
    min_stock_alert: i64,
}

#[derive(Debug, Deserialize)]
struct ImportedMedicineRecord {
    medicine_id: Option<i64>,
    name: String,
    generic_name: Option<String>,
    company: Option<String>,
    product_type: Option<String>,
    strength: Option<String>,
    composition: Option<String>,
    barcode: Option<String>,
    uses: Option<String>,
    adult_dose: Option<String>,
    child_dose: Option<String>,
    rack_location: Option<String>,
    min_stock_alert: Option<i64>,
    gst_rate_basis_points: Option<i64>,
    opening_batch: Option<ImportedOpeningBatch>,
}

#[derive(Debug, Deserialize)]
struct ImportedOpeningBatch {
    batch_no: String,
    expiry_date: String,
    purchase_rate_cents: i64,
    mrp_cents: i64,
    sale_rate_cents: i64,
    opening_stock: i64,
}

#[derive(Debug, Deserialize)]
struct StoreSettingsMutation {
    pharmacy_name: String,
    address: String,
    contact_number: String,
    drug_license_number: String,
    receipt_footer_note: String,
    upi_id: String,
    upi_display_name: String,
    gst_enabled: bool,
    gst_default_rate_basis_points: Option<i64>,
    gst_pricing_mode: String,
    gst_pharmacy_state_code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct PurchaseResult {
    purchase_id: i64,
    total_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PharmacyMutationResult {
    entity_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleCheckoutItem {
    medicine_id: i64,
    batch_id: i64,
    quantity: i64,
    unit_price_cents: i64,
    item_discount_cents: i64,
    gst_rate_override_basis_points: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleCheckoutRequest {
    customer_id: Option<i64>,
    customer_name: Option<String>,
    customer_phone: Option<String>,
    payment_mode: String,
    flat_discount_cents: i64,
    cash_tendered_cents: i64,
    gst_pricing_mode: Option<String>,
    upi_transaction_id: Option<String>,
    items: Vec<SaleCheckoutItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomerPaymentRequest {
    customer_id: i64,
    amount_cents: i64,
    payment_mode: String,
    payment_reference: Option<String>,
    upi_transaction_id: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomerPaymentResult {
    ledger_entry_id: i64,
    balance_due_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleReturnItemRequest {
    sale_item_id: i64,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleReturnRequest {
    invoice_no: String,
    items: Vec<SaleReturnItemRequest>,
    refund_mode: String,
    payment_reference: Option<String>,
    upi_transaction_id: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaleReturnResult {
    return_id: i64,
    return_no: String,
    total_cents: i64,
    customer_due_credit_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleVoidRequest {
    invoice_no: String,
    refund_mode: String,
    payment_reference: Option<String>,
    upi_transaction_id: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaleVoidResult {
    sale_id: i64,
    refund_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleCorrectionItemRequest {
    sale_item_id: i64,
    quantity: i64,
    unit_price_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaleCorrectionRequest {
    invoice_no: String,
    customer_id: Option<i64>,
    customer_name: Option<String>,
    customer_phone: Option<String>,
    payment_mode: String,
    cash_tendered_cents: Option<i64>,
    payment_reference: Option<String>,
    upi_transaction_id: Option<String>,
    adjustment_mode: Option<String>,
    adjustment_reference: Option<String>,
    adjustment_upi_transaction_id: Option<String>,
    notes: Option<String>,
    reason: Option<String>,
    items: Vec<SaleCorrectionItemRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaleCorrectionResult {
    sale_id: i64,
    invoice_no: String,
    grand_total_cents: i64,
}

#[derive(Debug)]
struct SaleAdjustmentLine {
    id: i64,
    batch_id: i64,
    quantity: i64,
    unit_price_cents: i64,
    item_discount_cents: i64,
    flat_discount_cents: i64,
    gst_rate_basis_points: i64,
    taxable_cents: i64,
    cgst_cents: i64,
    sgst_cents: i64,
    igst_cents: i64,
    total_gst_cents: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaleCheckoutResult {
    sale_id: i64,
    invoice_no: String,
}

#[derive(Debug, PartialEq)]
struct SaleLineAllocation {
    batch_id: i64,
    quantity: i64,
    item_discount_cents: i64,
}

#[derive(Debug)]
struct FefoBatch {
    id: i64,
    current_stock: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseBackupResult {
    path: String,
    photo_count: usize,
    ignored_orphaned_photo_count: usize,
    attachment_count: usize,
    ignored_orphaned_attachment_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseRestoreResult {
    safety_backup_path: String,
    source_format: String,
    restored_photo_count: usize,
    ignored_orphaned_photo_count: usize,
    restored_attachment_count: usize,
    ignored_orphaned_attachment_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
enum OrderListMutation {
    SaveItem {
        id: Option<i64>,
        medicine_id: i64,
        supplier_id: Option<i64>,
        quantity: i64,
        note: Option<String>,
        order_date: String,
    },
    SetOrdered {
        item_id: i64,
        ordered: bool,
    },
    DeleteItem {
        item_id: i64,
    },
    ClearDate {
        order_date: String,
    },
}

#[derive(Debug, Serialize)]
struct OrderListMutationResult {
    item_id: Option<i64>,
    rows_affected: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum DataResetScope {
    SalesHistory,
    PurchaseHistory,
    SupplierBalances,
    AllBusinessHistory,
}

#[derive(Debug, Default)]
struct DataResetCounts {
    sales_deleted: usize,
    sale_items_deleted: usize,
    purchases_deleted: usize,
    purchase_items_deleted: usize,
    stock_adjustments_deleted: usize,
    order_list_items_deleted: usize,
    supplier_balances_reset: usize,
}

#[derive(Debug, Serialize)]
struct DataResetSummary {
    scope: DataResetScope,
    backup_path: String,
    sales_deleted: usize,
    sale_items_deleted: usize,
    purchases_deleted: usize,
    purchase_items_deleted: usize,
    stock_adjustments_deleted: usize,
    order_list_items_deleted: usize,
    supplier_balances_reset: usize,
    stock_quantities_preserved: bool,
}

#[cfg(debug_assertions)]
fn to_sqlite_value(value: &Value) -> Result<rusqlite::types::Value, String> {
    match value {
        Value::Null => Ok(rusqlite::types::Value::Null),
        Value::Bool(value) => Ok(rusqlite::types::Value::Integer(if *value { 1 } else { 0 })),
        Value::Number(value) => {
            if let Some(integer) = value.as_i64() {
                Ok(rusqlite::types::Value::Integer(integer))
            } else if let Some(unsigned) = value.as_u64() {
                i64::try_from(unsigned)
                    .map(rusqlite::types::Value::Integer)
                    .map_err(|_| "Integer bind value exceeds SQLite's supported range.".to_owned())
            } else if let Some(float) = value.as_f64() {
                Ok(rusqlite::types::Value::Real(float))
            } else {
                Err("Unsupported numeric bind value.".to_owned())
            }
        }
        Value::String(value) => Ok(rusqlite::types::Value::Text(value.clone())),
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

pub(crate) fn open_pharmacy_connection(app: &AppHandle) -> Result<Connection, String> {
    open_pharmacy_connection_at(&pharmacy_database_path(app)?)
}

fn open_pharmacy_connection_at(database_path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(database_path)
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

fn migration_statements(version: i64) -> Result<&'static [&'static str], String> {
    match version {
        1 => Ok(&[
            r#"CREATE TABLE medicines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                generic_name TEXT,
                company TEXT,
                rack_location TEXT,
                min_stock_alert INTEGER NOT NULL DEFAULT 10 CHECK (min_stock_alert >= 0),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            r#"CREATE TABLE medicine_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
                batch_no TEXT NOT NULL,
                expiry_date TEXT NOT NULL,
                purchase_rate REAL NOT NULL CHECK (purchase_rate >= 0),
                mrp REAL NOT NULL CHECK (mrp >= 0),
                sale_rate REAL NOT NULL CHECK (sale_rate >= 0),
                current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
                barcode TEXT
            )"#,
            r#"CREATE TABLE suppliers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                address TEXT,
                balance_due REAL NOT NULL DEFAULT 0 CHECK (balance_due >= 0)
            )"#,
            r#"CREATE TABLE purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_no TEXT NOT NULL,
                supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
                total_amount REAL NOT NULL CHECK (total_amount >= 0),
                purchase_date TEXT NOT NULL
            )"#,
            r#"CREATE TABLE purchase_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
                batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                rate REAL NOT NULL CHECK (rate >= 0),
                total REAL NOT NULL CHECK (total >= 0)
            )"#,
            r#"CREATE TABLE sales (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                invoice_no TEXT UNIQUE NOT NULL,
                customer_name TEXT,
                customer_phone TEXT,
                subtotal REAL NOT NULL CHECK (subtotal >= 0),
                discount REAL NOT NULL DEFAULT 0 CHECK (discount >= 0),
                grand_total REAL NOT NULL CHECK (grand_total >= 0),
                payment_mode TEXT NOT NULL DEFAULT 'CASH',
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            r#"CREATE TABLE sale_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
                batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                unit_price REAL NOT NULL CHECK (unit_price >= 0),
                total_price REAL NOT NULL CHECK (total_price >= 0)
            )"#,
            "CREATE INDEX idx_medicines_name ON medicines(name COLLATE NOCASE)",
            "CREATE INDEX idx_medicines_generic_name ON medicines(generic_name COLLATE NOCASE)",
            "CREATE INDEX idx_batches_medicine_expiry ON medicine_batches(medicine_id, expiry_date, id)",
            "CREATE INDEX idx_batches_expiry ON medicine_batches(expiry_date)",
            "CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id)",
            "CREATE INDEX idx_sale_items_sale ON sale_items(sale_id)",
            "CREATE INDEX idx_sale_items_batch ON sale_items(batch_id)",
            "CREATE INDEX idx_batches_barcode ON medicine_batches(barcode) WHERE barcode IS NOT NULL",
        ]),
        2 => Ok(&[
            "ALTER TABLE sales ADD COLUMN flat_discount REAL NOT NULL DEFAULT 0 CHECK (flat_discount >= 0)",
            "ALTER TABLE sales ADD COLUMN cash_tendered REAL NOT NULL DEFAULT 0 CHECK (cash_tendered >= 0)",
            "ALTER TABLE sales ADD COLUMN change_due REAL NOT NULL DEFAULT 0 CHECK (change_due >= 0)",
            "ALTER TABLE sale_items ADD COLUMN item_discount REAL NOT NULL DEFAULT 0 CHECK (item_discount >= 0)",
            "CREATE INDEX idx_sales_created_at ON sales(created_at DESC, id DESC)",
        ]),
        3 => Ok(&[
            r#"CREATE TABLE stock_adjustments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE RESTRICT,
                batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
                quantity_change INTEGER NOT NULL CHECK (quantity_change != 0),
                reason TEXT NOT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            "CREATE INDEX idx_stock_adjustments_batch ON stock_adjustments(batch_id, created_at DESC)",
        ]),
        4 => Ok(&[
            r#"ALTER TABLE sale_items
               ADD COLUMN purchase_rate_at_sale REAL
               CHECK (purchase_rate_at_sale IS NULL OR purchase_rate_at_sale >= 0)"#,
            r#"CREATE TABLE app_settings (
                setting_key TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL
            )"#,
        ]),
        5 => Ok(&[
            "ALTER TABLE suppliers ADD COLUMN contact_person TEXT",
            "ALTER TABLE suppliers ADD COLUMN whatsapp_phone TEXT",
            "ALTER TABLE suppliers ADD COLUMN notes TEXT",
            r#"CREATE TABLE order_list_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_date TEXT NOT NULL CHECK (length(order_date) = 10),
                medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
                supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
                quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000000),
                note TEXT,
                ordered INTEGER NOT NULL DEFAULT 0 CHECK (ordered IN (0, 1)),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            "CREATE INDEX idx_order_list_items_date ON order_list_items(order_date, ordered, id)",
        ]),
        6 => Ok(&[
            "ALTER TABLE medicines ADD COLUMN gst_rate_basis_points INTEGER CHECK (gst_rate_basis_points IS NULL OR (gst_rate_basis_points >= 0 AND gst_rate_basis_points <= 10000))",
            r#"CREATE TABLE customers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT,
                phone_normalized TEXT,
                address TEXT,
                notes TEXT,
                state_code TEXT,
                active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            "CREATE UNIQUE INDEX idx_customers_phone_normalized ON customers(phone_normalized) WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''",
            "CREATE INDEX idx_customers_name ON customers(name COLLATE NOCASE)",
            "ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT",
            "ALTER TABLE sales ADD COLUMN upi_transaction_id TEXT",
            "ALTER TABLE sales ADD COLUMN upi_payment_verified INTEGER NOT NULL DEFAULT 0 CHECK (upi_payment_verified IN (0, 1))",
            "ALTER TABLE sales ADD COLUMN customer_state_code TEXT",
            "ALTER TABLE sales ADD COLUMN place_of_supply_state_code TEXT",
            "ALTER TABLE sales ADD COLUMN gst_enabled INTEGER NOT NULL DEFAULT 0 CHECK (gst_enabled IN (0, 1))",
            "ALTER TABLE sales ADD COLUMN gst_pricing_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (gst_pricing_mode IN ('INCLUSIVE', 'EXCLUSIVE'))",
            "ALTER TABLE sales ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK (tax_type IN ('NONE', 'CGST_SGST', 'IGST'))",
            "ALTER TABLE sales ADD COLUMN taxable_amount REAL NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0)",
            "ALTER TABLE sales ADD COLUMN cgst_amount REAL NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0)",
            "ALTER TABLE sales ADD COLUMN sgst_amount REAL NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0)",
            "ALTER TABLE sales ADD COLUMN igst_amount REAL NOT NULL DEFAULT 0 CHECK (igst_amount >= 0)",
            "ALTER TABLE sales ADD COLUMN total_gst REAL NOT NULL DEFAULT 0 CHECK (total_gst >= 0)",
            "ALTER TABLE sale_items ADD COLUMN gst_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate_basis_points >= 0 AND gst_rate_basis_points <= 10000)",
            "ALTER TABLE sale_items ADD COLUMN taxable_amount REAL NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0)",
            "ALTER TABLE sale_items ADD COLUMN cgst_amount REAL NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0)",
            "ALTER TABLE sale_items ADD COLUMN sgst_amount REAL NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0)",
            "ALTER TABLE sale_items ADD COLUMN igst_amount REAL NOT NULL DEFAULT 0 CHECK (igst_amount >= 0)",
            "ALTER TABLE sale_items ADD COLUMN total_gst REAL NOT NULL DEFAULT 0 CHECK (total_gst >= 0)",
            r#"CREATE TABLE customer_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                entry_type TEXT NOT NULL CHECK (entry_type IN ('CREDIT_SALE', 'COLLECTION')),
                invoice_no TEXT,
                debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
                credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
                payment_mode TEXT,
                upi_transaction_id TEXT,
                note TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (
                  (entry_type = 'CREDIT_SALE' AND debit_cents > 0 AND credit_cents = 0 AND invoice_no IS NOT NULL)
                  OR
                  (entry_type = 'COLLECTION' AND credit_cents > 0 AND debit_cents = 0 AND payment_mode IS NOT NULL)
                )
            )"#,
            "CREATE INDEX idx_customer_ledger_customer_date ON customer_ledger(customer_id, created_at, id)",
        ]),
        7 => Ok(&[
            "ALTER TABLE medicines ADD COLUMN product_type TEXT",
            "ALTER TABLE medicines ADD COLUMN strength TEXT",
            "ALTER TABLE medicines ADD COLUMN composition TEXT",
            "ALTER TABLE medicines ADD COLUMN barcode TEXT",
            "ALTER TABLE medicines ADD COLUMN uses TEXT",
            "ALTER TABLE medicines ADD COLUMN adult_dose TEXT",
            "ALTER TABLE medicines ADD COLUMN child_dose TEXT",
            "ALTER TABLE medicines ADD COLUMN photo_ref TEXT",
            "CREATE UNIQUE INDEX idx_medicines_barcode_unique ON medicines(UPPER(TRIM(barcode))) WHERE barcode IS NOT NULL AND TRIM(barcode) <> ''",
        ]),
        8 => Ok(&[
            "ALTER TABLE stock_adjustments ADD COLUMN previous_quantity INTEGER CHECK (previous_quantity IS NULL OR previous_quantity >= 0)",
            "ALTER TABLE stock_adjustments ADD COLUMN new_quantity INTEGER CHECK (new_quantity IS NULL OR new_quantity >= 0)",
        ]),
        9 => Ok(&[
            "ALTER TABLE suppliers ADD COLUMN state_code TEXT",
            "ALTER TABLE purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED'))",
            "ALTER TABLE purchases ADD COLUMN gst_enabled INTEGER NOT NULL DEFAULT 0 CHECK (gst_enabled IN (0, 1))",
            "ALTER TABLE purchases ADD COLUMN gst_pricing_mode TEXT NOT NULL DEFAULT 'EXCLUSIVE' CHECK (gst_pricing_mode IN ('INCLUSIVE', 'EXCLUSIVE'))",
            "ALTER TABLE purchases ADD COLUMN tax_type TEXT NOT NULL DEFAULT 'NONE' CHECK (tax_type IN ('NONE', 'CGST_SGST', 'IGST'))",
            "ALTER TABLE purchases ADD COLUMN taxable_amount REAL NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0)",
            "ALTER TABLE purchases ADD COLUMN cgst_amount REAL NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0)",
            "ALTER TABLE purchases ADD COLUMN sgst_amount REAL NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0)",
            "ALTER TABLE purchases ADD COLUMN igst_amount REAL NOT NULL DEFAULT 0 CHECK (igst_amount >= 0)",
            "ALTER TABLE purchases ADD COLUMN total_gst REAL NOT NULL DEFAULT 0 CHECK (total_gst >= 0)",
            "ALTER TABLE purchases ADD COLUMN place_of_supply_state_code TEXT",
            "ALTER TABLE purchase_items ADD COLUMN gst_rate_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (gst_rate_basis_points >= 0 AND gst_rate_basis_points <= 10000)",
            "ALTER TABLE purchase_items ADD COLUMN taxable_amount REAL NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0)",
            "ALTER TABLE purchase_items ADD COLUMN cgst_amount REAL NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0)",
            "ALTER TABLE purchase_items ADD COLUMN sgst_amount REAL NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0)",
            "ALTER TABLE purchase_items ADD COLUMN igst_amount REAL NOT NULL DEFAULT 0 CHECK (igst_amount >= 0)",
            "ALTER TABLE purchase_items ADD COLUMN total_gst REAL NOT NULL DEFAULT 0 CHECK (total_gst >= 0)",
            r#"CREATE TABLE supplier_ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
                entry_type TEXT NOT NULL CHECK (entry_type IN ('PURCHASE', 'PURCHASE_RETURN', 'PAYMENT', 'ADJUSTMENT')),
                purchase_id INTEGER REFERENCES purchases(id) ON DELETE RESTRICT,
                reference TEXT,
                debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
                credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
                payment_method TEXT,
                transaction_reference TEXT,
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CHECK (
                  (entry_type = 'PURCHASE' AND debit_cents > 0 AND credit_cents = 0)
                  OR (entry_type IN ('PURCHASE_RETURN', 'PAYMENT')
                      AND debit_cents = 0 AND credit_cents > 0)
                  OR (entry_type = 'ADJUSTMENT' AND (
                      (debit_cents > 0 AND credit_cents = 0)
                      OR (debit_cents = 0 AND credit_cents > 0)
                  ))
                )
            )"#,
            "CREATE INDEX idx_supplier_ledger_supplier_date ON supplier_ledger(supplier_id, created_at, id)",
            r#"CREATE TABLE purchase_returns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
                supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
                return_date TEXT NOT NULL CHECK (length(return_date) = 10),
                total_cents INTEGER NOT NULL CHECK (total_cents > 0),
                note TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            r#"CREATE TABLE purchase_return_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE RESTRICT,
                purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id) ON DELETE RESTRICT,
                batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
                quantity INTEGER NOT NULL CHECK (quantity > 0),
                rate_cents INTEGER NOT NULL CHECK (rate_cents >= 0),
                total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
                UNIQUE (return_id, purchase_item_id)
            )"#,
            "CREATE INDEX idx_purchase_returns_purchase ON purchase_returns(purchase_id, id)",
            r#"CREATE TABLE purchase_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
                file_ref TEXT NOT NULL UNIQUE,
                file_name TEXT NOT NULL,
                mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
                size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 20000000),
                sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
            "CREATE INDEX idx_purchase_attachments_purchase ON purchase_attachments(purchase_id, id)",
            r#"INSERT INTO supplier_ledger
                (supplier_id, entry_type, purchase_id, reference, debit_cents, note, created_at)
                SELECT p.supplier_id, 'PURCHASE', p.id, p.invoice_no,
                       CAST(ROUND(p.total_amount * 100) AS INTEGER),
                       'Carried forward from saved purchase invoice', p.purchase_date
                FROM purchases AS p
                WHERE p.supplier_id IS NOT NULL AND p.total_amount > 0"#,
            r#"WITH invoice_totals AS (
                 SELECT supplier_id,
                        SUM(CAST(ROUND(total_amount * 100) AS INTEGER)) AS invoice_cents
                 FROM purchases
                 WHERE supplier_id IS NOT NULL
                 GROUP BY supplier_id
               ),
               balances AS (
                 SELECT s.id AS supplier_id,
                        CAST(ROUND(s.balance_due * 100) AS INTEGER)
                          - COALESCE(i.invoice_cents, 0) AS opening_cents
                 FROM suppliers AS s
                 LEFT JOIN invoice_totals AS i ON i.supplier_id = s.id
               )
               INSERT INTO supplier_ledger
                 (supplier_id, entry_type, reference, debit_cents, credit_cents, note)
               SELECT supplier_id, 'ADJUSTMENT', 'Opening balance',
                      MAX(opening_cents, 0), MAX(-opening_cents, 0),
                      'Balance carried forward from pre-ledger supplier state'
               FROM balances WHERE opening_cents <> 0"#,
            r#"UPDATE suppliers
               SET balance_due = COALESCE((
                 SELECT SUM(debit_cents - credit_cents) / 100.0
                 FROM supplier_ledger WHERE supplier_id = suppliers.id
               ), 0)"#,
        ]),
        10 => Ok(&[
            "ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PARTIALLY_RETURNED', 'RETURNED', 'CANCELLED'))",
            "ALTER TABLE sales ADD COLUMN payment_reference TEXT",
            "ALTER TABLE sales ADD COLUMN notes TEXT",
            "ALTER TABLE sales ADD COLUMN cancelled_at DATETIME",
            "ALTER TABLE sale_items ADD COLUMN flat_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (flat_discount_cents >= 0)",
            "ALTER TABLE customer_ledger ADD COLUMN payment_reference TEXT",
            r#"WITH ranked AS (
                 SELECT
                   item.id,
                   item.sale_id,
                   CAST(ROUND((item.unit_price * item.quantity - item.item_discount) * 100) AS INTEGER) AS weight_cents,
                   CAST(ROUND(sale.flat_discount * 100) AS INTEGER) AS discount_cents,
                   SUM(CAST(ROUND((item.unit_price * item.quantity - item.item_discount) * 100) AS INTEGER))
                     OVER (PARTITION BY item.sale_id) AS total_weight_cents,
                   ROW_NUMBER() OVER (PARTITION BY item.sale_id ORDER BY item.id) AS row_number,
                   COUNT(*) OVER (PARTITION BY item.sale_id) AS row_count
                 FROM sale_items AS item
                 INNER JOIN sales AS sale ON sale.id = item.sale_id
               ),
               shares AS (
                 SELECT
                   current.id,
                   CASE
                     WHEN current.row_number = current.row_count THEN current.discount_cents - COALESCE((
                       SELECT SUM(CAST(previous.discount_cents * previous.weight_cents
                                       / previous.total_weight_cents AS INTEGER))
                       FROM ranked AS previous
                       WHERE previous.sale_id = current.sale_id
                         AND previous.row_number < current.row_number
                         AND previous.total_weight_cents > 0
                     ), 0)
                     WHEN current.total_weight_cents > 0
                       THEN CAST(current.discount_cents * current.weight_cents
                                 / current.total_weight_cents AS INTEGER)
                     ELSE 0
                   END AS share_cents
                 FROM ranked AS current
               )
               UPDATE sale_items
               SET flat_discount_cents = COALESCE((
                 SELECT share_cents FROM shares WHERE shares.id = sale_items.id
               ), 0)"#,
            r#"CREATE TABLE customer_ledger_events (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
                 entry_type TEXT NOT NULL CHECK (entry_type IN ('SALE_RETURN', 'SALE_VOID', 'SALE_CORRECTION')),
                 invoice_no TEXT,
                 reference TEXT,
                 debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
                 credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
                 payment_mode TEXT,
                 payment_reference TEXT,
                 upi_transaction_id TEXT,
                 note TEXT,
                 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 CHECK ((debit_cents > 0 AND credit_cents = 0)
                     OR (debit_cents = 0 AND credit_cents > 0))
               )"#,
            "CREATE INDEX idx_customer_ledger_events_customer_date ON customer_ledger_events(customer_id, created_at, id)",
            r#"CREATE TABLE sale_returns (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
                 return_no TEXT NOT NULL UNIQUE,
                 total_cents INTEGER NOT NULL CHECK (total_cents >= 0),
                 customer_due_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (customer_due_credit_cents >= 0),
                 refund_mode TEXT NOT NULL CHECK (refund_mode IN ('CASH', 'UPI', 'BANK', 'OTHER')),
                 payment_reference TEXT,
                 upi_transaction_id TEXT,
                 note TEXT,
                 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
               )"#,
            r#"CREATE TABLE sale_return_items (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE RESTRICT,
                 sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
                 batch_id INTEGER NOT NULL REFERENCES medicine_batches(id) ON DELETE RESTRICT,
                 quantity INTEGER NOT NULL CHECK (quantity > 0),
                 refund_cents INTEGER NOT NULL CHECK (refund_cents >= 0),
                 taxable_cents INTEGER NOT NULL CHECK (taxable_cents >= 0),
                 cgst_cents INTEGER NOT NULL CHECK (cgst_cents >= 0),
                 sgst_cents INTEGER NOT NULL CHECK (sgst_cents >= 0),
                 igst_cents INTEGER NOT NULL CHECK (igst_cents >= 0),
                 total_gst_cents INTEGER NOT NULL CHECK (total_gst_cents >= 0),
                 UNIQUE (return_id, sale_item_id)
               )"#,
            "CREATE INDEX idx_sale_returns_sale ON sale_returns(sale_id, id)",
            r#"CREATE TABLE sale_voids (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
                 refund_cents INTEGER NOT NULL CHECK (refund_cents >= 0),
                 refund_mode TEXT NOT NULL CHECK (refund_mode IN ('ACCOUNT', 'CASH', 'CARD', 'UPI', 'BANK', 'OTHER')),
                 payment_reference TEXT,
                 upi_transaction_id TEXT,
                 note TEXT,
                 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
               )"#,
            r#"CREATE TABLE sale_corrections (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
                 before_json TEXT NOT NULL,
                 after_json TEXT NOT NULL,
                 adjustment_debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (adjustment_debit_cents >= 0),
                 adjustment_credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (adjustment_credit_cents >= 0),
                 adjustment_mode TEXT,
                 adjustment_reference TEXT,
                 adjustment_upi_transaction_id TEXT,
                 note TEXT,
                 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
               )"#,
            "CREATE INDEX idx_sale_corrections_sale ON sale_corrections(sale_id, id)",
        ]),
        11 => Ok(&[
            r#"CREATE TABLE expense_categories (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 CHECK (length(trim(name)) > 0 AND length(name) <= 60)
               )"#,
            r#"INSERT INTO expense_categories (name) VALUES
                 ('Rent'),
                 ('Electricity'),
                 ('Salary'),
                 ('Transport'),
                 ('Internet/Phone'),
                 ('Maintenance'),
                 ('Office Supplies'),
                 ('Other')"#,
            r#"CREATE TABLE expenses (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 expense_date TEXT NOT NULL CHECK (
                   length(expense_date) = 10
                   AND date(expense_date) = expense_date
                 ),
                 category_id INTEGER NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
                 description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
                 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                 payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK', 'UPI', 'OTHER')),
                 reference_number TEXT CHECK (reference_number IS NULL OR length(reference_number) <= 100),
                 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
                 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
               )"#,
            "CREATE INDEX idx_expenses_date_id ON expenses(expense_date DESC, id DESC)",
            "CREATE INDEX idx_expenses_category_date ON expenses(category_id, expense_date DESC)",
            "CREATE INDEX idx_expenses_payment_date ON expenses(payment_method, expense_date DESC)",
            "CREATE INDEX idx_expenses_status_date ON expenses(status, expense_date DESC)",
        ]),
        _ => Err(format!("No migration is available for database version {version}.")),
    }
}

fn migrate_connection(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            )"#,
        )
        .map_err(|error| format!("Could not create the database migration table: {error}"))?;

    let applied_versions = {
        let mut statement = connection
            .prepare("SELECT version FROM schema_migrations ORDER BY version ASC")
            .map_err(|error| format!("Could not read database migration history: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("Could not read database migration history: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read database migration history: {error}"))?
    };

    let mut current_version = 0_i64;
    for version in applied_versions {
        if version != current_version + 1 {
            return Err(format!(
                "Database migration history is incomplete at version {}.",
                current_version + 1
            ));
        }
        current_version = version;
    }
    if current_version > LATEST_DATABASE_VERSION {
        return Err(format!(
            "Database version {current_version} is newer than this application supports."
        ));
    }

    for version in current_version + 1..=LATEST_DATABASE_VERSION {
        let statements = migration_statements(version)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Could not begin database migration {version}: {error}"))?;
        for sql in statements {
            transaction.execute_batch(sql).map_err(|error| {
                format!("Could not apply database migration {version}: {error}")
            })?;
        }
        transaction
            .execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                [version],
            )
            .map_err(|error| format!("Could not record database migration {version}: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not commit database migration {version}: {error}"))?;
    }
    Ok(())
}

fn migrate_pharmacy_database(app: &AppHandle) -> Result<(), String> {
    let mut connection = open_pharmacy_connection(app)?;
    migrate_connection(&mut connection)
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
                "The selected file is not a MY MEDICAL backup: {table} is missing."
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
        return Err("The selected database has no MY MEDICAL migration history.".to_owned());
    }
    for (index, version) in versions.iter().enumerate() {
        if *version != index as i64 + 1 {
            return Err("The selected backup has an incomplete migration history.".to_owned());
        }
    }
    let version = *versions
        .last()
        .expect("validated non-empty migration history");
    if version > LATEST_DATABASE_VERSION {
        return Err(format!(
            "This backup was created by a newer MY MEDICAL database version ({version})."
        ));
    }

    require_backup_columns(&connection, "schema_migrations", &["version", "applied_at"])?;
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
        &[
            "id",
            "invoice_no",
            "supplier_id",
            "total_amount",
            "purchase_date",
        ],
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
        &[
            "id",
            "sale_id",
            "batch_id",
            "quantity",
            "unit_price",
            "total_price",
        ],
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
    if version >= 5 {
        require_backup_columns(
            &connection,
            "suppliers",
            &["contact_person", "whatsapp_phone", "notes"],
        )?;
        require_backup_columns(
            &connection,
            "order_list_items",
            &[
                "id",
                "order_date",
                "medicine_id",
                "supplier_id",
                "quantity",
                "note",
                "ordered",
                "created_at",
            ],
        )?;
    }

    if version >= 6 {
        require_backup_columns(&connection, "medicines", &["gst_rate_basis_points"])?;
        require_backup_columns(
            &connection,
            "customers",
            &[
                "id",
                "name",
                "phone",
                "phone_normalized",
                "address",
                "notes",
                "state_code",
                "active",
                "created_at",
            ],
        )?;
        require_backup_columns(
            &connection,
            "customer_ledger",
            &[
                "id",
                "customer_id",
                "entry_type",
                "invoice_no",
                "debit_cents",
                "credit_cents",
                "payment_mode",
                "upi_transaction_id",
                "note",
                "created_at",
            ],
        )?;
        require_backup_columns(
            &connection,
            "sales",
            &[
                "customer_id",
                "upi_transaction_id",
                "upi_payment_verified",
                "customer_state_code",
                "place_of_supply_state_code",
                "gst_enabled",
                "gst_pricing_mode",
                "tax_type",
                "taxable_amount",
                "cgst_amount",
                "sgst_amount",
                "igst_amount",
                "total_gst",
            ],
        )?;
        require_backup_columns(
            &connection,
            "sale_items",
            &[
                "gst_rate_basis_points",
                "taxable_amount",
                "cgst_amount",
                "sgst_amount",
                "igst_amount",
                "total_gst",
            ],
        )?;
    }
    if version >= 7 {
        require_backup_columns(
            &connection,
            "medicines",
            &[
                "product_type",
                "strength",
                "composition",
                "barcode",
                "uses",
                "adult_dose",
                "child_dose",
                "photo_ref",
            ],
        )?;
    }
    if version >= 8 {
        require_backup_columns(
            &connection,
            "stock_adjustments",
            &["previous_quantity", "new_quantity"],
        )?;
    }
    if version >= 11 {
        require_backup_columns(
            &connection,
            "expense_categories",
            &["id", "name", "active", "created_at", "updated_at"],
        )?;
        require_backup_columns(
            &connection,
            "expenses",
            &[
                "id",
                "expense_date",
                "category_id",
                "description",
                "amount_cents",
                "payment_method",
                "reference_number",
                "status",
                "created_at",
                "updated_at",
            ],
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
    let base_name = format!("{prefix}_{timestamp}.zip");
    let candidate = directory.join(&base_name);
    if !candidate.exists() {
        return Ok(candidate);
    }

    for suffix in 2..=999 {
        let candidate = directory.join(format!("{prefix}_{timestamp}_{suffix}.zip"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not choose a unique internal backup filename.".to_owned())
}

fn create_complete_backup_at(
    database_path: &Path,
    photo_directory: &Path,
    destination: &Path,
) -> Result<BackupPhotoSummary, String> {
    if destination.exists() || fs::symlink_metadata(destination).is_ok() {
        return Err("A file already exists at the selected backup location.".to_owned());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Choose a valid backup folder.".to_owned())?;
    if !parent.is_dir() {
        return Err("The selected backup folder does not exist or is unavailable.".to_owned());
    }

    let staged_database = unique_internal_path(parent, "backup-database-stage", "db");
    let staged_package = unique_internal_path(parent, "backup-package-stage", "zip");
    let result = (|| {
        create_snapshot(database_path, &staged_database)?;
        let summary = create_complete_backup_from_snapshot(
            &staged_database,
            photo_directory,
            &staged_package,
        )?;
        if destination.exists() || fs::symlink_metadata(destination).is_ok() {
            return Err("A file already exists at the selected backup location.".to_owned());
        }
        fs::rename(&staged_package, destination)
            .map_err(|error| format!("Could not save the complete backup package: {error}"))?;
        Ok(summary)
    })();

    let _ = fs::remove_file(&staged_database);
    if result.is_err() {
        let _ = fs::remove_file(&staged_package);
    }
    result
}

fn create_internal_snapshot(app: &AppHandle, prefix: &str) -> Result<Option<PathBuf>, String> {
    let database_path = pharmacy_database_path(app)?;
    let photo_directory = medicine_photo_directory(app)?;
    create_internal_snapshot_at(&database_path, &photo_directory, prefix)
}

fn create_internal_snapshot_at(
    database_path: &Path,
    photo_directory: &Path,
    prefix: &str,
) -> Result<Option<PathBuf>, String> {
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
    create_complete_backup_at(database_path, photo_directory, &destination)?;
    Ok(Some(destination))
}

fn automatic_backup_marker_path(backup_path: &Path) -> PathBuf {
    let mut marker_path = backup_path.as_os_str().to_os_string();
    marker_path.push(".automatic");
    PathBuf::from(marker_path)
}

fn valid_automatic_backup_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 19
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'_'
        && bytes[13] == b'-'
        && bytes[16] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7 | 10 | 13 | 16) || byte.is_ascii_digit())
}

fn automatic_backup_sort_key(backup_path: &Path) -> Option<(String, u16)> {
    let extension = backup_path.extension()?.to_str()?;
    if !extension.eq_ignore_ascii_case("db") && !extension.eq_ignore_ascii_case("zip") {
        return None;
    }
    let stem = backup_path.file_stem()?.to_str()?;
    let stem = stem.strip_prefix("backup_")?;
    if let Some((timestamp, suffix)) = stem.rsplit_once('_') {
        if let Ok(sequence) = suffix.parse::<u16>() {
            if (2..=999).contains(&sequence) && valid_automatic_backup_timestamp(timestamp) {
                return Some((timestamp.to_owned(), sequence));
            }
        }
    }
    valid_automatic_backup_timestamp(stem).then(|| (stem.to_owned(), 1))
}

fn mark_automatic_backup(backup_path: &Path) -> Result<(), String> {
    if automatic_backup_sort_key(backup_path).is_none() {
        return Err("The generated automatic backup filename is invalid.".to_owned());
    }
    let marker_path = automatic_backup_marker_path(backup_path);
    let mut marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker_path)
        .map_err(|error| format!("Could not mark the automatic backup: {error}"))?;
    if let Err(error) = marker
        .write_all(AUTO_BACKUP_MARKER_CONTENT)
        .and_then(|()| marker.sync_all())
    {
        let _ = fs::remove_file(&marker_path);
        return Err(format!("Could not mark the automatic backup: {error}"));
    }
    Ok(())
}

fn prune_automatic_backups(directory: &Path, active_database: &Path) -> Result<usize, String> {
    let active_database = fs::canonicalize(active_database).map_err(|error| {
        format!("Could not identify the active database for backup cleanup: {error}")
    })?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Could not read the automatic backup folder: {error}"
            ))
        }
    };

    let mut backups = Vec::new();
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Could not inspect automatic backups: {error}"))?;
        let backup_path = entry.path();
        let Some(sort_key) = automatic_backup_sort_key(&backup_path) else {
            continue;
        };
        if !entry
            .file_type()
            .map_err(|error| format!("Could not inspect an automatic backup: {error}"))?
            .is_file()
        {
            continue;
        }
        let marker_path = automatic_backup_marker_path(&backup_path);
        let marker_is_regular_file = fs::symlink_metadata(&marker_path)
            .map(|metadata| metadata.file_type().is_file())
            .unwrap_or(false);
        if !marker_is_regular_file {
            continue;
        }
        let marker_content = fs::read(&marker_path)
            .map_err(|error| format!("Could not verify automatic backup ownership: {error}"))?;
        if marker_content.as_slice() != AUTO_BACKUP_MARKER_CONTENT {
            continue;
        }
        if fs::canonicalize(&backup_path)
            .map_err(|error| format!("Could not identify an automatic backup: {error}"))?
            == active_database
        {
            continue;
        }
        backups.push((sort_key, backup_path, marker_path));
    }

    backups.sort_by(|left, right| left.0.cmp(&right.0));
    let remove_count = backups.len().saturating_sub(AUTO_BACKUP_RETENTION_COUNT);
    for (_, backup_path, marker_path) in backups.into_iter().take(remove_count) {
        fs::remove_file(&backup_path)
            .map_err(|error| format!("Could not remove an older automatic backup: {error}"))?;
        fs::remove_file(&marker_path)
            .map_err(|error| format!("Could not remove an automatic backup marker: {error}"))?;
    }
    Ok(remove_count)
}

fn prune_automatic_backups_best_effort(directory: &Path, active_database: &Path) {
    if let Err(error) = prune_automatic_backups(directory, active_database) {
        eprintln!("Automatic backup cleanup was skipped: {error}");
    }
}

fn create_automatic_close_backup_at(
    database_path: &Path,
    photo_directory: &Path,
) -> Result<Option<PathBuf>, String> {
    let Some(backup_path) =
        create_internal_snapshot_at(database_path, photo_directory, "backup")?
    else {
        return Ok(None);
    };
    if let Err(error) = mark_automatic_backup(&backup_path) {
        let _ = fs::remove_file(&backup_path);
        return Err(error);
    }
    if let Some(directory) = backup_path.parent() {
        prune_automatic_backups_best_effort(directory, database_path);
    }
    Ok(Some(backup_path))
}

fn selected_backup_format(path: &Path) -> Result<BackupSourceFormat, String> {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("zip") => {
            Ok(BackupSourceFormat::CompleteArchive)
        }
        Some(extension) if extension.eq_ignore_ascii_case("db") => {
            Ok(BackupSourceFormat::LegacyDatabaseOnly)
        }
        _ => Err("Choose a MY MEDICAL complete .zip backup or legacy .db backup.".to_owned()),
    }
}

fn selected_backup_path(path: &Path) -> Result<(PathBuf, BackupSourceFormat), String> {
    if !path.is_absolute() {
        return Err("The selected backup path is not absolute.".to_owned());
    }
    let format = selected_backup_format(path)?;
    let canonical = fs::canonicalize(path)
        .map_err(|error| format!("Could not access the selected backup: {error}"))?;
    Ok((canonical, format))
}

fn backup_destination_path(active_database: &Path, destination: &Path) -> Result<PathBuf, String> {
    if !destination.is_absolute() {
        return Err("Choose an absolute path for the backup file.".to_owned());
    }
    if selected_backup_format(destination)? != BackupSourceFormat::CompleteArchive {
        return Err("Choose a .zip destination for a complete backup.".to_owned());
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
    let file_name = destination
        .file_name()
        .ok_or_else(|| "Choose a valid backup filename.".to_owned())?;
    let normalized_destination = fs::canonicalize(parent)
        .map_err(|error| format!("Could not access the selected backup folder: {error}"))?
        .join(file_name);
    let active_database = fs::canonicalize(active_database)
        .map_err(|error| format!("Could not locate the local pharmacy database: {error}"))?;
    if normalized_destination == active_database {
        return Err(
            "The backup destination cannot replace the active pharmacy database.".to_owned(),
        );
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
    let photo_directory = medicine_photo_directory(&app)?;
    let destination = backup_destination_path(&active_database, Path::new(&destination_path))?;
    let summary = create_complete_backup_at(&active_database, &photo_directory, &destination)?;
    Ok(DatabaseBackupResult {
        path: destination.display().to_string(),
        photo_count: summary.photo_count,
        ignored_orphaned_photo_count: summary.ignored_orphaned_photo_count,
        attachment_count: summary.attachment_count,
        ignored_orphaned_attachment_count: summary.ignored_orphaned_attachment_count,
    })
}

fn rollback_database_replacement(
    active_database: &Path,
    previous_database: &Path,
    moved_sidecars: &[(PathBuf, PathBuf)],
    previous_database_moved: bool,
    replacement_installed: bool,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if replacement_installed {
        if let Err(error) = remove_file_if_present(active_database) {
            failures.push(error);
        }
        for suffix in ["-wal", "-shm"] {
            if let Err(error) =
                remove_file_if_present(&sqlite_sidecar_path(active_database, suffix))
            {
                failures.push(error);
            }
        }
    }
    for (original_sidecar, previous_sidecar) in moved_sidecars.iter().rev() {
        if previous_sidecar.exists() {
            if let Err(error) = remove_file_if_present(original_sidecar) {
                failures.push(error);
                continue;
            }
            if let Err(error) = fs::rename(previous_sidecar, original_sidecar) {
                failures.push(format!(
                    "Could not restore database sidecar {}: {error}",
                    original_sidecar.display()
                ));
            }
        }
    }
    if previous_database_moved && previous_database.exists() {
        if let Err(error) = remove_file_if_present(active_database) {
            failures.push(error);
        } else if let Err(error) = fs::rename(previous_database, active_database) {
            failures.push(format!(
                "Could not restore the original database; its copy remains at {}: {error}",
                previous_database.display()
            ));
        }
    } else if previous_database_moved {
        failures.push("The original database copy could not be found during rollback.".to_owned());
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("Rollback was incomplete: {}", failures.join("; ")))
    }
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not remove {}: {error}", path.display())),
    }
}

fn database_replacement_error(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => format!("{error} The original database was restored."),
        Err(rollback_error) => format!("{error} {rollback_error}"),
    }
}

fn install_staged_database<F>(
    active_database: &Path,
    staged_database: &Path,
    verify_installed: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let config_directory = active_database
        .parent()
        .ok_or_else(|| "Could not locate the local pharmacy database folder.".to_owned())?;
    let previous_database = unique_internal_path(config_directory, "restore-previous", "db");
    fs::rename(active_database, &previous_database)
        .map_err(|error| format!("Could not prepare the current database for restore: {error}"))?;

    let mut moved_sidecars = Vec::new();
    for suffix in ["-wal", "-shm"] {
        let original_sidecar = sqlite_sidecar_path(active_database, suffix);
        if !original_sidecar.exists() {
            continue;
        }
        let previous_sidecar = sqlite_sidecar_path(&previous_database, suffix);
        if let Err(error) = fs::rename(&original_sidecar, &previous_sidecar) {
            let rollback = rollback_database_replacement(
                active_database,
                &previous_database,
                &moved_sidecars,
                true,
                false,
            );
            return Err(database_replacement_error(
                format!("Could not safely move the current database files: {error}"),
                rollback,
            ));
        }
        moved_sidecars.push((original_sidecar, previous_sidecar));
    }

    if let Err(error) = fs::rename(staged_database, active_database) {
        let rollback = rollback_database_replacement(
            active_database,
            &previous_database,
            &moved_sidecars,
            true,
            false,
        );
        return Err(database_replacement_error(
            format!("Could not install the selected database backup: {error}"),
            rollback,
        ));
    }

    if let Err(error) = verify_installed(active_database) {
        let rollback = rollback_database_replacement(
            active_database,
            &previous_database,
            &moved_sidecars,
            true,
            true,
        );
        return Err(database_replacement_error(
            format!("The restored database could not be opened: {error}"),
            rollback,
        ));
    }

    let _ = fs::remove_file(&previous_database);
    for (_, previous_sidecar) in moved_sidecars {
        let _ = fs::remove_file(previous_sidecar);
    }
    Ok(())
}

struct PhotoDirectorySwap {
    active_directory: PathBuf,
    previous_directory: Option<PathBuf>,
    storage_label: &'static str,
}

fn remove_path_if_present(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Could not inspect {}: {error}", path.display())),
    };
    if metadata.file_type().is_dir() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Could not remove {}: {error}", path.display()))
    } else {
        fs::remove_file(path)
            .map_err(|error| format!("Could not remove {}: {error}", path.display()))
    }
}

fn install_staged_photo_directory(
    active_directory: &Path,
    staged_directory: &Path,
) -> Result<PhotoDirectorySwap, String> {
    install_staged_directory(
        active_directory,
        staged_directory,
        "medicine photo",
        "restore-previous-photos",
    )
}

fn install_staged_purchase_attachment_directory(
    active_directory: &Path,
    staged_directory: &Path,
) -> Result<PhotoDirectorySwap, String> {
    install_staged_directory(
        active_directory,
        staged_directory,
        "purchase attachment",
        "restore-previous-purchase-attachments",
    )
}

fn install_staged_directory(
    active_directory: &Path,
    staged_directory: &Path,
    storage_label: &'static str,
    previous_prefix: &str,
) -> Result<PhotoDirectorySwap, String> {
    let parent = active_directory
        .parent()
        .ok_or_else(|| format!("Could not locate local {storage_label} storage."))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not access local {storage_label} storage: {error}"))?;
    let previous_directory = unique_internal_path(parent, previous_prefix, "dir");
    let active_metadata = match fs::symlink_metadata(active_directory) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Could not inspect current {storage_label} storage: {error}"
            ))
        }
    };
    if active_metadata
        .as_ref()
        .is_some_and(|metadata| !metadata.file_type().is_dir())
    {
        return Err(format!("Current {storage_label} storage is not a regular folder."));
    }

    let previous_moved = if active_metadata.is_some() {
        fs::rename(active_directory, &previous_directory).map_err(|error| {
            format!("Could not prepare current {storage_label} storage for restore: {error}")
        })?;
        true
    } else {
        false
    };
    if let Err(error) = fs::rename(staged_directory, active_directory) {
        let rollback = if previous_moved {
            fs::rename(&previous_directory, active_directory).map_err(|rollback_error| {
                format!(
                    "Could not restore current {storage_label} files; their previous folder remains at {}: {rollback_error}",
                    previous_directory.display()
                )
            })
        } else {
            Ok(())
        };
        return match rollback {
            Ok(()) => Err(format!(
                "Could not install restored {storage_label} files: {error}. Current files were restored."
            )),
            Err(rollback_error) => Err(format!(
                "Could not install restored {storage_label} files: {error}. {rollback_error}"
            )),
        };
    }

    Ok(PhotoDirectorySwap {
        active_directory: active_directory.to_path_buf(),
        previous_directory: previous_moved.then_some(previous_directory),
        storage_label,
    })
}

fn rollback_photo_directory_replacement(swap: &PhotoDirectorySwap) -> Result<(), String> {
    remove_path_if_present(&swap.active_directory)?;
    if let Some(previous_directory) = &swap.previous_directory {
        fs::rename(previous_directory, &swap.active_directory).map_err(|error| {
            format!(
                "Could not restore the original {} files; their previous folder remains at {}: {error}",
                swap.storage_label,
                previous_directory.display()
            )
        })?;
    }
    Ok(())
}

fn cleanup_previous_photo_directory(swap: &PhotoDirectorySwap) {
    if let Some(previous_directory) = &swap.previous_directory {
        if let Err(error) = remove_path_if_present(previous_directory) {
            eprintln!("Could not remove the old {} folder: {error}", swap.storage_label);
        }
    }
}

fn remove_restore_staging(staged_database: &Path, staged_photo_directory: &Path) {
    let _ = fs::remove_file(staged_database);
    let _ = fs::remove_dir_all(staged_photo_directory);
    if let Ok(staged_attachment_directory) =
        staged_purchase_attachment_directory(staged_photo_directory)
    {
        let _ = fs::remove_dir_all(staged_attachment_directory);
    }
}

fn restore_database_backup_at(
    active_database: &Path,
    active_photo_directory: &Path,
    source_path: &Path,
) -> Result<DatabaseRestoreResult, String> {
    if !active_database.is_file() {
        return Err("The local pharmacy database is not available to restore.".to_owned());
    }

    let (source, source_format) = selected_backup_path(source_path)?;
    let active_canonical = fs::canonicalize(&active_database)
        .map_err(|error| format!("Could not locate the local pharmacy database: {error}"))?;
    if source == active_canonical {
        return Err("Choose a backup file other than the active pharmacy database.".to_owned());
    }

    let config_directory = active_database
        .parent()
        .ok_or_else(|| "Could not locate the local pharmacy database folder.".to_owned())?;
    let staged_database = unique_internal_path(config_directory, "restore-stage", "db");
    let photo_parent = active_photo_directory
        .parent()
        .ok_or_else(|| "Could not locate local medicine photo storage.".to_owned())?;
    fs::create_dir_all(photo_parent)
        .map_err(|error| format!("Could not access local medicine photo storage: {error}"))?;
    let staged_photo_directory =
        unique_internal_path(photo_parent, "restore-photo-stage", "dir");
    let staged_attachment_directory =
        staged_purchase_attachment_directory(&staged_photo_directory)?;
    let active_attachment_directory = photo_parent.join("purchase-attachments");

    let staging_result = (|| {
        let summary = match source_format {
            BackupSourceFormat::CompleteArchive => {
                let package_summary =
                    stage_complete_backup(&source, &staged_database, &staged_photo_directory)?;
                RestoredPhotoSummary {
                    photo_count: package_summary.photo_count,
                    ignored_orphaned_photo_count: package_summary
                        .ignored_orphaned_photo_count,
                    attachment_count: package_summary.attachment_count,
                    ignored_orphaned_attachment_count: package_summary
                        .ignored_orphaned_attachment_count,
                }
            }
            BackupSourceFormat::LegacyDatabaseOnly => {
                create_snapshot(&source, &staged_database)?;
                RestoredPhotoSummary::default()
            }
        };

        validate_backup_database(&staged_database)?;
        let mut staged_connection = Connection::open(&staged_database)
            .map_err(|error| format!("Could not open the staged backup for upgrade: {error}"))?;
        migrate_connection(&mut staged_connection).map_err(|error| {
            format!("The selected backup could not be upgraded safely: {error}")
        })?;
        drop(staged_connection);
        validate_backup_database(&staged_database)?;

        let photo_directory_to_validate = match source_format {
            BackupSourceFormat::CompleteArchive => &staged_photo_directory,
            BackupSourceFormat::LegacyDatabaseOnly => active_photo_directory,
        };
        let photo_count =
            validate_photo_references(&staged_database, photo_directory_to_validate)?;
        if source_format == BackupSourceFormat::CompleteArchive
            && photo_count != summary.photo_count
        {
            return Err(
                "The staged medicine photos do not match the restored database.".to_owned(),
            );
        }
        let attachment_directory_to_validate = match source_format {
            BackupSourceFormat::CompleteArchive => &staged_attachment_directory,
            BackupSourceFormat::LegacyDatabaseOnly => &active_attachment_directory,
        };
        let attachment_count = validate_attachment_references(
            &staged_database,
            attachment_directory_to_validate,
        )?;
        if source_format == BackupSourceFormat::CompleteArchive
            && attachment_count != summary.attachment_count
        {
            return Err(
                "The staged purchase attachments do not match the restored database.".to_owned(),
            );
        }
        Ok(RestoredPhotoSummary {
            photo_count,
            ignored_orphaned_photo_count: summary.ignored_orphaned_photo_count,
            attachment_count,
            ignored_orphaned_attachment_count: summary
                .ignored_orphaned_attachment_count,
        })
    })();
    let restored_photos = match staging_result {
        Ok(summary) => summary,
        Err(error) => {
            remove_restore_staging(&staged_database, &staged_photo_directory);
            return Err(error);
        }
    };

    let safety_backup = match create_internal_snapshot_at(
        active_database,
        active_photo_directory,
        "before-restore",
    ) {
        Ok(Some(path)) => path,
        Ok(None) => {
            remove_restore_staging(&staged_database, &staged_photo_directory);
            return Err("A safety backup could not be created before restore.".to_owned());
        }
        Err(error) => {
            remove_restore_staging(&staged_database, &staged_photo_directory);
            return Err(format!(
                "A safety backup could not be created, so restore was stopped: {error}"
            ));
        }
    };

    let current_connection = match open_pharmacy_connection_at(active_database) {
        Ok(connection) => connection,
        Err(error) => {
            remove_restore_staging(&staged_database, &staged_photo_directory);
            return Err(format!(
                "{error} Restore was stopped. Safety backup created at {}.",
                safety_backup.display()
            ));
        }
    };
    let checkpoint_result = current_connection.query_row(
        "PRAGMA wal_checkpoint(TRUNCATE)",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
    );
    let (checkpoint_busy, _, _) = match checkpoint_result {
        Ok(result) => result,
        Err(error) => {
            drop(current_connection);
            remove_restore_staging(&staged_database, &staged_photo_directory);
            return Err(format!(
                "Could not safely close the current database: {error}. Safety backup created at {}.",
                safety_backup.display()
            ));
        }
    };
    if checkpoint_busy != 0 {
        drop(current_connection);
        remove_restore_staging(&staged_database, &staged_photo_directory);
        return Err(format!(
            "The database is busy. Close other database activity and try again. Safety backup created at {}.",
            safety_backup.display()
        ));
    }
    drop(current_connection);

    let photo_swap = if source_format == BackupSourceFormat::CompleteArchive {
        match install_staged_photo_directory(active_photo_directory, &staged_photo_directory) {
            Ok(swap) => Some(swap),
            Err(error) => {
                remove_restore_staging(&staged_database, &staged_photo_directory);
                return Err(format!(
                    "{error} Safety backup created at {}.",
                    safety_backup.display()
                ));
            }
        }
    } else {
        None
    };
    let attachment_swap = if source_format == BackupSourceFormat::CompleteArchive {
        match install_staged_purchase_attachment_directory(
            &active_attachment_directory,
            &staged_attachment_directory,
        ) {
            Ok(swap) => Some(swap),
            Err(error) => {
                let photo_rollback = photo_swap
                    .as_ref()
                    .map(rollback_photo_directory_replacement)
                    .unwrap_or(Ok(()));
                remove_restore_staging(&staged_database, &staged_photo_directory);
                return Err(match photo_rollback {
                    Ok(()) => format!(
                        "{error} Original medicine photos were restored. Safety backup created at {}.",
                        safety_backup.display()
                    ),
                    Err(rollback_error) => format!(
                        "{error} {rollback_error} Safety backup created at {}.",
                        safety_backup.display()
                    ),
                });
            }
        }
    } else {
        None
    };

    let install_result =
        install_staged_database(active_database, &staged_database, |installed_database| {
            let restored_connection = open_pharmacy_connection_at(installed_database)?;
            drop(restored_connection);
            validate_backup_database(installed_database)
        });
    if let Err(error) = install_result {
        let photo_rollback = photo_swap
            .as_ref()
            .map(rollback_photo_directory_replacement)
            .unwrap_or(Ok(()));
        let attachment_rollback = attachment_swap
            .as_ref()
            .map(rollback_photo_directory_replacement)
            .unwrap_or(Ok(()));
        remove_restore_staging(&staged_database, &staged_photo_directory);
        let rollback_message = match (photo_rollback, attachment_rollback) {
            (Ok(()), Ok(())) if photo_swap.is_some() || attachment_swap.is_some() => {
                "The original medicine photos and purchase attachments were restored.".to_owned()
            }
            (Ok(()), Ok(())) => String::new(),
            (Err(photo_error), Ok(())) => photo_error,
            (Ok(()), Err(attachment_error)) => attachment_error,
            (Err(photo_error), Err(attachment_error)) => {
                format!("{photo_error} {attachment_error}")
            }
        };
        return Err(format!(
            "{error} {rollback_message} Safety backup created at {}.",
            safety_backup.display()
        ));
    }
    if let Some(swap) = &photo_swap {
        cleanup_previous_photo_directory(swap);
    }
    if let Some(swap) = &attachment_swap {
        cleanup_previous_photo_directory(swap);
    }

    Ok(DatabaseRestoreResult {
        safety_backup_path: safety_backup.display().to_string(),
        source_format: match source_format {
            BackupSourceFormat::CompleteArchive => "complete".to_owned(),
            BackupSourceFormat::LegacyDatabaseOnly => "legacyDatabaseOnly".to_owned(),
        },
        restored_photo_count: restored_photos.photo_count,
        ignored_orphaned_photo_count: restored_photos.ignored_orphaned_photo_count,
        restored_attachment_count: restored_photos.attachment_count,
        ignored_orphaned_attachment_count: restored_photos
            .ignored_orphaned_attachment_count,
    })
}

#[tauri::command]
fn restore_database_backup(
    app: AppHandle,
    source_path: String,
) -> Result<DatabaseRestoreResult, String> {
    let active_database = pharmacy_database_path(&app)?;
    let active_photo_directory = medicine_photo_directory(&app)?;
    restore_database_backup_at(
        &active_database,
        &active_photo_directory,
        Path::new(&source_path),
    )
}

fn register_auto_backup_on_close(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    migrate_pharmacy_database(app.handle())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
    let window = app.get_webview_window("main").ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "main window not found")
    })?;
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
            let backup_result = (|| {
                let database_path = pharmacy_database_path(&app_handle)?;
                let photo_directory = medicine_photo_directory(&app_handle)?;
                create_automatic_close_backup_at(&database_path, &photo_directory)
            })();
            match backup_result {
                Ok(Some(path)) => {
                    eprintln!("Automatic pharmacy backup saved to {}", path.display());
                }
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

#[cfg(debug_assertions)]
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

fn normalized_required_text(
    value: String,
    maximum_length: usize,
    label: &str,
) -> Result<String, String> {
    let value = value.trim().to_owned();
    if value.is_empty() || value.encode_utf16().count() > maximum_length {
        return Err(format!("{label} is required and exceeds its supported length."));
    }
    Ok(value)
}

fn normalized_optional_text(
    value: Option<String>,
    maximum_length: usize,
    label: &str,
) -> Result<Option<String>, String> {
    let value = value.map(|text| text.trim().to_owned()).filter(|text| !text.is_empty());
    if value
        .as_ref()
        .is_some_and(|text| text.encode_utf16().count() > maximum_length)
    {
        return Err(format!("{label} exceeds its supported length."));
    }
    Ok(value)
}

fn normalized_optional_barcode(value: Option<String>) -> Result<Option<String>, String> {
    let value = normalized_optional_text(value, 128, "Barcode")?;
    Ok(value.map(|barcode| barcode.to_ascii_uppercase()))
}

fn normalized_optional_photo_ref(
    value: Option<String>,
) -> Result<Option<String>, String> {
    let value = normalized_optional_text(value, 120, "Medicine photo reference")?;
    if value.as_ref().is_some_and(|reference| {
        !reference.starts_with("medicine-")
            || !reference.ends_with(".jpg")
            || reference.contains("..")
            || !reference
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '.')
    }) {
        return Err("Medicine photo reference is invalid.".to_owned());
    }
    Ok(value)
}

fn normalized_photo_ref_for_medicine(
    value: Option<String>,
    medicine_id: i64,
) -> Result<Option<String>, String> {
    let value = normalized_optional_photo_ref(value)?;
    if value.as_ref().is_some_and(|reference| {
        reference
            .strip_prefix(&format!("medicine-{medicine_id}-"))
            .and_then(|suffix| suffix.strip_suffix(".jpg"))
            .is_none_or(|stamp| stamp.is_empty() || !stamp.chars().all(|digit| digit.is_ascii_digit()))
    }) {
        return Err("Medicine photo reference does not belong to this record.".to_owned());
    }
    Ok(value)
}

fn validate_medicine_photo_bytes(bytes: &[u8]) -> Result<(), String> {
    const MAX_MEDICINE_PHOTO_BYTES: usize = 2_000_000;
    if bytes.len() < 4 || bytes.len() > MAX_MEDICINE_PHOTO_BYTES {
        return Err("Medicine photo must be a JPEG image no larger than 2 MB.".to_owned());
    }
    if !bytes.starts_with(&[0xff, 0xd8, 0xff]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return Err("The selected photo could not be validated as a JPEG image.".to_owned());
    }
    Ok(())
}

fn require_one_changed_row(rows_affected: usize, label: &str) -> Result<(), String> {
    if rows_affected != 1 {
        return Err(format!("{label} no longer exists or could not be updated."));
    }
    Ok(())
}

fn medicine_write_error(error: rusqlite::Error, action: &str) -> String {
    let message = error.to_string();
    if message.contains("idx_medicines_barcode_unique") {
        "This barcode is already assigned to another medicine.".to_owned()
    } else {
        format!("Could not {action}: {message}")
    }
}

fn validate_optional_gst_rate(rate: Option<i64>) -> Result<Option<i64>, String> {
    if rate.is_some_and(|value| !(0..=10_000).contains(&value)) {
        return Err("GST rate must be between 0% and 100%, in 0.01% increments.".to_owned());
    }
    Ok(rate)
}

fn normalized_customer_phone(
    value: Option<String>,
) -> Result<(Option<String>, Option<String>), String> {
    let phone = normalized_optional_text(value, 40, "Customer phone")?;
    let normalized = phone.as_ref().map(|value| {
        value
            .chars()
            .filter(|character| character.is_ascii_digit())
            .collect::<String>()
    });
    if normalized
        .as_ref()
        .is_some_and(|digits| !(7..=15).contains(&digits.len()))
    {
        return Err("Customer phone must contain 7 to 15 digits.".to_owned());
    }
    Ok((phone, normalized))
}

fn normalized_state_code(value: Option<String>) -> Result<Option<String>, String> {
    let state_code = normalized_optional_text(value, 2, "State / Union territory code")?
        .map(|value| value.to_ascii_uppercase());
    if state_code.as_ref().is_some_and(|code| {
        code.len() != 2 || !code.chars().all(|character| character.is_ascii_digit())
    }) {
        return Err("Select a valid two-digit GST state code.".to_owned());
    }
    Ok(state_code)
}

pub(crate) fn validate_iso_date(
    connection: &Connection,
    value: &str,
    label: &str,
) -> Result<(), String> {
    let parsed_date = connection
        .query_row("SELECT date(?1, '+0 days')", [value], |row| {
            row.get::<_, Option<String>>(0)
        })
        .map_err(|error| format!("Could not validate {label}: {error}"))?;
    if value.len() != 10 || parsed_date.as_deref() != Some(value) {
        return Err(format!("{label} must be a valid date in YYYY-MM-DD format."));
    }
    Ok(())
}

fn insert_opening_stock_batch(
    connection: &Connection,
    medicine_id: i64,
    batch: ImportedOpeningBatch,
    audit_reason: &str,
) -> Result<(), String> {
    let batch_no = normalized_required_text(batch.batch_no, 120, "Batch number")?;
    validate_iso_date(connection, &batch.expiry_date, "Expiry date")?;
    if !(0..=100_000_000_000).contains(&batch.purchase_rate_cents)
        || !(0..=100_000_000_000).contains(&batch.mrp_cents)
        || !(0..=100_000_000_000).contains(&batch.sale_rate_cents)
    {
        return Err("Batch prices must be between 0 and 1,000,000,000.".to_owned());
    }
    if !(0..=1_000_000_000).contains(&batch.opening_stock) {
        return Err("Opening stock must be between 0 and 1,000,000,000 units.".to_owned());
    }

    let duplicate_batch: i64 = connection
        .query_row(
            r#"SELECT EXISTS(
                 SELECT 1 FROM medicine_batches
                 WHERE medicine_id = ?1
                   AND UPPER(TRIM(batch_no)) = UPPER(TRIM(?2))
               )"#,
            params![medicine_id, batch_no],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check batch number: {error}"))?;
    if duplicate_batch != 0 {
        return Err(format!(
            "Batch {batch_no} already exists for this medicine. Use the purchase or batch workflow to change it."
        ));
    }

    let rows_affected = connection
        .execute(
            r#"INSERT INTO medicine_batches (
                 medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                 sale_rate, current_stock
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![
                medicine_id,
                batch_no,
                batch.expiry_date,
                batch.purchase_rate_cents as f64 / 100.0,
                batch.mrp_cents as f64 / 100.0,
                batch.sale_rate_cents as f64 / 100.0,
                batch.opening_stock
            ],
        )
        .map_err(|error| format!("Could not create the opening batch: {error}"))?;
    require_one_changed_row(rows_affected, "Medicine batch")?;
    let batch_id = connection.last_insert_rowid();

    if batch.opening_stock > 0 {
        let rows_affected = connection
            .execute(
                r#"INSERT INTO stock_adjustments (
                     medicine_id, batch_id, quantity_change, reason,
                     previous_quantity, new_quantity
                   ) VALUES (?1, ?2, ?3, ?4, 0, ?3)"#,
                params![medicine_id, batch_id, batch.opening_stock, audit_reason],
            )
            .map_err(|error| format!("Could not record the opening stock: {error}"))?;
        require_one_changed_row(rows_affected, "Opening stock adjustment")?;
    }

    Ok(())
}

fn apply_pharmacy_mutation_to_connection(
    connection: &mut Connection,
    operation: PharmacyMutation,
) -> Result<Option<i64>, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the pharmacy update: {error}"))?;

    let entity_id = match operation {
        PharmacyMutation::CreateMedicine {
            name,
            generic_name,
            company,
            product_type,
            strength,
            composition,
            barcode,
            uses,
            adult_dose,
            child_dose,
            photo_ref,
            rack_location,
            min_stock_alert,
            gst_rate_basis_points,
            opening_batch,
        } => {
            let name = normalized_required_text(name, 120, "Medicine name")?;
            let generic_name = normalized_optional_text(generic_name, 150, "Generic name")?;
            let company = normalized_optional_text(company, 120, "Company")?;
            let product_type = normalized_optional_text(product_type, 80, "Product type")?;
            let strength = normalized_optional_text(strength, 80, "Strength")?;
            let composition = normalized_optional_text(composition, 500, "Composition")?;
            let barcode = normalized_optional_barcode(barcode)?;
            let uses = normalized_optional_text(uses, 1000, "Uses")?;
            let adult_dose = normalized_optional_text(adult_dose, 500, "Adult dose")?;
            let child_dose = normalized_optional_text(child_dose, 500, "Child dose")?;
            let photo_ref = normalized_optional_photo_ref(photo_ref)?;
            if photo_ref.is_some() {
                return Err("Save the medicine before attaching a photo.".to_owned());
            }
            let rack_location = normalized_optional_text(rack_location, 80, "Rack location")?;
            if !(0..=1_000_000_000).contains(&min_stock_alert) {
                return Err("Minimum stock alert must be between 0 and 1,000,000,000.".to_owned());
            }
            let gst_rate_basis_points = validate_optional_gst_rate(gst_rate_basis_points)?;
            let rows_affected = transaction
                .execute(
                    r#"INSERT INTO medicines (
                         name, generic_name, company, product_type, strength, composition,
                         barcode, uses, adult_dose, child_dose, photo_ref, rack_location,
                         min_stock_alert, gst_rate_basis_points
                       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"#,
                    params![
                        name,
                        generic_name,
                        company,
                        product_type,
                        strength,
                        composition,
                        barcode,
                        uses,
                        adult_dose,
                        child_dose,
                        photo_ref,
                        rack_location,
                        min_stock_alert,
                        gst_rate_basis_points
                    ],
                )
                .map_err(|error| medicine_write_error(error, "create the medicine"))?;
            require_one_changed_row(rows_affected, "Medicine")?;
            let medicine_id = transaction.last_insert_rowid();
            if let Some(batch) = opening_batch {
                if !(1..=1_000_000_000).contains(&batch.opening_stock) {
                    return Err(
                        "Opening stock must be a whole number from 1 to 1,000,000,000 units."
                            .to_owned(),
                    );
                }
                insert_opening_stock_batch(
                    &transaction,
                    medicine_id,
                    batch,
                    "Opening stock entered while adding medicine",
                )?;
            }
            Some(medicine_id)
        }
        PharmacyMutation::UpdateMedicine {
            medicine_id,
            name,
            generic_name,
            company,
            product_type,
            strength,
            composition,
            barcode,
            uses,
            adult_dose,
            child_dose,
            photo_ref,
            rack_location,
            min_stock_alert,
            gst_rate_basis_points,
        } => {
            if medicine_id <= 0 {
                return Err("Medicine id must be a positive whole number.".to_owned());
            }
            let name = normalized_required_text(name, 120, "Medicine name")?;
            let generic_name = normalized_optional_text(generic_name, 150, "Generic name")?;
            let company = normalized_optional_text(company, 120, "Company")?;
            let product_type = normalized_optional_text(product_type, 80, "Product type")?;
            let strength = normalized_optional_text(strength, 80, "Strength")?;
            let composition = normalized_optional_text(composition, 500, "Composition")?;
            let barcode = normalized_optional_barcode(barcode)?;
            let uses = normalized_optional_text(uses, 1000, "Uses")?;
            let adult_dose = normalized_optional_text(adult_dose, 500, "Adult dose")?;
            let child_dose = normalized_optional_text(child_dose, 500, "Child dose")?;
            let photo_ref = normalized_photo_ref_for_medicine(photo_ref, medicine_id)?;
            let rack_location = normalized_optional_text(rack_location, 80, "Rack location")?;
            if !(0..=1_000_000_000).contains(&min_stock_alert) {
                return Err("Minimum stock alert must be between 0 and 1,000,000,000.".to_owned());
            }
            let gst_rate_basis_points = validate_optional_gst_rate(gst_rate_basis_points)?;
            let rows_affected = transaction
                .execute(
                    r#"UPDATE medicines
                       SET name = ?1, generic_name = ?2, company = ?3,
                           product_type = ?4, strength = ?5, composition = ?6,
                           barcode = ?7, uses = ?8, adult_dose = ?9, child_dose = ?10,
                           photo_ref = ?11, rack_location = ?12, min_stock_alert = ?13,
                           gst_rate_basis_points = ?14
                       WHERE id = ?15"#,
                    params![
                        name,
                        generic_name,
                        company,
                        product_type,
                        strength,
                        composition,
                        barcode,
                        uses,
                        adult_dose,
                        child_dose,
                        photo_ref,
                        rack_location,
                        min_stock_alert,
                        gst_rate_basis_points,
                        medicine_id
                    ],
                )
                .map_err(|error| medicine_write_error(error, "update the medicine"))?;
            require_one_changed_row(rows_affected, "Medicine")?;
            None
        }
        PharmacyMutation::DeleteMedicine { medicine_id } => {
            if medicine_id <= 0 {
                return Err("Medicine id must be a positive whole number.".to_owned());
            }
            let rows_affected = transaction
                .execute("DELETE FROM medicines WHERE id = ?1", [medicine_id])
                .map_err(|error| format!("Could not delete the medicine: {error}"))?;
            require_one_changed_row(rows_affected, "Medicine")?;
            None
        }
        PharmacyMutation::UpdateBatchDetails {
            batch_id,
            medicine_id,
            mrp_cents,
            sale_rate_cents,
            rack_location,
        } => {
            if batch_id <= 0 || medicine_id <= 0 || mrp_cents < 0 || sale_rate_cents < 0 {
                return Err("Batch ids and prices must be valid non-negative values.".to_owned());
            }
            let rack_location = normalized_optional_text(rack_location, 80, "Rack location")?;
            let rows_affected = transaction
                .execute(
                    "UPDATE medicine_batches SET mrp = ?1, sale_rate = ?2 WHERE id = ?3 AND medicine_id = ?4",
                    params![
                        mrp_cents as f64 / 100.0,
                        sale_rate_cents as f64 / 100.0,
                        batch_id,
                        medicine_id
                    ],
                )
                .map_err(|error| format!("Could not update the medicine batch: {error}"))?;
            require_one_changed_row(rows_affected, "Medicine batch")?;
            let rows_affected = transaction
                .execute(
                    "UPDATE medicines SET rack_location = ?1 WHERE id = ?2",
                    params![rack_location, medicine_id],
                )
                .map_err(|error| format!("Could not update the medicine location: {error}"))?;
            require_one_changed_row(rows_affected, "Medicine")?;
            None
        }
        PharmacyMutation::AdjustBatchStock {
            batch_id,
            medicine_id,
            quantity_change,
            reason,
        } => {
            if batch_id <= 0 || medicine_id <= 0 {
                return Err("Medicine and batch ids must be positive whole numbers.".to_owned());
            }
            if quantity_change == 0
                || !(-1_000_000_000..=1_000_000_000).contains(&quantity_change)
            {
                return Err("Enter a non-zero stock adjustment of at most 1,000,000,000 units.".to_owned());
            }
            let reason = normalized_required_text(reason, 250, "Adjustment reason")?;
            let previous_stock: i64 = transaction
                .query_row(
                    "SELECT current_stock FROM medicine_batches WHERE id = ?1 AND medicine_id = ?2",
                    params![batch_id, medicine_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| format!("Could not read current batch stock: {error}"))?
                .ok_or_else(|| "Medicine batch was not found.".to_owned())?;
            let new_stock = previous_stock
                .checked_add(quantity_change)
                .filter(|quantity| (0..=1_000_000_000).contains(quantity))
                .ok_or_else(|| "The stock adjustment would create an invalid quantity.".to_owned())?;
            let rows_affected = transaction
                .execute(
                    r#"UPDATE medicine_batches
                       SET current_stock = ?1
                       WHERE id = ?2 AND medicine_id = ?3
                         AND current_stock = ?4"#,
                    params![new_stock, batch_id, medicine_id, previous_stock],
                )
                .map_err(|error| format!("Could not adjust medicine stock: {error}"))?;
            require_one_changed_row(rows_affected, "Medicine batch")?;
            let rows_affected = transaction
                .execute(
                    r#"INSERT INTO stock_adjustments (
                         medicine_id, batch_id, quantity_change, reason,
                         previous_quantity, new_quantity
                       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                    params![
                        medicine_id,
                        batch_id,
                        quantity_change,
                        reason,
                        previous_stock,
                        new_stock
                    ],
                )
                .map_err(|error| format!("Could not record the stock adjustment: {error}"))?;
            require_one_changed_row(rows_affected, "Stock adjustment")?;
            None
        }
        PharmacyMutation::AdjustBatchStockBulk {
            adjustments,
            reason,
        } => {
            if adjustments.is_empty() || adjustments.len() > 100 {
                return Err("Choose between 1 and 100 batches for a bulk stock adjustment.".to_owned());
            }
            let reason = normalized_required_text(reason, 250, "Adjustment reason")?;
            let mut seen_batches = HashMap::<i64, ()>::new();
            for adjustment in adjustments {
                if adjustment.batch_id <= 0 || adjustment.medicine_id <= 0 {
                    return Err("Medicine and batch ids must be positive whole numbers.".to_owned());
                }
                if adjustment.quantity_change == 0
                    || !(-1_000_000_000..=1_000_000_000)
                        .contains(&adjustment.quantity_change)
                {
                    return Err("Each bulk adjustment must be a non-zero change of at most 1,000,000,000 units.".to_owned());
                }
                if seen_batches.insert(adjustment.batch_id, ()).is_some() {
                    return Err("A batch can only appear once in a bulk stock adjustment.".to_owned());
                }
                let previous_stock: i64 = transaction
                    .query_row(
                        r#"SELECT current_stock
                           FROM medicine_batches
                           WHERE id = ?1 AND medicine_id = ?2"#,
                        params![adjustment.batch_id, adjustment.medicine_id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|error| format!("Could not validate a selected stock batch: {error}"))?
                    .ok_or_else(|| "A selected stock batch no longer exists.".to_owned())?;
                let new_stock = previous_stock
                    .checked_add(adjustment.quantity_change)
                    .filter(|quantity| (0..=1_000_000_000).contains(quantity))
                    .ok_or_else(|| "A bulk adjustment would create an invalid stock quantity.".to_owned())?;
                let rows_affected = transaction
                    .execute(
                        r#"UPDATE medicine_batches
                           SET current_stock = ?1
                           WHERE id = ?2 AND medicine_id = ?3
                             AND current_stock = ?4"#,
                        params![
                            new_stock,
                            adjustment.batch_id,
                            adjustment.medicine_id,
                            previous_stock
                        ],
                    )
                    .map_err(|error| format!("Could not adjust a selected stock batch: {error}"))?;
                require_one_changed_row(rows_affected, "Medicine batch")?;
                let rows_affected = transaction
                    .execute(
                        r#"INSERT INTO stock_adjustments (
                             medicine_id, batch_id, quantity_change, reason,
                             previous_quantity, new_quantity
                           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                        params![
                            adjustment.medicine_id,
                            adjustment.batch_id,
                            adjustment.quantity_change,
                            reason,
                            previous_stock,
                            new_stock
                        ],
                    )
                    .map_err(|error| format!("Could not record a bulk stock adjustment: {error}"))?;
                require_one_changed_row(rows_affected, "Stock adjustment")?;
            }
            None
        }
        PharmacyMutation::UpdateBulkReorderThresholds { updates } => {
            if updates.is_empty() || updates.len() > 100 {
                return Err("Choose between 1 and 100 medicines for a bulk reorder-level update.".to_owned());
            }
            let mut seen_medicines = HashMap::<i64, ()>::new();
            for update in updates {
                if update.medicine_id <= 0 {
                    return Err("Medicine ids must be positive whole numbers.".to_owned());
                }
                if !(0..=1_000_000_000).contains(&update.min_stock_alert) {
                    return Err("Reorder levels must be between 0 and 1,000,000,000 units.".to_owned());
                }
                if seen_medicines.insert(update.medicine_id, ()).is_some() {
                    return Err("A medicine can only appear once in a bulk reorder-level update.".to_owned());
                }
                let rows_affected = transaction
                    .execute(
                        "UPDATE medicines SET min_stock_alert = ?1 WHERE id = ?2",
                        params![update.min_stock_alert, update.medicine_id],
                    )
                    .map_err(|error| format!("Could not update a medicine reorder level: {error}"))?;
                require_one_changed_row(rows_affected, "Medicine")?;
            }
            None
        }
        PharmacyMutation::ImportMedicines { records } => {
            if records.is_empty() || records.len() > 1_000 {
                return Err("Import between 1 and 1,000 valid medicine rows at a time.".to_owned());
            }
            let mut seen_medicine_ids = HashMap::<i64, ()>::new();
            let mut seen_barcodes = HashMap::<String, ()>::new();
            let mut seen_identities = HashMap::<String, ()>::new();
            for record in records {
                let name = normalized_required_text(record.name, 120, "Medicine name")?;
                let generic_name = normalized_optional_text(record.generic_name, 150, "Generic name")?;
                let company = normalized_optional_text(record.company, 120, "Company")?;
                let product_type = normalized_optional_text(record.product_type, 80, "Product type")?;
                let strength = normalized_optional_text(record.strength, 80, "Strength")?;
                let composition = normalized_optional_text(record.composition, 500, "Composition")?;
                let barcode = normalized_optional_barcode(record.barcode)?;
                let uses = normalized_optional_text(record.uses, 1000, "Uses")?;
                let adult_dose = normalized_optional_text(record.adult_dose, 500, "Adult dose")?;
                let child_dose = normalized_optional_text(record.child_dose, 500, "Child dose")?;
                let rack_location = normalized_optional_text(record.rack_location, 80, "Rack location")?;
                if let Some(min_stock_alert) = record.min_stock_alert {
                    if !(0..=1_000_000_000).contains(&min_stock_alert) {
                        return Err("Minimum stock alert must be between 0 and 1,000,000,000.".to_owned());
                    }
                }
                let gst_rate_basis_points = validate_optional_gst_rate(record.gst_rate_basis_points)?;
                if let Some(barcode) = barcode.as_ref() {
                    if seen_barcodes.insert(barcode.to_uppercase(), ()).is_some() {
                        return Err("A barcode can only appear once in an import.".to_owned());
                    }
                }
                let identity = format!(
                    "{}|{}|{}|{}",
                    name.to_uppercase(),
                    company.as_deref().unwrap_or_default().to_uppercase(),
                    product_type.as_deref().unwrap_or_default().to_uppercase(),
                    strength.as_deref().unwrap_or_default().to_uppercase()
                );
                if seen_identities.insert(identity.clone(), ()).is_some() {
                    return Err("A medicine can only appear once in an import.".to_owned());
                }

                let medicine_id = if let Some(medicine_id) = record.medicine_id {
                    if medicine_id <= 0 {
                        return Err("Medicine ids must be positive whole numbers.".to_owned());
                    }
                    if seen_medicine_ids.insert(medicine_id, ()).is_some() {
                        return Err("A medicine can only appear once in an import.".to_owned());
                    }
                    let rows_affected = transaction
                        .execute(
                            r#"UPDATE medicines
                               SET name = ?1, generic_name = ?2, company = ?3,
                                   product_type = ?4, strength = ?5, composition = ?6,
                                   barcode = ?7, uses = ?8, adult_dose = ?9, child_dose = ?10,
                                   rack_location = ?11,
                                   min_stock_alert = COALESCE(?12, min_stock_alert),
                                   gst_rate_basis_points = ?13
                               WHERE id = ?14"#,
                            params![
                                name,
                                generic_name,
                                company,
                                product_type,
                                strength,
                                composition,
                                barcode,
                                uses,
                                adult_dose,
                                child_dose,
                                rack_location,
                                record.min_stock_alert,
                                gst_rate_basis_points,
                                medicine_id
                            ],
                        )
                        .map_err(|error| medicine_write_error(error, "update an imported medicine"))?;
                    require_one_changed_row(rows_affected, "Medicine")?;
                    medicine_id
                } else {
                    let duplicate_identity: i64 = transaction
                        .query_row(
                            r#"SELECT EXISTS(
                                 SELECT 1 FROM medicines
                                 WHERE UPPER(TRIM(name)) = ?1
                                   AND UPPER(TRIM(COALESCE(company, ''))) = ?2
                                   AND UPPER(TRIM(COALESCE(product_type, ''))) = ?3
                                   AND UPPER(TRIM(COALESCE(strength, ''))) = ?4
                               )"#,
                            params![
                                name.to_uppercase(),
                                company.as_deref().unwrap_or_default().to_uppercase(),
                                product_type.as_deref().unwrap_or_default().to_uppercase(),
                                strength.as_deref().unwrap_or_default().to_uppercase()
                            ],
                            |row| row.get(0),
                        )
                        .map_err(|error| format!("Could not check an imported medicine match: {error}"))?;
                    if duplicate_identity != 0 {
                        return Err(format!(
                            "{name} already exists. Select Update matching medicines and review the match."
                        ));
                    }
                    let rows_affected = if let Some(min_stock_alert) = record.min_stock_alert {
                        transaction.execute(
                            r#"INSERT INTO medicines (
                                 name, generic_name, company, product_type, strength, composition,
                                 barcode, uses, adult_dose, child_dose, rack_location,
                                 min_stock_alert, gst_rate_basis_points
                               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"#,
                            params![
                                name,
                                generic_name,
                                company,
                                product_type,
                                strength,
                                composition,
                                barcode,
                                uses,
                                adult_dose,
                                child_dose,
                                rack_location,
                                min_stock_alert,
                                gst_rate_basis_points
                            ],
                        )
                    } else {
                        transaction.execute(
                            r#"INSERT INTO medicines (
                                 name, generic_name, company, product_type, strength, composition,
                                 barcode, uses, adult_dose, child_dose, rack_location,
                                 gst_rate_basis_points
                               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"#,
                            params![
                                name,
                                generic_name,
                                company,
                                product_type,
                                strength,
                                composition,
                                barcode,
                                uses,
                                adult_dose,
                                child_dose,
                                rack_location,
                                gst_rate_basis_points
                            ],
                        )
                    }
                    .map_err(|error| medicine_write_error(error, "create an imported medicine"))?;
                    require_one_changed_row(rows_affected, "Medicine")?;
                    transaction.last_insert_rowid()
                };

                if let Some(batch) = record.opening_batch {
                    insert_opening_stock_batch(
                        &transaction,
                        medicine_id,
                        batch,
                        "Opening stock imported from Excel",
                    )?;
                }
            }
            None
        }
        PharmacyMutation::DeductStock { deductions } => {
            if deductions.is_empty() {
                return Err("At least one stock deduction is required.".to_owned());
            }
            let mut combined = HashMap::<i64, i64>::new();
            for deduction in deductions {
                if deduction.batch_id <= 0 || deduction.quantity <= 0 {
                    return Err("Stock deductions need positive batch ids and quantities.".to_owned());
                }
                let quantity = combined.entry(deduction.batch_id).or_default();
                *quantity = quantity
                    .checked_add(deduction.quantity)
                    .ok_or_else(|| "Combined stock deduction exceeds the supported amount.".to_owned())?;
            }
            let mut combined = combined.into_iter().collect::<Vec<_>>();
            combined.sort_unstable_by_key(|(batch_id, _)| *batch_id);
            for (batch_id, quantity) in combined {
                let rows_affected = transaction
                    .execute(
                        r#"UPDATE medicine_batches
                           SET current_stock = current_stock - ?1
                           WHERE id = ?2
                             AND current_stock >= ?1
                             AND expiry_date >= date('now', 'localtime')"#,
                        params![quantity, batch_id],
                    )
                    .map_err(|error| format!("Could not deduct medicine stock: {error}"))?;
                require_one_changed_row(rows_affected, "Medicine batch")?;
            }
            None
        }
        PharmacyMutation::AddStock { batch_id, quantity } => {
            if batch_id <= 0 || quantity <= 0 {
                return Err("Batch id and stock quantity must be positive whole numbers.".to_owned());
            }
            let rows_affected = transaction
                .execute(
                    "UPDATE medicine_batches SET current_stock = current_stock + ?1 WHERE id = ?2",
                    params![quantity, batch_id],
                )
                .map_err(|error| format!("Could not add stock to the medicine batch: {error}"))?;
            require_one_changed_row(rows_affected, "Medicine batch")?;
            None
        }
        PharmacyMutation::CreateSupplier {
            name,
            contact_person,
            phone,
            whatsapp_phone,
            address,
            notes,
            state_code,
        } => {
            let name = normalized_required_text(name, 120, "Supplier name")?;
            let contact_person =
                normalized_optional_text(contact_person, 120, "Contact person")?;
            let phone = normalized_optional_text(phone, 40, "Supplier phone")?;
            let whatsapp_phone =
                normalized_optional_text(whatsapp_phone, 40, "WhatsApp number")?;
            let address = normalized_optional_text(address, 500, "Supplier address")?;
            let notes = normalized_optional_text(notes, 1000, "Supplier notes")?;
            let state_code = normalized_state_code(state_code)?;
            let rows_affected = transaction
                .execute(
                    r#"INSERT INTO suppliers (
                         name, contact_person, phone, whatsapp_phone, address, notes, state_code
                       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                    params![name, contact_person, phone, whatsapp_phone, address, notes, state_code],
                )
                .map_err(|error| format!("Could not create the supplier: {error}"))?;
            require_one_changed_row(rows_affected, "Supplier")?;
            Some(transaction.last_insert_rowid())
        }
        PharmacyMutation::UpdateSupplier {
            supplier_id,
            name,
            contact_person,
            phone,
            whatsapp_phone,
            address,
            notes,
            state_code,
        } => {
            if supplier_id <= 0 {
                return Err("Supplier id must be a positive whole number.".to_owned());
            }
            let name = normalized_required_text(name, 120, "Supplier name")?;
            let contact_person =
                normalized_optional_text(contact_person, 120, "Contact person")?;
            let phone = normalized_optional_text(phone, 40, "Supplier phone")?;
            let whatsapp_phone =
                normalized_optional_text(whatsapp_phone, 40, "WhatsApp number")?;
            let address = normalized_optional_text(address, 500, "Supplier address")?;
            let notes = normalized_optional_text(notes, 1000, "Supplier notes")?;
            let state_code = normalized_state_code(state_code)?;
            let rows_affected = transaction
                .execute(
                    r#"UPDATE suppliers
                       SET name = ?1, contact_person = ?2, phone = ?3,
                           whatsapp_phone = ?4, address = ?5, notes = ?6, state_code = ?7
                       WHERE id = ?8"#,
                    params![
                        name,
                        contact_person,
                        phone,
                        whatsapp_phone,
                        address,
                        notes,
                        state_code,
                        supplier_id
                    ],
                )
                .map_err(|error| format!("Could not update the supplier: {error}"))?;
            require_one_changed_row(rows_affected, "Supplier")?;
            None
        }
        PharmacyMutation::DeleteSupplier { supplier_id } => {
            if supplier_id <= 0 {
                return Err("Supplier id must be a positive whole number.".to_owned());
            }
            let rows_affected = transaction
                .execute("DELETE FROM suppliers WHERE id = ?1", [supplier_id])
                .map_err(|error| format!("Could not delete the supplier: {error}"))?;
            require_one_changed_row(rows_affected, "Supplier")?;
            None
        }
        PharmacyMutation::CreateCustomer {
            name,
            phone,
            address,
            notes,
            state_code,
        } => {
            let name = normalized_required_text(name, 120, "Customer name")?;
            let (phone, phone_normalized) = normalized_customer_phone(phone)?;
            let address = normalized_optional_text(address, 500, "Customer address")?;
            let notes = normalized_optional_text(notes, 1000, "Customer notes")?;
            let state_code = normalized_state_code(state_code)?;
            let rows_affected = transaction
                .execute(
                    r#"INSERT INTO customers (
                         name, phone, phone_normalized, address, notes, state_code
                       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                    params![name, phone, phone_normalized, address, notes, state_code],
                )
                .map_err(|error| {
                    if error.to_string().contains("idx_customers_phone_normalized") {
                        "A customer with this phone number already exists.".to_owned()
                    } else {
                        format!("Could not create the customer: {error}")
                    }
                })?;
            require_one_changed_row(rows_affected, "Customer")?;
            Some(transaction.last_insert_rowid())
        }
        PharmacyMutation::UpdateCustomer {
            customer_id,
            name,
            phone,
            address,
            notes,
            state_code,
        } => {
            if customer_id <= 0 {
                return Err("Customer id must be a positive whole number.".to_owned());
            }
            let name = normalized_required_text(name, 120, "Customer name")?;
            let (phone, phone_normalized) = normalized_customer_phone(phone)?;
            let address = normalized_optional_text(address, 500, "Customer address")?;
            let notes = normalized_optional_text(notes, 1000, "Customer notes")?;
            let state_code = normalized_state_code(state_code)?;
            let rows_affected = transaction
                .execute(
                    r#"UPDATE customers
                       SET name = ?1, phone = ?2, phone_normalized = ?3,
                           address = ?4, notes = ?5, state_code = ?6
                       WHERE id = ?7"#,
                    params![
                        name,
                        phone,
                        phone_normalized,
                        address,
                        notes,
                        state_code,
                        customer_id
                    ],
                )
                .map_err(|error| {
                    if error.to_string().contains("idx_customers_phone_normalized") {
                        "A customer with this phone number already exists.".to_owned()
                    } else {
                        format!("Could not update the customer: {error}")
                    }
                })?;
            require_one_changed_row(rows_affected, "Customer")?;
            None
        }
        PharmacyMutation::SetCustomerActive {
            customer_id,
            active,
        } => {
            if customer_id <= 0 {
                return Err("Customer id must be a positive whole number.".to_owned());
            }
            let rows_affected = transaction
                .execute(
                    "UPDATE customers SET active = ?1 WHERE id = ?2",
                    params![active, customer_id],
                )
                .map_err(|error| format!("Could not update customer status: {error}"))?;
            require_one_changed_row(rows_affected, "Customer")?;
            None
        }
        PharmacyMutation::SaveSettings { settings } => {
            let gst_default_rate_basis_points =
                validate_optional_gst_rate(settings.gst_default_rate_basis_points)?;
            let gst_pricing_mode = settings.gst_pricing_mode.trim().to_ascii_uppercase();
            if !matches!(gst_pricing_mode.as_str(), "INCLUSIVE" | "EXCLUSIVE") {
                return Err("GST pricing mode must be inclusive or exclusive.".to_owned());
            }
            let gst_pharmacy_state_code =
                normalized_state_code(Some(settings.gst_pharmacy_state_code))?.unwrap_or_default();
            if settings.gst_enabled && gst_pharmacy_state_code.is_empty() {
                return Err("Set the pharmacy state before enabling GST.".to_owned());
            }
            let upi_id = settings.upi_id.trim().to_owned();
            if upi_id.encode_utf16().count() > 100
                || (!upi_id.is_empty()
                    && (upi_id.chars().any(char::is_whitespace)
                        || !upi_id.contains('@')
                        || upi_id.starts_with('@')
                        || upi_id.ends_with('@')))
            {
                return Err("Enter a valid UPI ID, or leave it blank.".to_owned());
            }
            let gst_default_rate_basis_points = gst_default_rate_basis_points
                .map(|value| value.to_string())
                .unwrap_or_default();
            let values = [
                ("pharmacy_name", settings.pharmacy_name, 160_usize),
                ("address", settings.address, 500),
                ("contact_number", settings.contact_number, 40),
                ("drug_license_number", settings.drug_license_number, 100),
                ("receipt_footer_note", settings.receipt_footer_note, 300),
                ("upi_id", upi_id, 100),
                (
                    "upi_display_name",
                    settings.upi_display_name,
                    120,
                ),
                ("gst_enabled", settings.gst_enabled.to_string(), 5),
                (
                    "gst_default_rate_basis_points",
                    gst_default_rate_basis_points,
                    5,
                ),
                ("gst_pricing_mode", gst_pricing_mode, 9),
                ("gst_pharmacy_state_code", gst_pharmacy_state_code, 2),
            ];
            for (key, value, maximum_length) in values {
                let value = value.trim();
                if value.encode_utf16().count() > maximum_length {
                    return Err(format!(
                        "{} must be {maximum_length} characters or fewer.",
                        key.replace('_', " ")
                    ));
                }
                let rows_affected = transaction
                    .execute(
                        r#"INSERT INTO app_settings (setting_key, setting_value)
                           VALUES (?1, ?2)
                           ON CONFLICT(setting_key) DO UPDATE
                           SET setting_value = excluded.setting_value"#,
                        params![key, value],
                    )
                    .map_err(|error| format!("Could not save pharmacy settings: {error}"))?;
                require_one_changed_row(rows_affected, "Pharmacy setting")?;
            }
            None
        }
    };

    transaction
        .commit()
        .map_err(|error| format!("Could not save the pharmacy update: {error}"))?;
    Ok(entity_id)
}

#[tauri::command]
fn apply_pharmacy_mutation(
    app: AppHandle,
    operation: PharmacyMutation,
) -> Result<PharmacyMutationResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    let entity_id = apply_pharmacy_mutation_to_connection(&mut connection, operation)?;
    Ok(PharmacyMutationResult { entity_id })
}

fn medicine_photo_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("medicine-photos"))
        .map_err(|error| format!("Could not access local medicine photo storage: {error}"))
}

fn medicine_photo_path(
    directory: &Path,
    medicine_id: i64,
    photo_ref: &str,
) -> Result<PathBuf, String> {
    let reference = normalized_photo_ref_for_medicine(Some(photo_ref.to_owned()), medicine_id)?
        .ok_or_else(|| "Medicine photo reference is missing.".to_owned())?;
    Ok(directory.join(reference))
}

pub(crate) fn ensure_local_storage_directory(directory: &Path) -> Result<(), String> {
    let parent = directory
        .parent()
        .ok_or_else(|| "The local storage directory is invalid.".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Could not create the local app-data directory: {error}"))?;

    let metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match fs::create_dir(directory) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(format!("Could not create local storage: {error}"));
                }
            }
            fs::symlink_metadata(directory)
                .map_err(|error| format!("Could not inspect local storage: {error}"))?
        }
        Err(error) => return Err(format!("Could not inspect local storage: {error}")),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Local storage must be a real directory inside the app-data folder.".to_owned());
    }

    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("Could not resolve the app-data folder: {error}"))?;
    let canonical_directory = fs::canonicalize(directory)
        .map_err(|error| format!("Could not resolve local storage: {error}"))?;
    if canonical_directory == canonical_parent || !canonical_directory.starts_with(&canonical_parent)
    {
        return Err("Local storage must remain inside the app-data folder.".to_owned());
    }
    Ok(())
}

#[tauri::command]
fn save_medicine_photo(
    app: AppHandle,
    medicine_id: i64,
    photo_bytes: Vec<u8>,
) -> Result<String, String> {
    if medicine_id <= 0 {
        return Err("Medicine id must be a positive whole number.".to_owned());
    }
    validate_medicine_photo_bytes(&photo_bytes)?;

    let mut connection = open_pharmacy_connection(&app)?;
    let old_photo_ref: Option<String> = connection
        .query_row(
            "SELECT photo_ref FROM medicines WHERE id = ?1",
            [medicine_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not find the medicine photo record: {error}"))?
        .ok_or_else(|| "The medicine no longer exists.".to_owned())?;
    if let Some(reference) = old_photo_ref.as_deref() {
        normalized_photo_ref_for_medicine(Some(reference.to_owned()), medicine_id)?;
    }

    let directory = medicine_photo_directory(&app)?;
    ensure_local_storage_directory(&directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The local clock is invalid; the medicine photo was not saved.".to_owned())?
        .as_nanos();
    let photo_ref = format!("medicine-{medicine_id}-{timestamp}.jpg");
    let target_path = medicine_photo_path(&directory, medicine_id, &photo_ref)?;
    let temporary_path = directory.join(format!(".{photo_ref}.tmp"));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)
        .map_err(|error| format!("Could not stage the medicine photo: {error}"))?;
    if let Err(error) = file.write_all(&photo_bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Could not write the medicine photo: {error}"));
    }
    drop(file);
    if let Err(error) = fs::rename(&temporary_path, &target_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(format!("Could not store the medicine photo locally: {error}"));
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| {
            let _ = fs::remove_file(&target_path);
            format!("Could not begin the medicine photo update: {error}")
        })?;
    let rows_affected = transaction
        .execute(
            "UPDATE medicines SET photo_ref = ?1 WHERE id = ?2",
            params![photo_ref, medicine_id],
        )
        .map_err(|error| format!("Could not update the medicine photo reference: {error}"))?;
    if let Err(error) = require_one_changed_row(rows_affected, "Medicine") {
        let _ = fs::remove_file(&target_path);
        return Err(error);
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the medicine photo update: {error}"))?;

    Ok(photo_ref)
}

#[tauri::command]
fn get_medicine_photo(app: AppHandle, medicine_id: i64) -> Result<Option<Vec<u8>>, String> {
    if medicine_id <= 0 {
        return Err("Medicine id must be a positive whole number.".to_owned());
    }
    let connection = open_pharmacy_connection(&app)?;
    let photo_ref: Option<String> = connection
        .query_row(
            "SELECT photo_ref FROM medicines WHERE id = ?1",
            [medicine_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read the medicine photo reference: {error}"))?
        .ok_or_else(|| "The medicine no longer exists.".to_owned())?;
    let Some(photo_ref) = photo_ref else {
        return Ok(None);
    };
    let directory = medicine_photo_directory(&app)?;
    ensure_local_storage_directory(&directory)?;
    let path = medicine_photo_path(&directory, medicine_id, &photo_ref)?;
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("The saved medicine photo is unavailable: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > 2_000_000 {
        return Err("The saved medicine photo is not a supported regular file.".to_owned());
    }
    let bytes = fs::read(&path)
        .map_err(|error| format!("Could not read the saved medicine photo: {error}"))?;
    validate_medicine_photo_bytes(&bytes)?;
    Ok(Some(bytes))
}

#[tauri::command]
fn remove_medicine_photo(app: AppHandle, medicine_id: i64) -> Result<(), String> {
    if medicine_id <= 0 {
        return Err("Medicine id must be a positive whole number.".to_owned());
    }
    let mut connection = open_pharmacy_connection(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the medicine photo removal: {error}"))?;
    let rows_affected = transaction
        .execute(
            "UPDATE medicines SET photo_ref = NULL WHERE id = ?1",
            [medicine_id],
        )
        .map_err(|error| format!("Could not clear the medicine photo reference: {error}"))?;
    require_one_changed_row(rows_affected, "Medicine")?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the medicine photo removal: {error}"))?;
    Ok(())
}

fn apply_order_list_mutation_to_connection(
    connection: &mut Connection,
    operation: OrderListMutation,
) -> Result<OrderListMutationResult, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the order-list update: {error}"))?;

    let result = match operation {
        OrderListMutation::SaveItem {
            id,
            medicine_id,
            supplier_id,
            quantity,
            note,
            order_date,
        } => {
            if medicine_id <= 0 || supplier_id.is_some_and(|id| id <= 0) {
                return Err("Medicine and supplier ids must be positive whole numbers.".to_owned());
            }
            if !(1..=1_000_000_000).contains(&quantity) {
                return Err("Order quantity must be between 1 and 1,000,000,000.".to_owned());
            }
            validate_iso_date(&transaction, &order_date, "Order date")?;
            let note = normalized_optional_text(note, 1000, "Order note")?;
            if let Some(item_id) = id {
                if item_id <= 0 {
                    return Err("Order item id must be a positive whole number.".to_owned());
                }
                let rows_affected = transaction
                    .execute(
                        r#"UPDATE order_list_items
                           SET medicine_id = ?1, supplier_id = ?2, quantity = ?3, note = ?4
                           WHERE id = ?5 AND order_date = ?6"#,
                        params![medicine_id, supplier_id, quantity, note, item_id, order_date],
                    )
                    .map_err(|error| format!("Could not update the order item: {error}"))?;
                require_one_changed_row(rows_affected, "Order item")?;
                OrderListMutationResult {
                    item_id: Some(item_id),
                    rows_affected,
                }
            } else {
                let rows_affected = transaction
                    .execute(
                        r#"INSERT INTO order_list_items (
                             order_date, medicine_id, supplier_id, quantity, note
                           ) VALUES (?1, ?2, ?3, ?4, ?5)"#,
                        params![order_date, medicine_id, supplier_id, quantity, note],
                    )
                    .map_err(|error| format!("Could not add the order item: {error}"))?;
                require_one_changed_row(rows_affected, "Order item")?;
                OrderListMutationResult {
                    item_id: Some(transaction.last_insert_rowid()),
                    rows_affected,
                }
            }
        }
        OrderListMutation::SetOrdered { item_id, ordered } => {
            if item_id <= 0 {
                return Err("Order item id must be a positive whole number.".to_owned());
            }
            let rows_affected = transaction
                .execute(
                    "UPDATE order_list_items SET ordered = ?1 WHERE id = ?2",
                    params![if ordered { 1_i64 } else { 0_i64 }, item_id],
                )
                .map_err(|error| format!("Could not update the order status: {error}"))?;
            require_one_changed_row(rows_affected, "Order item")?;
            OrderListMutationResult {
                item_id: Some(item_id),
                rows_affected,
            }
        }
        OrderListMutation::DeleteItem { item_id } => {
            if item_id <= 0 {
                return Err("Order item id must be a positive whole number.".to_owned());
            }
            let rows_affected = transaction
                .execute("DELETE FROM order_list_items WHERE id = ?1", [item_id])
                .map_err(|error| format!("Could not remove the order item: {error}"))?;
            require_one_changed_row(rows_affected, "Order item")?;
            OrderListMutationResult {
                item_id: Some(item_id),
                rows_affected,
            }
        }
        OrderListMutation::ClearDate { order_date } => {
            validate_iso_date(&transaction, &order_date, "Order date")?;
            let rows_affected = transaction
                .execute(
                    "DELETE FROM order_list_items WHERE order_date = ?1",
                    [order_date],
                )
                .map_err(|error| format!("Could not clear the order list: {error}"))?;
            OrderListMutationResult {
                item_id: None,
                rows_affected,
            }
        }
    };

    transaction
        .commit()
        .map_err(|error| format!("Could not save the order-list update: {error}"))?;
    Ok(result)
}

#[tauri::command]
fn mutate_order_list(
    app: AppHandle,
    operation: OrderListMutation,
) -> Result<OrderListMutationResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    apply_order_list_mutation_to_connection(&mut connection, operation)
}

fn reset_count(
    transaction: &Transaction<'_>,
    query: &str,
) -> Result<usize, String> {
    transaction
        .execute(query, [])
        .map_err(|error| format!("Could not reset business records: {error}"))
}

fn apply_business_reset(
    transaction: &Transaction<'_>,
    scope: DataResetScope,
) -> Result<DataResetCounts, String> {
    let mut counts = DataResetCounts::default();
    match scope {
        DataResetScope::SalesHistory => {
            reset_count(transaction, "DELETE FROM sale_return_items")?;
            reset_count(transaction, "DELETE FROM sale_returns")?;
            reset_count(transaction, "DELETE FROM sale_voids")?;
            reset_count(transaction, "DELETE FROM sale_corrections")?;
            reset_count(transaction, "DELETE FROM customer_ledger_events")?;
            counts.sale_items_deleted =
                reset_count(transaction, "DELETE FROM sale_items")?;
            counts.sales_deleted = reset_count(transaction, "DELETE FROM sales")?;
        }
        DataResetScope::PurchaseHistory => {
            reset_count(transaction, "DELETE FROM purchase_return_items")?;
            reset_count(transaction, "DELETE FROM purchase_returns")?;
            reset_count(transaction, "DELETE FROM purchase_attachments")?;
            reset_count(transaction, "DELETE FROM supplier_ledger")?;
            counts.supplier_balances_reset = transaction
                .execute("UPDATE suppliers SET balance_due = 0 WHERE balance_due <> 0", [])
                .map_err(|error| format!("Could not reset supplier balances: {error}"))?;
            counts.purchase_items_deleted =
                reset_count(transaction, "DELETE FROM purchase_items")?;
            counts.purchases_deleted = reset_count(transaction, "DELETE FROM purchases")?;
        }
        DataResetScope::SupplierBalances => {
            reset_count(transaction, "DELETE FROM supplier_ledger")?;
            counts.supplier_balances_reset = transaction
                .execute("UPDATE suppliers SET balance_due = 0 WHERE balance_due <> 0", [])
                .map_err(|error| format!("Could not reset supplier balances: {error}"))?;
        }
        DataResetScope::AllBusinessHistory => {
            reset_count(transaction, "DELETE FROM sale_return_items")?;
            reset_count(transaction, "DELETE FROM sale_returns")?;
            reset_count(transaction, "DELETE FROM sale_voids")?;
            reset_count(transaction, "DELETE FROM sale_corrections")?;
            reset_count(transaction, "DELETE FROM customer_ledger_events")?;
            counts.sale_items_deleted =
                reset_count(transaction, "DELETE FROM sale_items")?;
            counts.sales_deleted = reset_count(transaction, "DELETE FROM sales")?;
            reset_count(transaction, "DELETE FROM purchase_return_items")?;
            reset_count(transaction, "DELETE FROM purchase_returns")?;
            reset_count(transaction, "DELETE FROM purchase_attachments")?;
            reset_count(transaction, "DELETE FROM supplier_ledger")?;
            counts.purchase_items_deleted =
                reset_count(transaction, "DELETE FROM purchase_items")?;
            counts.purchases_deleted = reset_count(transaction, "DELETE FROM purchases")?;
            counts.stock_adjustments_deleted =
                reset_count(transaction, "DELETE FROM stock_adjustments")?;
            counts.order_list_items_deleted =
                reset_count(transaction, "DELETE FROM order_list_items")?;
            counts.supplier_balances_reset = transaction
                .execute("UPDATE suppliers SET balance_due = 0 WHERE balance_due <> 0", [])
                .map_err(|error| format!("Could not reset supplier balances: {error}"))?;
        }
    }
    Ok(counts)
}

fn reset_business_data_with_backup<F>(
    connection: &mut Connection,
    scope: DataResetScope,
    create_backup: F,
) -> Result<DataResetSummary, String>
where
    F: FnOnce() -> Result<String, String>,
{
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the data reset: {error}"))?;
    let backup_path = create_backup()?;
    let counts = apply_business_reset(&transaction, scope)?;
    transaction
        .commit()
        .map_err(|error| format!("Could not complete the data reset: {error}"))?;

    Ok(DataResetSummary {
        scope,
        backup_path,
        sales_deleted: counts.sales_deleted,
        sale_items_deleted: counts.sale_items_deleted,
        purchases_deleted: counts.purchases_deleted,
        purchase_items_deleted: counts.purchase_items_deleted,
        stock_adjustments_deleted: counts.stock_adjustments_deleted,
        order_list_items_deleted: counts.order_list_items_deleted,
        supplier_balances_reset: counts.supplier_balances_reset,
        stock_quantities_preserved: true,
    })
}

#[tauri::command]
fn reset_business_data(
    app: AppHandle,
    scope: DataResetScope,
    confirmation_phrase: String,
) -> Result<DataResetSummary, String> {
    if confirmation_phrase != "RESET MY DATA" {
        return Err("Type RESET MY DATA exactly to confirm this reset.".to_owned());
    }
    let mut connection = open_pharmacy_connection(&app)?;
    reset_business_data_with_backup(&mut connection, scope, || {
        create_internal_snapshot(&app, "pre_reset")?
            .map(|path| path.display().to_string())
            .ok_or_else(|| "A validated pre-reset database backup could not be created.".to_owned())
    })
}

fn allocate_sale_line_fefo(
    transaction: &Transaction<'_>,
    item: &SaleCheckoutItem,
    reserved_stock: &mut HashMap<i64, i64>,
) -> Result<Vec<SaleLineAllocation>, String> {
    if item.medicine_id <= 0 || item.batch_id <= 0 || item.quantity <= 0 {
        return Err(
            "Sale item must have a valid medicine, batch, and positive quantity.".to_owned(),
        );
    }

    let batches = {
        let mut statement = transaction
            .prepare(
                r#"SELECT id, current_stock
                   FROM medicine_batches
                   WHERE medicine_id = ?1
                     AND current_stock > 0
                     AND expiry_date >= date('now', 'localtime')
                   ORDER BY expiry_date ASC, batch_no COLLATE NOCASE ASC, id ASC"#,
            )
            .map_err(|error| format!("Could not find eligible medicine batches: {error}"))?;
        let rows = statement
            .query_map([item.medicine_id], |row| {
                Ok(FefoBatch {
                    id: row.get(0)?,
                    current_stock: row.get(1)?,
                })
            })
            .map_err(|error| format!("Could not read eligible medicine batches: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read eligible medicine batches: {error}"))?
    };

    let earliest_available = batches.iter().find(|batch| {
        batch.current_stock > reserved_stock.get(&batch.id).copied().unwrap_or_default()
    });
    if earliest_available
        .map(|batch| batch.id)
        .is_none_or(|batch_id| batch_id != item.batch_id)
    {
        return Err(
            "The selected batch does not follow earliest-expiry-first allocation. Refresh the cart and try again."
                .to_owned(),
        );
    }

    let mut remaining_quantity = item.quantity;
    let mut raw_allocations = Vec::new();
    for batch in batches {
        if remaining_quantity == 0 {
            break;
        }
        let already_reserved = reserved_stock.get(&batch.id).copied().unwrap_or_default();
        let available = batch
            .current_stock
            .checked_sub(already_reserved)
            .ok_or_else(|| "Reserved batch stock exceeded its available quantity.".to_owned())?;
        if available <= 0 {
            continue;
        }
        let allocated_quantity = available.min(remaining_quantity);
        let updated_reserved = already_reserved
            .checked_add(allocated_quantity)
            .ok_or_else(|| "Reserved batch quantity exceeds the supported amount.".to_owned())?;
        reserved_stock.insert(batch.id, updated_reserved);
        raw_allocations.push((batch.id, allocated_quantity));
        remaining_quantity -= allocated_quantity;
    }

    if remaining_quantity > 0 {
        return Err(
            "There is not enough unexpired stock to complete this sale. Refresh the cart and try again."
                .to_owned(),
        );
    }

    let mut discount_remaining = item.item_discount_cents;
    let allocation_count = raw_allocations.len();
    raw_allocations
        .into_iter()
        .enumerate()
        .map(|(index, (batch_id, quantity))| {
            let discount = if index + 1 == allocation_count {
                discount_remaining
            } else {
                let proportional =
                    ((item.item_discount_cents as i128 * quantity as i128)
                        / item.quantity as i128) as i64;
                discount_remaining -= proportional;
                proportional
            };
            Ok(SaleLineAllocation {
                batch_id,
                quantity,
                item_discount_cents: discount,
            })
        })
        .collect()
}

#[tauri::command]
fn complete_sale(
    app: AppHandle,
    checkout: SaleCheckoutRequest,
) -> Result<SaleCheckoutResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    complete_sale_in_connection(&mut connection, checkout)
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct GstAmounts {
    taxable_cents: i64,
    cgst_cents: i64,
    sgst_cents: i64,
    igst_cents: i64,
    total_gst_cents: i64,
}

fn allocate_cents_proportionally(total: i64, weights: &[i64]) -> Result<Vec<i64>, String> {
    if total < 0 || weights.iter().any(|weight| *weight < 0) {
        return Err("Discount and tax allocations must be non-negative.".to_owned());
    }
    if weights.is_empty() {
        return if total == 0 {
            Ok(Vec::new())
        } else {
            Err("The amount could not be allocated to an empty sale.".to_owned())
        };
    }
    let weight_total = weights.iter().try_fold(0_i64, |sum, weight| {
        sum.checked_add(*weight)
            .ok_or_else(|| "Sale allocation weights exceed the supported amount.".to_owned())
    })?;
    if total == 0 {
        return Ok(vec![0; weights.len()]);
    }
    if weight_total <= 0 {
        return Err("The amount cannot be allocated because all sale lines are zero.".to_owned());
    }

    let mut remaining = total;
    let mut result = Vec::with_capacity(weights.len());
    for (index, weight) in weights.iter().enumerate() {
        let share = if index + 1 == weights.len() {
            remaining
        } else {
            ((total as i128 * *weight as i128) / weight_total as i128) as i64
        };
        remaining -= share;
        result.push(share);
    }
    Ok(result)
}

fn rounded_ratio_to_cents(numerator: i128, denominator: i128) -> Result<i64, String> {
    if numerator < 0 || denominator <= 0 {
        return Err("GST calculation received an invalid amount or rate.".to_owned());
    }
    i64::try_from((numerator + denominator / 2) / denominator)
        .map_err(|_| "GST amount exceeds the supported amount.".to_owned())
}

fn resolve_gst_rate(
    gst_enabled: bool,
    override_rate: Option<i64>,
    product_rate: Option<i64>,
    default_rate: Option<i64>,
) -> Result<i64, String> {
    if !gst_enabled {
        return Ok(0);
    }
    let rate = override_rate
        .or(product_rate)
        .or(default_rate)
        .ok_or_else(|| {
            "GST is enabled, but this medicine has no product or default rate. Set a rate before checkout."
                .to_owned()
        })?;
    validate_optional_gst_rate(Some(rate))?;
    Ok(rate)
}

fn calculate_gst_amounts(
    amount_cents: i64,
    rate_basis_points: i64,
    pricing_mode: &str,
    interstate: bool,
    gst_enabled: bool,
) -> Result<GstAmounts, String> {
    if amount_cents < 0 || !(0..=10_000).contains(&rate_basis_points) {
        return Err("GST amount or rate is outside the supported range.".to_owned());
    }
    if !gst_enabled {
        return Ok(GstAmounts::default());
    }

    let (taxable_cents, total_gst_cents) = if pricing_mode == "INCLUSIVE" {
        let denominator = 10_000_i128 + rate_basis_points as i128;
        let taxable = rounded_ratio_to_cents(
            amount_cents as i128 * 10_000_i128,
            denominator,
        )?;
        (taxable, amount_cents - taxable)
    } else {
        let gst = rounded_ratio_to_cents(
            amount_cents as i128 * rate_basis_points as i128,
            10_000_i128,
        )?;
        (amount_cents, gst)
    };
    if interstate {
        Ok(GstAmounts {
            taxable_cents,
            cgst_cents: 0,
            sgst_cents: 0,
            igst_cents: total_gst_cents,
            total_gst_cents,
        })
    } else {
        let cgst_cents = total_gst_cents / 2;
        Ok(GstAmounts {
            taxable_cents,
            cgst_cents,
            sgst_cents: total_gst_cents - cgst_cents,
            igst_cents: 0,
            total_gst_cents,
        })
    }
}

fn complete_sale_in_connection(
    connection: &mut Connection,
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

    if checkout.payment_mode == "CREDIT" && checkout.customer_id.is_none() {
        return Err("Select a saved customer before recording a credit sale.".to_owned());
    }
    if checkout.customer_id.is_some_and(|customer_id| customer_id <= 0) {
        return Err("Customer id must be a positive whole number.".to_owned());
    }
    let upi_transaction_id = normalized_optional_text(
        checkout.upi_transaction_id.clone(),
        120,
        "UPI transaction ID",
    )?;
    if checkout.payment_mode != "UPI" && upi_transaction_id.is_some() {
        return Err("A UPI transaction ID can only be saved for a UPI payment.".to_owned());
    }

    let mut subtotal_cents = 0_i64;
    let mut item_discount_cents = 0_i64;
    let mut line_net_cents = Vec::with_capacity(checkout.items.len());
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
        validate_optional_gst_rate(item.gst_rate_override_basis_points)?;
        subtotal_cents = subtotal_cents
            .checked_add(line_gross_cents)
            .ok_or_else(|| "Sale subtotal exceeds the supported amount.".to_owned())?;
        item_discount_cents = item_discount_cents
            .checked_add(item.item_discount_cents)
            .ok_or_else(|| "Item discounts exceed the supported amount.".to_owned())?;
        line_net_cents.push(line_gross_cents - item.item_discount_cents);
    }

    let total_discount_cents = item_discount_cents
        .checked_add(checkout.flat_discount_cents)
        .ok_or_else(|| "Total discount exceeds the supported amount.".to_owned())?;
    let net_before_bill_discount_cents = subtotal_cents - item_discount_cents;
    if checkout.flat_discount_cents > net_before_bill_discount_cents {
        return Err("The combined discounts cannot exceed the sale subtotal.".to_owned());
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the sale transaction: {error}"))?;

    let setting_value = |key: &str| -> Result<Option<String>, String> {
        transaction
            .query_row(
                "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Could not read the {key} setting: {error}"))
    };
    let gst_enabled = setting_value("gst_enabled")?
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let default_rate = setting_value("gst_default_rate_basis_points")?
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .parse::<i64>()
                .map_err(|_| "The configured default GST rate is invalid.".to_owned())
        })
        .transpose()?;
    validate_optional_gst_rate(default_rate)?;
    let configured_mode = setting_value("gst_pricing_mode")?
        .unwrap_or_else(|| "EXCLUSIVE".to_owned())
        .to_ascii_uppercase();
    if !matches!(configured_mode.as_str(), "INCLUSIVE" | "EXCLUSIVE") {
        return Err("The configured GST pricing mode is invalid.".to_owned());
    }
    let gst_pricing_mode = checkout
        .gst_pricing_mode
        .as_deref()
        .unwrap_or(&configured_mode)
        .trim()
        .to_ascii_uppercase();
    if !matches!(gst_pricing_mode.as_str(), "INCLUSIVE" | "EXCLUSIVE") {
        return Err("GST pricing mode must be inclusive or exclusive.".to_owned());
    }
    let pharmacy_state_code = normalized_state_code(setting_value(
        "gst_pharmacy_state_code",
    )?)?;
    if gst_enabled && pharmacy_state_code.is_none() {
        return Err("Set the pharmacy state in Settings before completing a GST sale.".to_owned());
    }

    let saved_customer = if let Some(customer_id) = checkout.customer_id {
        Some(
            transaction
                .query_row(
                    r#"SELECT name, phone, state_code, active
                       FROM customers
                       WHERE id = ?1"#,
                    [customer_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, bool>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(|error| format!("Could not load the selected customer: {error}"))?
                .ok_or_else(|| "The selected customer no longer exists.".to_owned())?,
        )
    } else {
        None
    };
    if saved_customer
        .as_ref()
        .is_some_and(|(_, _, _, active)| !active)
    {
        return Err("The selected customer is inactive. Choose an active customer.".to_owned());
    }
    let manual_name = normalized_optional_text(checkout.customer_name.clone(), 120, "Customer name")?;
    let manual_phone = normalized_optional_text(checkout.customer_phone.clone(), 40, "Customer phone")?;
    let customer_name = saved_customer
        .as_ref()
        .map(|(name, _, _, _)| name.clone())
        .or(manual_name);
    let customer_phone = saved_customer
        .as_ref()
        .and_then(|(_, phone, _, _)| phone.clone())
        .or(manual_phone);
    let customer_state_code = saved_customer
        .as_ref()
        .and_then(|(_, _, state_code, _)| state_code.clone());
    let place_of_supply_state_code = customer_state_code
        .clone()
        .or_else(|| pharmacy_state_code.clone());
    let interstate = gst_enabled
        && place_of_supply_state_code.as_deref() != pharmacy_state_code.as_deref();
    let tax_type = if !gst_enabled {
        "NONE"
    } else if interstate {
        "IGST"
    } else {
        "CGST_SGST"
    };

    let mut gst_rates = Vec::with_capacity(checkout.items.len());
    for item in &checkout.items {
        let product_rate = transaction
            .query_row(
                "SELECT gst_rate_basis_points FROM medicines WHERE id = ?1",
                [item.medicine_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(|error| format!("Could not read the medicine GST rate: {error}"))?
            .flatten();
        let rate = resolve_gst_rate(
            gst_enabled,
            item.gst_rate_override_basis_points,
            product_rate,
            default_rate,
        )?;
        gst_rates.push(rate);
    }

    let bill_discount_allocations =
        allocate_cents_proportionally(checkout.flat_discount_cents, &line_net_cents)?;
    let mut line_tax = Vec::with_capacity(checkout.items.len());
    let mut taxable_total_cents = 0_i64;
    let mut cgst_total_cents = 0_i64;
    let mut sgst_total_cents = 0_i64;
    let mut igst_total_cents = 0_i64;
    let mut total_gst_cents = 0_i64;
    let mut grand_total_cents = 0_i64;
    for index in 0..checkout.items.len() {
        let after_discounts = line_net_cents[index] - bill_discount_allocations[index];
        let amounts = calculate_gst_amounts(
            after_discounts,
            gst_rates[index],
            &gst_pricing_mode,
            interstate,
            gst_enabled,
        )?;
        let line_grand_total = if gst_enabled && gst_pricing_mode == "EXCLUSIVE" {
            after_discounts
                .checked_add(amounts.total_gst_cents)
                .ok_or_else(|| "Sale total exceeds the supported amount.".to_owned())?
        } else {
            after_discounts
        };
        grand_total_cents = grand_total_cents
            .checked_add(line_grand_total)
            .ok_or_else(|| "Sale total exceeds the supported amount.".to_owned())?;
        taxable_total_cents = taxable_total_cents
            .checked_add(amounts.taxable_cents)
            .ok_or_else(|| "Taxable amount exceeds the supported amount.".to_owned())?;
        cgst_total_cents = cgst_total_cents
            .checked_add(amounts.cgst_cents)
            .ok_or_else(|| "CGST exceeds the supported amount.".to_owned())?;
        sgst_total_cents = sgst_total_cents
            .checked_add(amounts.sgst_cents)
            .ok_or_else(|| "SGST exceeds the supported amount.".to_owned())?;
        igst_total_cents = igst_total_cents
            .checked_add(amounts.igst_cents)
            .ok_or_else(|| "IGST exceeds the supported amount.".to_owned())?;
        total_gst_cents = total_gst_cents
            .checked_add(amounts.total_gst_cents)
            .ok_or_else(|| "GST total exceeds the supported amount.".to_owned())?;
        line_tax.push(amounts);
    }
    if checkout.payment_mode == "CASH" && checkout.cash_tendered_cents < grand_total_cents {
        return Err("Cash tendered must cover the final amount due.".to_owned());
    }
    let change_due_cents = if checkout.payment_mode == "CASH" {
        checkout.cash_tendered_cents - grand_total_cents
    } else {
        0
    };

    let mut reserved_stock = HashMap::new();
    let allocations = checkout
        .items
        .iter()
        .map(|item| allocate_sale_line_fefo(&transaction, item, &mut reserved_stock))
        .collect::<Result<Vec<_>, _>>()?;

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

    transaction
        .execute(
            r#"INSERT INTO sales (
                 invoice_no, customer_id, customer_name, customer_phone,
                 customer_state_code, place_of_supply_state_code, subtotal, discount,
                 flat_discount, grand_total, payment_mode, cash_tendered, change_due,
                 upi_transaction_id, upi_payment_verified, gst_enabled,
                 gst_pricing_mode, tax_type, taxable_amount, cgst_amount,
                 sgst_amount, igst_amount, total_gst
               ) VALUES (
                 ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                 ?13, ?14, 0, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22
               )"#,
            params![
                invoice_no,
                checkout.customer_id,
                customer_name,
                customer_phone,
                customer_state_code,
                place_of_supply_state_code,
                subtotal_cents as f64 / 100.0,
                total_discount_cents as f64 / 100.0,
                checkout.flat_discount_cents as f64 / 100.0,
                grand_total_cents as f64 / 100.0,
                checkout.payment_mode,
                checkout.cash_tendered_cents as f64 / 100.0,
                change_due_cents as f64 / 100.0,
                upi_transaction_id,
                gst_enabled,
                gst_pricing_mode,
                tax_type,
                taxable_total_cents as f64 / 100.0,
                cgst_total_cents as f64 / 100.0,
                sgst_total_cents as f64 / 100.0,
                igst_total_cents as f64 / 100.0,
                total_gst_cents as f64 / 100.0,
            ],
        )
        .map_err(|error| format!("Could not create the sale invoice: {error}"))?;
    let sale_id = transaction.last_insert_rowid();

    for (item_index, (item, item_allocations)) in
        checkout.items.into_iter().zip(allocations).enumerate()
    {
        let quantities = item_allocations
            .iter()
            .map(|allocation| allocation.quantity)
            .collect::<Vec<_>>();
        let tax = line_tax[item_index];
        let taxable_shares = allocate_cents_proportionally(tax.taxable_cents, &quantities)?;
        let cgst_shares = allocate_cents_proportionally(tax.cgst_cents, &quantities)?;
        let sgst_shares = allocate_cents_proportionally(tax.sgst_cents, &quantities)?;
        let igst_shares = allocate_cents_proportionally(tax.igst_cents, &quantities)?;
        let gst_shares = allocate_cents_proportionally(tax.total_gst_cents, &quantities)?;
        let flat_discount_shares =
            allocate_cents_proportionally(bill_discount_allocations[item_index], &quantities)?;
        for (allocation_index, allocation) in item_allocations.into_iter().enumerate() {
            let rows_affected = transaction
                .execute(
                    r#"UPDATE medicine_batches
                       SET current_stock = current_stock - ?1
                       WHERE id = ?2
                         AND medicine_id = ?3
                         AND current_stock >= ?1
                         AND expiry_date >= date('now', 'localtime')"#,
                    params![allocation.quantity, allocation.batch_id, item.medicine_id],
                )
                .map_err(|error| format!("Could not deduct medicine stock: {error}"))?;
            if rows_affected != 1 {
                return Err(format!(
                    "Batch {} is expired or no longer has enough stock. Refresh the cart and try again.",
                    allocation.batch_id
                ));
            }

            let purchase_rate_cents: i64 = transaction
                .query_row(
                    r#"SELECT CAST(round(purchase_rate * 100) AS INTEGER)
                       FROM medicine_batches
                       WHERE id = ?1 AND medicine_id = ?2"#,
                    params![allocation.batch_id, item.medicine_id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("Could not capture the batch cost for the sale: {error}"))?;

            let line_gross_cents = item
                .unit_price_cents
                .checked_mul(allocation.quantity)
                .ok_or_else(|| "Sale item total exceeds the supported amount.".to_owned())?;
            let line_total_cents = line_gross_cents - allocation.item_discount_cents;
            transaction
                .execute(
                    r#"INSERT INTO sale_items (
                         sale_id, batch_id, quantity, unit_price, item_discount, total_price,
                         flat_discount_cents, purchase_rate_at_sale, gst_rate_basis_points, taxable_amount,
                         cgst_amount, sgst_amount, igst_amount, total_gst
                       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)"#,
                    params![
                        sale_id,
                        allocation.batch_id,
                        allocation.quantity,
                        item.unit_price_cents as f64 / 100.0,
                        allocation.item_discount_cents as f64 / 100.0,
                        line_total_cents as f64 / 100.0,
                        flat_discount_shares[allocation_index],
                        purchase_rate_cents as f64 / 100.0,
                        gst_rates[item_index],
                        taxable_shares[allocation_index] as f64 / 100.0,
                        cgst_shares[allocation_index] as f64 / 100.0,
                        sgst_shares[allocation_index] as f64 / 100.0,
                        igst_shares[allocation_index] as f64 / 100.0,
                        gst_shares[allocation_index] as f64 / 100.0,
                    ],
                )
                .map_err(|error| format!("Could not add a sale item: {error}"))?;
        }
    }

    if checkout.payment_mode == "CREDIT" {
        let customer_id = checkout
            .customer_id
            .ok_or_else(|| "Select a saved customer before recording a credit sale.".to_owned())?;
        transaction
            .execute(
                r#"INSERT INTO customer_ledger (
                     customer_id, entry_type, invoice_no, debit_cents, note
                   ) VALUES (?1, 'CREDIT_SALE', ?2, ?3, 'Credit sale')"#,
                params![customer_id, invoice_no, grand_total_cents],
            )
            .map_err(|error| format!("Could not add the credit sale to the customer ledger: {error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Could not commit the completed sale: {error}"))?;
    Ok(SaleCheckoutResult {
        sale_id,
        invoice_no,
    })
}

fn collect_customer_payment_in_connection(
    connection: &mut Connection,
    payment: CustomerPaymentRequest,
) -> Result<CustomerPaymentResult, String> {
    if payment.customer_id <= 0 {
        return Err("Customer id must be a positive whole number.".to_owned());
    }
    if payment.amount_cents <= 0 {
        return Err("Collection amount must be greater than zero.".to_owned());
    }
    if !matches!(
        payment.payment_mode.as_str(),
        "CASH" | "CARD" | "UPI" | "BANK" | "OTHER"
    ) {
        return Err("Choose a valid collection payment method.".to_owned());
    }
    let payment_reference = normalized_optional_text(
        payment.payment_reference,
        120,
        "Payment reference",
    )?;
    let upi_transaction_id =
        normalized_optional_text(payment.upi_transaction_id, 120, "UPI transaction ID")?;
    if payment.payment_mode != "UPI" && upi_transaction_id.is_some() {
        return Err("A UPI transaction ID can only be saved for a UPI collection.".to_owned());
    }
    let note = normalized_optional_text(payment.note, 250, "Collection note")?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the customer collection: {error}"))?;
    let balance_cents = transaction
        .query_row(
            r#"SELECT COALESCE((
                 SELECT SUM(debit_cents - credit_cents)
                 FROM (
                   SELECT debit_cents, credit_cents FROM customer_ledger WHERE customer_id = ?1
                   UNION ALL
                   SELECT debit_cents, credit_cents FROM customer_ledger_events WHERE customer_id = ?1
                 )
               ), 0)
               FROM customers
               WHERE id = ?1"#,
            [payment.customer_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| format!("Could not read the customer balance: {error}"))?
        .ok_or_else(|| "The selected customer no longer exists.".to_owned())?;
    if balance_cents <= 0 {
        return Err("This customer has no outstanding balance.".to_owned());
    }
    if payment.amount_cents > balance_cents {
        return Err("Collection amount cannot exceed the customer's outstanding balance.".to_owned());
    }
    let rows_affected = transaction
        .execute(
            r#"INSERT INTO customer_ledger (
                 customer_id, entry_type, credit_cents, payment_mode,
                 payment_reference, upi_transaction_id, note
               ) VALUES (?1, 'COLLECTION', ?2, ?3, ?4, ?5, ?6)"#,
            params![
                payment.customer_id,
                payment.amount_cents,
                payment.payment_mode,
                payment_reference,
                upi_transaction_id,
                note
            ],
        )
        .map_err(|error| format!("Could not record the customer collection: {error}"))?;
    require_one_changed_row(rows_affected, "Customer collection")?;
    let ledger_entry_id = transaction.last_insert_rowid();
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the customer collection: {error}"))?;
    Ok(CustomerPaymentResult {
        ledger_entry_id,
        balance_due_cents: balance_cents - payment.amount_cents,
    })
}

#[tauri::command]
fn collect_customer_payment(
    app: AppHandle,
    payment: CustomerPaymentRequest,
) -> Result<CustomerPaymentResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    collect_customer_payment_in_connection(&mut connection, payment)
}

fn load_sale_adjustment_lines(
    connection: &Connection,
    sale_id: i64,
) -> Result<Vec<SaleAdjustmentLine>, String> {
    let mut statement = connection
        .prepare(
            r#"SELECT id, batch_id, quantity,
                      CAST(ROUND(unit_price * 100) AS INTEGER),
                CAST(ROUND(item_discount * 100) AS INTEGER),
                      flat_discount_cents,
                      gst_rate_basis_points,
                      CAST(ROUND(taxable_amount * 100) AS INTEGER),
                      CAST(ROUND(cgst_amount * 100) AS INTEGER),
                      CAST(ROUND(sgst_amount * 100) AS INTEGER),
                      CAST(ROUND(igst_amount * 100) AS INTEGER),
                      CAST(ROUND(total_gst * 100) AS INTEGER)
               FROM sale_items WHERE sale_id = ?1 ORDER BY id ASC"#,
        )
        .map_err(|error| format!("Could not load the invoice items: {error}"))?;
    let rows = statement
        .query_map([sale_id], |row| {
            Ok(SaleAdjustmentLine {
                id: row.get(0)?,
                batch_id: row.get(1)?,
                quantity: row.get(2)?,
                unit_price_cents: row.get(3)?,
                item_discount_cents: row.get(4)?,
                flat_discount_cents: row.get(5)?,
                gst_rate_basis_points: row.get(6)?,
                taxable_cents: row.get(7)?,
                cgst_cents: row.get(8)?,
                sgst_cents: row.get(9)?,
                igst_cents: row.get(10)?,
                total_gst_cents: row.get(11)?,
            })
        })
        .map_err(|error| format!("Could not read the invoice items: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read the invoice items: {error}"))
}

fn sale_customer_balance_cents(
    connection: &Connection,
    customer_id: i64,
) -> Result<i64, String> {
    connection
        .query_row(
            r#"SELECT COALESCE(SUM(debit_cents - credit_cents), 0)
               FROM (
                 SELECT debit_cents, credit_cents FROM customer_ledger WHERE customer_id = ?1
                 UNION ALL
                 SELECT debit_cents, credit_cents FROM customer_ledger_events WHERE customer_id = ?1
               )"#,
            [customer_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not read the customer balance: {error}"))
}

fn insert_customer_ledger_adjustment(
    transaction: &Transaction<'_>,
    customer_id: i64,
    entry_type: &str,
    invoice_no: &str,
    debit_cents: i64,
    credit_cents: i64,
    payment_mode: Option<&str>,
    payment_reference: Option<&str>,
    upi_transaction_id: Option<&str>,
    note: Option<&str>,
) -> Result<(), String> {
    if debit_cents < 0 || credit_cents < 0 || (debit_cents == 0) == (credit_cents == 0) {
        return Err("A customer-ledger adjustment must be a positive debit or credit.".to_owned());
    }
    transaction
        .execute(
            r#"INSERT INTO customer_ledger_events (
                 customer_id, entry_type, invoice_no, reference,
                 debit_cents, credit_cents, payment_mode, payment_reference,
                 upi_transaction_id, note
               ) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                customer_id,
                entry_type,
                invoice_no,
                debit_cents,
                credit_cents,
                payment_mode,
                payment_reference,
                upi_transaction_id,
                note
            ],
        )
        .map_err(|error| format!("Could not record the customer-ledger adjustment: {error}"))?;
    Ok(())
}

fn update_sale_return_status(
    transaction: &Transaction<'_>,
    sale_id: i64,
) -> Result<(), String> {
    transaction
        .execute(
            r#"UPDATE sales
               SET status = CASE
                 WHEN NOT EXISTS (
                   SELECT 1 FROM sale_items AS original
                   WHERE original.sale_id = ?1
                     AND original.quantity > COALESCE((
                       SELECT SUM(returned.quantity)
                       FROM sale_return_items AS returned
                       WHERE returned.sale_item_id = original.id
                     ), 0)
                 )
                   THEN 'RETURNED'
                 ELSE 'PARTIALLY_RETURNED'
               END
               WHERE id = ?1 AND status <> 'CANCELLED'"#,
            [sale_id],
        )
        .map_err(|error| format!("Could not update the invoice return status: {error}"))?;
    Ok(())
}

fn create_sale_return_in_connection(
    connection: &mut Connection,
    request: SaleReturnRequest,
) -> Result<SaleReturnResult, String> {
    if request.invoice_no.trim().is_empty() || request.items.is_empty() {
        return Err("Choose an invoice and at least one item to return.".to_owned());
    }
    if !matches!(request.refund_mode.as_str(), "CASH" | "UPI" | "BANK" | "OTHER") {
        return Err("Choose a valid refund method.".to_owned());
    }
    let payment_reference =
        normalized_optional_text(request.payment_reference, 120, "Payment reference")?;
    let upi_transaction_id =
        normalized_optional_text(request.upi_transaction_id, 120, "UPI transaction ID")?;
    if request.refund_mode != "UPI" && upi_transaction_id.is_some() {
        return Err("A UPI transaction ID can only be saved for a UPI refund.".to_owned());
    }
    let note = normalized_optional_text(request.note, 500, "Return note")?;
    let mut quantities_by_item = HashMap::new();
    for item in request.items {
        if item.sale_item_id <= 0 || item.quantity <= 0 {
            return Err("Return items need a valid invoice line and positive quantity.".to_owned());
        }
        if quantities_by_item.insert(item.sale_item_id, item.quantity).is_some() {
            return Err("Choose each invoice line only once per return.".to_owned());
        }
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the sales return: {error}"))?;
    let sale: Option<(i64, String, Option<i64>, String, i64)> = transaction
        .query_row(
            r#"SELECT id, status, customer_id, payment_mode,
                      CAST(ROUND(grand_total * 100) AS INTEGER)
               FROM sales WHERE invoice_no = ?1"#,
            [request.invoice_no.trim()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|error| format!("Could not find the sale invoice: {error}"))?;
    let (sale_id, status, customer_id, payment_mode, _) =
        sale.ok_or_else(|| "The selected invoice no longer exists.".to_owned())?;
    if status == "CANCELLED" {
        return Err("A cancelled invoice cannot be returned.".to_owned());
    }
    if !matches!(status.as_str(), "ACTIVE" | "PARTIALLY_RETURNED") {
        return Err("This invoice has already been fully returned.".to_owned());
    }

    let lines = load_sale_adjustment_lines(&transaction, sale_id)?;
    let mut total_cents = 0_i64;
    let mut return_line_values = Vec::new();
    for (sale_item_id, quantity) in quantities_by_item {
        let line = lines
            .iter()
            .find(|line| line.id == sale_item_id)
            .ok_or_else(|| "A selected return item does not belong to this invoice.".to_owned())?;
        let returned: (i64, i64, i64, i64, i64, i64, i64) = transaction
            .query_row(
                r#"SELECT COALESCE(SUM(quantity), 0), COALESCE(SUM(refund_cents), 0),
                          COALESCE(SUM(taxable_cents), 0), COALESCE(SUM(cgst_cents), 0),
                          COALESCE(SUM(sgst_cents), 0), COALESCE(SUM(igst_cents), 0),
                          COALESCE(SUM(total_gst_cents), 0)
                   FROM sale_return_items WHERE sale_item_id = ?1"#,
                [sale_item_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?)),
            )
            .map_err(|error| format!("Could not check earlier returns for this item: {error}"))?;
        let returned_quantity = returned.0;
        let remaining_quantity = line.quantity - returned_quantity;
        if quantity > remaining_quantity {
            return Err(format!(
                "Return quantity for invoice item {sale_item_id} exceeds the remaining quantity ({remaining_quantity})."
            ));
        }
        if remaining_quantity <= 0 {
            return Err("This invoice item has already been fully returned.".to_owned());
        }
        let line_total_cents = (line.unit_price_cents * line.quantity)
            .checked_sub(line.item_discount_cents)
            .and_then(|amount| amount.checked_sub(line.flat_discount_cents))
            .and_then(|amount| {
                if amount < 0 {
                    None
                } else if payment_mode != "CREDIT" {
                    Some(amount)
                } else {
                    Some(amount)
                }
            })
            .ok_or_else(|| "The original invoice line total is invalid.".to_owned())?;
        let gst_inclusive = transaction
            .query_row(
                "SELECT gst_enabled, gst_pricing_mode FROM sales WHERE id = ?1",
                [sale_id],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(|error| format!("Could not read the invoice tax settings: {error}"))?;
        let full_refund_cents = if gst_inclusive.0 && gst_inclusive.1 == "EXCLUSIVE" {
            line_total_cents
                .checked_add(line.total_gst_cents)
                .ok_or_else(|| "The original invoice line total is invalid.".to_owned())?
        } else {
            line_total_cents
        };
        let remaining_refund_cents = full_refund_cents - returned.1;
        if remaining_refund_cents < 0 {
            return Err("Earlier returns exceed the original invoice line value.".to_owned());
        }
        let refund_cents = if quantity == remaining_quantity {
            remaining_refund_cents
        } else {
            (remaining_refund_cents as i128 * quantity as i128 / remaining_quantity as i128) as i64
        };
        let proportional = |remaining: i64| -> i64 {
            if quantity == remaining_quantity {
                remaining
            } else {
                (remaining as i128 * quantity as i128 / remaining_quantity as i128) as i64
            }
        };
        let taxable_cents = proportional(line.taxable_cents - returned.2);
        let cgst_cents = proportional(line.cgst_cents - returned.3);
        let sgst_cents = proportional(line.sgst_cents - returned.4);
        let igst_cents = proportional(line.igst_cents - returned.5);
        let total_gst_cents = proportional(line.total_gst_cents - returned.6);

        let batch_rows = transaction
            .execute(
                r#"UPDATE medicine_batches
                   SET current_stock = current_stock + ?1
                   WHERE id = ?2 AND expiry_date >= date('now', 'localtime')
                     AND current_stock <= 1000000000 - ?1"#,
                params![quantity, line.batch_id],
            )
            .map_err(|error| format!("Could not restore the original batch stock: {error}"))?;
        if batch_rows != 1 {
            return Err(format!(
                "Original batch {} has expired or cannot safely accept returned stock.",
                line.batch_id
            ));
        }
        total_cents = total_cents
            .checked_add(refund_cents)
            .ok_or_else(|| "The return total exceeds the supported amount.".to_owned())?;
        return_line_values.push((
            sale_item_id,
            line.batch_id,
            quantity,
            refund_cents,
            taxable_cents,
            cgst_cents,
            sgst_cents,
            igst_cents,
            total_gst_cents,
        ));
    }
    if total_cents < 0 {
        return Err("The selected return has an invalid value.".to_owned());
    }
    let returned_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM sale_returns WHERE sale_id = ?1",
            [sale_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not number this return: {error}"))?;
    let return_no = format!("R{sale_id}-{:03}", returned_count + 1);
    transaction
        .execute(
            r#"INSERT INTO sale_returns (
                 sale_id, return_no, total_cents, refund_mode, payment_reference,
                 upi_transaction_id, note
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            params![
                sale_id,
                return_no,
                total_cents,
                request.refund_mode,
                payment_reference,
                upi_transaction_id,
                note
            ],
        )
        .map_err(|error| format!("Could not save the sales return: {error}"))?;
    let return_id = transaction.last_insert_rowid();
    for (sale_item_id, batch_id, quantity, refund, taxable, cgst, sgst, igst, gst) in
        return_line_values
    {
        transaction
            .execute(
                r#"INSERT INTO sale_return_items (
                     return_id, sale_item_id, batch_id, quantity, refund_cents,
                     taxable_cents, cgst_cents, sgst_cents, igst_cents, total_gst_cents
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"#,
                params![return_id, sale_item_id, batch_id, quantity, refund, taxable, cgst, sgst, igst, gst],
            )
            .map_err(|error| format!("Could not save a returned invoice item: {error}"))?;
    }
    let customer_due_credit_cents = if payment_mode == "CREDIT" {
        if let Some(customer_id) = customer_id {
            let balance_cents = sale_customer_balance_cents(&transaction, customer_id)?;
            let credit_cents = total_cents.max(0).min(balance_cents.max(0));
            if credit_cents > 0 {
                insert_customer_ledger_adjustment(
                    &transaction,
                    customer_id,
                    "SALE_RETURN",
                    request.invoice_no.trim(),
                    0,
                    credit_cents,
                    Some(&request.refund_mode),
                    payment_reference.as_deref(),
                    upi_transaction_id.as_deref(),
                    note.as_deref(),
                )?;
            }
            credit_cents
        } else {
            0
        }
    } else {
        0
    };
    transaction
        .execute(
            "UPDATE sale_returns SET customer_due_credit_cents = ?1 WHERE id = ?2",
            params![customer_due_credit_cents, return_id],
        )
        .map_err(|error| format!("Could not save the customer due adjustment: {error}"))?;
    update_sale_return_status(&transaction, sale_id)?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the sales return: {error}"))?;
    Ok(SaleReturnResult {
        return_id,
        return_no,
        total_cents,
        customer_due_credit_cents,
    })
}

#[tauri::command]
fn create_sale_return(
    app: AppHandle,
    request: SaleReturnRequest,
) -> Result<SaleReturnResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    create_sale_return_in_connection(&mut connection, request)
}

fn cancel_sale_in_connection(
    connection: &mut Connection,
    request: SaleVoidRequest,
) -> Result<SaleVoidResult, String> {
    let invoice_no = request.invoice_no.trim();
    if invoice_no.is_empty() {
        return Err("Choose an invoice to cancel.".to_owned());
    }
    let note = normalized_optional_text(request.note, 500, "Cancellation note")?;
    if note.is_none() {
        return Err("Enter a reason for cancelling this invoice.".to_owned());
    }
    let payment_reference =
        normalized_optional_text(request.payment_reference, 120, "Payment reference")?;
    let upi_transaction_id =
        normalized_optional_text(request.upi_transaction_id, 120, "UPI transaction ID")?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin invoice cancellation: {error}"))?;
    let sale: Option<(i64, String, Option<i64>, String, i64)> = transaction
        .query_row(
            r#"SELECT id, status, customer_id, payment_mode,
                      CAST(ROUND(grand_total * 100) AS INTEGER)
               FROM sales WHERE invoice_no = ?1"#,
            [invoice_no],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|error| format!("Could not load the invoice to cancel: {error}"))?;
    let (sale_id, status, customer_id, payment_mode, grand_total_cents) =
        sale.ok_or_else(|| "The selected invoice no longer exists.".to_owned())?;
    if status != "ACTIVE" {
        return Err("Only an invoice with no returns can be cancelled.".to_owned());
    }
    if payment_mode == "CREDIT" {
        if request.refund_mode != "ACCOUNT" {
            return Err("A credit invoice must be cancelled back to the customer account.".to_owned());
        }
    } else if !matches!(
        request.refund_mode.as_str(),
        "CASH" | "CARD" | "UPI" | "BANK" | "OTHER"
    ) {
        return Err("Choose a valid refund method for this invoice.".to_owned());
    }
    if request.refund_mode != "UPI" && upi_transaction_id.is_some() {
        return Err("A UPI transaction ID can only be saved for a UPI refund.".to_owned());
    }
    let lines = load_sale_adjustment_lines(&transaction, sale_id)?;
    if lines.is_empty() {
        return Err("The invoice has no items to reverse.".to_owned());
    }
    for line in &lines {
        let changed = transaction
            .execute(
                r#"UPDATE medicine_batches
                   SET current_stock = current_stock + ?1
                   WHERE id = ?2 AND expiry_date >= date('now', 'localtime')
                     AND current_stock <= 1000000000 - ?1"#,
                params![line.quantity, line.batch_id],
            )
            .map_err(|error| format!("Could not restore stock from the cancelled invoice: {error}"))?;
        if changed != 1 {
            return Err(format!(
                "Original batch {} has expired or cannot safely accept the cancelled stock.",
                line.batch_id
            ));
        }
    }
    if payment_mode == "CREDIT" {
        let customer_id = customer_id
            .ok_or_else(|| "The credit invoice has no saved customer account.".to_owned())?;
        let balance_cents = sale_customer_balance_cents(&transaction, customer_id)?;
        if balance_cents < grand_total_cents {
            return Err(
                "This credit invoice cannot be cancelled because part of its balance has already been collected or adjusted."
                    .to_owned(),
            );
        }
        insert_customer_ledger_adjustment(
            &transaction,
            customer_id,
            "SALE_VOID",
            invoice_no,
            0,
            grand_total_cents,
            Some("ACCOUNT"),
            payment_reference.as_deref(),
            upi_transaction_id.as_deref(),
            note.as_deref(),
        )?;
    }
    transaction
        .execute(
            r#"INSERT INTO sale_voids (
                 sale_id, refund_cents, refund_mode, payment_reference,
                 upi_transaction_id, note
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            params![
                sale_id,
                grand_total_cents,
                request.refund_mode,
                payment_reference,
                upi_transaction_id,
                note
            ],
        )
        .map_err(|error| format!("Could not record the invoice cancellation: {error}"))?;
    let changed = transaction
        .execute(
            r#"UPDATE sales SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP
               WHERE id = ?1 AND status = 'ACTIVE'"#,
            [sale_id],
        )
        .map_err(|error| format!("Could not mark the invoice as cancelled: {error}"))?;
    require_one_changed_row(changed, "Invoice")?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit invoice cancellation: {error}"))?;
    Ok(SaleVoidResult {
        sale_id,
        refund_cents: grand_total_cents,
    })
}

#[tauri::command]
fn cancel_sale(app: AppHandle, request: SaleVoidRequest) -> Result<SaleVoidResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    cancel_sale_in_connection(&mut connection, request)
}

fn correct_sale_in_connection(
    connection: &mut Connection,
    request: SaleCorrectionRequest,
) -> Result<SaleCorrectionResult, String> {
    let invoice_no = request.invoice_no.trim();
    if invoice_no.is_empty() || request.items.is_empty() {
        return Err("Choose an invoice and keep at least one invoice item.".to_owned());
    }
    if !matches!(
        request.payment_mode.as_str(),
        "CASH" | "CARD" | "UPI" | "CREDIT" | "OTHER"
    ) {
        return Err("Choose a valid payment method.".to_owned());
    }
    if request.customer_id.is_some_and(|customer_id| customer_id <= 0) {
        return Err("Customer id must be a positive whole number.".to_owned());
    }
    let reason = normalized_optional_text(request.reason, 500, "Correction reason")?
        .ok_or_else(|| "Enter a reason for correcting this invoice.".to_owned())?;
    let notes = normalized_optional_text(request.notes, 500, "Invoice notes")?;
    let payment_reference =
        normalized_optional_text(request.payment_reference, 120, "Payment reference")?;
    let upi_transaction_id =
        normalized_optional_text(request.upi_transaction_id, 120, "UPI transaction ID")?;
    if request.payment_mode != "UPI" && upi_transaction_id.is_some() {
        return Err("A UPI transaction ID can only be saved for a UPI payment.".to_owned());
    }
    let mut requested_items = HashMap::new();
    for item in request.items {
        if item.sale_item_id <= 0 || item.quantity <= 0 || item.unit_price_cents < 0 {
            return Err("Corrected invoice items need valid ids, positive quantities, and non-negative prices.".to_owned());
        }
        if requested_items.insert(item.sale_item_id, item).is_some() {
            return Err("Choose each invoice item only once.".to_owned());
        }
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin invoice correction: {error}"))?;
    let sale: Option<(
        i64,
        String,
        Option<i64>,
        String,
        i64,
        i64,
        i64,
        i64,
        bool,
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    )> = transaction
        .query_row(
            r#"SELECT id, status, customer_id, payment_mode,
                      CAST(ROUND(grand_total * 100) AS INTEGER),
                      CAST(ROUND(subtotal * 100) AS INTEGER),
                      CAST(ROUND(flat_discount * 100) AS INTEGER),
                      CAST(ROUND(cash_tendered * 100) AS INTEGER),
                      gst_enabled, gst_pricing_mode, tax_type,
                      customer_state_code, place_of_supply_state_code,
                      customer_name, customer_phone
               FROM sales WHERE invoice_no = ?1"#,
            [invoice_no],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                    row.get(12)?,
                    row.get(13)?,
                    row.get(14)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Could not load the invoice to correct: {error}"))?;
    let (
        sale_id,
        status,
        old_customer_id,
        old_payment_mode,
        old_total_cents,
        _old_subtotal_cents,
        flat_discount_cents,
        old_cash_tendered_cents,
        gst_enabled,
        pricing_mode,
        old_tax_type,
        old_customer_state_code,
        _old_place_of_supply_state_code,
        old_customer_name,
        old_customer_phone,
    ) = sale.ok_or_else(|| "The selected invoice no longer exists.".to_owned())?;
    if status != "ACTIVE" {
        return Err("Only invoices without returns or cancellation can be corrected.".to_owned());
    }
    let prior_return_count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM sale_returns WHERE sale_id = ?1",
            [sale_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check earlier invoice returns: {error}"))?;
    if prior_return_count != 0 {
        return Err("An invoice with a recorded return cannot be edited; use the return trail instead.".to_owned());
    }
    let mut lines = load_sale_adjustment_lines(&transaction, sale_id)?;
    if lines.is_empty() || requested_items.len() != lines.len() {
        return Err("Invoice correction cannot add or remove historical batch lines.".to_owned());
    }

    let mut target_customer_state_code = old_customer_state_code.clone();
    let (customer_name, customer_phone) = if let Some(customer_id) = request.customer_id {
        let customer: Option<(String, Option<String>, Option<String>)> = transaction
            .query_row(
                "SELECT name, phone, state_code FROM customers WHERE id = ?1 AND active = 1",
                [customer_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| format!("Could not load the corrected customer: {error}"))?;
        let (name, phone, state_code) =
            customer.ok_or_else(|| "The corrected customer is unavailable.".to_owned())?;
        target_customer_state_code = state_code;
        (Some(name), phone)
    } else {
        (
            normalized_optional_text(request.customer_name, 120, "Customer name")?
                .or(old_customer_name),
            normalized_optional_text(request.customer_phone, 40, "Customer phone")?
                .or(old_customer_phone),
        )
    };
    if request.payment_mode == "CREDIT" && request.customer_id.is_none() {
        return Err("Select a saved customer before changing an invoice to credit.".to_owned());
    }
    let target_customer_state_code = normalized_state_code(target_customer_state_code)?;
    let pharmacy_state_code = normalized_state_code(
        transaction
            .query_row(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'gst_pharmacy_state_code'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Could not read the pharmacy state setting: {error}"))?,
    )?;
    let place_of_supply_state_code = target_customer_state_code
        .clone()
        .or_else(|| pharmacy_state_code.clone());
    let interstate = if gst_enabled {
        match (&target_customer_state_code, &pharmacy_state_code) {
            (Some(customer_state), Some(pharmacy_state)) => customer_state != pharmacy_state,
            _ => old_tax_type == "IGST",
        }
    } else {
        false
    };

    let mut new_quantities = Vec::with_capacity(lines.len());
    let mut new_prices = Vec::with_capacity(lines.len());
    let mut line_nets = Vec::with_capacity(lines.len());
    let mut subtotal_cents = 0_i64;
    let mut item_discount_cents = 0_i64;
    let mut before_items = Vec::new();
    for line in &lines {
        let item = requested_items
            .remove(&line.id)
            .ok_or_else(|| "Invoice correction must include every original batch line.".to_owned())?;
        let line_gross = item
            .unit_price_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| "Corrected invoice line exceeds the supported amount.".to_owned())?;
        if line_gross < line.item_discount_cents {
            return Err("The corrected line price cannot be less than its existing item discount.".to_owned());
        }
        let net = line_gross - line.item_discount_cents;
        subtotal_cents = subtotal_cents
            .checked_add(line_gross)
            .ok_or_else(|| "Corrected invoice subtotal exceeds the supported amount.".to_owned())?;
        item_discount_cents = item_discount_cents
            .checked_add(line.item_discount_cents)
            .ok_or_else(|| "Corrected invoice discount exceeds the supported amount.".to_owned())?;
        line_nets.push(net);
        new_quantities.push(item.quantity);
        new_prices.push(item.unit_price_cents);
        before_items.push(serde_json::json!({
            "saleItemId": line.id,
            "batchId": line.batch_id,
            "quantity": line.quantity,
            "unitPriceCents": line.unit_price_cents,
            "itemDiscountCents": line.item_discount_cents,
            "flatDiscountCents": line.flat_discount_cents,
            "gstRateBasisPoints": line.gst_rate_basis_points,
        }));
    }
    if !requested_items.is_empty() {
        return Err("One or more corrected items do not belong to this invoice.".to_owned());
    }
    if flat_discount_cents > line_nets.iter().sum::<i64>() {
        return Err("The invoice discount cannot exceed the corrected item totals.".to_owned());
    }
    let flat_shares = allocate_cents_proportionally(flat_discount_cents, &line_nets)?;
    let mut tax_values = Vec::with_capacity(lines.len());
    let mut grand_total_cents = 0_i64;
    let mut taxable_total_cents = 0_i64;
    let mut cgst_total_cents = 0_i64;
    let mut sgst_total_cents = 0_i64;
    let mut igst_total_cents = 0_i64;
    let mut total_gst_cents = 0_i64;
    for index in 0..lines.len() {
        let after_discount = line_nets[index] - flat_shares[index];
        let tax = calculate_gst_amounts(
            after_discount,
            lines[index].gst_rate_basis_points,
            &pricing_mode,
            interstate,
            gst_enabled,
        )?;
        let line_total = if gst_enabled && pricing_mode == "EXCLUSIVE" {
            after_discount
                .checked_add(tax.total_gst_cents)
                .ok_or_else(|| "Corrected invoice total exceeds the supported amount.".to_owned())?
        } else {
            after_discount
        };
        grand_total_cents = grand_total_cents
            .checked_add(line_total)
            .ok_or_else(|| "Corrected invoice total exceeds the supported amount.".to_owned())?;
        taxable_total_cents += tax.taxable_cents;
        cgst_total_cents += tax.cgst_cents;
        sgst_total_cents += tax.sgst_cents;
        igst_total_cents += tax.igst_cents;
        total_gst_cents += tax.total_gst_cents;
        tax_values.push(tax);
    }
    let total_discount_cents = item_discount_cents
        .checked_add(flat_discount_cents)
        .ok_or_else(|| "Corrected invoice discount exceeds the supported amount.".to_owned())?;
    let cash_tendered_cents = if request.payment_mode == "CASH" {
        request
            .cash_tendered_cents
            .unwrap_or_else(|| old_cash_tendered_cents.max(grand_total_cents))
    } else {
        0
    };
    if cash_tendered_cents < 0 || (request.payment_mode == "CASH" && cash_tendered_cents < grand_total_cents) {
        return Err("Cash tendered must cover the corrected invoice total.".to_owned());
    }
    if request.cash_tendered_cents.is_some_and(|amount| amount < 0) {
        return Err("Cash tendered cannot be negative.".to_owned());
    }

    for (index, line) in lines.iter_mut().enumerate() {
        let delta = new_quantities[index] - line.quantity;
        if delta > 0 {
            let changed = transaction
                .execute(
                    r#"UPDATE medicine_batches SET current_stock = current_stock - ?1
                       WHERE id = ?2 AND current_stock >= ?1
                         AND expiry_date >= date('now', 'localtime')"#,
                    params![delta, line.batch_id],
                )
                .map_err(|error| format!("Could not deduct corrected invoice stock: {error}"))?;
            if changed != 1 {
                return Err(format!(
                    "Original batch {} is expired or has insufficient stock for this correction.",
                    line.batch_id
                ));
            }
        } else if delta < 0 {
            let quantity = -delta;
            let changed = transaction
                .execute(
                    r#"UPDATE medicine_batches SET current_stock = current_stock + ?1
                       WHERE id = ?2 AND expiry_date >= date('now', 'localtime')
                         AND current_stock <= 1000000000 - ?1"#,
                    params![quantity, line.batch_id],
                )
                .map_err(|error| format!("Could not restore corrected invoice stock: {error}"))?;
            if changed != 1 {
                return Err(format!(
                    "Original batch {} has expired or cannot safely accept stock from this correction.",
                    line.batch_id
                ));
            }
        }
        let quantity = new_quantities[index];
        let unit_price = new_prices[index];
        let line_gross = unit_price * quantity;
        let line_net = line_gross - line.item_discount_cents;
        let tax = tax_values[index];
        transaction
            .execute(
                r#"UPDATE sale_items
                   SET quantity = ?1, unit_price = ?2, total_price = ?3,
                       flat_discount_cents = ?4, taxable_amount = ?5,
                       cgst_amount = ?6, sgst_amount = ?7, igst_amount = ?8,
                       total_gst = ?9
                   WHERE id = ?10 AND sale_id = ?11"#,
                params![
                    quantity,
                    unit_price as f64 / 100.0,
                    line_net as f64 / 100.0,
                    flat_shares[index],
                    tax.taxable_cents as f64 / 100.0,
                    tax.cgst_cents as f64 / 100.0,
                    tax.sgst_cents as f64 / 100.0,
                    tax.igst_cents as f64 / 100.0,
                    tax.total_gst_cents as f64 / 100.0,
                    line.id,
                    sale_id
                ],
            )
            .map_err(|error| format!("Could not update a corrected invoice item: {error}"))?;
        line.quantity = quantity;
        line.unit_price_cents = unit_price;
        line.flat_discount_cents = flat_shares[index];
        line.taxable_cents = tax.taxable_cents;
        line.cgst_cents = tax.cgst_cents;
        line.sgst_cents = tax.sgst_cents;
        line.igst_cents = tax.igst_cents;
        line.total_gst_cents = tax.total_gst_cents;
    }

    let adjustment_delta = grand_total_cents - old_total_cents;
    let mut adjustment_debit_cents = 0_i64;
    let mut adjustment_credit_cents = 0_i64;
    let old_is_credit = old_payment_mode == "CREDIT";
    let new_is_credit = request.payment_mode == "CREDIT";
    let mut adjustment_mode = None;
    let adjustment_reference = normalized_optional_text(
        request.adjustment_reference,
        120,
        "Correction settlement reference",
    )?;
    let adjustment_upi_transaction_id = normalized_optional_text(
        request.adjustment_upi_transaction_id,
        120,
        "Correction UPI transaction ID",
    )?;
    let external_adjustment = if old_is_credit != new_is_credit {
        if old_is_credit {
            (grand_total_cents, 0)
        } else {
            (0, old_total_cents)
        }
    } else if old_is_credit {
        (adjustment_delta.max(0), (-adjustment_delta).max(0))
    } else {
        (adjustment_delta.max(0), (-adjustment_delta).max(0))
    };
    let has_external_adjustment = !old_is_credit || !new_is_credit;
    if external_adjustment.0 > 0 || external_adjustment.1 > 0 {
        if has_external_adjustment {
            let mode = request
                .adjustment_mode
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_ascii_uppercase();
            if !matches!(mode.as_str(), "CASH" | "CARD" | "UPI" | "BANK" | "OTHER") {
                return Err("Choose how the correction's payment or refund was handled.".to_owned());
            }
            if mode != "UPI" && adjustment_upi_transaction_id.is_some() {
                return Err("A correction UPI reference can only be saved for a UPI settlement.".to_owned());
            }
            adjustment_mode = Some(mode);
        } else {
            adjustment_mode = Some("ACCOUNT".to_owned());
        }
        adjustment_debit_cents = external_adjustment.0;
        adjustment_credit_cents = external_adjustment.1;
    }
    if old_is_credit {
        let old_customer = old_customer_id
            .ok_or_else(|| "The original credit invoice has no saved customer.".to_owned())?;
        let old_balance = sale_customer_balance_cents(&transaction, old_customer)?;
        let credit_old_invoice = if new_is_credit && request.customer_id == Some(old_customer) {
            (-adjustment_delta).max(0)
        } else {
            old_total_cents
        };
        if old_balance < credit_old_invoice {
            return Err("The original customer balance is too low to safely correct this credit invoice.".to_owned());
        }
        if credit_old_invoice > 0 {
            insert_customer_ledger_adjustment(
                &transaction,
                old_customer,
                "SALE_CORRECTION",
                invoice_no,
                0,
                credit_old_invoice,
                adjustment_mode.as_deref(),
                adjustment_reference.as_deref(),
                adjustment_upi_transaction_id.as_deref(),
                Some(&reason),
            )?;
        }
    }
    if new_is_credit {
        let new_customer = request
            .customer_id
            .ok_or_else(|| "Select a saved customer before changing an invoice to credit.".to_owned())?;
        let debit_new_invoice = if old_is_credit && old_customer_id == Some(new_customer) {
            adjustment_delta.max(0)
        } else {
            grand_total_cents
        };
        if debit_new_invoice > 0 {
            insert_customer_ledger_adjustment(
                &transaction,
                new_customer,
                "SALE_CORRECTION",
                invoice_no,
                debit_new_invoice,
                0,
                Some("ACCOUNT"),
                payment_reference.as_deref(),
                upi_transaction_id.as_deref(),
                Some(&reason),
            )?;
        }
    }

    let before_json = serde_json::json!({
        "invoiceNo": invoice_no,
        "customerId": old_customer_id,
        "paymentMode": old_payment_mode,
        "grandTotalCents": old_total_cents,
        "items": before_items,
    });
    let after_json = serde_json::json!({
        "invoiceNo": invoice_no,
        "customerId": request.customer_id,
        "paymentMode": request.payment_mode,
        "grandTotalCents": grand_total_cents,
        "items": lines.iter().map(|line| serde_json::json!({
            "saleItemId": line.id,
            "batchId": line.batch_id,
            "quantity": line.quantity,
            "unitPriceCents": line.unit_price_cents,
            "flatDiscountCents": line.flat_discount_cents,
            "gstRateBasisPoints": line.gst_rate_basis_points,
        })).collect::<Vec<_>>(),
    });
    let before_json = serde_json::to_string(&before_json)
        .map_err(|error| format!("Could not preserve the original invoice snapshot: {error}"))?;
    let after_json = serde_json::to_string(&after_json)
        .map_err(|error| format!("Could not preserve the corrected invoice snapshot: {error}"))?;
    let change_due_cents = if request.payment_mode == "CASH" {
        cash_tendered_cents - grand_total_cents
    } else {
        0
    };
    let tax_type = if !gst_enabled {
        "NONE"
    } else if interstate {
        "IGST"
    } else {
        "CGST_SGST"
    };
    transaction
        .execute(
            r#"UPDATE sales SET
                 customer_id = ?1, customer_name = ?2, customer_phone = ?3,
                 customer_state_code = ?4, place_of_supply_state_code = ?5,
                 subtotal = ?6, discount = ?7, grand_total = ?8,
                 payment_mode = ?9, cash_tendered = ?10, change_due = ?11,
                 payment_reference = ?12, upi_transaction_id = ?13,
                 upi_payment_verified = 0, tax_type = ?14, taxable_amount = ?15,
                 cgst_amount = ?16, sgst_amount = ?17, igst_amount = ?18,
                 total_gst = ?19, notes = ?20
               WHERE id = ?21 AND status = 'ACTIVE'"#,
            params![
                request.customer_id,
                customer_name,
                customer_phone,
                target_customer_state_code,
                place_of_supply_state_code,
                subtotal_cents as f64 / 100.0,
                total_discount_cents as f64 / 100.0,
                grand_total_cents as f64 / 100.0,
                request.payment_mode,
                cash_tendered_cents as f64 / 100.0,
                change_due_cents as f64 / 100.0,
                payment_reference,
                upi_transaction_id,
                tax_type,
                taxable_total_cents as f64 / 100.0,
                cgst_total_cents as f64 / 100.0,
                sgst_total_cents as f64 / 100.0,
                igst_total_cents as f64 / 100.0,
                total_gst_cents as f64 / 100.0,
                notes,
                sale_id
            ],
        )
        .map_err(|error| format!("Could not update the corrected invoice: {error}"))?;
    transaction
        .execute(
            r#"INSERT INTO sale_corrections (
                 sale_id, before_json, after_json, adjustment_debit_cents,
                 adjustment_credit_cents, adjustment_mode, adjustment_reference,
                 adjustment_upi_transaction_id, note
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            params![
                sale_id,
                before_json,
                after_json,
                adjustment_debit_cents,
                adjustment_credit_cents,
                adjustment_mode,
                adjustment_reference,
                adjustment_upi_transaction_id,
                reason
            ],
        )
        .map_err(|error| format!("Could not save the invoice correction history: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit invoice correction: {error}"))?;
    Ok(SaleCorrectionResult {
        sale_id,
        invoice_no: invoice_no.to_owned(),
        grand_total_cents,
    })
}

#[tauri::command]
fn correct_sale(
    app: AppHandle,
    request: SaleCorrectionRequest,
) -> Result<SaleCorrectionResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    correct_sale_in_connection(&mut connection, request)
}

#[allow(dead_code)]
fn record_purchase_legacy(
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
#[allow(dead_code)]
fn complete_purchase_legacy(app: AppHandle, purchase: PurchaseRequest) -> Result<PurchaseResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    record_purchase_legacy(&mut connection, purchase)
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(register_auto_backup_on_close);

    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
            execute_sql_transaction,
            get_inventory_medicines,
            get_medicine_batches,
            get_medicine_order_usage,
            search_medicines,
            get_fefo_batch,
            get_sellable_batches,
            get_low_stock_alerts,
            get_expiry_alerts,
            get_suppliers,
            get_customers,
            get_customer_ledger,
            get_store_settings,
            get_recent_purchases,
            get_purchase_history,
            get_purchase_details,
            get_supplier_ledger,
            get_recent_sales,
            get_sales_history,
            get_sale_details,
            get_sales_report_summary,
            get_sales_report_rows,
            financial_reports::get_report_date_range,
            financial_reports::get_financial_report,
            expenses::get_expense_categories,
            expenses::get_expenses,
            expenses::save_expense_category,
            expenses::set_expense_category_active,
            expenses::save_expense,
            expenses::cancel_expense,
            get_weekly_sales,
            get_order_list,
            get_dashboard_inventory_summary,
            get_dashboard_purchase_summary,
            get_top_selling_medicines,
            reads::check_development_database_empty,
            apply_pharmacy_mutation,
            mutate_order_list,
            reset_business_data,
            save_medicine_photo,
            get_medicine_photo,
            remove_medicine_photo,
            complete_sale,
            collect_customer_payment,
            create_sale_return,
            cancel_sale,
            correct_sale,
            purchase_management::complete_purchase,
            purchase_management::edit_purchase,
            purchase_management::cancel_purchase,
            purchase_management::return_purchase,
            purchase_management::create_supplier_payment,
            purchase_management::add_purchase_attachment,
            purchase_management::get_purchase_attachment_path,
            create_database_backup,
            restore_database_backup
    ]);

    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_inventory_medicines,
        get_medicine_batches,
        get_medicine_order_usage,
        search_medicines,
        get_fefo_batch,
        get_sellable_batches,
        get_low_stock_alerts,
        get_expiry_alerts,
        get_suppliers,
        get_customers,
        get_customer_ledger,
        get_store_settings,
        get_recent_purchases,
        get_purchase_history,
        get_purchase_details,
        get_supplier_ledger,
        get_recent_sales,
        get_sales_history,
        get_sale_details,
        get_sales_report_summary,
        get_sales_report_rows,
        financial_reports::get_report_date_range,
        financial_reports::get_financial_report,
        expenses::get_expense_categories,
        expenses::get_expenses,
        expenses::save_expense_category,
        expenses::set_expense_category_active,
        expenses::save_expense,
        expenses::cancel_expense,
        get_weekly_sales,
        get_order_list,
        get_dashboard_inventory_summary,
        get_dashboard_purchase_summary,
        get_top_selling_medicines,
        apply_pharmacy_mutation,
        mutate_order_list,
        reset_business_data,
        save_medicine_photo,
        get_medicine_photo,
        remove_medicine_photo,
        complete_sale,
        collect_customer_payment,
        create_sale_return,
        cancel_sale,
        correct_sale,
        purchase_management::complete_purchase,
        purchase_management::edit_purchase,
        purchase_management::cancel_purchase,
        purchase_management::return_purchase,
        purchase_management::create_supplier_payment,
        purchase_management::add_purchase_attachment,
        purchase_management::get_purchase_attachment_path,
        create_database_backup,
        restore_database_backup
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to start Medicine Inventory POS");
}

#[cfg(test)]
mod fefo_tests {
    use super::*;

    fn connection_with_batches() -> Connection {
        let connection = Connection::open_in_memory().expect("open FEFO test database");
        connection
            .execute_batch(
                r#"CREATE TABLE medicine_batches (
                    id INTEGER PRIMARY KEY,
                    medicine_id INTEGER NOT NULL,
                    batch_no TEXT NOT NULL,
                    expiry_date TEXT NOT NULL,
                    purchase_rate REAL NOT NULL,
                    current_stock INTEGER NOT NULL
                )"#,
            )
            .expect("create FEFO batch schema");
        connection
    }

    fn add_batch(connection: &Connection, id: i64, expiry_offset_days: i64, stock: i64) {
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     id, medicine_id, batch_no, expiry_date, purchase_rate, current_stock
                   ) VALUES (
                     ?1, 1, ?2, date('now', 'localtime', ?3), 1.0, ?4
                   )"#,
                params![
                    id,
                    format!("LOT-{id}"),
                    format!("{expiry_offset_days:+} days"),
                    stock
                ],
            )
            .expect("add FEFO test batch");
    }

    fn sale_item(batch_id: i64, quantity: i64, discount_cents: i64) -> SaleCheckoutItem {
        SaleCheckoutItem {
            medicine_id: 1,
            batch_id,
            quantity,
            unit_price_cents: 1_000,
            item_discount_cents: discount_cents,
            gst_rate_override_basis_points: None,
        }
    }

    fn allocate(
        connection: &mut Connection,
        item: &SaleCheckoutItem,
    ) -> Result<Vec<SaleLineAllocation>, String> {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("begin FEFO test transaction");
        allocate_sale_line_fefo(&transaction, item, &mut HashMap::new())
    }

    #[test]
    fn allocates_from_a_single_valid_batch() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 11, 8, 9);

        let allocations = allocate(&mut connection, &sale_item(11, 4, 0))
            .expect("allocate single batch");

        assert_eq!(
            allocations,
            vec![SaleLineAllocation {
                batch_id: 11,
                quantity: 4,
                item_discount_cents: 0
            }]
        );
    }

    #[test]
    fn chooses_the_earliest_expiry_from_multiple_valid_batches() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 21, 12, 5);
        add_batch(&connection, 22, 3, 8);

        let allocations = allocate(&mut connection, &sale_item(22, 2, 0))
            .expect("allocate earliest-expiry batch");

        assert_eq!(allocations[0].batch_id, 22);
        assert_eq!(allocations[0].quantity, 2);
    }

    #[test]
    fn excludes_expired_batches_and_uses_the_valid_batch() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 31, -1, 9);
        add_batch(&connection, 32, 4, 9);

        let allocations = allocate(&mut connection, &sale_item(32, 3, 0))
            .expect("allocate valid batch");

        assert_eq!(allocations.len(), 1);
        assert_eq!(allocations[0].batch_id, 32);
        assert_eq!(allocations[0].quantity, 3);
    }

    #[test]
    fn splits_quantity_across_batches_in_fefo_order() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 41, 2, 2);
        add_batch(&connection, 42, 9, 5);

        let allocations = allocate(&mut connection, &sale_item(41, 5, 50))
            .expect("allocate across batches");

        assert_eq!(
            allocations,
            vec![
                SaleLineAllocation {
                    batch_id: 41,
                    quantity: 2,
                    item_discount_cents: 20
                },
                SaleLineAllocation {
                    batch_id: 42,
                    quantity: 3,
                    item_discount_cents: 30
                }
            ]
        );
    }

    #[test]
    fn rejects_quantity_above_total_unexpired_stock() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 51, 2, 2);
        add_batch(&connection, 52, 9, 1);

        let result = allocate(&mut connection, &sale_item(51, 4, 0));

        assert!(result.is_err());
    }

    #[test]
    fn rejects_renderer_selection_of_a_later_expiry_batch() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 61, 2, 4);
        add_batch(&connection, 62, 9, 4);

        let result = allocate(&mut connection, &sale_item(62, 1, 0));

        assert!(result
            .expect_err("later-expiry batch must be rejected")
            .contains("earliest-expiry-first"));
    }

    #[test]
    fn rejects_zero_and_negative_allocation_quantities() {
        let mut connection = connection_with_batches();
        add_batch(&connection, 71, 4, 3);

        for quantity in [0, -1] {
            let error = allocate(&mut connection, &sale_item(71, quantity, 0))
                .expect_err("invalid quantity must be rejected before allocation");
            assert!(error.contains("positive quantity"));
        }
    }
}

#[cfg(test)]
mod sale_tests {
    use super::*;

    fn sale_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open sale test database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable sale test foreign keys");
        migrate_connection(&mut connection).expect("migrate sale test database");
        connection
            .execute(
                "INSERT INTO medicines (id, name) VALUES (1, 'Sale test medicine')",
                [],
            )
            .expect("create sale test medicine");
        connection
    }

    fn add_sale_batch(
        connection: &Connection,
        batch_id: i64,
        expiry_offset_days: i64,
        stock: i64,
        purchase_rate: f64,
    ) {
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                   ) VALUES (
                     ?1, 1, ?2, date('now', 'localtime', ?3), ?4, 20, 10, ?5
                   )"#,
                params![
                    batch_id,
                    format!("SALE-{batch_id}"),
                    format!("{expiry_offset_days:+} days"),
                    purchase_rate,
                    stock
                ],
            )
            .expect("add sale test batch");
    }

    fn checkout(batch_id: i64, quantity: i64, item_discount_cents: i64) -> SaleCheckoutRequest {
        SaleCheckoutRequest {
            customer_id: None,
            customer_name: Some("Test customer".to_owned()),
            customer_phone: Some("12345".to_owned()),
            payment_mode: "CASH".to_owned(),
            flat_discount_cents: 50,
            cash_tendered_cents: 4_000,
            gst_pricing_mode: None,
            upi_transaction_id: None,
            items: vec![SaleCheckoutItem {
                medicine_id: 1,
                batch_id,
                quantity,
                unit_price_cents: 1_000,
                item_discount_cents,
                gst_rate_override_basis_points: None,
            }],
        }
    }

    #[test]
    fn sale_splits_stock_by_fefo_and_preserves_invoice_totals_and_payment() {
        let mut connection = sale_connection();
        add_sale_batch(&connection, 201, -2, 7, 2.5);
        add_sale_batch(&connection, 202, 2, 2, 4.0);
        add_sale_batch(&connection, 203, 8, 5, 5.0);

        let result = complete_sale_in_connection(&mut connection, checkout(202, 4, 100))
            .expect("complete FEFO sale");
        let (expired_stock, earliest_stock, later_stock): (i64, i64, i64) = connection
            .query_row(
                r#"SELECT
                     (SELECT current_stock FROM medicine_batches WHERE id = 201),
                     (SELECT current_stock FROM medicine_batches WHERE id = 202),
                     (SELECT current_stock FROM medicine_batches WHERE id = 203)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read sale batch stock");
        let (subtotal, discount, flat_discount, grand_total, cash_tendered, change_due): (
            i64,
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = connection
            .query_row(
                r#"SELECT
                     CAST(round(subtotal * 100) AS INTEGER),
                     CAST(round(discount * 100) AS INTEGER),
                     CAST(round(flat_discount * 100) AS INTEGER),
                     CAST(round(grand_total * 100) AS INTEGER),
                     CAST(round(cash_tendered * 100) AS INTEGER),
                     CAST(round(change_due * 100) AS INTEGER)
                   FROM sales WHERE id = ?1"#,
                [result.sale_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("read sale totals");
        let sale_item_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sale_items WHERE sale_id = ?1",
                [result.sale_id],
                |row| row.get(0),
            )
            .expect("count sale item allocations");
        let sale_line_total: i64 = connection
            .query_row(
                "SELECT CAST(round(SUM(total_price) * 100) AS INTEGER) FROM sale_items WHERE sale_id = ?1",
                [result.sale_id],
                |row| row.get(0),
            )
            .expect("read sale line totals");

        assert!(result.invoice_no.starts_with("INV-"));
        assert_eq!((expired_stock, earliest_stock, later_stock), (7, 0, 3));
        assert_eq!(
            (subtotal, discount, flat_discount, grand_total, cash_tendered, change_due),
            (4_000, 150, 50, 3_850, 4_000, 150)
        );
        assert_eq!(sale_item_rows, 2);
        assert_eq!(sale_line_total, 3_900);
    }

    #[test]
    fn sale_rejects_later_batch_selection_and_insufficient_eligible_stock() {
        let mut connection = sale_connection();
        add_sale_batch(&connection, 211, 2, 2, 4.0);
        add_sale_batch(&connection, 212, 8, 1, 5.0);

        let later_batch_result = complete_sale_in_connection(&mut connection, checkout(212, 1, 0));
        assert!(later_batch_result
            .expect_err("reject later-expiry batch")
            .contains("earliest-expiry-first"));

        let insufficient_result =
            complete_sale_in_connection(&mut connection, checkout(211, 4, 0));
        assert!(insufficient_result.is_err());

        let sale_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM sales", [], |row| row.get(0))
            .expect("count completed sales");
        let (early_stock, late_stock): (i64, i64) = connection
            .query_row(
                r#"SELECT
                     (SELECT current_stock FROM medicine_batches WHERE id = 211),
                     (SELECT current_stock FROM medicine_batches WHERE id = 212)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read rejected sale stock");

        assert_eq!(sale_count, 0);
        assert_eq!((early_stock, late_stock), (2, 1));
    }

    #[test]
    fn checkout_rejects_zero_and_negative_quantities_without_mutating_stock() {
        let mut connection = sale_connection();
        add_sale_batch(&connection, 221, 2, 6, 4.0);

        for quantity in [0, -1] {
            let error = complete_sale_in_connection(&mut connection, checkout(221, quantity, 0))
                .expect_err("invalid checkout quantity must be rejected");
            assert!(error.contains("invalid id, quantity"));
        }

        let (sale_count, stock): (i64, i64) = connection
            .query_row(
                r#"SELECT
                     (SELECT COUNT(*) FROM sales),
                     (SELECT current_stock FROM medicine_batches WHERE id = 221)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read database after rejected checkout");

        assert_eq!((sale_count, stock), (0, 6));
    }

    #[test]
    fn invoice_sale_price_is_saved_without_changing_batch_pricing() {
        let mut connection = sale_connection();
        add_sale_batch(&connection, 223, 2, 6, 4.0);

        let mut request = checkout(223, 1, 0);
        request.items[0].unit_price_cents = 1_234;
        let result =
            complete_sale_in_connection(&mut connection, request).expect("complete edited-price sale");

        let saved_line: (i64, i64, f64) = connection
            .query_row(
                r#"SELECT CAST(round(unit_price * 100) AS INTEGER),
                          CAST(round(total_price * 100) AS INTEGER),
                          purchase_rate_at_sale
                   FROM sale_items WHERE sale_id = ?1"#,
                [result.sale_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read sale-time line price");
        let (batch_sale_rate, batch_stock): (i64, i64) = connection
            .query_row(
                r#"SELECT CAST(round(sale_rate * 100) AS INTEGER), current_stock
                   FROM medicine_batches WHERE id = 223"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read unchanged batch price and stock");
        let invoice_total_cents: i64 = connection
            .query_row(
                "SELECT CAST(round(grand_total * 100) AS INTEGER) FROM sales WHERE id = ?1",
                [result.sale_id],
                |row| row.get(0),
            )
            .expect("read invoice total");

        assert_eq!(saved_line, (1_234, 1_234, 4.0));
        assert_eq!((batch_sale_rate, batch_stock), (1_000, 5));
        assert_eq!(invoice_total_cents, 1_184);
    }

    #[test]
    fn checkout_rejects_empty_cart_and_negative_price_without_mutating_stock() {
        let mut connection = sale_connection();
        add_sale_batch(&connection, 224, 2, 6, 4.0);

        let mut empty_cart = checkout(224, 1, 0);
        empty_cart.items.clear();
        assert!(complete_sale_in_connection(&mut connection, empty_cart)
            .expect_err("reject empty cart")
            .contains("at least one medicine"));

        let mut invalid_price = checkout(224, 1, 0);
        invalid_price.items[0].unit_price_cents = -1;
        assert!(complete_sale_in_connection(&mut connection, invalid_price)
            .expect_err("reject negative price")
            .contains("invalid id, quantity, price, or discount"));

        let (sale_count, stock): (i64, i64) = connection
            .query_row(
                r#"SELECT (SELECT COUNT(*) FROM sales),
                          (SELECT current_stock FROM medicine_batches WHERE id = 224)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read database after rejected checkouts");
        assert_eq!((sale_count, stock), (0, 6));
    }
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn applies_all_migrations_without_changing_the_schema_version_contract() {
        let mut connection = Connection::open_in_memory().expect("open migration test database");
        migrate_connection(&mut connection).expect("apply migrations");
        migrate_connection(&mut connection).expect("migrations are idempotent");

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0))
            .expect("read migration version");
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("check migration database integrity");
        let app_settings_exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'",
                [],
                |row| row.get(0),
            )
            .expect("check final migration table");

        assert_eq!(version, LATEST_DATABASE_VERSION);
        assert_eq!(integrity, "ok");
        assert_eq!(app_settings_exists, 1);
    }

    #[test]
    fn version_six_upgrade_preserves_existing_stock_purchase_and_gst_snapshots() {
        let mut connection = Connection::open_in_memory().expect("open version-six fixture");
        connection
            .execute_batch(
                r#"PRAGMA foreign_keys = ON;
                   CREATE TABLE schema_migrations (
                       version INTEGER PRIMARY KEY,
                       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                   );"#,
            )
            .expect("create migration history");
        for version in 1..=6 {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("begin historical migration");
            for statement in migration_statements(version).expect("read migration") {
                transaction
                    .execute_batch(statement)
                    .expect("apply migration");
            }
            transaction
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [version],
                )
                .expect("record migration");
            transaction.commit().expect("commit migration");
        }
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name, gst_rate_basis_points)
                VALUES (1, 'Existing medicine', 1800);
                INSERT INTO medicine_batches (
                    id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                ) VALUES (1, 1, 'OLD-1', '2099-12-31', 4, 8, 7, 23);
                INSERT INTO purchases (id, invoice_no, total_amount, purchase_date)
                VALUES (1, 'P-OLD', 8, '2026-03-02');
                INSERT INTO purchase_items (id, purchase_id, batch_id, quantity, rate, total)
                VALUES (1, 1, 1, 2, 4, 8);
                INSERT INTO sales (
                    id, invoice_no, subtotal, grand_total, gst_enabled, gst_pricing_mode,
                    tax_type, taxable_amount, cgst_amount, sgst_amount, total_gst, created_at
                ) VALUES (
                    1, 'S-OLD', 118, 118, 1, 'INCLUSIVE', 'CGST_SGST',
                    100, 9, 9, 18, '2026-03-02 12:00:00'
                );
                INSERT INTO sale_items (
                    id, sale_id, batch_id, quantity, unit_price, total_price,
                    gst_rate_basis_points, taxable_amount, cgst_amount, sgst_amount, total_gst
                ) VALUES (1, 1, 1, 1, 118, 118, 1800, 100, 9, 9, 18);
                "#,
            )
            .expect("seed existing business records");

        migrate_connection(&mut connection).expect("upgrade to latest schema");
        migrate_connection(&mut connection).expect("rerun startup migration");

        let medicine_metadata: (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                r#"SELECT product_type, strength, composition, barcode, uses,
                          adult_dose, child_dose, photo_ref
                   FROM medicines WHERE id = 1"#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .expect("read migrated medicine fields");
        let preserved_stock: i64 = connection
            .query_row("SELECT current_stock FROM medicine_batches WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read original stock");
        let preserved_totals: (i64, i64, i64) = connection
            .query_row(
                r#"SELECT
                     (SELECT COUNT(*) FROM purchases),
                     (SELECT COUNT(*) FROM sales),
                     (SELECT COUNT(*) FROM purchase_items)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read historical transaction counts");
        let gst_snapshot: (i64, f64, f64, i64) = connection
            .query_row(
                r#"SELECT
                     si.gst_rate_basis_points, si.total_gst, s.grand_total,
                     m.gst_rate_basis_points
                   FROM sale_items AS si
                   JOIN sales AS s ON s.id = si.sale_id
                   JOIN medicines AS m ON m.id = 1
                   WHERE si.id = 1"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read preserved tax snapshots");
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("check upgraded database integrity");

        assert_eq!(medicine_metadata, (None, None, None, None, None, None, None, None));
        assert_eq!(preserved_stock, 23);
        assert_eq!(preserved_totals, (1, 1, 1));
        assert_eq!(gst_snapshot, (1800, 18.0, 118.0, 1800));
        assert_eq!(integrity, "ok");
    }

    #[test]
    fn version_five_migration_preserves_existing_version_four_business_data() {
        let mut connection = Connection::open_in_memory().expect("open existing database fixture");
        connection
            .execute_batch(
                r#"PRAGMA foreign_keys = ON;
                   CREATE TABLE schema_migrations (
                       version INTEGER PRIMARY KEY,
                       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                   );"#,
            )
            .expect("create version-four migration history");
        for version in 1..=4 {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("begin historical migration");
            for statement in migration_statements(version).expect("read historical migration") {
                transaction
                    .execute_batch(statement)
                    .expect("apply historical migration");
            }
            transaction
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [version],
                )
                .expect("record historical migration");
            transaction.commit().expect("commit historical migration");
        }
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name)
                VALUES (1, 'Existing medicine');
                INSERT INTO medicine_batches (
                    id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                ) VALUES (1, 1, 'OLD-1', '2099-12-31', 4, 8, 7, 23);
                INSERT INTO suppliers (id, name, phone, address, balance_due)
                VALUES (1, 'Existing supplier', '12345', 'Old Road', 75.25);
                INSERT INTO purchases (id, invoice_no, supplier_id, total_amount, purchase_date)
                VALUES (1, 'OLD-P-1', 1, 8, '2026-03-02');
                INSERT INTO purchase_items (id, purchase_id, batch_id, quantity, rate, total)
                VALUES (1, 1, 1, 2, 4, 8);
                INSERT INTO sales (id, invoice_no, subtotal, grand_total, created_at)
                VALUES (1, 'OLD-S-1', 7, 7, '2026-03-02 12:00:00');
                INSERT INTO sale_items (id, sale_id, batch_id, quantity, unit_price, total_price)
                VALUES (1, 1, 1, 1, 7, 7);
                INSERT INTO app_settings (setting_key, setting_value)
                VALUES ('pharmacy_name', 'Existing Pharmacy');
                "#,
            )
            .expect("seed version-four business records");

        migrate_connection(&mut connection).expect("upgrade existing database to version five");
        migrate_connection(&mut connection).expect("version-five startup migration is idempotent");

        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0))
            .expect("read upgraded schema version");
        let supplier: (String, Option<String>, f64) = connection
            .query_row(
                "SELECT name, contact_person, balance_due FROM suppliers WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read existing supplier after migration");
        let preserved: (i64, i64, i64, String) = connection
            .query_row(
                r#"SELECT
                     (SELECT current_stock FROM medicine_batches WHERE id = 1),
                     (SELECT COUNT(*) FROM purchases),
                     (SELECT COUNT(*) FROM sales),
                     (SELECT setting_value FROM app_settings WHERE setting_key = 'pharmacy_name')"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read preserved business data");
        let order_list_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM order_list_items", [], |row| row.get(0))
            .expect("read new order-list table");
        let integrity: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("check upgraded database integrity");

        assert_eq!(version, LATEST_DATABASE_VERSION);
        assert_eq!(supplier, ("Existing supplier".to_owned(), None, 75.25));
        assert_eq!(preserved, (23, 1, 1, "Existing Pharmacy".to_owned()));
        assert_eq!(order_list_count, 0);
        assert_eq!(integrity, "ok");
    }

    #[test]
    fn rejects_non_contiguous_migration_history() {
        let mut connection = Connection::open_in_memory().expect("open migration test database");
        connection
            .execute_batch(
                r#"CREATE TABLE schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO schema_migrations (version) VALUES (1), (3);"#,
            )
            .expect("create invalid migration history");

        assert!(migrate_connection(&mut connection)
            .expect_err("migration gaps must fail explicitly")
            .contains("incomplete"));
    }
}

#[cfg(test)]
mod pharmacy_mutation_tests {
    use super::*;

    fn migrated_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open pharmacy mutation database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable foreign keys");
        migrate_connection(&mut connection).expect("migrate pharmacy mutation database");
        connection
    }

    fn create_medicine(connection: &mut Connection) -> i64 {
        apply_pharmacy_mutation_to_connection(
            connection,
            PharmacyMutation::CreateMedicine {
                name: "Test medicine".to_owned(),
                generic_name: Some("Test generic".to_owned()),
                company: Some("Test company".to_owned()),
                product_type: None,
                strength: None,
                composition: None,
                barcode: None,
                uses: None,
                adult_dose: None,
                child_dose: None,
                photo_ref: None,
                rack_location: Some("A-1".to_owned()),
                min_stock_alert: 5,
                gst_rate_basis_points: None,
                opening_batch: None,
            },
        )
        .expect("create medicine")
        .expect("medicine id")
    }

    #[test]
    fn medicine_creation_records_opening_batch_and_audit_adjustment_atomically() {
        let mut connection = migrated_connection();
        let medicine_id = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::CreateMedicine {
                name: "Opening stock medicine".to_owned(),
                generic_name: None,
                company: Some("Example maker".to_owned()),
                product_type: Some("Tablet".to_owned()),
                strength: Some("20 mg".to_owned()),
                composition: None,
                barcode: None,
                uses: None,
                adult_dose: None,
                child_dose: None,
                photo_ref: None,
                rack_location: None,
                min_stock_alert: 10,
                gst_rate_basis_points: None,
                opening_batch: Some(ImportedOpeningBatch {
                    batch_no: "OPEN-2026".to_owned(),
                    expiry_date: "2028-12-31".to_owned(),
                    purchase_rate_cents: 1250,
                    mrp_cents: 2000,
                    sale_rate_cents: 1800,
                    opening_stock: 15,
                }),
            },
        )
        .expect("create medicine with opening stock")
        .expect("medicine id");

        let batch: (String, String, f64, f64, f64, i64) = connection
            .query_row(
                r#"SELECT batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                   FROM medicine_batches WHERE medicine_id = ?1"#,
                [medicine_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("read opening batch");
        assert_eq!(
            batch,
            (
                "OPEN-2026".to_owned(),
                "2028-12-31".to_owned(),
                12.5,
                20.0,
                18.0,
                15,
            )
        );

        let adjustment: (i64, i64, i64, String) = connection
            .query_row(
                r#"SELECT quantity_change, previous_quantity, new_quantity, reason
                   FROM stock_adjustments WHERE medicine_id = ?1"#,
                [medicine_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read opening stock audit adjustment");
        assert_eq!(
            adjustment,
            (
                15,
                0,
                15,
                "Opening stock entered while adding medicine".to_owned(),
            )
        );

        let rejected = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::CreateMedicine {
                name: "Invalid opening batch".to_owned(),
                generic_name: None,
                company: None,
                product_type: None,
                strength: None,
                composition: None,
                barcode: None,
                uses: None,
                adult_dose: None,
                child_dose: None,
                photo_ref: None,
                rack_location: None,
                min_stock_alert: 0,
                gst_rate_basis_points: None,
                opening_batch: Some(ImportedOpeningBatch {
                    batch_no: "BAD-DATE".to_owned(),
                    expiry_date: "2028-13-40".to_owned(),
                    purchase_rate_cents: 100,
                    mrp_cents: 200,
                    sale_rate_cents: 150,
                    opening_stock: 1,
                }),
            },
        )
        .expect_err("invalid opening batch date must reject the whole medicine creation");
        assert!(rejected.contains("valid date"));

        let counts: (i64, i64, i64) = connection
            .query_row(
                r#"SELECT
                     (SELECT COUNT(*) FROM medicines),
                     (SELECT COUNT(*) FROM medicine_batches),
                     (SELECT COUNT(*) FROM stock_adjustments)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("count records after rejected creation");
        assert_eq!(counts, (1, 1, 1));
    }

    #[test]
    fn medicine_metadata_supports_optional_values_extensible_types_and_unique_barcodes() {
        let mut connection = migrated_connection();
        let medicine_id = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::CreateMedicine {
                name: "Custom product".to_owned(),
                generic_name: None,
                company: Some("Example maker".to_owned()),
                product_type: Some("Veterinary feed supplement".to_owned()),
                strength: Some("250 mg".to_owned()),
                composition: Some("Compound A 250 mg".to_owned()),
                barcode: Some("  ab-102  ".to_owned()),
                uses: Some("Used for testing".to_owned()),
                adult_dose: None,
                child_dose: None,
                photo_ref: None,
                rack_location: None,
                min_stock_alert: 4,
                gst_rate_basis_points: Some(1800),
                opening_batch: None,
            },
        )
        .expect("create medicine with metadata")
        .expect("medicine id");
        let metadata: (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = connection
            .query_row(
                r#"SELECT product_type, strength, composition, barcode, uses,
                          adult_dose, child_dose, photo_ref, gst_rate_basis_points
                   FROM medicines WHERE id = ?1"#,
                [medicine_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                    ))
                },
            )
            .expect("read medicine metadata");

        assert_eq!(
            metadata,
            (
                Some("Veterinary feed supplement".to_owned()),
                Some("250 mg".to_owned()),
                Some("Compound A 250 mg".to_owned()),
                Some("AB-102".to_owned()),
                Some("Used for testing".to_owned()),
                None,
                None,
                None,
                Some(1800),
            )
        );

        let optional_barcode_id = create_medicine(&mut connection);
        let optional_barcode: Option<String> = connection
            .query_row(
                "SELECT barcode FROM medicines WHERE id = ?1",
                [optional_barcode_id],
                |row| row.get(0),
            )
            .expect("read medicine without a barcode");
        assert_eq!(optional_barcode, None);

        let duplicate = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::CreateMedicine {
                name: "Duplicate code".to_owned(),
                generic_name: None,
                company: None,
                product_type: None,
                strength: None,
                composition: None,
                barcode: Some("ab-102".to_owned()),
                uses: None,
                adult_dose: None,
                child_dose: None,
                photo_ref: None,
                rack_location: None,
                min_stock_alert: 0,
                gst_rate_basis_points: None,
                opening_batch: None,
            },
        )
        .expect_err("normalized duplicate barcode must be rejected");
        assert!(duplicate.contains("already assigned"));

        let invalid_photo_reference = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::UpdateMedicine {
                medicine_id,
                name: "Custom product".to_owned(),
                generic_name: None,
                company: Some("Example maker".to_owned()),
                product_type: Some("Veterinary feed supplement".to_owned()),
                strength: Some("250 mg".to_owned()),
                composition: Some("Compound A 250 mg".to_owned()),
                barcode: Some("AB-102".to_owned()),
                uses: Some("Used for testing".to_owned()),
                adult_dose: None,
                child_dose: None,
                photo_ref: Some("../outside.jpg".to_owned()),
                rack_location: None,
                min_stock_alert: 4,
                gst_rate_basis_points: Some(1800),
            },
        )
        .expect_err("unsafe photo references must be rejected");
        assert!(invalid_photo_reference.contains("photo reference is invalid"));

        assert_eq!(
            normalized_photo_ref_for_medicine(Some("medicine-42-123.jpg".to_owned()), 42)
                .expect("accept a scoped local photo reference"),
            Some("medicine-42-123.jpg".to_owned())
        );
        assert!(
            normalized_photo_ref_for_medicine(Some("medicine-43-123.jpg".to_owned()), 42)
                .is_err(),
            "a medicine cannot reference another medicine's photo"
        );
        assert!(validate_medicine_photo_bytes(&[0xff, 0xd8, 0xff, 0xd9]).is_ok());
        assert!(validate_medicine_photo_bytes(&[0x00, 0x01, 0x02, 0x03]).is_err());
        assert!(validate_medicine_photo_bytes(&vec![0xff; 2_000_001]).is_err());
    }

    #[test]
    fn typed_medicine_supplier_and_settings_writes_persist() {
        let mut connection = migrated_connection();
        let medicine_id = create_medicine(&mut connection);
        let supplier_id = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::CreateSupplier {
                name: "Test supplier".to_owned(),
                contact_person: Some("Casey Manager".to_owned()),
                phone: Some("12345".to_owned()),
                whatsapp_phone: Some("919876543210".to_owned()),
                address: None,
                notes: Some("Morning delivery preferred".to_owned()),
                state_code: None,
            },
        )
        .expect("create supplier")
        .expect("supplier id");
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::SaveSettings {
                settings: StoreSettingsMutation {
                    pharmacy_name: "Test pharmacy".to_owned(),
                    address: "Market Road".to_owned(),
                    contact_number: "12345".to_owned(),
                    drug_license_number: "DL-1".to_owned(),
                    receipt_footer_note: "Thank you".to_owned(),
                    upi_id: String::new(),
                    upi_display_name: String::new(),
                    gst_enabled: false,
                    gst_default_rate_basis_points: None,
                    gst_pricing_mode: "EXCLUSIVE".to_owned(),
                    gst_pharmacy_state_code: String::new(),
                },
            },
        )
        .expect("save settings");
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::UpdateMedicine {
                medicine_id,
                name: "Updated medicine".to_owned(),
                generic_name: None,
                company: Some("New company".to_owned()),
                product_type: None,
                strength: None,
                composition: None,
                barcode: None,
                uses: None,
                adult_dose: None,
                child_dose: None,
                photo_ref: None,
                rack_location: Some("B-2".to_owned()),
                min_stock_alert: 9,
                gst_rate_basis_points: None,
            },
        )
        .expect("update medicine");

        let medicine_name: String = connection
            .query_row(
                "SELECT name FROM medicines WHERE id = ?1",
                [medicine_id],
                |row| row.get(0),
            )
            .expect("read medicine");
        let stored_supplier_id: i64 = connection
            .query_row(
                "SELECT id FROM suppliers WHERE id = ?1",
                [supplier_id],
                |row| row.get(0),
            )
            .expect("read supplier");
        let pharmacy_name: String = connection
            .query_row(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'pharmacy_name'",
                [],
                |row| row.get(0),
            )
            .expect("read pharmacy setting");

        assert_eq!(medicine_name, "Updated medicine");
        assert_eq!(stored_supplier_id, supplier_id);
        assert_eq!(pharmacy_name, "Test pharmacy");
    }

    #[test]
    fn typed_writes_survive_reopen_and_test_database_passes_quick_check() {
        let database_path = unique_internal_path(
            &std::env::temp_dir(),
            "pharmadesk-qa-persistence",
            "db",
        );
        let mut connection = Connection::open(&database_path).expect("open QA database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable QA foreign keys");
        migrate_connection(&mut connection).expect("migrate QA database");
        let medicine_id = create_medicine(&mut connection);
        drop(connection);

        let reopened = Connection::open(&database_path).expect("reopen QA database");
        let medicine_name: String = reopened
            .query_row(
                "SELECT name FROM medicines WHERE id = ?1",
                [medicine_id],
                |row| row.get(0),
            )
            .expect("read persisted QA medicine");
        let integrity: String = reopened
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("check QA database integrity");

        assert_eq!(medicine_name, "Test medicine");
        assert_eq!(integrity, "ok");
        drop(reopened);
        fs::remove_file(database_path).expect("remove isolated QA database");
    }

    #[test]
    fn typed_batch_mutations_preserve_stock_adjustment_and_atomic_deduction_rules() {
        let mut connection = migrated_connection();
        let medicine_id = create_medicine(&mut connection);
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                   ) VALUES
                     (101, ?1, 'LOT-A', '2099-12-31', 4, 10, 9, 3),
                     (102, ?1, 'LOT-B', '2099-12-31', 5, 11, 10, 0)"#,
                [medicine_id],
            )
            .expect("seed stock batches");

        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::AdjustBatchStock {
                batch_id: 101,
                medicine_id,
                quantity_change: 2,
                reason: "Count correction".to_owned(),
            },
        )
        .expect("adjust stock");
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::UpdateBatchDetails {
                batch_id: 101,
                medicine_id,
                mrp_cents: 1_200,
                sale_rate_cents: 1_000,
                rack_location: Some("C-3".to_owned()),
            },
        )
        .expect("update batch");
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::AddStock {
                batch_id: 101,
                quantity: 1,
            },
        )
        .expect("add stock");
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::DeductStock {
                deductions: vec![StockDeduction {
                    batch_id: 101,
                    quantity: 2,
                }],
            },
        )
        .expect("deduct stock");

        let result = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::DeductStock {
                deductions: vec![
                    StockDeduction {
                        batch_id: 101,
                        quantity: 1,
                    },
                    StockDeduction {
                        batch_id: 102,
                        quantity: 1,
                    },
                ],
            },
        );
        let stock: i64 = connection
            .query_row(
                "SELECT current_stock FROM medicine_batches WHERE id = 101",
                [],
                |row| row.get(0),
            )
            .expect("read batch stock");
        let adjustments: i64 = connection
            .query_row("SELECT COUNT(*) FROM stock_adjustments", [], |row| row.get(0))
            .expect("count stock adjustments");
        let mrp: f64 = connection
            .query_row(
                "SELECT mrp FROM medicine_batches WHERE id = 101",
                [],
                |row| row.get(0),
            )
            .expect("read updated MRP");

        assert!(result.is_err());
        assert_eq!(stock, 4);
        assert_eq!(adjustments, 1);
        assert_eq!(mrp, 12.0);
    }

    #[test]
    fn bulk_stock_adjustments_commit_together_and_record_quantity_snapshots() {
        let mut connection = migrated_connection();
        let first_medicine = create_medicine(&mut connection);
        let second_medicine = create_medicine(&mut connection);
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                   ) VALUES
                     (201, ?1, 'LOT-A', '2099-12-31', 4, 10, 9, 3),
                     (202, ?2, 'LOT-B', '2099-12-31', 5, 11, 10, 1),
                     (203, ?1, 'EXPIRED', '2000-01-01', 5, 11, 10, 0)"#,
                params![first_medicine, second_medicine],
            )
            .expect("seed bulk stock batches");

        let rejected = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::AdjustBatchStockBulk {
                adjustments: vec![
                    BulkStockAdjustment {
                        batch_id: 201,
                        medicine_id: first_medicine,
                        quantity_change: 2,
                    },
                    BulkStockAdjustment {
                        batch_id: 202,
                        medicine_id: second_medicine,
                        quantity_change: -2,
                    },
                ],
                reason: "Count correction".to_owned(),
            },
        );
        assert!(rejected.is_err());
        let unchanged_stock: (i64, i64) = connection
            .query_row(
                "SELECT (SELECT current_stock FROM medicine_batches WHERE id = 201), \
                        (SELECT current_stock FROM medicine_batches WHERE id = 202)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read stock after rejected bulk operation");
        let unchanged_adjustment_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM stock_adjustments", [], |row| row.get(0))
            .expect("count adjustments after rollback");
        assert_eq!(unchanged_stock, (3, 1));
        assert_eq!(unchanged_adjustment_count, 0);

        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::AdjustBatchStockBulk {
                adjustments: vec![
                    BulkStockAdjustment {
                        batch_id: 201,
                        medicine_id: first_medicine,
                        quantity_change: 2,
                    },
                    BulkStockAdjustment {
                        batch_id: 202,
                        medicine_id: second_medicine,
                        quantity_change: -1,
                    },
                ],
                reason: "Count correction".to_owned(),
            },
        )
        .expect("save all valid bulk adjustments");
        let final_stock: (i64, i64) = connection
            .query_row(
                "SELECT (SELECT current_stock FROM medicine_batches WHERE id = 201), \
                        (SELECT current_stock FROM medicine_batches WHERE id = 202)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read stock after accepted bulk operation");
        let final_adjustment_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM stock_adjustments", [], |row| row.get(0))
            .expect("count saved bulk adjustments");
        let quantity_snapshot: (i64, i64) = connection
            .query_row(
                "SELECT previous_quantity, new_quantity FROM stock_adjustments WHERE batch_id = 201",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read stock adjustment quantity snapshot");
        assert_eq!(final_stock, (5, 0));
        assert_eq!(final_adjustment_count, 2);
        assert_eq!(quantity_snapshot, (3, 5));
    }

    #[test]
    fn bulk_reorder_level_updates_are_atomic_and_leave_stock_untouched() {
        let mut connection = migrated_connection();
        let first_medicine = create_medicine(&mut connection);
        let second_medicine = create_medicine(&mut connection);
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                   ) VALUES (?1, 'LOT-A', '2099-12-31', 4, 10, 9, 7)"#,
                [first_medicine],
            )
            .expect("seed stock for reorder-level test");

        let rejected = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::UpdateBulkReorderThresholds {
                updates: vec![
                    BulkReorderThreshold {
                        medicine_id: first_medicine,
                        min_stock_alert: 15,
                    },
                    BulkReorderThreshold {
                        medicine_id: i64::MAX,
                        min_stock_alert: 20,
                    },
                ],
            },
        );
        assert!(rejected.is_err());
        let unchanged_alert: i64 = connection
            .query_row(
                "SELECT min_stock_alert FROM medicines WHERE id = ?1",
                [first_medicine],
                |row| row.get(0),
            )
            .expect("read alert after rejected bulk update");
        assert_eq!(unchanged_alert, 5);

        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::UpdateBulkReorderThresholds {
                updates: vec![
                    BulkReorderThreshold {
                        medicine_id: first_medicine,
                        min_stock_alert: 15,
                    },
                    BulkReorderThreshold {
                        medicine_id: second_medicine,
                        min_stock_alert: 20,
                    },
                ],
            },
        )
        .expect("save valid bulk reorder levels");
        let final_alerts: (i64, i64) = connection
            .query_row(
                "SELECT (SELECT min_stock_alert FROM medicines WHERE id = ?1), \
                        (SELECT min_stock_alert FROM medicines WHERE id = ?2)",
                params![first_medicine, second_medicine],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read saved reorder levels");
        let stock: i64 = connection
            .query_row(
                "SELECT current_stock FROM medicine_batches WHERE medicine_id = ?1",
                [first_medicine],
                |row| row.get(0),
            )
            .expect("read stock after reorder-level update");
        assert_eq!(final_alerts, (15, 20));
        assert_eq!(stock, 7);
    }

    #[test]
    fn spreadsheet_import_updates_and_adds_medicines_atomically_with_audited_opening_stock() {
        let mut connection = migrated_connection();
        let existing_medicine_id = create_medicine(&mut connection);

        let duplicate_barcode_import = apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::ImportMedicines {
                records: vec![
                    ImportedMedicineRecord {
                        medicine_id: None,
                        name: "Import one".to_owned(),
                        generic_name: None,
                        company: None,
                        product_type: None,
                        strength: None,
                        composition: None,
                        barcode: Some("DUP-IMPORT-CODE".to_owned()),
                        uses: None,
                        adult_dose: None,
                        child_dose: None,
                        rack_location: None,
                        min_stock_alert: None,
                        gst_rate_basis_points: None,
                        opening_batch: None,
                    },
                    ImportedMedicineRecord {
                        medicine_id: None,
                        name: "Import two".to_owned(),
                        generic_name: None,
                        company: None,
                        product_type: None,
                        strength: None,
                        composition: None,
                        barcode: Some("DUP-IMPORT-CODE".to_owned()),
                        uses: None,
                        adult_dose: None,
                        child_dose: None,
                        rack_location: None,
                        min_stock_alert: None,
                        gst_rate_basis_points: None,
                        opening_batch: None,
                    },
                ],
            },
        );
        assert!(duplicate_barcode_import.is_err());
        let medicine_count_after_rejection: i64 = connection
            .query_row("SELECT COUNT(*) FROM medicines", [], |row| row.get(0))
            .expect("count medicines after rejected import");
        assert_eq!(medicine_count_after_rejection, 1);

        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::ImportMedicines {
                records: vec![
                    ImportedMedicineRecord {
                        medicine_id: Some(existing_medicine_id),
                        name: "Updated imported medicine".to_owned(),
                        generic_name: Some("Generic update".to_owned()),
                        company: Some("Local importer".to_owned()),
                        product_type: Some("Tablet".to_owned()),
                        strength: Some("20 mg".to_owned()),
                        composition: None,
                        barcode: None,
                        uses: None,
                        adult_dose: None,
                        child_dose: None,
                        rack_location: Some("R-2".to_owned()),
                        min_stock_alert: Some(11),
                        gst_rate_basis_points: Some(500),
                        opening_batch: None,
                    },
                    ImportedMedicineRecord {
                        medicine_id: None,
                        name: "New imported medicine".to_owned(),
                        generic_name: None,
                        company: Some("Local importer".to_owned()),
                        product_type: Some("Syrup".to_owned()),
                        strength: Some("100 ml".to_owned()),
                        composition: None,
                        barcode: Some("NEW-IMPORT-CODE".to_owned()),
                        uses: None,
                        adult_dose: None,
                        child_dose: None,
                        rack_location: None,
                        min_stock_alert: None,
                        gst_rate_basis_points: None,
                        opening_batch: Some(ImportedOpeningBatch {
                            batch_no: "OPEN-1".to_owned(),
                            expiry_date: "2099-12-31".to_owned(),
                            purchase_rate_cents: 1250,
                            mrp_cents: 2000,
                            sale_rate_cents: 1800,
                            opening_stock: 20,
                        }),
                    },
                ],
            },
        )
        .expect("save valid medicine import");

        let updated_medicine: (String, i64, i64) = connection
            .query_row(
                "SELECT name, min_stock_alert, gst_rate_basis_points FROM medicines WHERE id = ?1",
                [existing_medicine_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read updated medicine fields");
        let imported_batch: (String, i64, i64, i64) = connection
            .query_row(
                r#"SELECT batches.batch_no, batches.current_stock,
                          adjustments.previous_quantity, adjustments.new_quantity
                   FROM medicine_batches AS batches
                   JOIN stock_adjustments AS adjustments ON adjustments.batch_id = batches.id
                   WHERE batches.batch_no = 'OPEN-1'"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read imported opening batch and audit");
        let purchases_created: i64 = connection
            .query_row("SELECT COUNT(*) FROM purchases", [], |row| row.get(0))
            .expect("check import did not create a purchase invoice");
        let medicine_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM medicines", [], |row| row.get(0))
            .expect("count imported medicines");
        assert_eq!(updated_medicine, ("Updated imported medicine".to_owned(), 11, 500));
        assert_eq!(imported_batch, ("OPEN-1".to_owned(), 20, 0, 20));
        assert_eq!(purchases_created, 0);
        assert_eq!(medicine_count, 2);
    }
}

#[cfg(test)]
mod purchase_tests {
    use super::*;

    fn test_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable foreign keys");
        migrate_connection(&mut connection).expect("migrate purchase test schema");
        connection
            .execute_batch(
                "INSERT INTO medicines (id, name) VALUES (1, 'Test medicine');
                 INSERT INTO suppliers (id, name) VALUES (1, 'Test supplier');",
            )
            .expect("insert purchase test records");
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
            gst_rate_override_basis_points: None,
        }
    }

    fn purchase(invoice_no: &str, items: Vec<PurchaseItemRequest>) -> PurchaseRequest {
        PurchaseRequest {
            supplier_id: 1,
            invoice_no: invoice_no.to_owned(),
            purchase_date: "2026-10-01".to_owned(),
            gst_pricing_mode: None,
            place_of_supply_state_code: None,
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
    use std::fs::File;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEST_DIRECTORY_ID: AtomicU64 = AtomicU64::new(0);

    fn create_test_backup_directory() -> PathBuf {
        let temp_directory = std::env::temp_dir();
        loop {
            let id = NEXT_TEST_DIRECTORY_ID.fetch_add(1, Ordering::Relaxed);
            let directory = temp_directory.join(format!(
                ".pharmadesk-retention-test-{}-{id}.dir",
                std::process::id()
            ));
            match fs::create_dir(&directory) {
                Ok(()) => return directory,
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create temporary backup directory: {error}"),
            }
        }
    }

    fn restore_database_backup_without_photos(
        active_database: &Path,
        source_path: &Path,
    ) -> Result<DatabaseRestoreResult, String> {
        let photo_directory = active_database
            .parent()
            .expect("test database has a parent directory")
            .join("medicine-photos");
        restore_database_backup_at(active_database, &photo_directory, source_path)
    }

    fn create_test_photo_directory(directory: &Path, name: &str) -> PathBuf {
        let photo_directory = directory.join(name);
        fs::create_dir_all(&photo_directory).expect("create isolated medicine photo directory");
        photo_directory
    }

    fn set_test_photo_reference(database_path: &Path, medicine_id: i64, photo_ref: &str) {
        let connection = Connection::open(database_path).expect("open database for photo fixture");
        connection
            .execute(
                "UPDATE medicines SET photo_ref = ?1 WHERE id = ?2",
                params![photo_ref, medicine_id],
            )
            .expect("set test medicine photo reference");
    }

    fn test_jpeg(marker: u8) -> Vec<u8> {
        vec![0xff, 0xd8, 0xff, 0xe0, marker, 0xff, 0xd9]
    }

    fn insert_test_medicine(
        connection: &Connection,
        id: i64,
        name: &str,
        photo_ref: Option<&str>,
    ) {
        connection
            .execute(
                "INSERT INTO medicines (
                    id, name, generic_name, company, rack_location, min_stock_alert,
                    gst_rate_basis_points, product_type, strength, composition, barcode,
                    uses, adult_dose, child_dose, photo_ref
                 ) VALUES (
                    ?1, ?2, 'Backup Generic', 'Backup Labs', 'Rack R5', 3, 1800,
                    'Tablet', '250 mg', 'Test composition', ?3, 'Test use',
                    'One daily', 'Half daily', ?4
                 )",
                params![id, name, format!("MED-BACKUP-{id:03}"), photo_ref],
            )
            .expect("insert test medicine");
    }

    fn rewrite_zip_entry(
        source: &Path,
        destination: &Path,
        target_entry: &str,
        replacement: Option<&[u8]>,
    ) {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let source_file = File::open(source).expect("open source test archive");
        let mut source_archive =
            zip::ZipArchive::new(source_file).expect("read source test archive");
        let output_file = File::create(destination).expect("create rewritten test archive");
        let mut output_archive = zip::ZipWriter::new(output_file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut found_target = false;

        for index in 0..source_archive.len() {
            let mut entry = source_archive
                .by_index(index)
                .expect("read source test archive entry");
            let name = entry.name().to_owned();
            if name == target_entry {
                found_target = true;
                if replacement.is_none() {
                    continue;
                }
            }
            output_archive
                .start_file(&name, options)
                .expect("create rewritten archive entry");
            if name == target_entry {
                output_archive
                    .write_all(replacement.expect("replacement bytes were provided"))
                    .expect("write replacement test entry");
            } else {
                std::io::copy(&mut entry, &mut output_archive)
                    .expect("copy test archive entry");
            }
        }
        assert!(found_target, "requested archive entry must exist");
        output_archive
            .finish()
            .expect("finish rewritten test archive")
            .sync_all()
            .expect("sync rewritten test archive");
    }

    fn create_active_database(directory: &Path) -> PathBuf {
        let active_database = directory.join("pharmacy.db");
        fs::write(&active_database, b"active database").expect("create active database");
        active_database
    }

    fn create_automatic_backup(directory: &Path, timestamp: &str) -> PathBuf {
        let path = directory.join(format!("backup_{timestamp}.db"));
        fs::write(&path, b"automatic backup").expect("create automatic backup");
        mark_automatic_backup(&path).expect("mark automatic backup");
        path
    }

    fn count_automatic_backups(directory: &Path) -> usize {
        fs::read_dir(directory)
            .expect("read backup directory")
            .filter_map(Result::ok)
            .filter(|entry| {
                automatic_backup_sort_key(&entry.path()).is_some()
                    && automatic_backup_marker_path(&entry.path()).is_file()
            })
            .count()
    }

    fn create_restore_fixture_database(path: &Path, version: i64) -> Connection {
        let mut connection = Connection::open(path).expect("open restore fixture database");
        connection
            .execute_batch(
                r#"PRAGMA foreign_keys = ON;
                   CREATE TABLE schema_migrations (
                       version INTEGER PRIMARY KEY,
                       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                   );"#,
            )
            .expect("create restore fixture migration history");
        for migration_version in 1..=version {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("begin fixture migration");
            for statement in
                migration_statements(migration_version).expect("read fixture migration")
            {
                transaction
                    .execute_batch(statement)
                    .expect("apply fixture migration");
            }
            transaction
                .execute(
                    "INSERT INTO schema_migrations (version) VALUES (?1)",
                    [migration_version],
                )
                .expect("record fixture migration");
            transaction.commit().expect("commit fixture migration");
        }

        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (
                    id, name, generic_name, company, rack_location, min_stock_alert,
                    gst_rate_basis_points, product_type, strength, composition, barcode,
                    uses, adult_dose, child_dose, photo_ref
                ) VALUES (
                    1, 'Backup Medicine', 'Backup Generic', 'Backup Labs', 'Rack R4', 3,
                    1800, 'Tablet', '500 mg', 'Test composition', 'MED-BACKUP-001',
                    'Test use', 'One tablet daily', 'Half tablet daily', NULL
                );
                INSERT INTO medicine_batches (
                    id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                    sale_rate, current_stock, barcode
                ) VALUES
                    (1, 1, 'LOT-FEFO', '2027-03-01', 25, 60, 55, 8, 'LOT-CODE-001'),
                    (2, 1, 'LOT-LATER', '2028-05-01', 27, 62, 58, 14, 'LOT-CODE-002');
                INSERT INTO suppliers (
                    id, name, phone, address, balance_due, contact_person,
                    whatsapp_phone, notes
                ) VALUES (
                    1, 'Backup Supplier', '1112223333', 'Supplier address', 12.5,
                    'Supplier Contact', '1112223333', 'Supplier notes'
                );
                INSERT INTO purchases (id, invoice_no, supplier_id, total_amount, purchase_date)
                    VALUES (1, 'PUR-BACKUP-001', 1, 50, '2026-10-03');
                INSERT INTO purchase_items (id, purchase_id, batch_id, quantity, rate, total)
                    VALUES (1, 1, 1, 2, 25, 50);
                INSERT INTO customers (
                    id, name, phone, phone_normalized, address, notes, state_code, active
                ) VALUES (
                    1, 'Backup Customer', '9998887777', '9998887777',
                    'Customer address', 'Customer notes', '29', 1
                );
                INSERT INTO sales (
                    id, invoice_no, customer_name, customer_phone, subtotal, discount,
                    grand_total, payment_mode, created_at, customer_id,
                    customer_state_code, place_of_supply_state_code, gst_enabled,
                    gst_pricing_mode, tax_type, taxable_amount, cgst_amount,
                    sgst_amount, igst_amount, total_gst
                ) VALUES (
                    1, 'SALE-BACKUP-001', 'Backup Customer', '9998887777', 100, 0,
                    118, 'CREDIT', '2026-10-03 10:00:00', 1, '29', '29', 1,
                    'EXCLUSIVE', 'CGST_SGST', 100, 9, 9, 0, 18
                );
                INSERT INTO sale_items (
                    id, sale_id, batch_id, quantity, unit_price, total_price,
                    purchase_rate_at_sale, gst_rate_basis_points, taxable_amount,
                    cgst_amount, sgst_amount, igst_amount, total_gst
                ) VALUES (
                    1, 1, 1, 2, 50, 100, 25, 1800, 100, 9, 9, 0, 18
                );
                INSERT INTO customer_ledger (
                    id, customer_id, entry_type, invoice_no, debit_cents, credit_cents,
                    payment_mode, note, created_at
                ) VALUES
                    (1, 1, 'CREDIT_SALE', 'SALE-BACKUP-001', 11800, 0, NULL,
                     'Credit sale', '2026-10-03 10:00:00'),
                    (2, 1, 'COLLECTION', NULL, 0, 2500, 'CASH',
                     'Partial collection', '2026-10-03 11:00:00');
                INSERT INTO order_list_items (
                    id, order_date, medicine_id, supplier_id, quantity, note, ordered
                ) VALUES (
                    1, '2026-10-03', 1, 1, 4, 'Reorder after next sale', 0
                );
                INSERT INTO app_settings (setting_key, setting_value) VALUES
                    ('pharmacy_name', 'Backup Pharmacy'),
                    ('address', 'Pharmacy address'),
                    ('contact_number', '1234567890'),
                    ('drug_license_number', 'DL-TEST-001'),
                    ('receipt_footer_note', 'Keep this receipt'),
                    ('upi_id', 'backup@upi'),
                    ('upi_display_name', 'Backup Pharmacy'),
                    ('gst_enabled', 'true'),
                    ('gst_default_rate_basis_points', '1800'),
                    ('gst_pricing_mode', 'EXCLUSIVE'),
                    ('gst_pharmacy_state_code', '29');
                "#,
            )
            .expect("seed restore fixture");

        if version >= 3 {
            connection
                .execute_batch(
                    "INSERT INTO stock_adjustments (
                        id, medicine_id, batch_id, quantity_change, reason
                     ) VALUES (1, 1, 2, 1, 'Count correction');",
                )
                .expect("add fixture stock adjustment");
        }
        if version >= 8 {
            connection
                .execute_batch(
                    "UPDATE stock_adjustments
                     SET previous_quantity = 13, new_quantity = 14
                     WHERE id = 1;",
                )
                .expect("add fixture adjustment snapshots");
        }
        connection
    }

    fn assert_restore_fixture(connection: &Connection) {
        let medicine: (String, String, i64, String) = connection
            .query_row(
                "SELECT name, composition, gst_rate_basis_points, barcode
                 FROM medicines WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read restored medicine metadata");
        assert_eq!(
            medicine,
            (
                "Backup Medicine".to_owned(),
                "Test composition".to_owned(),
                1800,
                "MED-BACKUP-001".to_owned()
            )
        );

        let fefo_batch: String = connection
            .query_row(
                "SELECT batch_no FROM medicine_batches
                 WHERE medicine_id = 1 AND current_stock > 0
                 ORDER BY expiry_date, id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .expect("read restored FEFO batch");
        assert_eq!(fefo_batch, "LOT-FEFO");
        let batch_state: (i64, String, i64) = connection
            .query_row(
                "SELECT current_stock, barcode, id FROM medicine_batches
                 WHERE batch_no = 'LOT-LATER'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read restored batch");
        assert_eq!(batch_state, (14, "LOT-CODE-002".to_owned(), 2));

        let customer_balance_cents: i64 = connection
            .query_row(
                "SELECT SUM(debit_cents - credit_cents)
                 FROM customer_ledger WHERE customer_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read restored customer balance");
        assert_eq!(customer_balance_cents, 9_300);

        let gst_snapshot: (String, String, String, f64, f64, f64) = connection
            .query_row(
                "SELECT tax_type, customer_state_code, place_of_supply_state_code,
                        taxable_amount, total_gst, grand_total
                 FROM sales WHERE invoice_no = 'SALE-BACKUP-001'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .expect("read restored historical GST snapshot");
        assert_eq!(
            gst_snapshot,
            (
                "CGST_SGST".to_owned(),
                "29".to_owned(),
                "29".to_owned(),
                100.0,
                18.0,
                118.0
            )
        );

        let sale_item_snapshot: (f64, i64, f64, f64) = connection
            .query_row(
                "SELECT purchase_rate_at_sale, gst_rate_basis_points,
                        taxable_amount, total_gst
                 FROM sale_items WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read restored sale-item snapshots");
        assert_eq!(sale_item_snapshot, (25.0, 1800, 100.0, 18.0));

        let order_state: (i64, String) = connection
            .query_row(
                "SELECT quantity, note FROM order_list_items WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read restored order list");
        assert_eq!(order_state, (4, "Reorder after next sale".to_owned()));

        let pharmacy_name: String = connection
            .query_row(
                "SELECT setting_value FROM app_settings
                 WHERE setting_key = 'pharmacy_name'",
                [],
                |row| row.get(0),
            )
            .expect("read restored pharmacy setting");
        let upi_id: String = connection
            .query_row(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'upi_id'",
                [],
                |row| row.get(0),
            )
            .expect("read restored UPI setting");
        assert_eq!(pharmacy_name, "Backup Pharmacy");
        assert_eq!(upi_id, "backup@upi");

        let foreign_key_errors: i64 = connection
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("check restored relationships");
        assert_eq!(foreign_key_errors, 0);
    }

    #[test]
    fn backup_retention_keeps_fewer_than_the_limit() {
        let directory = create_test_backup_directory();
        let active_database = create_active_database(&directory);
        for second in 0..AUTO_BACKUP_RETENTION_COUNT - 1 {
            create_automatic_backup(&directory, &format!("2026-10-02_00-00-{second:02}"));
        }

        assert_eq!(
            prune_automatic_backups(&directory, &active_database).expect("prune backups"),
            0
        );
        assert_eq!(
            count_automatic_backups(&directory),
            AUTO_BACKUP_RETENTION_COUNT - 1
        );
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn backup_retention_keeps_exactly_the_limit() {
        let directory = create_test_backup_directory();
        let active_database = create_active_database(&directory);
        for second in 0..AUTO_BACKUP_RETENTION_COUNT {
            create_automatic_backup(&directory, &format!("2026-10-02_00-00-{second:02}"));
        }

        assert_eq!(
            prune_automatic_backups(&directory, &active_database).expect("prune backups"),
            0
        );
        assert_eq!(
            count_automatic_backups(&directory),
            AUTO_BACKUP_RETENTION_COUNT
        );
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn backup_retention_removes_only_the_oldest_automatic_backups() {
        let directory = create_test_backup_directory();
        let active_database = create_active_database(&directory);
        let mut paths = Vec::new();
        for second in 0..AUTO_BACKUP_RETENTION_COUNT + 2 {
            paths.push(create_automatic_backup(
                &directory,
                &format!("2026-10-02_00-00-{second:02}"),
            ));
        }

        assert_eq!(
            prune_automatic_backups(&directory, &active_database).expect("prune backups"),
            2
        );
        assert!(!paths[0].exists());
        assert!(!automatic_backup_marker_path(&paths[0]).exists());
        assert!(!paths[1].exists());
        assert!(paths[2..].iter().all(|path| path.exists()));
        assert_eq!(
            count_automatic_backups(&directory),
            AUTO_BACKUP_RETENTION_COUNT
        );
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn backup_retention_preserves_manual_and_unmarked_files() {
        let directory = create_test_backup_directory();
        let active_database = create_active_database(&directory);
        let manual_backup = directory.join("user-selected.db");
        let unmarked_backup = directory.join("backup_2026-10-01_00-00-00.db");
        fs::write(&manual_backup, b"manual backup").expect("create manual backup");
        fs::write(&unmarked_backup, b"unmarked backup").expect("create unmarked backup");
        for second in 0..AUTO_BACKUP_RETENTION_COUNT + 1 {
            create_automatic_backup(&directory, &format!("2026-10-02_00-00-{second:02}"));
        }

        assert_eq!(
            prune_automatic_backups(&directory, &active_database).expect("prune backups"),
            1
        );
        assert!(manual_backup.exists());
        assert!(unmarked_backup.exists());
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn backup_retention_never_deletes_the_active_database() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("backup_2026-10-01_00-00-00.db");
        fs::write(&active_database, b"active database").expect("create active database");
        mark_automatic_backup(&active_database).expect("mark active database");
        for second in 0..AUTO_BACKUP_RETENTION_COUNT + 1 {
            create_automatic_backup(&directory, &format!("2026-10-02_00-00-{second:02}"));
        }

        prune_automatic_backups(&directory, &active_database).expect("prune backups");

        assert!(active_database.exists());
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn cleanup_failure_is_non_fatal_for_the_close_path() {
        let directory = create_test_backup_directory();
        let active_database = create_active_database(&directory);
        let not_a_directory = directory.join("not-a-directory");
        fs::write(&not_a_directory, b"blocker").expect("create non-directory path");

        prune_automatic_backups_best_effort(&not_a_directory, &active_database);

        assert!(active_database.exists());
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn backup_retention_handles_a_missing_directory() {
        let directory = create_test_backup_directory();
        let active_database = create_active_database(&directory);
        let missing_directory = directory.join("missing");
        assert_eq!(
            prune_automatic_backups(&missing_directory, &active_database).expect("missing is safe"),
            0
        );
        fs::remove_dir_all(directory).expect("remove temporary backup directory");
    }

    #[test]
    fn vacuum_snapshot_preserves_pharmacy_schema_and_data() {
        let directory =
            unique_internal_path(&std::env::temp_dir(), "pharmadesk-backup-test", "dir");
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

    #[test]
    fn complete_backup_restore_round_trip_restores_database_and_referenced_photos() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "active-photos");
        let backup_path = directory.join("user-selected-backup.zip");
        let photo_ref = "medicine-1-1234567890123456789.jpg";
        let active_connection =
            create_restore_fixture_database(&active_database, LATEST_DATABASE_VERSION);
        let rent_id: i64 = active_connection
            .query_row(
                "SELECT id FROM expense_categories WHERE name = 'Rent'",
                [],
                |row| row.get(0),
            )
            .expect("find seeded rent category");
        active_connection
            .execute(
                "INSERT INTO expense_categories (name, active) VALUES ('Backup Utilities', 0)",
                [],
            )
            .expect("create inactive expense category");
        let inactive_category_id = active_connection.last_insert_rowid();
        active_connection
            .execute(
                r#"INSERT INTO expenses
                   (id, expense_date, category_id, description, amount_cents,
                    payment_method, reference_number, status, created_at, updated_at)
                   VALUES (501, '2026-09-01', ?1, 'September rent', 42563,
                           'BANK', 'BANK-REF-501', 'ACTIVE',
                           '2026-09-01 10:15:00', '2026-09-04 11:30:00')"#,
                [rent_id],
            )
            .expect("create active expense backup fixture");
        active_connection
            .execute(
                r#"INSERT INTO expenses
                   (id, expense_date, category_id, description, amount_cents,
                    payment_method, reference_number, status, created_at, updated_at)
                   VALUES (502, '2026-09-02', ?1, 'Cancelled utility bill', 8500,
                           'UPI', NULL, 'CANCELLED',
                           '2026-09-02 10:15:00', '2026-09-03 11:30:00')"#,
                [inactive_category_id],
            )
            .expect("create cancelled expense backup fixture");
        drop(active_connection);
        set_test_photo_reference(&active_database, 1, photo_ref);
        let original_photo = test_jpeg(0x01);
        fs::write(photo_directory.join(photo_ref), &original_photo)
            .expect("write referenced medicine photo");

        let destination = backup_destination_path(&active_database, &backup_path)
            .expect("resolve the complete backup destination");
        let backup_summary =
            create_complete_backup_at(&active_database, &photo_directory, &destination)
                .expect("create complete manual backup");
        assert_eq!(backup_summary.photo_count, 1);
        assert_eq!(backup_summary.ignored_orphaned_photo_count, 0);

        let active_connection = Connection::open(&active_database).expect("open active database");
        active_connection
            .execute_batch(
                r#"
                UPDATE medicines SET name = 'Changed medicine', composition = 'Changed';
                UPDATE medicine_batches SET current_stock = 1 WHERE id = 1;
                DELETE FROM sale_items;
                DELETE FROM sales;
                DELETE FROM purchase_items;
                DELETE FROM purchases;
                DELETE FROM order_list_items;
                UPDATE app_settings SET setting_value = 'Changed pharmacy'
                  WHERE setting_key = 'pharmacy_name';
                UPDATE expenses SET amount_cents = 99999, status = 'CANCELLED',
                    payment_method = 'OTHER', reference_number = 'CHANGED'
                  WHERE id = 501;
                UPDATE expense_categories SET name = 'Changed Utilities', active = 1
                  WHERE name = 'Backup Utilities';
                "#,
            )
            .expect("change active records before restoring");
        drop(active_connection);
        fs::write(photo_directory.join(photo_ref), test_jpeg(0x02))
            .expect("change active medicine photo before restoring");

        let restore_result =
            restore_database_backup_at(&active_database, &photo_directory, &backup_path)
                .expect("restore the complete database backup");
        assert_eq!(restore_result.source_format, "complete");
        assert_eq!(restore_result.restored_photo_count, 1);
        let safety_backup = PathBuf::from(&restore_result.safety_backup_path);
        assert!(safety_backup.is_file());
        let safety_database = directory.join("safety-stage.db");
        let safety_photos = directory.join("safety-stage-photos");
        stage_complete_backup(&safety_backup, &safety_database, &safety_photos)
            .expect("extract pre-restore safety backup");
        let safety_connection =
            Connection::open(&safety_database).expect("open pre-restore safety backup");
        let safety_medicine_name: String = safety_connection
            .query_row("SELECT name FROM medicines WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read safety snapshot medicine");
        let safety_sale_count: i64 = safety_connection
            .query_row("SELECT COUNT(*) FROM sales", [], |row| row.get(0))
            .expect("read safety snapshot sales");
        assert_eq!(safety_medicine_name, "Changed medicine");
        assert_eq!(safety_sale_count, 0);
        drop(safety_connection);
        assert_eq!(
            fs::read(safety_photos.join(photo_ref)).expect("read safety photo"),
            test_jpeg(0x02)
        );

        // Reopening through a new connection models the app reading the restored file after reload.
        let reopened_database =
            Connection::open(&active_database).expect("reopen restored pharmacy database");
        assert_restore_fixture(&reopened_database);
        let restored_version: i64 = reopened_database
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("read restored schema version");
        assert_eq!(restored_version, LATEST_DATABASE_VERSION);
        let restored_expense: (
            String,
            String,
            i64,
            String,
            Option<String>,
            String,
            String,
            String,
        ) = reopened_database
            .query_row(
                r#"SELECT e.expense_date, c.name, e.amount_cents, e.payment_method,
                          e.reference_number, e.status, e.created_at, e.updated_at
                   FROM expenses e JOIN expense_categories c ON c.id = e.category_id
                   WHERE e.id = 501"#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .expect("read restored active expense");
        let cancelled_expense: (String, i64, String, Option<String>, String) = reopened_database
            .query_row(
                r#"SELECT expense_date, amount_cents, payment_method, reference_number, status
                   FROM expenses WHERE id = 502"#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read restored cancelled expense");
        let restored_category_active: bool = reopened_database
            .query_row(
                "SELECT active = 1 FROM expense_categories WHERE name = 'Backup Utilities'",
                [],
                |row| row.get(0),
            )
            .expect("read restored category status");
        assert_eq!(
            restored_expense,
            (
                "2026-09-01".to_owned(),
                "Rent".to_owned(),
                42_563,
                "BANK".to_owned(),
                Some("BANK-REF-501".to_owned()),
                "ACTIVE".to_owned(),
                "2026-09-01 10:15:00".to_owned(),
                "2026-09-04 11:30:00".to_owned(),
            )
        );
        assert_eq!(
            cancelled_expense,
            (
                "2026-09-02".to_owned(),
                8_500,
                "UPI".to_owned(),
                None,
                "CANCELLED".to_owned(),
            )
        );
        assert!(!restored_category_active);
        drop(reopened_database);
        assert_eq!(
            fs::read(photo_directory.join(photo_ref)).expect("read restored medicine photo"),
            original_photo
        );
        fs::remove_dir_all(directory).expect("remove isolated restore database");
    }

    #[test]
    fn complete_backup_restore_preserves_returns_voids_corrections_and_customer_events() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "phase4-photos");
        let backup_path = directory.join("phase4-backup.zip");
        let mut connection = create_restore_fixture_database(&active_database, 8);
        migrate_connection(&mut connection).expect("upgrade backup fixture to the current schema");
        connection
            .execute_batch(
                r#"
                INSERT INTO sale_corrections (sale_id, before_json, after_json, note)
                SELECT id, '{"grandTotal":100}', '{"grandTotal":90}', 'Backup audit'
                FROM sales WHERE invoice_no = 'SALE-BACKUP-001';

                INSERT INTO sale_returns (
                  sale_id, return_no, total_cents, customer_due_credit_cents, refund_mode, note
                )
                SELECT id, 'RET-BACKUP-001', 100, 100, 'CASH', 'Backup return'
                FROM sales WHERE invoice_no = 'SALE-BACKUP-001';

                INSERT INTO sale_return_items (
                  return_id, sale_item_id, batch_id, quantity, refund_cents, taxable_cents,
                  cgst_cents, sgst_cents, igst_cents, total_gst_cents
                )
                SELECT r.id, si.id, si.batch_id, 1, 100, 100, 0, 0, 0, 0
                FROM sale_returns AS r
                INNER JOIN sales AS s ON s.id = r.sale_id
                INNER JOIN sale_items AS si ON si.sale_id = s.id
                WHERE r.return_no = 'RET-BACKUP-001'
                ORDER BY si.id LIMIT 1;

                INSERT INTO customer_ledger_events (
                  customer_id, entry_type, invoice_no, reference, credit_cents,
                  payment_mode, payment_reference, note
                )
                VALUES (1, 'SALE_RETURN', 'SALE-BACKUP-001', 'RET-BACKUP-001',
                        100, 'CASH', 'RETURN-PAYMENT-1', 'Backup customer event');

                INSERT INTO sales (
                  invoice_no, subtotal, discount, flat_discount, grand_total,
                  payment_mode, status
                )
                SELECT 'VOID-BACKUP-001', subtotal, discount, flat_discount,
                       grand_total, 'CASH', 'CANCELLED'
                FROM sales WHERE invoice_no = 'SALE-BACKUP-001';

                INSERT INTO sale_voids (sale_id, refund_cents, refund_mode, note)
                SELECT id, CAST(ROUND(grand_total * 100) AS INTEGER), 'CASH', 'Backup void'
                FROM sales WHERE invoice_no = 'VOID-BACKUP-001';
                "#,
            )
            .expect("add Phase 4 records to backup fixture");
        drop(connection);

        let destination = backup_destination_path(&active_database, &backup_path)
            .expect("resolve Phase 4 backup destination");
        create_complete_backup_at(&active_database, &photo_directory, &destination)
            .expect("create backup containing Phase 4 records");

        let active_connection =
            Connection::open(&active_database).expect("open active database before restore");
        active_connection
            .execute_batch(
                "DELETE FROM sale_return_items;
                 DELETE FROM sale_returns;
                 DELETE FROM sale_voids;
                 DELETE FROM sale_corrections;
                 DELETE FROM customer_ledger_events;",
            )
            .expect("remove Phase 4 records from active database");
        drop(active_connection);

        restore_database_backup_at(&active_database, &photo_directory, &backup_path)
            .expect("restore backup containing Phase 4 records");
        let restored = Connection::open(&active_database).expect("open restored database");
        let counts: (i64, i64, i64, i64, i64) = restored
            .query_row(
                r#"SELECT
                     (SELECT COUNT(*) FROM sale_returns),
                     (SELECT COUNT(*) FROM sale_return_items),
                     (SELECT COUNT(*) FROM sale_voids),
                     (SELECT COUNT(*) FROM sale_corrections),
                     (SELECT COUNT(*) FROM customer_ledger_events)"#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read restored Phase 4 record counts");
        assert_eq!(counts, (1, 1, 1, 1, 1));
        let payment_reference: String = restored
            .query_row(
                "SELECT payment_reference FROM customer_ledger_events WHERE reference = 'RET-BACKUP-001'",
                [],
                |row| row.get(0),
            )
            .expect("read restored customer payment reference");
        assert_eq!(payment_reference, "RETURN-PAYMENT-1");
        drop(restored);
        fs::remove_dir_all(directory).expect("remove isolated Phase 4 backup database");
    }

    #[test]
    fn complete_backup_stores_multiple_photos_and_supported_long_references() {
        use std::io::Read;

        let directory = create_test_backup_directory();
        let database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "photos");
        let backup = directory.join("multi-photo.zip");
        let long_reference = format!("medicine-1-{}.jpg", "7".repeat(105));
        let second_reference = "medicine-2-123456789.jpg";
        let connection = create_restore_fixture_database(&database, 8);
        insert_test_medicine(&connection, 2, "Second Medicine", Some(second_reference));
        insert_test_medicine(&connection, 3, "No Photo Medicine", None);
        drop(connection);
        set_test_photo_reference(&database, 1, &long_reference);
        let first_photo = test_jpeg(0x11);
        let second_photo = test_jpeg(0x22);
        fs::write(photo_directory.join(&long_reference), &first_photo)
            .expect("write long-reference photo");
        fs::write(photo_directory.join(second_reference), &second_photo)
            .expect("write second photo");

        let summary = create_complete_backup_at(&database, &photo_directory, &backup)
            .expect("create multi-photo backup");
        assert_eq!(summary.photo_count, 2);
        assert_eq!(summary.ignored_orphaned_photo_count, 0);

        let mut archive =
            zip::ZipArchive::new(File::open(&backup).expect("open multi-photo backup"))
                .expect("read multi-photo backup");
        assert_eq!(archive.len(), 4);
        let mut manifest_bytes = Vec::new();
        archive
            .by_name("my-medical-backup.json")
            .expect("find backup manifest")
            .read_to_end(&mut manifest_bytes)
            .expect("read backup manifest");
        let manifest: serde_json::Value =
            serde_json::from_slice(&manifest_bytes).expect("parse backup manifest");
        let photos = manifest["photos"].as_array().expect("manifest photo list");
        assert_eq!(photos.len(), 2);
        assert_eq!(photos[0]["medicineId"], 1);
        assert_eq!(
            photos[0]["archivePath"],
            format!("photos/{long_reference}")
        );
        assert_eq!(photos[1]["medicineId"], 2);
        assert_eq!(
            photos[1]["archivePath"],
            format!("photos/{second_reference}")
        );
        assert!(archive.by_name("photos/medicine-3-1.jpg").is_err());

        let staged_database = directory.join("staged-multi-photo.db");
        let staged_photos = directory.join("staged-multi-photo-files");
        let restored_summary =
            stage_complete_backup(&backup, &staged_database, &staged_photos)
                .expect("stage multi-photo backup");
        assert_eq!(restored_summary.photo_count, 2);
        assert_eq!(
            fs::read(staged_photos.join(&long_reference)).expect("read staged long photo"),
            first_photo
        );
        assert_eq!(
            fs::read(staged_photos.join(second_reference)).expect("read staged second photo"),
            second_photo
        );
        let restored_database =
            Connection::open(&staged_database).expect("open staged multi-photo database");
        let no_photo_reference: Option<String> = restored_database
            .query_row(
                "SELECT photo_ref FROM medicines WHERE id = 3",
                [],
                |row| row.get(0),
            )
            .expect("read no-photo medicine");
        assert_eq!(no_photo_reference, None);
        drop(restored_database);
        drop(archive);
        fs::remove_dir_all(directory).expect("remove multi-photo backup fixture");
    }

    #[test]
    fn complete_backup_without_photo_references_works_when_photo_storage_is_absent() {
        let directory = create_test_backup_directory();
        let database = directory.join("pharmacy.db");
        let photo_directory = directory.join("missing-photo-folder");
        let backup = directory.join("no-photos.zip");
        let connection = create_restore_fixture_database(&database, 8);
        drop(connection);

        let summary = create_complete_backup_at(&database, &photo_directory, &backup)
            .expect("create backup without medicine photos");
        assert_eq!(summary.photo_count, 0);
        assert_eq!(summary.ignored_orphaned_photo_count, 0);
        assert!(!photo_directory.exists());
        let archive = zip::ZipArchive::new(File::open(&backup).expect("open no-photo backup"))
            .expect("read no-photo backup");
        assert_eq!(archive.len(), 2);

        let staged_database = directory.join("staged-no-photo.db");
        let staged_photos = directory.join("staged-no-photo-files");
        let restored_summary = stage_complete_backup(&backup, &staged_database, &staged_photos)
            .expect("stage backup without medicine photos");
        assert_eq!(restored_summary.photo_count, 0);
        assert!(fs::read_dir(&staged_photos)
            .expect("read staged empty photo folder")
            .next()
            .is_none());
        fs::remove_dir_all(directory).expect("remove no-photo backup fixture");
    }

    #[test]
    fn supplier_ledger_backfill_preserves_existing_balance_and_links_purchase_rows() {
        let directory = create_test_backup_directory();
        let database = directory.join("pharmacy.db");
        let connection = create_restore_fixture_database(&database, 8);
        drop(connection);

        let mut connection = Connection::open(&database).expect("reopen legacy supplier database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable foreign keys");
        migrate_connection(&mut connection).expect("apply supplier ledger migration");
        let balance_cents: i64 = connection
            .query_row(
                "SELECT CAST(ROUND(balance_due * 100) AS INTEGER) FROM suppliers WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read carried supplier balance");
        let ledger_balance_cents: i64 = connection
            .query_row(
                "SELECT COALESCE(SUM(debit_cents - credit_cents), 0)
                 FROM supplier_ledger WHERE supplier_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read migrated supplier ledger");
        let linked_purchase_rows: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM supplier_ledger
                 WHERE supplier_id = 1 AND purchase_id = 1 AND entry_type = 'PURCHASE'",
                [],
                |row| row.get(0),
            )
            .expect("count linked migrated purchases");
        assert_eq!(balance_cents, 1_250);
        assert_eq!(ledger_balance_cents, balance_cents);
        assert_eq!(linked_purchase_rows, 1);
        drop(connection);
        fs::remove_dir_all(directory).expect("remove supplier migration fixture");
    }

    #[test]
    fn complete_backup_restores_purchase_attachments_and_rejects_tampering() {
        use sha2::Digest as _;

        let directory = create_test_backup_directory();
        let source_directory = directory.join("source");
        fs::create_dir_all(&source_directory).expect("create purchase backup fixture");
        let source_database = source_directory.join("pharmacy.db");
        let source_connection = create_restore_fixture_database(&source_database, 9);
        let attachment_bytes = b"%PDF-1.7\noriginal-invoice";
        let attachment_ref = "purchase-1-12345.pdf";
        source_connection
            .execute(
                r#"INSERT INTO purchase_attachments
                   (purchase_id, file_ref, file_name, mime_type, size_bytes, sha256)
                   VALUES (1, ?1, 'supplier-invoice.pdf', 'application/pdf', ?2, ?3)"#,
                params![
                    attachment_ref,
                    attachment_bytes.len() as i64,
                    format!("{:x}", sha2::Sha256::digest(attachment_bytes)),
                ],
            )
            .expect("add attachment metadata");
        drop(source_connection);

        let source_photos = create_test_photo_directory(&source_directory, "medicine-photos");
        let photo_ref = "medicine-1-12345.jpg";
        set_test_photo_reference(&source_database, 1, photo_ref);
        let photo_bytes = test_jpeg(0x51);
        fs::write(source_photos.join(photo_ref), &photo_bytes)
            .expect("write source medicine photo");
        let source_attachments = source_directory.join("purchase-attachments");
        fs::create_dir_all(&source_attachments).expect("create purchase attachment storage");
        fs::write(
            source_attachments.join(attachment_ref),
            attachment_bytes,
        )
        .expect("write source invoice attachment");
        let source_backup = directory.join("with-purchase-attachment.zip");
        let summary = create_complete_backup_at(&source_database, &source_photos, &source_backup)
            .expect("create purchase attachment backup");
        assert_eq!(summary.attachment_count, 1);
        assert_eq!(summary.ignored_orphaned_attachment_count, 0);

        let corrupt_backup = directory.join("tampered-purchase-attachment.zip");
        let mut tampered_bytes = attachment_bytes.to_vec();
        *tampered_bytes.last_mut().expect("test PDF is not empty") ^= 1;
        rewrite_zip_entry(
            &source_backup,
            &corrupt_backup,
            &format!("purchase-attachments/{attachment_ref}"),
            Some(&tampered_bytes),
        );
        let invalid_stage_database = directory.join("invalid-stage.db");
        let invalid_stage_photos = directory.join("invalid-stage-photos");
        assert!(stage_complete_backup(
            &corrupt_backup,
            &invalid_stage_database,
            &invalid_stage_photos,
        )
        .is_err());
        assert!(!invalid_stage_database.exists());
        assert!(!invalid_stage_photos.exists());
        assert!(!staged_purchase_attachment_directory(&invalid_stage_photos)
            .expect("derive invalid attachment staging path")
            .exists());

        let active_directory = directory.join("active");
        fs::create_dir_all(&active_directory).expect("create active restore directory");
        let active_database = active_directory.join("pharmacy.db");
        let active_connection = create_restore_fixture_database(&active_database, 9);
        drop(active_connection);
        let active_photos = create_test_photo_directory(&active_directory, "medicine-photos");
        let restored = restore_database_backup_at(
            &active_database,
            &active_photos,
            &source_backup,
        )
        .expect("restore complete backup with purchase attachment");
        assert_eq!(restored.restored_attachment_count, 1);
        assert_eq!(restored.restored_photo_count, 1);
        assert_eq!(restored.ignored_orphaned_attachment_count, 0);
        assert_eq!(
            fs::read(active_photos.join(photo_ref)).expect("read restored medicine photo"),
            photo_bytes,
        );
        assert_eq!(
            fs::read(active_directory.join("purchase-attachments").join(attachment_ref))
                .expect("read restored purchase attachment"),
            attachment_bytes,
        );

        fs::remove_dir_all(directory).expect("remove purchase attachment backup fixture");
    }

    #[test]
    fn complete_backup_rejects_unsafe_photo_references() {
        let directory = create_test_backup_directory();
        let database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "photos");
        let backup = directory.join("unsafe-reference.zip");
        let connection = create_restore_fixture_database(&database, 8);
        drop(connection);
        set_test_photo_reference(&database, 1, "../../outside.jpg");

        let error = create_complete_backup_at(&database, &photo_directory, &backup)
            .expect_err("unsafe photo reference must stop backup creation");
        assert!(!error.is_empty());
        assert!(!backup.exists());
        fs::remove_dir_all(directory).expect("remove unsafe reference fixture");
    }

    #[test]
    fn complete_backup_reports_and_omits_unreferenced_photo_files() {
        let directory = create_test_backup_directory();
        let database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "photos");
        let backup = directory.join("orphan-check.zip");
        let photo_ref = "medicine-1-12345.jpg";
        let connection = create_restore_fixture_database(&database, 8);
        drop(connection);
        set_test_photo_reference(&database, 1, photo_ref);
        fs::write(photo_directory.join(photo_ref), test_jpeg(0x31))
            .expect("write referenced photo");
        fs::write(photo_directory.join("orphaned-photo.jpg"), test_jpeg(0x32))
            .expect("write orphan photo");

        let summary = create_complete_backup_at(&database, &photo_directory, &backup)
            .expect("create backup with orphan");
        assert_eq!(summary.photo_count, 1);
        assert_eq!(summary.ignored_orphaned_photo_count, 1);
        let mut archive = zip::ZipArchive::new(File::open(&backup).expect("open backup"))
            .expect("read backup archive");
        assert_eq!(archive.len(), 3);
        assert!(archive.by_name("photos/orphaned-photo.jpg").is_err());
        fs::remove_dir_all(directory).expect("remove orphan backup fixture");
    }

    #[test]
    fn backup_fails_explicitly_when_a_referenced_photo_is_missing_or_corrupt() {
        let directory = create_test_backup_directory();
        let database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "photos");
        let missing_backup = directory.join("missing-photo.zip");
        let corrupt_backup = directory.join("corrupt-photo.zip");
        let photo_ref = "medicine-1-12345.jpg";
        let connection = create_restore_fixture_database(&database, 8);
        drop(connection);
        set_test_photo_reference(&database, 1, photo_ref);

        let missing_error =
            create_complete_backup_at(&database, &photo_directory, &missing_backup)
                .expect_err("missing referenced photo must stop backup");
        assert!(missing_error.contains(photo_ref));
        assert!(!missing_backup.exists());

        fs::write(photo_directory.join(photo_ref), b"not a JPEG")
            .expect("write corrupt referenced photo");
        let corrupt_error =
            create_complete_backup_at(&database, &photo_directory, &corrupt_backup)
                .expect_err("corrupt referenced photo must stop backup");
        assert!(corrupt_error.contains("corrupt"));
        assert!(!corrupt_backup.exists());
        fs::remove_dir_all(directory).expect("remove invalid photo backup fixture");
    }

    #[test]
    fn missing_corrupt_or_invalid_complete_archives_do_not_replace_active_data() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("active.db");
        let source_database = directory.join("source.db");
        let active_photos = create_test_photo_directory(&directory, "active-photos");
        let source_photos = create_test_photo_directory(&directory, "source-photos");
        let source_backup = directory.join("source.zip");
        let photo_ref = "medicine-1-12345.jpg";

        let active_connection = create_restore_fixture_database(&active_database, 8);
        active_connection
            .execute(
                "UPDATE app_settings SET setting_value = 'Live Pharmacy'
                 WHERE setting_key = 'pharmacy_name'",
                [],
            )
            .expect("mark active data");
        drop(active_connection);
        let source_connection = create_restore_fixture_database(&source_database, 8);
        drop(source_connection);
        set_test_photo_reference(&source_database, 1, photo_ref);
        fs::write(source_photos.join(photo_ref), test_jpeg(0x41))
            .expect("write source referenced photo");
        fs::write(active_photos.join("local-sentinel.bin"), b"leave active photos alone")
            .expect("write active photo sentinel");
        create_complete_backup_at(&source_database, &source_photos, &source_backup)
            .expect("create source complete backup");

        let missing_photo_backup = directory.join("missing-photo-entry.zip");
        let corrupt_photo_backup = directory.join("corrupt-photo-entry.zip");
        let corrupt_database_backup = directory.join("corrupt-database-entry.zip");
        rewrite_zip_entry(
            &source_backup,
            &missing_photo_backup,
            &format!("photos/{photo_ref}"),
            None,
        );
        rewrite_zip_entry(
            &source_backup,
            &corrupt_photo_backup,
            &format!("photos/{photo_ref}"),
            Some(b"not a JPEG"),
        );
        rewrite_zip_entry(
            &source_backup,
            &corrupt_database_backup,
            "pharmacy.db",
            Some(b"not a SQLite database"),
        );

        for invalid_backup in [
            &missing_photo_backup,
            &corrupt_photo_backup,
            &corrupt_database_backup,
        ] {
            let error =
                restore_database_backup_at(&active_database, &active_photos, invalid_backup)
                    .expect_err("invalid complete archive must not install");
            assert!(!error.is_empty());
            let active_connection =
                Connection::open(&active_database).expect("reopen unchanged active database");
            let pharmacy_name: String = active_connection
                .query_row(
                    "SELECT setting_value FROM app_settings
                     WHERE setting_key = 'pharmacy_name'",
                    [],
                    |row| row.get(0),
                )
                .expect("read active pharmacy setting");
            assert_eq!(pharmacy_name, "Live Pharmacy");
            drop(active_connection);
            assert_eq!(
                fs::read(active_photos.join("local-sentinel.bin"))
                    .expect("read unchanged active photo sentinel"),
                b"leave active photos alone"
            );
            assert!(!directory.join("backups").exists());
        }
        fs::remove_dir_all(directory).expect("remove invalid complete archive fixture");
    }

    #[test]
    fn legacy_database_restore_uses_only_matching_local_photos() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("active.db");
        let source_database = directory.join("legacy-source.db");
        let legacy_backup = directory.join("legacy-backup.db");
        let active_photos = create_test_photo_directory(&directory, "active-photos");
        let photo_ref = "medicine-1-12345.jpg";
        let active_connection = create_restore_fixture_database(&active_database, 8);
        drop(active_connection);
        let source_connection = create_restore_fixture_database(&source_database, 8);
        drop(source_connection);
        set_test_photo_reference(&source_database, 1, photo_ref);
        create_snapshot(&source_database, &legacy_backup).expect("create legacy database backup");
        let local_photo = test_jpeg(0x51);
        fs::write(active_photos.join(photo_ref), &local_photo)
            .expect("write matching local medicine photo");

        let restore_result =
            restore_database_backup_at(&active_database, &active_photos, &legacy_backup)
                .expect("restore legacy database with locally available photo");
        assert_eq!(restore_result.source_format, "legacyDatabaseOnly");
        assert_eq!(restore_result.restored_photo_count, 1);
        assert_eq!(
            fs::read(active_photos.join(photo_ref)).expect("read preserved local photo"),
            local_photo
        );

        let active_connection = Connection::open(&active_database).expect("open restored database");
        active_connection
            .execute(
                "UPDATE app_settings SET setting_value = 'Keep Current Data'
                 WHERE setting_key = 'pharmacy_name'",
                [],
            )
            .expect("change active pharmacy name");
        drop(active_connection);
        fs::remove_file(active_photos.join(photo_ref)).expect("remove required local photo");
        let missing_photo_error =
            restore_database_backup_at(&active_database, &active_photos, &legacy_backup)
                .expect_err("legacy restore without required photo must stop");
        assert!(missing_photo_error.contains("legacy database-only backup"));
        let unchanged_connection =
            Connection::open(&active_database).expect("reopen unchanged database");
        let pharmacy_name: String = unchanged_connection
            .query_row(
                "SELECT setting_value FROM app_settings
                 WHERE setting_key = 'pharmacy_name'",
                [],
                |row| row.get(0),
            )
            .expect("read pharmacy name after rejected legacy restore");
        assert_eq!(pharmacy_name, "Keep Current Data");
        drop(unchanged_connection);
        fs::remove_dir_all(directory).expect("remove legacy restore fixture");
    }

    #[test]
    fn failed_database_install_rolls_back_a_prior_photo_directory_swap() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let active_photos = create_test_photo_directory(&directory, "medicine-photos");
        let staged_photos = create_test_photo_directory(&directory, "staged-photos");
        let staged_database = directory.join("failed-staged.db");
        let active_connection = create_restore_fixture_database(&active_database, 8);
        drop(active_connection);
        fs::write(active_photos.join("original.jpg"), test_jpeg(0x61))
            .expect("write original active photo");
        fs::write(staged_photos.join("replacement.jpg"), test_jpeg(0x62))
            .expect("write staged replacement photo");
        fs::write(&staged_database, b"invalid staged database")
            .expect("write invalid staged database");

        let photo_swap = install_staged_photo_directory(&active_photos, &staged_photos)
            .expect("install staged photo directory");
        assert!(active_photos.join("replacement.jpg").is_file());
        let database_error = install_staged_database(&active_database, &staged_database, |_| {
            Err("simulated database verification failure".to_owned())
        })
        .expect_err("database install should fail");
        assert!(database_error.contains("simulated database verification failure"));
        rollback_photo_directory_replacement(&photo_swap)
            .expect("restore original photo directory after database failure");

        assert!(active_photos.join("original.jpg").is_file());
        assert!(!active_photos.join("replacement.jpg").exists());
        let restored_connection =
            Connection::open(&active_database).expect("open rolled-back database");
        assert_restore_fixture(&restored_connection);
        drop(restored_connection);
        fs::remove_dir_all(directory).expect("remove restore rollback fixture");
    }

    #[test]
    fn restore_migrates_a_valid_older_backup_before_installing_it() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let older_database = directory.join("older-source.db");
        let older_backup = directory.join("older-backup.db");
        let active_connection = create_restore_fixture_database(&active_database, 8);
        drop(active_connection);
        let older_connection = create_restore_fixture_database(&older_database, 7);
        drop(older_connection);
        create_snapshot(&older_database, &older_backup).expect("snapshot version-seven database");
        validate_backup_database(&older_backup).expect("validate older compatible backup");

        restore_database_backup_without_photos(&active_database, &older_backup)
            .expect("restore and migrate older backup");

        let reopened_database =
            Connection::open(&active_database).expect("reopen migrated restored database");
        assert_restore_fixture(&reopened_database);
        let restored_version: i64 = reopened_database
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("read migrated schema version");
        let adjustment_snapshot: (Option<i64>, Option<i64>) = reopened_database
            .query_row(
                "SELECT previous_quantity, new_quantity FROM stock_adjustments WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read migrated adjustment snapshot columns");
        assert_eq!(restored_version, LATEST_DATABASE_VERSION);
        assert_eq!(adjustment_snapshot, (None, None));
        drop(reopened_database);
        fs::remove_dir_all(directory).expect("remove isolated legacy restore database");
    }

    #[test]
    fn restore_migrates_version_ten_backup_and_seeds_expense_categories() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let source_database = directory.join("version-ten-source.db");
        let source_backup = directory.join("version-ten-backup.db");
        let active_connection = create_restore_fixture_database(&active_database, 10);
        drop(active_connection);
        let source_connection = create_restore_fixture_database(&source_database, 10);
        drop(source_connection);
        create_snapshot(&source_database, &source_backup).expect("snapshot version-ten database");
        validate_backup_database(&source_backup).expect("validate pre-expense backup");

        restore_database_backup_without_photos(&active_database, &source_backup)
            .expect("restore and migrate version-ten backup");

        let reopened_database =
            Connection::open(&active_database).expect("reopen migrated expense database");
        let restored_version: i64 = reopened_database
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .expect("read migrated schema version");
        let seeded_categories: i64 = reopened_database
            .query_row(
                "SELECT COUNT(*) FROM expense_categories",
                [],
                |row| row.get(0),
            )
            .expect("count seeded expense categories");
        let restored_expenses: i64 = reopened_database
            .query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
            .expect("count migrated expenses");
        assert_eq!(restored_version, LATEST_DATABASE_VERSION);
        assert_eq!(seeded_categories, 8);
        assert_eq!(restored_expenses, 0);
        drop(reopened_database);
        fs::remove_dir_all(directory).expect("remove version-ten restore fixture");
    }

    #[test]
    fn invalid_corrupt_and_incompatible_backups_leave_the_active_database_unchanged() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let future_backup = directory.join("future-backup.db");
        let incomplete_backup = directory.join("incomplete-backup.db");
        let corrupt_backup = directory.join("corrupt-backup.db");
        let active_connection = create_restore_fixture_database(&active_database, 8);
        drop(active_connection);

        let future_connection =
            create_restore_fixture_database(&future_backup, LATEST_DATABASE_VERSION);
        drop(future_connection);
        let future_connection =
            Connection::open(&future_backup).expect("open future-schema fixture");
        future_connection
            .execute(
                "INSERT INTO schema_migrations (version) VALUES (?1)",
                [LATEST_DATABASE_VERSION + 1],
            )
            .expect("mark fixture as a future schema");
        drop(future_connection);

        let incomplete_connection = create_restore_fixture_database(&incomplete_backup, 7);
        drop(incomplete_connection);
        let incomplete_connection =
            Connection::open(&incomplete_backup).expect("open incomplete-schema fixture");
        incomplete_connection
            .execute("INSERT INTO schema_migrations (version) VALUES (8)", [])
            .expect("mark incomplete fixture as version eight");
        drop(incomplete_connection);
        fs::write(&corrupt_backup, b"not a SQLite database").expect("create corrupt backup file");

        let corrupt_error =
            restore_database_backup_without_photos(&active_database, &corrupt_backup)
                .unwrap_err();
        let future_error =
            restore_database_backup_without_photos(&active_database, &future_backup)
                .unwrap_err();
        let incomplete_error =
            restore_database_backup_without_photos(&active_database, &incomplete_backup)
                .unwrap_err();
        assert!(!corrupt_error.is_empty());
        assert!(
            future_error.contains("newer MY MEDICAL database version"),
            "unexpected future-schema restore error: {future_error}"
        );
        assert!(incomplete_error.contains("stock_adjustments.previous_quantity"));
        assert!(!directory.join("backups").exists());

        let active_connection =
            Connection::open(&active_database).expect("reopen unchanged database");
        let active_medicine_name: String = active_connection
            .query_row("SELECT name FROM medicines WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read unchanged active medicine");
        assert_eq!(active_medicine_name, "Backup Medicine");
        drop(active_connection);
        fs::remove_dir_all(directory).expect("remove isolated validation database");
    }

    #[test]
    fn restore_stops_without_replacing_data_when_safety_backup_creation_fails() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let source_database = directory.join("source.db");
        let source_backup = directory.join("source-backup.db");
        let active_connection = create_restore_fixture_database(&active_database, 8);
        drop(active_connection);
        let source_connection = create_restore_fixture_database(&source_database, 8);
        drop(source_connection);
        create_snapshot(&source_database, &source_backup).expect("create selected backup");
        fs::write(directory.join("backups"), b"blocking file")
            .expect("block safety backup directory creation");

        let error = restore_database_backup_without_photos(&active_database, &source_backup)
            .expect_err("restore must stop when it cannot create a safety backup");
        assert!(error.contains("safety backup could not be created"));
        let active_connection = Connection::open(&active_database).expect("reopen active database");
        let active_medicine_name: String = active_connection
            .query_row("SELECT name FROM medicines WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read active medicine after failed restore");
        assert_eq!(active_medicine_name, "Backup Medicine");
        drop(active_connection);
        assert!(fs::read_dir(&directory)
            .expect("read staging directory")
            .all(|entry| !entry
                .expect("read staging entry")
                .file_name()
                .to_string_lossy()
                .starts_with("restore-stage-")));
        fs::remove_dir_all(directory).expect("remove isolated safety-backup failure database");
    }

    #[test]
    fn failed_restore_installation_rolls_back_to_the_original_database() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let incoming_source = directory.join("incoming-source.db");
        let staged_database = directory.join("restore-stage-test.db");
        let active_connection = create_restore_fixture_database(&active_database, 8);
        drop(active_connection);
        let incoming_connection = create_restore_fixture_database(&incoming_source, 8);
        incoming_connection
            .execute(
                "UPDATE app_settings SET setting_value = 'Replacement Pharmacy'
                 WHERE setting_key = 'pharmacy_name'",
                [],
            )
            .expect("change incoming fixture");
        drop(incoming_connection);
        create_snapshot(&incoming_source, &staged_database).expect("stage replacement database");

        let error = install_staged_database(&active_database, &staged_database, |_| {
            Err("simulated reopen failure".to_owned())
        })
        .expect_err("installation check should fail");
        assert!(error.contains("simulated reopen failure"));
        assert!(error.contains("The original database was restored."));
        assert!(!staged_database.exists());

        let reopened_database =
            Connection::open(&active_database).expect("reopen rolled-back database");
        let pharmacy_name: String = reopened_database
            .query_row(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'pharmacy_name'",
                [],
                |row| row.get(0),
            )
            .expect("read original pharmacy setting");
        assert_eq!(pharmacy_name, "Backup Pharmacy");
        drop(reopened_database);
        fs::remove_dir_all(directory).expect("remove isolated rollback database");
    }

    #[test]
    fn automatic_close_backup_is_valid_and_contains_current_pharmacy_data() {
        let directory = create_test_backup_directory();
        let active_database = directory.join("pharmacy.db");
        let photo_directory = create_test_photo_directory(&directory, "active-photos");
        let connection = create_restore_fixture_database(&active_database, 8);
        drop(connection);

        let backup_path = create_automatic_close_backup_at(&active_database, &photo_directory)
            .expect("create close-time automatic backup")
            .expect("active database should produce a backup");
        assert_eq!(backup_path.extension().and_then(|value| value.to_str()), Some("zip"));
        assert!(automatic_backup_marker_path(&backup_path).is_file());
        let staged_database = directory.join("automatic-stage.db");
        let staged_photos = directory.join("automatic-stage-photos");
        stage_complete_backup(&backup_path, &staged_database, &staged_photos)
            .expect("validate and extract automatic backup");
        let backup = Connection::open(&staged_database).expect("open automatic backup");
        assert_restore_fixture(&backup);
        drop(backup);
        assert_eq!(
            count_automatic_backups(backup_path.parent().expect("backup directory")),
            1
        );

        fs::remove_dir_all(directory).expect("remove isolated automatic backup database");
    }
}

#[cfg(test)]
mod business_history_tests {
    use super::*;

    fn create_business_database(directory: &Path) -> (PathBuf, Connection) {
        fs::create_dir_all(directory).expect("create temporary database directory");
        let database_path = directory.join("pharmacy.db");
        let mut connection = Connection::open(&database_path).expect("open temporary database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .expect("configure temporary database");
        migrate_connection(&mut connection).expect("migrate temporary database");
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name, min_stock_alert)
                VALUES (1, 'Reset test medicine', 2);
                INSERT INTO medicine_batches (
                    id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock
                ) VALUES (1, 1, 'B-1', '2099-12-31', 4, 8, 7, 9);
                INSERT INTO suppliers (
                    id, name, contact_person, phone, whatsapp_phone, address, notes, balance_due
                ) VALUES (1, 'Reset test supplier', 'Contact One', '12345',
                          '919876543210', 'Local Road', 'Keep for later', 40);
                INSERT INTO purchases (id, invoice_no, supplier_id, total_amount, purchase_date)
                VALUES (1, 'P-RESET-1', 1, 8, '2026-03-02');
                INSERT INTO purchase_items (id, purchase_id, batch_id, quantity, rate, total)
                VALUES (1, 1, 1, 2, 4, 8);
                INSERT INTO sales (id, invoice_no, subtotal, grand_total, created_at)
                VALUES (1, 'S-RESET-1', 7, 7, '2026-03-02 12:00:00');
                INSERT INTO sale_items (id, sale_id, batch_id, quantity, unit_price, total_price)
                VALUES (1, 1, 1, 1, 7, 7);
                INSERT INTO stock_adjustments (id, medicine_id, batch_id, quantity_change, reason)
                VALUES (1, 1, 1, 1, 'Count correction');
                INSERT INTO order_list_items (
                    id, order_date, medicine_id, supplier_id, quantity, note
                ) VALUES (1, '2026-03-02', 1, 1, 5, 'Restock');
                INSERT INTO app_settings (setting_key, setting_value)
                VALUES ('pharmacy_name', 'Reset Test Pharmacy');
                "#,
            )
            .expect("seed isolated local database");
        (database_path, connection)
    }

    fn count(connection: &Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count isolated database rows")
    }

    fn stock(connection: &Connection) -> i64 {
        connection
            .query_row(
                "SELECT current_stock FROM medicine_batches WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read preserved stock")
    }

    #[test]
    fn order_list_mutations_create_update_order_delete_and_clear_by_date() {
        let mut connection = Connection::open_in_memory().expect("open order-list test database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable test foreign keys");
        migrate_connection(&mut connection).expect("migrate order-list test database");
        connection
            .execute(
                "INSERT INTO medicines (id, name) VALUES (1, 'Order test')",
                [],
            )
            .expect("insert medicine");
        connection
            .execute(
                "INSERT INTO suppliers (id, name) VALUES (1, 'Supplier')",
                [],
            )
            .expect("insert supplier");

        let created = apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::SaveItem {
                id: None,
                medicine_id: 1,
                supplier_id: Some(1),
                quantity: 4,
                note: Some("First note".to_owned()),
                order_date: "2026-03-02".to_owned(),
            },
        )
        .expect("create order-list item");
        let item_id = created.item_id.expect("created order-list id");
        apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::SaveItem {
                id: Some(item_id),
                medicine_id: 1,
                supplier_id: Some(1),
                quantity: 7,
                note: Some("Updated note".to_owned()),
                order_date: "2026-03-02".to_owned(),
            },
        )
        .expect("update order-list item");
        apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::SetOrdered {
                item_id,
                ordered: true,
            },
        )
        .expect("mark order item ordered");

        let updated: (i64, i64, String) = connection
            .query_row(
                "SELECT quantity, ordered, note FROM order_list_items WHERE id = ?1",
                [item_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read updated order item");
        assert_eq!(updated, (7, 1, "Updated note".to_owned()));
        let purchase_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM purchases", [], |row| row.get(0))
            .expect("confirm preparing an order does not create a purchase invoice");
        assert_eq!(purchase_count, 0);

        let invalid = apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::SaveItem {
                id: None,
                medicine_id: 1,
                supplier_id: None,
                quantity: 2,
                note: None,
                order_date: "2026-02-30".to_owned(),
            },
        );
        assert!(invalid.is_err());
        assert_eq!(count(&connection, "order_list_items"), 1);

        let deleted = apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::DeleteItem { item_id },
        )
        .expect("delete order-list item");
        assert_eq!(deleted.rows_affected, 1);
        assert_eq!(count(&connection, "order_list_items"), 0);

        apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::SaveItem {
                id: None,
                medicine_id: 1,
                supplier_id: Some(1),
                quantity: 2,
                note: None,
                order_date: "2026-03-02".to_owned(),
            },
        )
        .expect("create item for date clear");
        let cleared = apply_order_list_mutation_to_connection(
            &mut connection,
            OrderListMutation::ClearDate {
                order_date: "2026-03-02".to_owned(),
            },
        )
        .expect("clear order list date");
        assert_eq!(cleared.rows_affected, 1);
        assert_eq!(count(&connection, "order_list_items"), 0);
    }

    #[test]
    fn deleting_supplier_unassigns_but_keeps_purchase_and_order_history() {
        let directory =
            unique_internal_path(&std::env::temp_dir(), "pharmacy-supplier-delete", "dir");
        let (_database_path, mut connection) = create_business_database(&directory);
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::DeleteSupplier { supplier_id: 1 },
        )
        .expect("delete supplier");

        assert_eq!(count(&connection, "suppliers"), 0);
        assert_eq!(count(&connection, "purchases"), 1);
        let purchase_supplier: Option<i64> = connection
            .query_row(
                "SELECT supplier_id FROM purchases WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read preserved purchase link");
        assert_eq!(purchase_supplier, None);
        let order_supplier: Option<i64> = connection
            .query_row(
                "SELECT supplier_id FROM order_list_items WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read cleared order-list supplier link");
        assert_eq!(order_supplier, None);
        drop(connection);
        fs::remove_dir_all(directory).expect("remove isolated database");
    }

    #[test]
    fn reset_stops_before_deleting_any_data_when_backup_creation_fails() {
        let directory =
            unique_internal_path(&std::env::temp_dir(), "pharmacy-reset-failure", "dir");
        let (_database_path, mut connection) = create_business_database(&directory);
        let result = reset_business_data_with_backup(
            &mut connection,
            DataResetScope::AllBusinessHistory,
            || Err("simulated backup failure".to_owned()),
        );
        assert!(result.unwrap_err().contains("simulated backup failure"));
        assert_eq!(count(&connection, "sales"), 1);
        assert_eq!(count(&connection, "purchases"), 1);
        assert_eq!(count(&connection, "order_list_items"), 1);
        assert_eq!(stock(&connection), 9);
        drop(connection);
        fs::remove_dir_all(directory).expect("remove isolated database");
    }

    #[test]
    fn reset_rolls_back_prior_deletions_when_a_later_step_fails() {
        let directory = unique_internal_path(&std::env::temp_dir(), "pharmacy-reset-rollback", "dir");
        let (_database_path, mut connection) = create_business_database(&directory);
        connection
            .execute_batch(
                r#"CREATE TRIGGER reject_supplier_balance_reset
                   BEFORE UPDATE OF balance_due ON suppliers
                   BEGIN
                     SELECT RAISE(ABORT, 'simulated reset failure');
                   END;"#,
            )
            .expect("add isolated failure trigger");

        let result = reset_business_data_with_backup(
            &mut connection,
            DataResetScope::AllBusinessHistory,
            || Ok("validated test backup".to_owned()),
        );

        assert!(result.unwrap_err().contains("simulated reset failure"));
        assert_eq!(count(&connection, "sales"), 1);
        assert_eq!(count(&connection, "sale_items"), 1);
        assert_eq!(count(&connection, "purchases"), 1);
        assert_eq!(count(&connection, "purchase_items"), 1);
        assert_eq!(count(&connection, "stock_adjustments"), 1);
        assert_eq!(count(&connection, "order_list_items"), 1);
        assert_eq!(stock(&connection), 9);
        let supplier_balance: f64 = connection
            .query_row(
                "SELECT balance_due FROM suppliers WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read unchanged supplier balance");
        assert_eq!(supplier_balance, 40.0);
        drop(connection);
        fs::remove_dir_all(directory).expect("remove isolated database");
    }

    #[test]
    fn sales_reset_keeps_purchase_history_stock_and_master_records() {
        let directory = unique_internal_path(&std::env::temp_dir(), "pharmacy-reset-sales", "dir");
        let (_database_path, mut connection) = create_business_database(&directory);
        let summary =
            reset_business_data_with_backup(&mut connection, DataResetScope::SalesHistory, || {
                Ok("validated test backup".to_owned())
            })
            .expect("reset sales history");

        assert_eq!(summary.sales_deleted, 1);
        assert_eq!(summary.sale_items_deleted, 1);
        assert!(summary.stock_quantities_preserved);
        assert_eq!(count(&connection, "sales"), 0);
        assert_eq!(count(&connection, "sale_items"), 0);
        assert_eq!(count(&connection, "purchases"), 1);
        assert_eq!(count(&connection, "purchase_items"), 1);
        assert_eq!(count(&connection, "stock_adjustments"), 1);
        assert_eq!(count(&connection, "order_list_items"), 1);
        assert_eq!(count(&connection, "medicines"), 1);
        assert_eq!(count(&connection, "suppliers"), 1);
        assert_eq!(stock(&connection), 9);
        drop(connection);
        fs::remove_dir_all(directory).expect("remove isolated database");
    }

    #[test]
    fn all_history_reset_keeps_a_valid_pre_reset_backup_and_preserves_stock() {
        let directory = unique_internal_path(&std::env::temp_dir(), "pharmacy-reset-backup", "dir");
        let (database_path, mut connection) = create_business_database(&directory);
        let photo_directory = directory.join("medicine-photos");
        fs::create_dir_all(&photo_directory).expect("create reset medicine photo directory");
        let photo_ref = "medicine-1-987654321.jpg";
        connection
            .execute(
                "UPDATE medicines SET photo_ref = ?1 WHERE id = 1",
                [photo_ref],
            )
            .expect("set reset fixture photo reference");
        let photo_bytes = vec![0xff, 0xd8, 0xff, 0xe0, 0x44, 0xff, 0xd9];
        fs::write(photo_directory.join(photo_ref), &photo_bytes)
            .expect("write reset fixture photo");
        let backup_path = directory.join("pre-reset.zip");
        let backup_path_for_closure = backup_path.clone();
        let source_path_for_closure = database_path.clone();
        let photo_directory_for_closure = photo_directory.clone();

        let summary = reset_business_data_with_backup(
            &mut connection,
            DataResetScope::AllBusinessHistory,
            move || {
                create_complete_backup_at(
                    &source_path_for_closure,
                    &photo_directory_for_closure,
                    &backup_path_for_closure,
                )?;
                Ok(backup_path_for_closure.display().to_string())
            },
        )
        .expect("create backup and reset all business history");

        assert_eq!(summary.sales_deleted, 1);
        assert_eq!(summary.sale_items_deleted, 1);
        assert_eq!(summary.purchases_deleted, 1);
        assert_eq!(summary.purchase_items_deleted, 1);
        assert_eq!(summary.stock_adjustments_deleted, 1);
        assert_eq!(summary.order_list_items_deleted, 1);
        assert_eq!(summary.supplier_balances_reset, 1);
        assert!(summary.stock_quantities_preserved);
        assert_eq!(count(&connection, "sales"), 0);
        assert_eq!(count(&connection, "purchases"), 0);
        assert_eq!(count(&connection, "stock_adjustments"), 0);
        assert_eq!(count(&connection, "order_list_items"), 0);
        assert_eq!(count(&connection, "medicines"), 1);
        assert_eq!(count(&connection, "suppliers"), 1);
        assert_eq!(stock(&connection), 9);
        let supplier_balance: f64 = connection
            .query_row(
                "SELECT balance_due FROM suppliers WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read reset supplier balance");
        assert_eq!(supplier_balance, 0.0);
        let setting: String = connection
            .query_row(
                "SELECT setting_value FROM app_settings WHERE setting_key = 'pharmacy_name'",
                [],
                |row| row.get(0),
            )
            .expect("read preserved app setting");
        assert_eq!(setting, "Reset Test Pharmacy");
        drop(connection);

        let staged_database = directory.join("pre-reset-stage.db");
        let staged_photos = directory.join("pre-reset-stage-photos");
        stage_complete_backup(&backup_path, &staged_database, &staged_photos)
            .expect("validate retained pre-reset complete backup");
        let backup = Connection::open_with_flags(&staged_database, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .expect("open retained backup");
        assert_eq!(count(&backup, "sales"), 1);
        assert_eq!(count(&backup, "purchases"), 1);
        assert_eq!(count(&backup, "order_list_items"), 1);
        assert_eq!(stock(&backup), 9);
        drop(backup);
        assert_eq!(
            fs::read(staged_photos.join(photo_ref)).expect("read retained reset photo"),
            photo_bytes
        );
        fs::remove_dir_all(directory).expect("remove isolated database");
    }
}

#[cfg(test)]
mod gst_calculation_tests {
    use super::{calculate_gst_amounts, resolve_gst_rate};

    #[test]
    fn gst_rate_resolution_prefers_pos_override_then_product_then_default() {
        assert_eq!(
            resolve_gst_rate(true, Some(1_200), Some(500), Some(900)).unwrap(),
            1_200
        );
        assert_eq!(
            resolve_gst_rate(true, None, Some(500), Some(900)).unwrap(),
            500
        );
        assert_eq!(
            resolve_gst_rate(true, None, None, Some(900)).unwrap(),
            900
        );
        assert_eq!(resolve_gst_rate(false, None, None, None).unwrap(), 0);
        assert!(resolve_gst_rate(true, None, None, None).is_err());
    }

    #[test]
    fn inclusive_gst_is_extracted_from_the_listed_price_in_cents() {
        let amounts =
            calculate_gst_amounts(10_500, 500, "INCLUSIVE", false, true).unwrap();
        assert_eq!(amounts.taxable_cents, 10_000);
        assert_eq!(amounts.total_gst_cents, 500);
        assert_eq!(amounts.cgst_cents, 250);
        assert_eq!(amounts.sgst_cents, 250);
        assert_eq!(amounts.igst_cents, 0);
    }

    #[test]
    fn exclusive_local_gst_splits_to_cgst_and_sgst() {
        let amounts =
            calculate_gst_amounts(10_000, 500, "EXCLUSIVE", false, true).unwrap();
        assert_eq!(amounts.taxable_cents, 10_000);
        assert_eq!(amounts.total_gst_cents, 500);
        assert_eq!(amounts.cgst_cents, 250);
        assert_eq!(amounts.sgst_cents, 250);
        assert_eq!(amounts.igst_cents, 0);
    }

    #[test]
    fn interstate_gst_is_recorded_as_igst_only() {
        let amounts =
            calculate_gst_amounts(10_000, 250, "EXCLUSIVE", true, true).unwrap();
        assert_eq!(amounts.taxable_cents, 10_000);
        assert_eq!(amounts.total_gst_cents, 250);
        assert_eq!(amounts.cgst_cents, 0);
        assert_eq!(amounts.sgst_cents, 0);
        assert_eq!(amounts.igst_cents, 250);
    }
}

#[cfg(test)]
mod gst_checkout_tests {
    use super::*;

    fn gst_connection(
        product_rate_basis_points: Option<i64>,
        default_rate_basis_points: i64,
    ) -> Connection {
        let mut connection = Connection::open_in_memory().expect("open GST checkout database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable GST checkout foreign keys");
        migrate_connection(&mut connection).expect("migrate GST checkout database");
        connection
            .execute(
                "INSERT INTO medicines (id, name, gst_rate_basis_points) VALUES (1, 'GST test medicine', ?1)",
                [product_rate_basis_points],
            )
            .expect("create GST test medicine");
        apply_pharmacy_mutation_to_connection(
            &mut connection,
            PharmacyMutation::SaveSettings {
                settings: StoreSettingsMutation {
                    pharmacy_name: "GST Test Pharmacy".to_owned(),
                    address: String::new(),
                    contact_number: String::new(),
                    drug_license_number: String::new(),
                    receipt_footer_note: String::new(),
                    upi_id: String::new(),
                    upi_display_name: String::new(),
                    gst_enabled: true,
                    gst_default_rate_basis_points: Some(default_rate_basis_points),
                    gst_pricing_mode: "EXCLUSIVE".to_owned(),
                    gst_pharmacy_state_code: "29".to_owned(),
                },
            },
        )
        .expect("save GST settings");
        connection
    }

    fn create_customer(connection: &mut Connection, state_code: &str) -> i64 {
        apply_pharmacy_mutation_to_connection(
            connection,
            PharmacyMutation::CreateCustomer {
                name: "GST Test Customer".to_owned(),
                phone: None,
                address: None,
                notes: None,
                state_code: Some(state_code.to_owned()),
            },
        )
        .expect("create GST test customer")
        .expect("customer id")
    }

    fn add_batch(connection: &Connection, batch_id: i64, sale_rate: f64) {
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     id, medicine_id, batch_no, expiry_date, purchase_rate,
                     mrp, sale_rate, current_stock
                   ) VALUES (
                     ?1, 1, ?2, date('now', 'localtime', '+365 days'), 50,
                     ?3, ?3, 10
                   )"#,
                params![batch_id, format!("GST-{batch_id}"), sale_rate],
            )
            .expect("create GST sale batch");
    }

    fn sale_request(
        customer_id: i64,
        batch_id: i64,
        payment_mode: &str,
        pricing_mode: &str,
        unit_price_cents: i64,
        upi_transaction_id: Option<&str>,
    ) -> SaleCheckoutRequest {
        SaleCheckoutRequest {
            customer_id: Some(customer_id),
            customer_name: None,
            customer_phone: None,
            payment_mode: payment_mode.to_owned(),
            flat_discount_cents: 0,
            cash_tendered_cents: 0,
            gst_pricing_mode: Some(pricing_mode.to_owned()),
            upi_transaction_id: upi_transaction_id.map(str::to_owned),
            items: vec![SaleCheckoutItem {
                medicine_id: 1,
                batch_id,
                quantity: 1,
                unit_price_cents,
                item_discount_cents: 0,
                gst_rate_override_basis_points: None,
            }],
        }
    }

    #[test]
    fn sale_snapshots_product_rate_interstate_tax_and_unverified_upi() {
        let mut connection = gst_connection(Some(500), 1_200);
        let customer_id = create_customer(&mut connection, "07");
        add_batch(&connection, 301, 105.0);

        complete_sale_in_connection(
            &mut connection,
            sale_request(
                customer_id,
                301,
                "UPI",
                "INCLUSIVE",
                10_500,
                Some("UPI-TEST-301"),
            ),
        )
        .expect("complete interstate UPI sale");

        let sale: (
            i64,
            String,
            Option<String>,
            Option<String>,
            String,
            f64,
            f64,
            f64,
            f64,
            f64,
            i64,
            Option<String>,
        ) = connection
            .query_row(
                r#"SELECT gst_enabled, tax_type, customer_state_code,
                          place_of_supply_state_code, gst_pricing_mode,
                          taxable_amount, cgst_amount, sgst_amount,
                          igst_amount, grand_total, upi_payment_verified,
                          upi_transaction_id
                   FROM sales ORDER BY id DESC LIMIT 1"#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                    ))
                },
            )
            .expect("read saved GST sale");
        assert_eq!(sale.0, 1);
        assert_eq!(sale.1, "IGST");
        assert_eq!(sale.2.as_deref(), Some("07"));
        assert_eq!(sale.3.as_deref(), Some("07"));
        assert_eq!(sale.4, "INCLUSIVE");
        assert_eq!(sale.5, 100.0);
        assert_eq!(sale.6, 0.0);
        assert_eq!(sale.7, 0.0);
        assert_eq!(sale.8, 5.0);
        assert_eq!(sale.9, 105.0);
        assert_eq!(sale.10, 0);
        assert_eq!(sale.11.as_deref(), Some("UPI-TEST-301"));

        let line: (i64, f64, f64) = connection
            .query_row(
                "SELECT gst_rate_basis_points, taxable_amount, igst_amount FROM sale_items",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read saved GST sale line");
        assert_eq!(line, (500, 100.0, 5.0));
    }

    #[test]
    fn pos_gst_override_is_invoice_scoped_and_historical_rates_stay_fixed() {
        let mut connection = gst_connection(Some(500), 1_200);
        let customer_id = create_customer(&mut connection, "29");
        add_batch(&connection, 303, 100.0);

        let mut first_request =
            sale_request(customer_id, 303, "CARD", "EXCLUSIVE", 10_000, None);
        first_request.items[0].gst_rate_override_basis_points = Some(1_200);
        let first = complete_sale_in_connection(&mut connection, first_request)
            .expect("complete sale with POS-only GST override");

        let product_rate: i64 = connection
            .query_row(
                "SELECT gst_rate_basis_points FROM medicines WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read unchanged medicine GST rate");
        assert_eq!(product_rate, 500);

        connection
            .execute(
                "UPDATE medicines SET gst_rate_basis_points = 1800 WHERE id = 1",
                [],
            )
            .expect("change medicine GST rate for later sale");
        let second = complete_sale_in_connection(
            &mut connection,
            sale_request(customer_id, 303, "CARD", "EXCLUSIVE", 10_000, None),
        )
        .expect("complete later sale using current medicine GST rate");

        let first_snapshot: (i64, i64) = connection
            .query_row(
                r#"SELECT gst_rate_basis_points,
                          CAST(round(grand_total * 100) AS INTEGER)
                   FROM sale_items JOIN sales ON sales.id = sale_items.sale_id
                   WHERE sales.id = ?1"#,
                [first.sale_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read first sale GST snapshot");
        let second_snapshot: (i64, i64) = connection
            .query_row(
                r#"SELECT gst_rate_basis_points,
                          CAST(round(grand_total * 100) AS INTEGER)
                   FROM sale_items JOIN sales ON sales.id = sale_items.sale_id
                   WHERE sales.id = ?1"#,
                [second.sale_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read later sale GST snapshot");

        assert_eq!(first_snapshot, (1_200, 11_200));
        assert_eq!(second_snapshot, (1_800, 11_800));
    }

    #[test]
    fn credit_sale_records_local_ledger_and_collection_reduces_balance() {
        let mut connection = gst_connection(None, 500);
        let customer_id = create_customer(&mut connection, "29");
        add_batch(&connection, 302, 100.0);

        complete_sale_in_connection(
            &mut connection,
            sale_request(customer_id, 302, "CREDIT", "EXCLUSIVE", 10_000, None),
        )
        .expect("complete customer credit sale");

        let sale: (String, f64, f64, f64, f64) = connection
            .query_row(
                r#"SELECT tax_type, cgst_amount, sgst_amount, igst_amount, grand_total
                   FROM sales ORDER BY id DESC LIMIT 1"#,
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("read local credit sale");
        assert_eq!(sale, ("CGST_SGST".to_owned(), 2.5, 2.5, 0.0, 105.0));

        let before_collection: (i64, i64, i64) = connection
            .query_row(
                r#"SELECT COALESCE(SUM(debit_cents), 0),
                          COALESCE(SUM(credit_cents), 0), COUNT(*)
                   FROM customer_ledger WHERE customer_id = ?1"#,
                [customer_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read customer credit ledger");
        assert_eq!(before_collection, (10_500, 0, 1));

        let collection = collect_customer_payment_in_connection(
            &mut connection,
            CustomerPaymentRequest {
                customer_id,
                amount_cents: 5_000,
                payment_mode: "BANK".to_owned(),
                payment_reference: Some("COLLECT-BANK-REF".to_owned()),
                upi_transaction_id: None,
                note: Some("Part payment".to_owned()),
            },
        )
        .expect("record customer collection");
        assert_eq!(collection.balance_due_cents, 5_500);

        let after_collection: (i64, i64, i64) = connection
            .query_row(
                r#"SELECT COALESCE(SUM(debit_cents), 0),
                          COALESCE(SUM(credit_cents), 0), COUNT(*)
                   FROM customer_ledger WHERE customer_id = ?1"#,
                [customer_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read collected customer balance");
        assert_eq!(after_collection, (10_500, 5_000, 2));
        let collection_payment: (String, Option<String>) = connection
            .query_row(
                "SELECT payment_mode, payment_reference FROM customer_ledger
                 WHERE customer_id = ?1 ORDER BY id DESC LIMIT 1",
                [customer_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read saved customer collection payment");
        assert_eq!(
            collection_payment,
            ("BANK".to_owned(), Some("COLLECT-BANK-REF".to_owned()))
        );
    }

    #[test]
    fn sale_returns_restore_only_returned_units_and_reject_over_return_atomically() {
        let mut connection = gst_connection(None, 500);
        let customer_id = create_customer(&mut connection, "29");
        add_batch(&connection, 401, 10.0);
        let mut sale_request = sale_request(customer_id, 401, "CASH", "EXCLUSIVE", 1_000, None);
        sale_request.items[0].quantity = 2;
        sale_request.cash_tendered_cents = 4_000;
        complete_sale_in_connection(&mut connection, sale_request)
            .expect("complete sale for return test");
        let (sale_id, invoice_no): (i64, String) = connection
            .query_row(
                "SELECT id, invoice_no FROM sales ORDER BY id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read return test invoice");
        let sale_item_id: i64 = connection
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = ?1",
                [sale_id],
                |row| row.get(0),
            )
            .expect("read return test line");

        let first_return = create_sale_return_in_connection(
            &mut connection,
            SaleReturnRequest {
                invoice_no: invoice_no.clone(),
                items: vec![SaleReturnItemRequest {
                    sale_item_id,
                    quantity: 1,
                }],
                refund_mode: "CASH".to_owned(),
                payment_reference: None,
                upi_transaction_id: None,
                note: Some("One unit returned".to_owned()),
            },
        )
        .expect("record first partial return");
        assert!(first_return.total_cents > 0);
        let (status, stock): (String, i64) = connection
            .query_row(
                r#"SELECT sales.status,
                          (SELECT current_stock FROM medicine_batches WHERE id = 401)
                   FROM sales WHERE sales.id = ?1"#,
                [sale_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read partial-return state");
        assert_eq!(status, "PARTIALLY_RETURNED");
        assert_eq!(stock, 9);

        let failed_over_return = create_sale_return_in_connection(
            &mut connection,
            SaleReturnRequest {
                invoice_no: invoice_no.clone(),
                items: vec![SaleReturnItemRequest {
                    sale_item_id,
                    quantity: 2,
                }],
                refund_mode: "CASH".to_owned(),
                payment_reference: None,
                upi_transaction_id: None,
                note: None,
            },
        );
        assert!(failed_over_return.is_err());
        let stock_after_rejection: i64 = connection
            .query_row(
                "SELECT current_stock FROM medicine_batches WHERE id = 401",
                [],
                |row| row.get(0),
            )
            .expect("read stock after rejected return");
        assert_eq!(stock_after_rejection, 9);

        create_sale_return_in_connection(
            &mut connection,
            SaleReturnRequest {
                invoice_no,
                items: vec![SaleReturnItemRequest {
                    sale_item_id,
                    quantity: 1,
                }],
                refund_mode: "CASH".to_owned(),
                payment_reference: None,
                upi_transaction_id: None,
                note: None,
            },
        )
        .expect("return final remaining unit");
        let (final_status, final_stock): (String, i64) = connection
            .query_row(
                r#"SELECT sales.status,
                          (SELECT current_stock FROM medicine_batches WHERE id = 401)
                   FROM sales WHERE sales.id = ?1"#,
                [sale_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read fully returned invoice");
        assert_eq!(final_status, "RETURNED");
        assert_eq!(final_stock, 10);
    }

    #[test]
    fn invoice_correction_keeps_cost_snapshot_and_records_audit_before_correction() {
        let mut connection = gst_connection(None, 500);
        let customer_id = create_customer(&mut connection, "29");
        add_batch(&connection, 402, 100.0);
        let mut sale_request = sale_request(customer_id, 402, "CASH", "EXCLUSIVE", 10_000, None);
        sale_request.cash_tendered_cents = 40_000;
        complete_sale_in_connection(&mut connection, sale_request)
            .expect("complete sale for correction test");
        let (sale_id, invoice_no): (i64, String) = connection
            .query_row(
                "SELECT id, invoice_no FROM sales ORDER BY id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read correction test invoice");
        let sale_item_id: i64 = connection
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = ?1",
                [sale_id],
                |row| row.get(0),
            )
            .expect("read correction test line");

        let result = correct_sale_in_connection(
            &mut connection,
            SaleCorrectionRequest {
                invoice_no,
                customer_id: Some(customer_id),
                customer_name: None,
                customer_phone: None,
                payment_mode: "CASH".to_owned(),
                cash_tendered_cents: Some(40_000),
                payment_reference: None,
                upi_transaction_id: None,
                adjustment_mode: Some("CASH".to_owned()),
                adjustment_reference: Some("REFUND-402".to_owned()),
                adjustment_upi_transaction_id: None,
                notes: Some("Corrected unit price".to_owned()),
                reason: Some("Price entered incorrectly".to_owned()),
                items: vec![SaleCorrectionItemRequest {
                    sale_item_id,
                    quantity: 1,
                    unit_price_cents: 9_500,
                }],
            },
        )
        .expect("correct invoice unit price");
        assert_eq!(result.sale_id, sale_id);
        let (
            unit_price_cents,
            cost_snapshot,
            updated_total,
            audit_count,
            before_json,
            after_json,
            reference,
            note,
        ): (
            i64,
            f64,
            i64,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                r#"SELECT CAST(ROUND(si.unit_price * 100) AS INTEGER), si.purchase_rate_at_sale,
                          CAST(ROUND(s.grand_total * 100) AS INTEGER),
                          (SELECT COUNT(*) FROM sale_corrections WHERE sale_id = s.id),
                          (SELECT before_json FROM sale_corrections WHERE sale_id = s.id),
                          (SELECT after_json FROM sale_corrections WHERE sale_id = s.id),
                          (SELECT adjustment_reference FROM sale_corrections WHERE sale_id = s.id),
                          (SELECT note FROM sale_corrections WHERE sale_id = s.id)
                   FROM sales AS s
                   INNER JOIN sale_items AS si ON si.sale_id = s.id
                   WHERE s.id = ?1"#,
                [sale_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                    ))
                },
            )
            .expect("read corrected invoice and audit");
        assert_eq!(unit_price_cents, 9_500);
        assert_eq!(cost_snapshot, 50.0);
        assert_eq!(result.grand_total_cents, updated_total);
        assert_eq!(unit_price_cents, 9_500);
        assert_eq!(audit_count, 1);
        assert_ne!(before_json, after_json);
        assert_eq!(reference.as_deref(), Some("REFUND-402"));
        assert_eq!(note.as_deref(), Some("Price entered incorrectly"));
    }

    #[test]
    fn cancelling_an_invoice_restores_stock_and_is_not_repeatable() {
        let mut connection = gst_connection(None, 500);
        let customer_id = create_customer(&mut connection, "29");
        add_batch(&connection, 403, 100.0);
        let mut sale_request = sale_request(customer_id, 403, "CASH", "EXCLUSIVE", 10_000, None);
        sale_request.cash_tendered_cents = 40_000;
        complete_sale_in_connection(&mut connection, sale_request)
            .expect("complete sale for cancellation test");
        let (sale_id, invoice_no, grand_total): (i64, String, i64) = connection
            .query_row(
                "SELECT id, invoice_no, CAST(ROUND(grand_total * 100) AS INTEGER)
                 FROM sales ORDER BY id DESC LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read cancellation test invoice");
        let result = cancel_sale_in_connection(
            &mut connection,
            SaleVoidRequest {
                invoice_no: invoice_no.clone(),
                refund_mode: "CASH".to_owned(),
                payment_reference: Some("CANCEL-403".to_owned()),
                upi_transaction_id: None,
                note: Some("Duplicate invoice".to_owned()),
            },
        )
        .expect("cancel invoice");
        assert_eq!(result.sale_id, sale_id);
        assert_eq!(result.refund_cents, grand_total);
        let (status, stock, refund, reference): (String, i64, i64, Option<String>) = connection
            .query_row(
                r#"SELECT s.status,
                          (SELECT current_stock FROM medicine_batches WHERE id = 403),
                          v.refund_cents, v.payment_reference
                   FROM sales AS s INNER JOIN sale_voids AS v ON v.sale_id = s.id
                   WHERE s.id = ?1"#,
                [sale_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("read cancelled invoice and refund");
        assert_eq!(status, "CANCELLED");
        assert_eq!(stock, 10);
        assert_eq!(refund, grand_total);
        assert_eq!(reference.as_deref(), Some("CANCEL-403"));
        assert!(cancel_sale_in_connection(
            &mut connection,
            SaleVoidRequest {
                invoice_no,
                refund_mode: "CASH".to_owned(),
                payment_reference: None,
                upi_transaction_id: None,
                note: None,
            },
        )
        .is_err());
    }
}
