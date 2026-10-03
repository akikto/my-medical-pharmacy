use rusqlite::{params, Connection, OptionalExtension, Params, Row};
use serde::Serialize;
use tauri::AppHandle;

use crate::{open_pharmacy_connection, validate_iso_date};

#[derive(Debug, Serialize)]
pub(crate) struct MedicineInventoryRecord {
    id: i64,
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
    created_at: String,
    available_stock: f64,
    expired_stock: f64,
    near_expiry_stock: f64,
    batch_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct MedicineBatchRecord {
    id: i64,
    medicine_id: i64,
    batch_no: String,
    expiry_date: String,
    purchase_rate: f64,
    mrp: f64,
    sale_rate: f64,
    current_stock: i64,
    barcode: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct MedicineSearchRecord {
    id: i64,
    name: String,
    generic_name: Option<String>,
    company: Option<String>,
    product_type: Option<String>,
    strength: Option<String>,
    composition: Option<String>,
    medicine_barcode: Option<String>,
    uses: Option<String>,
    adult_dose: Option<String>,
    child_dose: Option<String>,
    photo_ref: Option<String>,
    rack_location: Option<String>,
    min_stock_alert: i64,
    gst_rate_basis_points: Option<i64>,
    created_at: String,
    available_stock: f64,
    exact_barcode_match: bool,
    batch_id: Option<i64>,
    batch_medicine_id: Option<i64>,
    batch_no: Option<String>,
    expiry_date: Option<String>,
    purchase_rate: Option<f64>,
    mrp: Option<f64>,
    sale_rate: Option<f64>,
    current_stock: Option<i64>,
    barcode: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct LowStockAlertRecord {
    medicine_id: i64,
    name: String,
    generic_name: Option<String>,
    company: Option<String>,
    rack_location: Option<String>,
    min_stock_alert: i64,
    available_stock: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct ExpiryAlertRecord {
    id: i64,
    medicine_id: i64,
    batch_no: String,
    expiry_date: String,
    purchase_rate: f64,
    mrp: f64,
    sale_rate: f64,
    current_stock: i64,
    barcode: Option<String>,
    medicine_name: String,
    days_until_expiry: i64,
    status: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct SupplierRecord {
    id: i64,
    name: String,
    contact_person: Option<String>,
    phone: Option<String>,
    whatsapp_phone: Option<String>,
    address: Option<String>,
    notes: Option<String>,
    state_code: Option<String>,
    balance_due: f64,
}

#[derive(Debug, Serialize)]
pub(crate) struct OrderListRecord {
    id: i64,
    medicine_id: i64,
    medicine_name: String,
    generic_name: Option<String>,
    company: Option<String>,
    supplier_id: Option<i64>,
    supplier_name: Option<String>,
    quantity: i64,
    note: Option<String>,
    ordered: bool,
    order_date: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct WeeklySalesDayRecord {
    sale_date: String,
    total_sales: f64,
    invoice_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct StoreSettingRecord {
    setting_key: String,
    setting_value: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct RecentPurchaseRecord {
    id: i64,
    invoice_no: String,
    supplier_id: Option<i64>,
    supplier_name: Option<String>,
    total_amount: f64,
    purchase_date: String,
    item_count: i64,
    total_units: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct PurchaseHistoryRecord {
    id: i64,
    invoice_no: String,
    supplier_id: Option<i64>,
    supplier_name: Option<String>,
    total_amount: f64,
    purchase_date: String,
    total_gst: f64,
    status: String,
    supplier_balance_due: f64,
    item_count: i64,
    total_units: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct PurchaseLineDetailRecord {
    id: i64,
    medicine_id: i64,
    medicine_name: String,
    batch_id: i64,
    batch_no: String,
    expiry_date: String,
    quantity: i64,
    returned_quantity: i64,
    available_quantity: i64,
    rate: f64,
    total: f64,
    gst_rate_basis_points: i64,
    total_gst: f64,
}

#[derive(Debug, Serialize)]
pub(crate) struct PurchaseAttachmentRecord {
    id: i64,
    file_name: String,
    mime_type: String,
    size_bytes: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct PurchaseDetailsRecord {
    id: i64,
    invoice_no: String,
    supplier_id: Option<i64>,
    supplier_name: Option<String>,
    purchase_date: String,
    total_amount: f64,
    status: String,
    gst_enabled: bool,
    gst_pricing_mode: String,
    tax_type: String,
    place_of_supply_state_code: Option<String>,
    taxable_amount: f64,
    cgst_amount: f64,
    sgst_amount: f64,
    igst_amount: f64,
    total_gst: f64,
    lines: Vec<PurchaseLineDetailRecord>,
    attachments: Vec<PurchaseAttachmentRecord>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SupplierLedgerEntryRecord {
    id: i64,
    entry_type: String,
    reference: Option<String>,
    debit: f64,
    credit: f64,
    payment_method: Option<String>,
    transaction_reference: Option<String>,
    note: Option<String>,
    created_at: String,
    running_balance: f64,
}

#[derive(Debug, Serialize)]
pub(crate) struct SupplierLedgerRecord {
    opening_balance: f64,
    current_balance: f64,
    entries: Vec<SupplierLedgerEntryRecord>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SaleRecord {
    id: i64,
    invoice_no: String,
    customer_id: Option<i64>,
    customer_name: Option<String>,
    customer_phone: Option<String>,
    customer_state_code: Option<String>,
    place_of_supply_state_code: Option<String>,
    subtotal: f64,
    discount: f64,
    flat_discount: f64,
    grand_total: f64,
    payment_mode: String,
    cash_tendered: f64,
    change_due: f64,
    upi_transaction_id: Option<String>,
    upi_payment_verified: bool,
    gst_enabled: bool,
    gst_pricing_mode: String,
    tax_type: String,
    taxable_amount: f64,
    cgst_amount: f64,
    sgst_amount: f64,
    igst_amount: f64,
    total_gst: f64,
    created_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct RecentSaleRecord {
    id: i64,
    invoice_no: String,
    customer_name: Option<String>,
    customer_phone: Option<String>,
    subtotal: f64,
    discount: f64,
    flat_discount: f64,
    grand_total: f64,
    payment_mode: String,
    cash_tendered: f64,
    change_due: f64,
    created_at: String,
    item_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct SaleItemDetailRecord {
    id: i64,
    sale_id: i64,
    batch_id: i64,
    quantity: i64,
    unit_price: f64,
    item_discount: f64,
    total_price: f64,
    gst_rate_basis_points: i64,
    taxable_amount: f64,
    cgst_amount: f64,
    sgst_amount: f64,
    igst_amount: f64,
    total_gst: f64,
    medicine_name: String,
    generic_name: Option<String>,
    batch_no: String,
    expiry_date: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CustomerRecord {
    id: i64,
    name: String,
    phone: Option<String>,
    address: Option<String>,
    notes: Option<String>,
    state_code: Option<String>,
    active: bool,
    credit_total: f64,
    amount_paid: f64,
    balance_due: f64,
    created_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct CustomerLedgerEntryRecord {
    id: i64,
    customer_id: i64,
    entry_type: String,
    invoice_no: Option<String>,
    debit: f64,
    credit: f64,
    payment_mode: Option<String>,
    upi_transaction_id: Option<String>,
    note: Option<String>,
    created_at: String,
    running_balance: f64,
}

#[derive(Debug, Serialize)]
pub(crate) struct SaleDetailsRecord {
    sale: SaleRecord,
    items: Vec<SaleItemDetailRecord>,
}

#[derive(Debug, Serialize)]
pub(crate) struct SalesReportSummaryRecord {
    total_revenue: f64,
    gross_profit: f64,
    total_invoices: i64,
    cash_revenue: f64,
    cash_invoices: i64,
    card_upi_revenue: f64,
    card_upi_invoices: i64,
    other_revenue: f64,
    other_invoices: i64,
    profit_unavailable_invoices: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct SalesReportRowRecord {
    id: i64,
    invoice_no: String,
    customer_name: Option<String>,
    payment_mode: String,
    grand_total: f64,
    created_at: String,
}

#[derive(Debug, Serialize)]
pub(crate) struct DashboardInventorySummaryRecord {
    total_medicines: i64,
    stock_value_at_cost: f64,
    in_stock_medicines: i64,
    low_stock_medicines: i64,
    out_of_stock_medicines: i64,
    total_suppliers: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct DashboardPurchaseSummaryRecord {
    total_amount: f64,
    invoice_count: i64,
}

#[derive(Debug, Serialize)]
pub(crate) struct TopSellingMedicineRecord {
    medicine_id: i64,
    name: String,
    quantity_sold: i64,
    line_sales_before_invoice_discount: f64,
}

#[derive(Debug, Serialize)]
pub(crate) struct MedicineOrderUsageRecord {
    medicine_id: i64,
    sold_units_30_days: i64,
    sales_days_30_days: i64,
}

#[cfg(debug_assertions)]
#[derive(Debug, Serialize)]
pub(crate) struct DevelopmentDatabaseCounts {
    medicines: i64,
    medicine_batches: i64,
    suppliers: i64,
    purchases: i64,
    purchase_items: i64,
    sales: i64,
    sale_items: i64,
    stock_adjustments: i64,
    order_list_items: i64,
    app_settings: i64,
}

fn query_rows<T, P, F>(
    connection: &Connection,
    query: &str,
    parameters: P,
    map_row: F,
) -> Result<Vec<T>, String>
where
    P: Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let mut statement = connection
        .prepare(query)
        .map_err(|error| format!("Could not prepare a local database read: {error}"))?;
    let rows = statement
        .query_map(parameters, map_row)
        .map_err(|error| format!("Could not run a local database read: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read local database results: {error}"))
}

fn contains_pattern(term: &str) -> Option<String> {
    if term.is_empty() {
        return None;
    }

    let escaped = term
        .chars()
        .flat_map(|character| match character {
            '!' => vec!['!', '!'],
            '%' => vec!['!', '%'],
            '_' => vec!['!', '_'],
            _ => vec![character],
        })
        .collect::<String>();
    Some(format!("%{escaped}%"))
}

fn query_inventory_medicines(
    connection: &Connection,
    search_term: &str,
) -> Result<Vec<MedicineInventoryRecord>, String> {
    let pattern = contains_pattern(search_term);
    query_rows(
        connection,
        r#"SELECT
             m.id,
             m.name,
             m.generic_name,
             m.company,
             m.product_type,
             m.strength,
             m.composition,
             m.barcode,
             m.uses,
             m.adult_dose,
             m.child_dose,
             m.photo_ref,
             m.rack_location,
             m.min_stock_alert,
             m.gst_rate_basis_points,
             m.created_at,
             COALESCE(SUM(CASE
               WHEN b.expiry_date >= date('now', 'localtime')
               THEN b.current_stock ELSE 0 END), 0) AS available_stock,
             COALESCE(SUM(CASE
               WHEN b.expiry_date < date('now', 'localtime')
               THEN b.current_stock ELSE 0 END), 0) AS expired_stock,
             COALESCE(SUM(CASE
               WHEN b.expiry_date >= date('now', 'localtime')
                AND b.expiry_date <= date('now', 'localtime', '+30 days')
               THEN b.current_stock ELSE 0 END), 0) AS near_expiry_stock,
             COUNT(b.id) AS batch_count
           FROM medicines AS m
           LEFT JOIN medicine_batches AS b ON b.medicine_id = m.id
           WHERE ?1 IS NULL
              OR m.name LIKE ?1 ESCAPE '!'
              OR COALESCE(m.generic_name, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.company, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.rack_location, '') LIKE ?1 ESCAPE '!'
           GROUP BY m.id
           ORDER BY m.name COLLATE NOCASE ASC, m.id ASC"#,
        [pattern],
        |row| {
            Ok(MedicineInventoryRecord {
                id: row.get("id")?,
                name: row.get("name")?,
                generic_name: row.get("generic_name")?,
                company: row.get("company")?,
                product_type: row.get("product_type")?,
                strength: row.get("strength")?,
                composition: row.get("composition")?,
                barcode: row.get("barcode")?,
                uses: row.get("uses")?,
                adult_dose: row.get("adult_dose")?,
                child_dose: row.get("child_dose")?,
                photo_ref: row.get("photo_ref")?,
                rack_location: row.get("rack_location")?,
                min_stock_alert: row.get("min_stock_alert")?,
                gst_rate_basis_points: row.get("gst_rate_basis_points")?,
                created_at: row.get("created_at")?,
                available_stock: row.get("available_stock")?,
                expired_stock: row.get("expired_stock")?,
                near_expiry_stock: row.get("near_expiry_stock")?,
                batch_count: row.get("batch_count")?,
            })
        },
    )
}

fn query_medicine_batches(
    connection: &Connection,
    medicine_id: i64,
) -> Result<Vec<MedicineBatchRecord>, String> {
    query_rows(
        connection,
        r#"SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                  sale_rate, current_stock, barcode
           FROM medicine_batches
           WHERE medicine_id = ?1
           ORDER BY expiry_date ASC, batch_no COLLATE NOCASE ASC, id ASC"#,
        [medicine_id],
        map_batch,
    )
}

fn map_batch(row: &Row<'_>) -> rusqlite::Result<MedicineBatchRecord> {
    Ok(MedicineBatchRecord {
        id: row.get("id")?,
        medicine_id: row.get("medicine_id")?,
        batch_no: row.get("batch_no")?,
        expiry_date: row.get("expiry_date")?,
        purchase_rate: row.get("purchase_rate")?,
        mrp: row.get("mrp")?,
        sale_rate: row.get("sale_rate")?,
        current_stock: row.get("current_stock")?,
        barcode: row.get("barcode")?,
    })
}

fn query_medicine_search(
    connection: &Connection,
    search_term: &str,
    limit: i64,
) -> Result<Vec<MedicineSearchRecord>, String> {
    let pattern = contains_pattern(search_term);
    query_rows(
        connection,
        r#"SELECT
             m.id,
             m.name,
             m.generic_name,
             m.company,
             m.product_type,
             m.strength,
             m.composition,
             m.barcode AS medicine_barcode,
             m.uses,
             m.adult_dose,
             m.child_dose,
             m.photo_ref,
             m.rack_location,
             m.min_stock_alert,
             m.gst_rate_basis_points,
             m.created_at,
             COALESCE((
               SELECT SUM(stock_batch.current_stock)
               FROM medicine_batches AS stock_batch
               WHERE stock_batch.medicine_id = m.id
                 AND stock_batch.expiry_date >= date('now', 'localtime')
             ), 0) AS available_stock,
              CASE WHEN UPPER(TRIM(COALESCE(m.barcode, ''))) = ?2
                       OR EXISTS (
                         SELECT 1 FROM medicine_batches AS exact_batch
                         WHERE exact_batch.medicine_id = m.id
                           AND UPPER(TRIM(COALESCE(exact_batch.barcode, ''))) = ?2
                       )
                   THEN 1 ELSE 0 END AS exact_barcode_match,
             b.id AS batch_id,
             b.medicine_id AS batch_medicine_id,
             b.batch_no,
             b.expiry_date,
             b.purchase_rate,
             b.mrp,
             b.sale_rate,
             b.current_stock,
             b.barcode
           FROM medicines AS m
           LEFT JOIN medicine_batches AS b
             ON b.id = (
               SELECT candidate.id
               FROM medicine_batches AS candidate
               WHERE candidate.medicine_id = m.id
                 AND candidate.current_stock > 0
                 AND candidate.expiry_date >= date('now', 'localtime')
                ORDER BY candidate.expiry_date ASC,
                 candidate.id ASC
               LIMIT 1
             )
           WHERE m.name LIKE ?1 ESCAPE '!'
              OR COALESCE(m.generic_name, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.company, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.product_type, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.strength, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.composition, '') LIKE ?1 ESCAPE '!'
               OR UPPER(TRIM(COALESCE(m.barcode, ''))) = ?2
               OR COALESCE(m.barcode, '') LIKE ?1 ESCAPE '!'
              OR EXISTS (
                SELECT 1 FROM medicine_batches AS barcode_batch
                WHERE barcode_batch.medicine_id = m.id
                  AND (
                    UPPER(TRIM(COALESCE(barcode_batch.barcode, ''))) = ?2
                    OR barcode_batch.barcode LIKE ?1 ESCAPE '!'
                  )
              )
           ORDER BY
             CASE WHEN EXISTS (
               SELECT 1 FROM medicine_batches AS exact_barcode
               WHERE exact_barcode.medicine_id = m.id
                  AND UPPER(TRIM(COALESCE(exact_barcode.barcode, ''))) = ?2
              ) THEN 0
              WHEN UPPER(TRIM(COALESCE(m.barcode, ''))) = ?2 THEN 1
              ELSE 2 END,
             m.name COLLATE NOCASE ASC,
             m.id ASC
           LIMIT ?3"#,
        params![pattern, search_term.trim().to_uppercase(), limit],
        |row| {
            Ok(MedicineSearchRecord {
                id: row.get("id")?,
                name: row.get("name")?,
                generic_name: row.get("generic_name")?,
                company: row.get("company")?,
                product_type: row.get("product_type")?,
                strength: row.get("strength")?,
                composition: row.get("composition")?,
                medicine_barcode: row.get("medicine_barcode")?,
                uses: row.get("uses")?,
                adult_dose: row.get("adult_dose")?,
                child_dose: row.get("child_dose")?,
                photo_ref: row.get("photo_ref")?,
                rack_location: row.get("rack_location")?,
                min_stock_alert: row.get("min_stock_alert")?,
                gst_rate_basis_points: row.get("gst_rate_basis_points")?,
                created_at: row.get("created_at")?,
                available_stock: row.get("available_stock")?,
                exact_barcode_match: row.get("exact_barcode_match")?,
                batch_id: row.get("batch_id")?,
                batch_medicine_id: row.get("batch_medicine_id")?,
                batch_no: row.get("batch_no")?,
                expiry_date: row.get("expiry_date")?,
                purchase_rate: row.get("purchase_rate")?,
                mrp: row.get("mrp")?,
                sale_rate: row.get("sale_rate")?,
                current_stock: row.get("current_stock")?,
                barcode: row.get("barcode")?,
            })
        },
    )
}

fn query_sellable_batches(
    connection: &Connection,
    medicine_id: i64,
    limit_one: bool,
) -> Result<Vec<MedicineBatchRecord>, String> {
    let query = if limit_one {
        r#"SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                  sale_rate, current_stock, barcode
           FROM medicine_batches
           WHERE medicine_id = ?1
             AND current_stock > 0
             AND expiry_date >= date('now', 'localtime')
           ORDER BY expiry_date ASC, id ASC
           LIMIT 1"#
    } else {
        r#"SELECT id, medicine_id, batch_no, expiry_date, purchase_rate, mrp,
                  sale_rate, current_stock, barcode
           FROM medicine_batches
           WHERE medicine_id = ?1
             AND current_stock > 0
             AND expiry_date >= date('now', 'localtime')
           ORDER BY expiry_date ASC, id ASC"#
    };
    query_rows(connection, query, [medicine_id], map_batch)
}

fn query_low_stock_alerts(connection: &Connection) -> Result<Vec<LowStockAlertRecord>, String> {
    query_rows(
        connection,
        r#"SELECT
             m.id AS medicine_id,
             m.name,
             m.generic_name,
             m.company,
             m.rack_location,
             m.min_stock_alert,
             COALESCE(SUM(b.current_stock), 0) AS available_stock
           FROM medicines AS m
           LEFT JOIN medicine_batches AS b
             ON b.medicine_id = m.id
             AND b.expiry_date >= date('now', 'localtime')
           GROUP BY m.id
           HAVING COALESCE(SUM(b.current_stock), 0) <= m.min_stock_alert
           ORDER BY available_stock ASC, m.name COLLATE NOCASE ASC"#,
        [],
        |row| {
            Ok(LowStockAlertRecord {
                medicine_id: row.get("medicine_id")?,
                name: row.get("name")?,
                generic_name: row.get("generic_name")?,
                company: row.get("company")?,
                rack_location: row.get("rack_location")?,
                min_stock_alert: row.get("min_stock_alert")?,
                available_stock: row.get("available_stock")?,
            })
        },
    )
}

fn query_expiry_alerts(
    connection: &Connection,
    horizon_days: i64,
) -> Result<Vec<ExpiryAlertRecord>, String> {
    let modifier = format!("+{horizon_days} days");
    query_rows(
        connection,
        r#"SELECT
             b.id,
             b.medicine_id,
             b.batch_no,
             b.expiry_date,
             b.purchase_rate,
             b.mrp,
             b.sale_rate,
             b.current_stock,
             b.barcode,
             m.name AS medicine_name,
             CAST(julianday(b.expiry_date) - julianday(date('now', 'localtime')) AS INTEGER)
               AS days_until_expiry,
             CASE
               WHEN b.expiry_date < date('now', 'localtime') THEN 'expired'
               ELSE 'expiring'
             END AS status
           FROM medicine_batches AS b
           INNER JOIN medicines AS m ON m.id = b.medicine_id
           WHERE b.current_stock > 0
             AND b.expiry_date <= date('now', 'localtime', ?1)
           ORDER BY b.expiry_date ASC, m.name COLLATE NOCASE ASC, b.id ASC"#,
        [modifier],
        |row| {
            Ok(ExpiryAlertRecord {
                id: row.get("id")?,
                medicine_id: row.get("medicine_id")?,
                batch_no: row.get("batch_no")?,
                expiry_date: row.get("expiry_date")?,
                purchase_rate: row.get("purchase_rate")?,
                mrp: row.get("mrp")?,
                sale_rate: row.get("sale_rate")?,
                current_stock: row.get("current_stock")?,
                barcode: row.get("barcode")?,
                medicine_name: row.get("medicine_name")?,
                days_until_expiry: row.get("days_until_expiry")?,
                status: row.get("status")?,
            })
        },
    )
}

fn query_suppliers(
    connection: &Connection,
    search_term: &str,
) -> Result<Vec<SupplierRecord>, String> {
    let pattern = contains_pattern(search_term);
    query_rows(
        connection,
        r#"SELECT
             id, name, contact_person, phone, whatsapp_phone, address, notes, state_code, balance_due
           FROM suppliers
           WHERE ?1 IS NULL
              OR name LIKE ?1 ESCAPE '!'
              OR COALESCE(contact_person, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(phone, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(whatsapp_phone, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(address, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(notes, '') LIKE ?1 ESCAPE '!'
           ORDER BY name COLLATE NOCASE ASC, id ASC"#,
        [pattern],
        |row| {
            Ok(SupplierRecord {
                id: row.get("id")?,
                name: row.get("name")?,
                contact_person: row.get("contact_person")?,
                phone: row.get("phone")?,
                whatsapp_phone: row.get("whatsapp_phone")?,
                address: row.get("address")?,
                notes: row.get("notes")?,
                state_code: row.get("state_code")?,
                balance_due: row.get("balance_due")?,
            })
        },
    )
}

fn query_customers(
    connection: &Connection,
    search_term: &str,
    include_inactive: bool,
) -> Result<Vec<CustomerRecord>, String> {
    let pattern = contains_pattern(search_term);
    let phone_digits = search_term
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
    let phone_pattern = (!phone_digits.is_empty()).then(|| format!("%{phone_digits}%"));
    query_rows(
        connection,
        r#"SELECT
             c.id,
             c.name,
             c.phone,
             c.address,
             c.notes,
             c.state_code,
             c.active,
             COALESCE(SUM(l.debit_cents), 0) / 100.0 AS credit_total,
             COALESCE(SUM(l.credit_cents), 0) / 100.0 AS amount_paid,
             COALESCE(SUM(l.debit_cents - l.credit_cents), 0) / 100.0 AS balance_due,
             c.created_at
           FROM customers AS c
           LEFT JOIN customer_ledger AS l ON l.customer_id = c.id
           WHERE (?2 = 1 OR c.active = 1)
             AND (
               ?1 IS NULL
               OR c.name LIKE ?1 ESCAPE '!'
               OR COALESCE(c.phone, '') LIKE ?1 ESCAPE '!'
               OR COALESCE(c.address, '') LIKE ?1 ESCAPE '!'
               OR COALESCE(c.notes, '') LIKE ?1 ESCAPE '!'
               OR (?3 IS NOT NULL AND c.phone_normalized LIKE ?3 ESCAPE '!')
             )
           GROUP BY c.id
           ORDER BY c.active DESC, c.name COLLATE NOCASE ASC, c.id ASC"#,
        params![pattern, include_inactive, phone_pattern],
        |row| {
            Ok(CustomerRecord {
                id: row.get("id")?,
                name: row.get("name")?,
                phone: row.get("phone")?,
                address: row.get("address")?,
                notes: row.get("notes")?,
                state_code: row.get("state_code")?,
                active: row.get("active")?,
                credit_total: row.get("credit_total")?,
                amount_paid: row.get("amount_paid")?,
                balance_due: row.get("balance_due")?,
                created_at: row.get("created_at")?,
            })
        },
    )
}

fn query_customer_ledger(
    connection: &Connection,
    customer_id: i64,
) -> Result<Vec<CustomerLedgerEntryRecord>, String> {
    if customer_id <= 0 {
        return Err("Customer id must be a positive whole number.".to_owned());
    }
    let rows = query_rows(
        connection,
        r#"SELECT id, customer_id, entry_type, invoice_no, debit_cents, credit_cents,
                  payment_mode, upi_transaction_id, note, created_at
           FROM customer_ledger
           WHERE customer_id = ?1
           ORDER BY created_at ASC, id ASC"#,
        [customer_id],
        |row| {
            Ok((
                row.get::<_, i64>("id")?,
                row.get::<_, i64>("customer_id")?,
                row.get::<_, String>("entry_type")?,
                row.get::<_, Option<String>>("invoice_no")?,
                row.get::<_, i64>("debit_cents")?,
                row.get::<_, i64>("credit_cents")?,
                row.get::<_, Option<String>>("payment_mode")?,
                row.get::<_, Option<String>>("upi_transaction_id")?,
                row.get::<_, Option<String>>("note")?,
                row.get::<_, String>("created_at")?,
            ))
        },
    )?;
    let mut balance_cents = 0_i64;
    Ok(rows
        .into_iter()
        .map(
            |(
                id,
                customer_id,
                entry_type,
                invoice_no,
                debit_cents,
                credit_cents,
                payment_mode,
                upi_transaction_id,
                note,
                created_at,
            )| {
                balance_cents += debit_cents - credit_cents;
                CustomerLedgerEntryRecord {
                    id,
                    customer_id,
                    entry_type,
                    invoice_no,
                    debit: debit_cents as f64 / 100.0,
                    credit: credit_cents as f64 / 100.0,
                    payment_mode,
                    upi_transaction_id,
                    note,
                    created_at,
                    running_balance: balance_cents as f64 / 100.0,
                }
            },
        )
        .collect())
}

fn query_order_list(
    connection: &Connection,
    order_date: &str,
) -> Result<Vec<OrderListRecord>, String> {
    validate_iso_date(connection, order_date, "Order date")?;
    query_rows(
        connection,
        r#"SELECT
             item.id,
             item.medicine_id,
             medicine.name AS medicine_name,
             medicine.generic_name,
             medicine.company,
             item.supplier_id,
             supplier.name AS supplier_name,
             item.quantity,
             item.note,
             item.ordered,
             item.order_date
           FROM order_list_items AS item
           INNER JOIN medicines AS medicine ON medicine.id = item.medicine_id
           LEFT JOIN suppliers AS supplier ON supplier.id = item.supplier_id
           WHERE item.order_date = ?1
           ORDER BY item.ordered ASC, medicine.name COLLATE NOCASE ASC, item.id ASC"#,
        [order_date],
        |row| {
            Ok(OrderListRecord {
                id: row.get("id")?,
                medicine_id: row.get("medicine_id")?,
                medicine_name: row.get("medicine_name")?,
                generic_name: row.get("generic_name")?,
                company: row.get("company")?,
                supplier_id: row.get("supplier_id")?,
                supplier_name: row.get("supplier_name")?,
                quantity: row.get("quantity")?,
                note: row.get("note")?,
                ordered: row.get::<_, i64>("ordered")? != 0,
                order_date: row.get("order_date")?,
            })
        },
    )
}

fn query_store_settings(connection: &Connection) -> Result<Vec<StoreSettingRecord>, String> {
    query_rows(
        connection,
        "SELECT setting_key, setting_value FROM app_settings",
        [],
        |row| {
            Ok(StoreSettingRecord {
                setting_key: row.get("setting_key")?,
                setting_value: row.get("setting_value")?,
            })
        },
    )
}

fn query_recent_purchases(
    connection: &Connection,
    limit: i64,
) -> Result<Vec<RecentPurchaseRecord>, String> {
    query_rows(
        connection,
        r#"SELECT
             p.id,
             p.invoice_no,
             p.supplier_id,
             s.name AS supplier_name,
             p.total_amount,
             p.purchase_date,
             COUNT(pi.id) AS item_count,
             COALESCE(SUM(pi.quantity), 0) AS total_units
           FROM purchases AS p
           LEFT JOIN suppliers AS s ON s.id = p.supplier_id
           LEFT JOIN purchase_items AS pi ON pi.purchase_id = p.id
           GROUP BY p.id
           ORDER BY p.purchase_date DESC, p.id DESC
           LIMIT ?1"#,
        [limit],
        |row| {
            Ok(RecentPurchaseRecord {
                id: row.get("id")?,
                invoice_no: row.get("invoice_no")?,
                supplier_id: row.get("supplier_id")?,
                supplier_name: row.get("supplier_name")?,
                total_amount: row.get("total_amount")?,
                purchase_date: row.get("purchase_date")?,
                item_count: row.get("item_count")?,
                total_units: row.get("total_units")?,
            })
        },
    )
}

fn query_purchase_history(
    connection: &Connection,
    search_term: &str,
    supplier_id: Option<i64>,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<Vec<PurchaseHistoryRecord>, String> {
    let pattern = contains_pattern(search_term);
    query_rows(
        connection,
        r#"SELECT p.id, p.invoice_no, p.supplier_id, s.name AS supplier_name,
                  p.total_amount, p.purchase_date, p.total_gst, p.status,
                  COALESCE(s.balance_due, 0) AS supplier_balance_due,
                  COUNT(pi.id) AS item_count, COALESCE(SUM(pi.quantity), 0) AS total_units
           FROM purchases p
           LEFT JOIN suppliers s ON s.id = p.supplier_id
           LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
           WHERE (?1 IS NULL OR p.invoice_no LIKE ?1 ESCAPE '!' OR COALESCE(s.name, '') LIKE ?1 ESCAPE '!')
             AND (?2 IS NULL OR p.supplier_id = ?2)
             AND (?3 IS NULL OR p.purchase_date >= ?3)
             AND (?4 IS NULL OR p.purchase_date <= ?4)
           GROUP BY p.id
           ORDER BY p.purchase_date DESC, p.id DESC"#,
        params![pattern, supplier_id, from_date, to_date],
        |row| {
            Ok(PurchaseHistoryRecord {
                id: row.get("id")?,
                invoice_no: row.get("invoice_no")?,
                supplier_id: row.get("supplier_id")?,
                supplier_name: row.get("supplier_name")?,
                total_amount: row.get("total_amount")?,
                purchase_date: row.get("purchase_date")?,
                total_gst: row.get("total_gst")?,
                status: row.get("status")?,
                supplier_balance_due: row.get("supplier_balance_due")?,
                item_count: row.get("item_count")?,
                total_units: row.get("total_units")?,
            })
        },
    )
}

fn query_purchase_details(
    connection: &Connection,
    purchase_id: i64,
) -> Result<PurchaseDetailsRecord, String> {
    if purchase_id <= 0 {
        return Err("Purchase id must be a positive whole number.".to_owned());
    }
    let header = connection
        .query_row(
            r#"SELECT p.id, p.invoice_no, p.supplier_id, s.name, p.purchase_date,
                      p.total_amount, p.status, p.gst_enabled, p.gst_pricing_mode,
                      p.tax_type, p.place_of_supply_state_code, p.taxable_amount,
                      p.cgst_amount, p.sgst_amount, p.igst_amount, p.total_gst
               FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
               WHERE p.id = ?1"#,
            [purchase_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, f64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, bool>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, Option<String>>(10)?,
                    row.get::<_, f64>(11)?,
                    row.get::<_, f64>(12)?,
                    row.get::<_, f64>(13)?,
                    row.get::<_, f64>(14)?,
                    row.get::<_, f64>(15)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("Could not read the purchase invoice: {error}"))?
        .ok_or_else(|| "The purchase invoice no longer exists.".to_owned())?;
    let lines = query_rows(
        connection,
        r#"SELECT pi.id, b.medicine_id, m.name AS medicine_name, pi.batch_id,
                  b.batch_no, b.expiry_date, pi.quantity,
                  COALESCE((SELECT SUM(pri.quantity) FROM purchase_return_items pri
                            WHERE pri.purchase_item_id = pi.id), 0) AS returned_quantity,
                  CAST(ROUND(pi.rate * 100) AS INTEGER) AS rate_cents,
                  pi.total, pi.gst_rate_basis_points, pi.total_gst
           FROM purchase_items pi
           JOIN medicine_batches b ON b.id = pi.batch_id
           JOIN medicines m ON m.id = b.medicine_id
           WHERE pi.purchase_id = ?1 ORDER BY pi.id"#,
        [purchase_id],
        |row| {
            let quantity: i64 = row.get("quantity")?;
            let returned_quantity: i64 = row.get("returned_quantity")?;
            Ok(PurchaseLineDetailRecord {
                id: row.get("id")?,
                medicine_id: row.get("medicine_id")?,
                medicine_name: row.get("medicine_name")?,
                batch_id: row.get("batch_id")?,
                batch_no: row.get("batch_no")?,
                expiry_date: row.get("expiry_date")?,
                quantity,
                returned_quantity,
                available_quantity: quantity.saturating_sub(returned_quantity),
                rate: row.get::<_, i64>("rate_cents")? as f64 / 100.0,
                total: row.get("total")?,
                gst_rate_basis_points: row.get("gst_rate_basis_points")?,
                total_gst: row.get("total_gst")?,
            })
        },
    )?;
    let attachments = query_rows(
        connection,
        "SELECT id, file_name, mime_type, size_bytes FROM purchase_attachments WHERE purchase_id = ?1 ORDER BY id",
        [purchase_id],
        |row| {
            Ok(PurchaseAttachmentRecord {
                id: row.get("id")?,
                file_name: row.get("file_name")?,
                mime_type: row.get("mime_type")?,
                size_bytes: row.get("size_bytes")?,
            })
        },
    )?;
    Ok(PurchaseDetailsRecord {
        id: header.0,
        invoice_no: header.1,
        supplier_id: header.2,
        supplier_name: header.3,
        purchase_date: header.4,
        total_amount: header.5,
        status: header.6,
        gst_enabled: header.7,
        gst_pricing_mode: header.8,
        tax_type: header.9,
        place_of_supply_state_code: header.10,
        taxable_amount: header.11,
        cgst_amount: header.12,
        sgst_amount: header.13,
        igst_amount: header.14,
        total_gst: header.15,
        lines,
        attachments,
    })
}

fn query_supplier_ledger(
    connection: &Connection,
    supplier_id: i64,
    from_date: Option<&str>,
    to_date: Option<&str>,
    entry_type: Option<&str>,
    search_term: &str,
) -> Result<SupplierLedgerRecord, String> {
    if supplier_id <= 0 {
        return Err("Supplier id must be a positive whole number.".to_owned());
    }
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM suppliers WHERE id = ?1)",
            [supplier_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not validate the supplier: {error}"))?;
    if !exists {
        return Err("The supplier no longer exists.".to_owned());
    }
    let filter_type = entry_type.map(str::to_ascii_uppercase);
    if filter_type
        .as_deref()
        .is_some_and(|value| !matches!(value, "PURCHASE" | "PURCHASE_RETURN" | "PAYMENT" | "ADJUSTMENT"))
    {
        return Err("Choose a supported supplier ledger transaction type.".to_owned());
    }
    let needle = search_term.trim().to_lowercase();
    let rows = query_rows(
        connection,
        r#"SELECT id, entry_type, reference, debit_cents, credit_cents,
                  payment_method, transaction_reference, note, created_at
           FROM supplier_ledger WHERE supplier_id = ?1
           ORDER BY created_at ASC, id ASC"#,
        [supplier_id],
        |row| {
            Ok((
                row.get::<_, i64>("id")?,
                row.get::<_, String>("entry_type")?,
                row.get::<_, Option<String>>("reference")?,
                row.get::<_, i64>("debit_cents")?,
                row.get::<_, i64>("credit_cents")?,
                row.get::<_, Option<String>>("payment_method")?,
                row.get::<_, Option<String>>("transaction_reference")?,
                row.get::<_, Option<String>>("note")?,
                row.get::<_, String>("created_at")?,
            ))
        },
    )?;
    let mut balance_cents = 0_i64;
    let mut opening_balance_cents = 0_i64;
    let mut entries = Vec::new();
    for (
        id,
        entry_type,
        reference,
        debit_cents,
        credit_cents,
        payment_method,
        transaction_reference,
        note,
        created_at,
    ) in rows
    {
        balance_cents = balance_cents
            .checked_add(debit_cents)
            .and_then(|balance| balance.checked_sub(credit_cents))
            .ok_or_else(|| "Supplier ledger balance exceeds the supported amount.".to_owned())?;
        let entry_date = created_at.get(..10).unwrap_or(created_at.as_str());
        let before_range = from_date.is_some_and(|from| entry_date < from);
        if before_range {
            opening_balance_cents = balance_cents;
        }
        let matches_search = needle.is_empty()
            || reference.as_deref().unwrap_or_default().to_lowercase().contains(&needle)
            || transaction_reference
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .contains(&needle)
            || note
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .contains(&needle);
        if !before_range
            && to_date.is_none_or(|to| entry_date <= to)
            && filter_type.as_deref().is_none_or(|filter| filter == entry_type)
            && matches_search
        {
            entries.push(SupplierLedgerEntryRecord {
                id,
                entry_type,
                reference,
                debit: debit_cents as f64 / 100.0,
                credit: credit_cents as f64 / 100.0,
                payment_method,
                transaction_reference,
                note,
                created_at,
                running_balance: balance_cents as f64 / 100.0,
            });
        }
    }
    Ok(SupplierLedgerRecord {
        opening_balance: opening_balance_cents as f64 / 100.0,
        current_balance: balance_cents as f64 / 100.0,
        entries,
    })
}

fn map_sale(row: &Row<'_>) -> rusqlite::Result<SaleRecord> {
    Ok(SaleRecord {
        id: row.get("id")?,
        invoice_no: row.get("invoice_no")?,
        customer_id: row.get("customer_id")?,
        customer_name: row.get("customer_name")?,
        customer_phone: row.get("customer_phone")?,
        customer_state_code: row.get("customer_state_code")?,
        place_of_supply_state_code: row.get("place_of_supply_state_code")?,
        subtotal: row.get("subtotal")?,
        discount: row.get("discount")?,
        flat_discount: row.get("flat_discount")?,
        grand_total: row.get("grand_total")?,
        payment_mode: row.get("payment_mode")?,
        cash_tendered: row.get("cash_tendered")?,
        change_due: row.get("change_due")?,
        upi_transaction_id: row.get("upi_transaction_id")?,
        upi_payment_verified: row.get("upi_payment_verified")?,
        gst_enabled: row.get("gst_enabled")?,
        gst_pricing_mode: row.get("gst_pricing_mode")?,
        tax_type: row.get("tax_type")?,
        taxable_amount: row.get("taxable_amount")?,
        cgst_amount: row.get("cgst_amount")?,
        sgst_amount: row.get("sgst_amount")?,
        igst_amount: row.get("igst_amount")?,
        total_gst: row.get("total_gst")?,
        created_at: row.get("created_at")?,
    })
}

fn query_recent_sales(
    connection: &Connection,
    limit: i64,
) -> Result<Vec<RecentSaleRecord>, String> {
    query_rows(
        connection,
        r#"SELECT
             s.id,
             s.invoice_no,
             s.customer_name,
             s.customer_phone,
             s.subtotal,
             s.discount,
             s.flat_discount,
             s.grand_total,
             s.payment_mode,
             s.cash_tendered,
             s.change_due,
             s.created_at,
             COUNT(si.id) AS item_count
           FROM sales AS s
           LEFT JOIN sale_items AS si ON si.sale_id = s.id
           GROUP BY s.id
           ORDER BY s.created_at DESC, s.id DESC
           LIMIT ?1"#,
        [limit],
        |row| {
            Ok(RecentSaleRecord {
                id: row.get("id")?,
                invoice_no: row.get("invoice_no")?,
                customer_name: row.get("customer_name")?,
                customer_phone: row.get("customer_phone")?,
                subtotal: row.get("subtotal")?,
                discount: row.get("discount")?,
                flat_discount: row.get("flat_discount")?,
                grand_total: row.get("grand_total")?,
                payment_mode: row.get("payment_mode")?,
                cash_tendered: row.get("cash_tendered")?,
                change_due: row.get("change_due")?,
                created_at: row.get("created_at")?,
                item_count: row.get("item_count")?,
            })
        },
    )
}

fn query_sale_details(
    connection: &Connection,
    invoice_no: &str,
) -> Result<Option<SaleDetailsRecord>, String> {
    let mut sales = query_rows(
        connection,
        r#"SELECT id, invoice_no, customer_id, customer_name, customer_phone,
                  customer_state_code, place_of_supply_state_code, subtotal, discount,
                  flat_discount, grand_total, payment_mode, cash_tendered, change_due,
                  upi_transaction_id, upi_payment_verified, gst_enabled, gst_pricing_mode, tax_type,
                  taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst,
                  created_at
           FROM sales
           WHERE invoice_no = ?1
           LIMIT 1"#,
        [invoice_no],
        map_sale,
    )?;
    let Some(sale) = sales.pop() else {
        return Ok(None);
    };

    let items = query_rows(
        connection,
        r#"SELECT
             si.id,
             si.sale_id,
             si.batch_id,
             si.quantity,
             si.unit_price,
             si.item_discount,
             si.total_price,
             si.gst_rate_basis_points,
             si.taxable_amount,
             si.cgst_amount,
             si.sgst_amount,
             si.igst_amount,
             si.total_gst,
             m.name AS medicine_name,
             m.generic_name,
             b.batch_no,
             b.expiry_date
           FROM sale_items AS si
           INNER JOIN medicine_batches AS b ON b.id = si.batch_id
           INNER JOIN medicines AS m ON m.id = b.medicine_id
           WHERE si.sale_id = ?1
           ORDER BY si.id ASC"#,
        [sale.id],
        |row| {
            Ok(SaleItemDetailRecord {
                id: row.get("id")?,
                sale_id: row.get("sale_id")?,
                batch_id: row.get("batch_id")?,
                quantity: row.get("quantity")?,
                unit_price: row.get("unit_price")?,
                item_discount: row.get("item_discount")?,
                total_price: row.get("total_price")?,
                gst_rate_basis_points: row.get("gst_rate_basis_points")?,
                taxable_amount: row.get("taxable_amount")?,
                cgst_amount: row.get("cgst_amount")?,
                sgst_amount: row.get("sgst_amount")?,
                igst_amount: row.get("igst_amount")?,
                total_gst: row.get("total_gst")?,
                medicine_name: row.get("medicine_name")?,
                generic_name: row.get("generic_name")?,
                batch_no: row.get("batch_no")?,
                expiry_date: row.get("expiry_date")?,
            })
        },
    )?;
    Ok(Some(SaleDetailsRecord { sale, items }))
}

fn query_sales_report_summary(
    connection: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<SalesReportSummaryRecord, String> {
    let mut rows = query_rows(
        connection,
        r#"WITH in_range AS (
             SELECT id, grand_total, flat_discount, payment_mode
             FROM sales
             WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
           ),
           profit_by_sale AS (
             SELECT
               ranged.id,
               ranged.flat_discount,
               COUNT(item.id) AS line_count,
               COUNT(item.purchase_rate_at_sale) AS costed_line_count,
               COALESCE(SUM(item.total_price), 0) AS line_revenue,
               COALESCE(SUM(item.purchase_rate_at_sale * item.quantity), 0) AS purchase_cost
             FROM in_range AS ranged
             LEFT JOIN sale_items AS item ON item.sale_id = ranged.id
             GROUP BY ranged.id
           )
           SELECT
             COALESCE(SUM(ranged.grand_total), 0) AS total_revenue,
             COALESCE(SUM(
               CASE
                 WHEN profit.line_count > 0
                   AND profit.line_count = profit.costed_line_count
                 THEN profit.line_revenue - profit.flat_discount - profit.purchase_cost
                 ELSE 0
               END
             ), 0) AS gross_profit,
             COUNT(ranged.id) AS total_invoices,
             COALESCE(SUM(CASE WHEN ranged.payment_mode = 'CASH'
               THEN ranged.grand_total ELSE 0 END), 0) AS cash_revenue,
             COALESCE(SUM(CASE WHEN ranged.payment_mode = 'CASH' THEN 1 ELSE 0 END), 0)
               AS cash_invoices,
             COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('UPI', 'CARD')
               THEN ranged.grand_total ELSE 0 END), 0) AS card_upi_revenue,
             COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('UPI', 'CARD') THEN 1 ELSE 0 END), 0)
               AS card_upi_invoices,
             COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('CREDIT', 'OTHER')
               THEN ranged.grand_total ELSE 0 END), 0) AS other_revenue,
             COALESCE(SUM(CASE WHEN ranged.payment_mode IN ('CREDIT', 'OTHER') THEN 1 ELSE 0 END), 0)
               AS other_invoices,
             COALESCE(SUM(CASE
               WHEN profit.line_count > profit.costed_line_count THEN 1 ELSE 0
             END), 0) AS profit_unavailable_invoices
           FROM in_range AS ranged
           LEFT JOIN profit_by_sale AS profit ON profit.id = ranged.id"#,
        params![start_date, end_date],
        |row| {
            Ok(SalesReportSummaryRecord {
                total_revenue: row.get("total_revenue")?,
                gross_profit: row.get("gross_profit")?,
                total_invoices: row.get("total_invoices")?,
                cash_revenue: row.get("cash_revenue")?,
                cash_invoices: row.get("cash_invoices")?,
                card_upi_revenue: row.get("card_upi_revenue")?,
                card_upi_invoices: row.get("card_upi_invoices")?,
                other_revenue: row.get("other_revenue")?,
                other_invoices: row.get("other_invoices")?,
                profit_unavailable_invoices: row.get("profit_unavailable_invoices")?,
            })
        },
    )?;
    rows.pop()
        .ok_or_else(|| "The local database did not return a report summary.".to_owned())
}

fn query_sales_report_rows(
    connection: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<SalesReportRowRecord>, String> {
    query_rows(
        connection,
        r#"SELECT id, invoice_no, customer_name, payment_mode, grand_total, created_at
           FROM sales
           WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
           ORDER BY created_at DESC, id DESC"#,
        params![start_date, end_date],
        |row| {
            Ok(SalesReportRowRecord {
                id: row.get("id")?,
                invoice_no: row.get("invoice_no")?,
                customer_name: row.get("customer_name")?,
                payment_mode: row.get("payment_mode")?,
                grand_total: row.get("grand_total")?,
                created_at: row.get("created_at")?,
            })
        },
    )
}

fn query_weekly_sales(
    connection: &Connection,
    start_date: &str,
    end_date: &str,
) -> Result<Vec<WeeklySalesDayRecord>, String> {
    validate_iso_date(connection, start_date, "Week start")?;
    validate_iso_date(connection, end_date, "Week end")?;
    if start_date > end_date {
        return Err("Week start must not be after week end.".to_owned());
    }
    let day_span = connection
        .query_row(
            "SELECT CAST(julianday(?2) - julianday(?1) AS INTEGER)",
            params![start_date, end_date],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Could not validate the weekly sales range: {error}"))?;
    if day_span > 6 {
        return Err("Weekly sales can be requested for at most seven days.".to_owned());
    }
    query_rows(
        connection,
        r#"SELECT
             date(created_at, 'localtime') AS sale_date,
             COALESCE(SUM(grand_total), 0) AS total_sales,
             COUNT(*) AS invoice_count
           FROM sales
           WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2
             AND invoice_no NOT GLOB 'DEV-DEMO-SALE-*'
           GROUP BY date(created_at, 'localtime')
           ORDER BY sale_date ASC"#,
        params![start_date, end_date],
        |row| {
            Ok(WeeklySalesDayRecord {
                sale_date: row.get("sale_date")?,
                total_sales: row.get("total_sales")?,
                invoice_count: row.get("invoice_count")?,
            })
        },
    )
}

fn query_dashboard_inventory_summary(
    connection: &Connection,
) -> Result<DashboardInventorySummaryRecord, String> {
    let mut rows = query_rows(
        connection,
        r#"WITH stock_by_medicine AS (
             SELECT
               m.id,
               m.min_stock_alert,
               COALESCE(SUM(
                 CASE WHEN b.expiry_date >= date('now', 'localtime')
                   THEN b.current_stock ELSE 0 END
               ), 0) AS available_stock,
               COALESCE(SUM(
                 CASE WHEN b.expiry_date >= date('now', 'localtime')
                   THEN b.current_stock * b.purchase_rate ELSE 0 END
               ), 0) AS stock_value_at_cost
             FROM medicines AS m
             LEFT JOIN medicine_batches AS b ON b.medicine_id = m.id
             GROUP BY m.id
           )
           SELECT
             COUNT(*) AS total_medicines,
             COALESCE(SUM(stock_value_at_cost), 0) AS stock_value_at_cost,
             COALESCE(SUM(CASE
               WHEN available_stock > min_stock_alert THEN 1 ELSE 0
             END), 0) AS in_stock_medicines,
             COALESCE(SUM(CASE
               WHEN available_stock > 0 AND available_stock <= min_stock_alert
                 THEN 1 ELSE 0
             END), 0) AS low_stock_medicines,
             COALESCE(SUM(CASE WHEN available_stock = 0 THEN 1 ELSE 0 END), 0)
               AS out_of_stock_medicines,
             (SELECT COUNT(*) FROM suppliers) AS total_suppliers
           FROM stock_by_medicine"#,
        [],
        |row| {
            Ok(DashboardInventorySummaryRecord {
                total_medicines: row.get("total_medicines")?,
                stock_value_at_cost: row.get("stock_value_at_cost")?,
                in_stock_medicines: row.get("in_stock_medicines")?,
                low_stock_medicines: row.get("low_stock_medicines")?,
                out_of_stock_medicines: row.get("out_of_stock_medicines")?,
                total_suppliers: row.get("total_suppliers")?,
            })
        },
    )?;
    rows.pop()
        .ok_or_else(|| "The local database did not return an inventory summary.".to_owned())
}

fn query_dashboard_purchase_summary(
    connection: &Connection,
    today: &str,
) -> Result<DashboardPurchaseSummaryRecord, String> {
    let mut rows = query_rows(
        connection,
        r#"SELECT
             COALESCE(SUM(total_amount), 0) AS total_amount,
             COUNT(*) AS invoice_count
           FROM purchases
           WHERE purchase_date = ?1"#,
        [today],
        |row| {
            Ok(DashboardPurchaseSummaryRecord {
                total_amount: row.get("total_amount")?,
                invoice_count: row.get("invoice_count")?,
            })
        },
    )?;
    rows.pop()
        .ok_or_else(|| "The local database did not return a purchase summary.".to_owned())
}

fn query_top_selling_medicines(
    connection: &Connection,
) -> Result<Vec<TopSellingMedicineRecord>, String> {
    query_rows(
        connection,
        r#"SELECT
             m.id AS medicine_id,
             m.name,
             COALESCE(SUM(si.quantity), 0) AS quantity_sold,
             COALESCE(SUM(si.total_price), 0) AS line_sales_before_invoice_discount
           FROM sales AS s
           INNER JOIN sale_items AS si ON si.sale_id = s.id
           INNER JOIN medicine_batches AS b ON b.id = si.batch_id
           INNER JOIN medicines AS m ON m.id = b.medicine_id
           WHERE date(s.created_at, 'localtime')
             BETWEEN date('now', 'localtime', '-29 days') AND date('now', 'localtime')
           GROUP BY m.id, m.name
           ORDER BY quantity_sold DESC,
             line_sales_before_invoice_discount DESC,
             m.name COLLATE NOCASE ASC,
             m.id ASC
           LIMIT 5"#,
        [],
        |row| {
            Ok(TopSellingMedicineRecord {
                medicine_id: row.get("medicine_id")?,
                name: row.get("name")?,
                quantity_sold: row.get("quantity_sold")?,
                line_sales_before_invoice_discount: row
                    .get("line_sales_before_invoice_discount")?,
            })
        },
    )
}

fn query_medicine_order_usage_for_date(
    connection: &Connection,
    medicine_id: i64,
    as_of_date: &str,
) -> Result<MedicineOrderUsageRecord, String> {
    if medicine_id <= 0 {
        return Err("Medicine id must be a positive whole number.".to_owned());
    }
    validate_iso_date(connection, as_of_date, "Usage date")?;
    let mut records = query_rows(
        connection,
        r#"WITH recent_items AS (
             SELECT
               si.batch_id,
               si.quantity,
               date(s.created_at, 'localtime') AS sale_date
             FROM sales AS s
             INNER JOIN sale_items AS si ON si.sale_id = s.id
             WHERE date(s.created_at, 'localtime')
               BETWEEN date(?2, '-29 days') AND ?2
               AND s.invoice_no NOT GLOB 'DEV-DEMO-SALE-*'
           )
           SELECT
             m.id AS medicine_id,
             COALESCE(SUM(recent_items.quantity), 0) AS sold_units_30_days,
             COUNT(DISTINCT recent_items.sale_date) AS sales_days_30_days
           FROM medicines AS m
           LEFT JOIN medicine_batches AS b ON b.medicine_id = m.id
           LEFT JOIN recent_items ON recent_items.batch_id = b.id
           WHERE m.id = ?1
           GROUP BY m.id"#,
        params![medicine_id, as_of_date],
        |row| {
            Ok(MedicineOrderUsageRecord {
                medicine_id: row.get("medicine_id")?,
                sold_units_30_days: row.get("sold_units_30_days")?,
                sales_days_30_days: row.get("sales_days_30_days")?,
            })
        },
    )?;
    records
        .pop()
        .ok_or_else(|| "Medicine was not found for the order suggestion.".to_owned())
}

fn query_medicine_order_usage(
    connection: &Connection,
    medicine_id: i64,
) -> Result<MedicineOrderUsageRecord, String> {
    let today = connection
        .query_row("SELECT date('now', 'localtime')", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Could not read the local date for order usage: {error}"))?;
    query_medicine_order_usage_for_date(connection, medicine_id, &today)
}

#[cfg(debug_assertions)]
fn query_development_database_counts(
    connection: &Connection,
) -> Result<DevelopmentDatabaseCounts, String> {
    let mut rows = query_rows(
        connection,
        r#"SELECT
             (SELECT COUNT(*) FROM medicines) AS medicines,
             (SELECT COUNT(*) FROM medicine_batches) AS medicine_batches,
             (SELECT COUNT(*) FROM suppliers) AS suppliers,
             (SELECT COUNT(*) FROM purchases) AS purchases,
             (SELECT COUNT(*) FROM purchase_items) AS purchase_items,
             (SELECT COUNT(*) FROM sales) AS sales,
             (SELECT COUNT(*) FROM sale_items) AS sale_items,
             (SELECT COUNT(*) FROM stock_adjustments) AS stock_adjustments,
             (SELECT COUNT(*) FROM order_list_items) AS order_list_items,
             (SELECT COUNT(*) FROM app_settings) AS app_settings"#,
        [],
        |row| {
            Ok(DevelopmentDatabaseCounts {
                medicines: row.get("medicines")?,
                medicine_batches: row.get("medicine_batches")?,
                suppliers: row.get("suppliers")?,
                purchases: row.get("purchases")?,
                purchase_items: row.get("purchase_items")?,
                sales: row.get("sales")?,
                sale_items: row.get("sale_items")?,
                stock_adjustments: row.get("stock_adjustments")?,
                order_list_items: row.get("order_list_items")?,
                app_settings: row.get("app_settings")?,
            })
        },
    )?;
    rows.pop()
        .ok_or_else(|| "The local database did not return its empty-data check.".to_owned())
}

#[tauri::command]
pub(crate) fn get_inventory_medicines(
    app: AppHandle,
    search_term: String,
) -> Result<Vec<MedicineInventoryRecord>, String> {
    query_inventory_medicines(&open_pharmacy_connection(&app)?, &search_term)
}

#[tauri::command]
pub(crate) fn get_medicine_batches(
    app: AppHandle,
    medicine_id: i64,
) -> Result<Vec<MedicineBatchRecord>, String> {
    query_medicine_batches(&open_pharmacy_connection(&app)?, medicine_id)
}

#[tauri::command]
pub(crate) fn search_medicines(
    app: AppHandle,
    search_term: String,
    limit: i64,
) -> Result<Vec<MedicineSearchRecord>, String> {
    query_medicine_search(&open_pharmacy_connection(&app)?, &search_term, limit)
}

#[tauri::command]
pub(crate) fn get_fefo_batch(
    app: AppHandle,
    medicine_id: i64,
) -> Result<Option<MedicineBatchRecord>, String> {
    Ok(
        query_sellable_batches(&open_pharmacy_connection(&app)?, medicine_id, true)?
            .into_iter()
            .next(),
    )
}

#[tauri::command]
pub(crate) fn get_sellable_batches(
    app: AppHandle,
    medicine_id: i64,
) -> Result<Vec<MedicineBatchRecord>, String> {
    query_sellable_batches(&open_pharmacy_connection(&app)?, medicine_id, false)
}

#[tauri::command]
pub(crate) fn get_low_stock_alerts(app: AppHandle) -> Result<Vec<LowStockAlertRecord>, String> {
    query_low_stock_alerts(&open_pharmacy_connection(&app)?)
}

#[tauri::command]
pub(crate) fn get_expiry_alerts(
    app: AppHandle,
    horizon_days: i64,
) -> Result<Vec<ExpiryAlertRecord>, String> {
    query_expiry_alerts(&open_pharmacy_connection(&app)?, horizon_days)
}

#[tauri::command]
pub(crate) fn get_suppliers(
    app: AppHandle,
    search_term: String,
) -> Result<Vec<SupplierRecord>, String> {
    query_suppliers(&open_pharmacy_connection(&app)?, &search_term)
}

#[tauri::command]
pub(crate) fn get_customers(
    app: AppHandle,
    search_term: String,
    include_inactive: bool,
) -> Result<Vec<CustomerRecord>, String> {
    query_customers(
        &open_pharmacy_connection(&app)?,
        &search_term,
        include_inactive,
    )
}

#[tauri::command]
pub(crate) fn get_customer_ledger(
    app: AppHandle,
    customer_id: i64,
) -> Result<Vec<CustomerLedgerEntryRecord>, String> {
    query_customer_ledger(&open_pharmacy_connection(&app)?, customer_id)
}

#[tauri::command]
pub(crate) fn get_order_list(
    app: AppHandle,
    order_date: String,
) -> Result<Vec<OrderListRecord>, String> {
    query_order_list(&open_pharmacy_connection(&app)?, &order_date)
}

#[tauri::command]
pub(crate) fn get_store_settings(app: AppHandle) -> Result<Vec<StoreSettingRecord>, String> {
    query_store_settings(&open_pharmacy_connection(&app)?)
}

#[tauri::command]
pub(crate) fn get_recent_purchases(
    app: AppHandle,
    limit: i64,
) -> Result<Vec<RecentPurchaseRecord>, String> {
    query_recent_purchases(&open_pharmacy_connection(&app)?, limit)
}

#[tauri::command]
pub(crate) fn get_purchase_history(
    app: AppHandle,
    search_term: String,
    supplier_id: Option<i64>,
    from_date: Option<String>,
    to_date: Option<String>,
) -> Result<Vec<PurchaseHistoryRecord>, String> {
    let connection = open_pharmacy_connection(&app)?;
    if supplier_id.is_some_and(|id| id <= 0) {
        return Err("Supplier id must be a positive whole number.".to_owned());
    }
    if let Some(date) = from_date.as_deref() {
        validate_iso_date(&connection, date, "start date")?;
    }
    if let Some(date) = to_date.as_deref() {
        validate_iso_date(&connection, date, "end date")?;
    }
    if from_date.as_deref().zip(to_date.as_deref()).is_some_and(|(from, to)| from > to) {
        return Err("The purchase start date cannot be after the end date.".to_owned());
    }
    query_purchase_history(
        &connection,
        &search_term,
        supplier_id,
        from_date.as_deref(),
        to_date.as_deref(),
    )
}

#[tauri::command]
pub(crate) fn get_purchase_details(
    app: AppHandle,
    purchase_id: i64,
) -> Result<PurchaseDetailsRecord, String> {
    query_purchase_details(&open_pharmacy_connection(&app)?, purchase_id)
}

#[tauri::command]
pub(crate) fn get_supplier_ledger(
    app: AppHandle,
    supplier_id: i64,
    from_date: Option<String>,
    to_date: Option<String>,
    entry_type: Option<String>,
    search_term: String,
) -> Result<SupplierLedgerRecord, String> {
    let connection = open_pharmacy_connection(&app)?;
    if let Some(date) = from_date.as_deref() {
        validate_iso_date(&connection, date, "start date")?;
    }
    if let Some(date) = to_date.as_deref() {
        validate_iso_date(&connection, date, "end date")?;
    }
    if from_date.as_deref().zip(to_date.as_deref()).is_some_and(|(from, to)| from > to) {
        return Err("The supplier ledger start date cannot be after the end date.".to_owned());
    }
    query_supplier_ledger(
        &connection,
        supplier_id,
        from_date.as_deref(),
        to_date.as_deref(),
        entry_type.as_deref(),
        &search_term,
    )
}

#[tauri::command]
pub(crate) fn get_recent_sales(
    app: AppHandle,
    limit: i64,
) -> Result<Vec<RecentSaleRecord>, String> {
    query_recent_sales(&open_pharmacy_connection(&app)?, limit)
}

#[tauri::command]
pub(crate) fn get_sale_details(
    app: AppHandle,
    invoice_no: String,
) -> Result<Option<SaleDetailsRecord>, String> {
    query_sale_details(&open_pharmacy_connection(&app)?, &invoice_no)
}

#[tauri::command]
pub(crate) fn get_sales_report_summary(
    app: AppHandle,
    start_date: String,
    end_date: String,
) -> Result<SalesReportSummaryRecord, String> {
    query_sales_report_summary(&open_pharmacy_connection(&app)?, &start_date, &end_date)
}

#[tauri::command]
pub(crate) fn get_sales_report_rows(
    app: AppHandle,
    start_date: String,
    end_date: String,
) -> Result<Vec<SalesReportRowRecord>, String> {
    query_sales_report_rows(&open_pharmacy_connection(&app)?, &start_date, &end_date)
}

#[tauri::command]
pub(crate) fn get_weekly_sales(
    app: AppHandle,
    start_date: String,
    end_date: String,
) -> Result<Vec<WeeklySalesDayRecord>, String> {
    query_weekly_sales(&open_pharmacy_connection(&app)?, &start_date, &end_date)
}

#[tauri::command]
pub(crate) fn get_dashboard_inventory_summary(
    app: AppHandle,
) -> Result<DashboardInventorySummaryRecord, String> {
    query_dashboard_inventory_summary(&open_pharmacy_connection(&app)?)
}

#[tauri::command]
pub(crate) fn get_dashboard_purchase_summary(
    app: AppHandle,
    today: String,
) -> Result<DashboardPurchaseSummaryRecord, String> {
    query_dashboard_purchase_summary(&open_pharmacy_connection(&app)?, &today)
}

#[tauri::command]
pub(crate) fn get_top_selling_medicines(
    app: AppHandle,
) -> Result<Vec<TopSellingMedicineRecord>, String> {
    query_top_selling_medicines(&open_pharmacy_connection(&app)?)
}

#[tauri::command]
pub(crate) fn get_medicine_order_usage(
    app: AppHandle,
    medicine_id: i64,
) -> Result<MedicineOrderUsageRecord, String> {
    query_medicine_order_usage(&open_pharmacy_connection(&app)?, medicine_id)
}

#[cfg(debug_assertions)]
#[tauri::command]
pub(crate) fn check_development_database_empty(
    app: AppHandle,
) -> Result<DevelopmentDatabaseCounts, String> {
    query_development_database_counts(&open_pharmacy_connection(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate_connection;

    fn migrated_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open typed-read test database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable foreign keys");
        migrate_connection(&mut connection).expect("apply schema migrations");
        connection
    }

    fn insert_medicine(connection: &Connection, id: i64, name: &str, min_stock: i64) {
        connection
            .execute(
                "INSERT INTO medicines (id, name, min_stock_alert) VALUES (?1, ?2, ?3)",
                params![id, name, min_stock],
            )
            .expect("insert test medicine");
    }

    fn insert_batch(
        connection: &Connection,
        id: i64,
        medicine_id: i64,
        batch_no: &str,
        expiry: &str,
        stock: i64,
        purchase_rate: f64,
        barcode: Option<&str>,
    ) {
        connection
            .execute(
                r#"INSERT INTO medicine_batches
                   (id, medicine_id, batch_no, expiry_date, current_stock,
                    purchase_rate, mrp, sale_rate, barcode)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, 2, 2, ?7)"#,
                params![
                    id,
                    medicine_id,
                    batch_no,
                    expiry,
                    stock,
                    purchase_rate,
                    barcode
                ],
            )
            .expect("insert test batch");
    }

    #[test]
    fn inventory_queries_preserve_literal_search_barcode_priority_and_fefo() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "Alpha 100%_Ready!", 4);
        insert_medicine(&connection, 2, "alpha", 1);
        insert_medicine(&connection, 3, "Med 100XXReady", 10);
        let dates: (String, String, String) = connection
            .query_row(
                "SELECT date('now', 'localtime', '-1 day'), date('now', 'localtime'), date('now', 'localtime', '+30 days')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("compute fixture expiry dates");
        insert_batch(&connection, 1, 1, "expired", &dates.0, 4, 2.0, None);
        insert_batch(&connection, 2, 1, "first", &dates.1, 3, 3.0, Some("BAR-1"));
        insert_batch(&connection, 3, 1, "later", &dates.2, 5, 4.0, None);

        let all = query_inventory_medicines(&connection, "").expect("read all inventory");
        assert_eq!(
            all.iter().map(|row| row.name.as_str()).collect::<Vec<_>>(),
            vec!["alpha", "Alpha 100%_Ready!", "Med 100XXReady"]
        );
        let target = query_inventory_medicines(&connection, "100%_Ready!")
            .expect("read escaped literal search");
        assert_eq!(target.len(), 1);
        assert_eq!(target[0].id, 1);
        assert_eq!(target[0].available_stock, 8.0);
        assert_eq!(
            query_medicine_batches(&connection, 1)
                .expect("read all medicine batches")
                .iter()
                .map(|batch| batch.id)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );

        let exact_barcode =
            query_medicine_search(&connection, "BAR-1", 30).expect("search exact barcode");
        assert_eq!(exact_barcode[0].id, 1);
        assert_eq!(exact_barcode[0].batch_id, Some(2));
        assert!(exact_barcode[0].exact_barcode_match);
        assert_eq!(
            query_sellable_batches(&connection, 1, false)
                .expect("read sellable batches")
                .iter()
                .map(|batch| batch.id)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        assert_eq!(
            query_sellable_batches(&connection, 1, true).expect("read FEFO batch")[0].id,
            2
        );
        assert_eq!(
            query_low_stock_alerts(&connection)
                .expect("read low-stock alerts")
                .iter()
                .map(|alert| alert.medicine_id)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
        let expiry_alerts =
            query_expiry_alerts(&connection, 7).expect("read seven-day expiry alerts");
        assert_eq!(
            expiry_alerts
                .iter()
                .map(|alert| (alert.id, alert.days_until_expiry, alert.status.as_str()))
                .collect::<Vec<_>>(),
            vec![(1, -1, "expired"), (2, 0, "expiring")]
        );
    }

    #[test]
    fn medicine_master_barcode_finds_its_record_and_keeps_fefo_batch_selection() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "Scannable medicine", 1);
        connection
            .execute(
                "UPDATE medicines SET barcode = 'MED-100' WHERE id = 1",
                [],
            )
            .expect("set medicine master barcode");
        let dates: (String, String) = connection
            .query_row(
                "SELECT date('now', 'localtime', '-1 day'), date('now', 'localtime', '+10 days')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("compute barcode fixture expiry dates");
        insert_batch(&connection, 1, 1, "expired", &dates.0, 3, 2.0, None);
        insert_batch(&connection, 2, 1, "sellable", &dates.1, 4, 3.0, Some("OTHER"));

        let result = query_medicine_search(&connection, "MED-100", 10)
            .expect("search the medicine master barcode");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].medicine_barcode.as_deref(), Some("MED-100"));
        assert_eq!(result[0].batch_id, Some(2));
        assert!(result[0].exact_barcode_match);

        connection
            .execute(
                r#"UPDATE medicines
                   SET company = 'Northstar', product_type = 'Syrup',
                       strength = '100 mg / 5 ml',
                       composition = 'dextromethorphan'
                   WHERE id = 1"#,
                [],
            )
            .expect("save searchable product identifiers");
        for identifier in [
            "Northstar",
            "Syrup",
            "100 mg / 5 ml",
            "dextromethorphan",
        ] {
            let matches = query_medicine_search(&connection, identifier, 10)
                .expect("search medicine identifier");
            assert_eq!(matches.len(), 1, "identifier {identifier}");
            assert_eq!(matches[0].id, 1, "identifier {identifier}");
        }
    }

    #[test]
    fn duplicate_exact_batch_barcodes_return_each_medicine_candidate() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "First medicine", 1);
        insert_medicine(&connection, 2, "Second medicine", 1);
        let dates: (String, String) = connection
            .query_row(
                "SELECT date('now', 'localtime', '+2 days'), date('now', 'localtime', '+6 days')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("compute duplicate barcode fixture expiry dates");
        insert_batch(
            &connection,
            1,
            1,
            "FIRST",
            &dates.0,
            4,
            2.0,
            Some("DUP-100"),
        );
        insert_batch(
            &connection,
            2,
            2,
            "SECOND",
            &dates.1,
            5,
            3.0,
            Some("DUP-100"),
        );

        let matches =
            query_medicine_search(&connection, "dup-100", 100).expect("search duplicate code");
        assert_eq!(
            matches.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(matches.iter().all(|row| row.exact_barcode_match));
        assert_eq!(
            matches
                .iter()
                .map(|row| row.batch_id)
                .collect::<Vec<_>>(),
            vec![Some(1), Some(2)]
        );
    }

    #[test]
    fn customer_suggestions_search_name_or_normalized_phone_and_include_due_balance() {
        let connection = migrated_connection();
        connection
            .execute(
                r#"INSERT INTO customers
                   (id, name, phone, phone_normalized, state_code)
                   VALUES (1, 'Asha Rao', '+91 98765 43210', '919876543210', '29')"#,
                [],
            )
            .expect("insert saved customer");
        connection
            .execute(
                r#"INSERT INTO customer_ledger
                   (customer_id, entry_type, invoice_no, debit_cents, credit_cents)
                   VALUES (1, 'CREDIT_SALE', 'INV-CUST-1', 7250, 0)"#,
                [],
            )
            .expect("record saved customer's due balance");

        let by_name = query_customers(&connection, "Asha", false)
            .expect("search customer suggestion by name");
        let by_phone = query_customers(&connection, "9876543210", false)
            .expect("search customer suggestion by normalized phone");
        assert_eq!(by_name.len(), 1);
        assert_eq!(by_phone.len(), 1);
        assert_eq!(by_name[0].id, 1);
        assert_eq!(by_name[0].name, "Asha Rao");
        assert_eq!(by_name[0].balance_due, 72.5);
        assert_eq!(by_phone[0].balance_due, 72.5);
    }

    #[test]
    fn supplier_settings_purchase_and_sales_reads_preserve_nulls_and_order() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "Medicine", 10);
        insert_batch(&connection, 1, 1, "B-1", "2099-01-01", 10, 2.0, None);
        connection
            .execute(
                "INSERT INTO suppliers (id, name) VALUES (1, 'Supplier One')",
                [],
            )
            .expect("insert supplier");
        connection
            .execute(
                "INSERT INTO purchases (id, invoice_no, supplier_id, total_amount, purchase_date) VALUES
                   (1, 'P-1', 1, 8, '2026-01-01'),
                   (2, 'P-2', NULL, 10, '2026-01-02')",
                [],
            )
            .expect("insert purchases");
        connection
            .execute(
                "INSERT INTO purchase_items (purchase_id, batch_id, quantity, rate, total) VALUES (1, 1, 2, 4, 8)",
                [],
            )
            .expect("insert purchase item");
        connection
            .execute(
                r#"INSERT INTO sales
                   (id, invoice_no, subtotal, grand_total, created_at) VALUES
                   (1, 'INV-1', 20, 20, '2026-01-01 10:00:00'),
                   (2, 'INV-2', 30, 30, '2026-01-02 10:00:00')"#,
                [],
            )
            .expect("insert sales");
        connection
            .execute(
                "INSERT INTO sale_items (id, sale_id, batch_id, quantity, unit_price, total_price) VALUES (2, 2, 1, 1, 10, 10), (1, 2, 1, 2, 10, 20)",
                [],
            )
            .expect("insert sale items");
        connection
            .execute(
                "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pharmacy_name', 'Fixture Pharmacy')",
                [],
            )
            .expect("insert setting");

        assert_eq!(query_suppliers(&connection, "%").unwrap().len(), 0);
        assert_eq!(query_suppliers(&connection, "Supplier").unwrap()[0].id, 1);
        assert_eq!(
            query_store_settings(&connection).unwrap()[0].setting_value,
            "Fixture Pharmacy"
        );
        let purchases = query_recent_purchases(&connection, 1).unwrap();
        assert_eq!(purchases[0].id, 2);
        assert_eq!(purchases[0].supplier_name, None);
        assert_eq!(purchases[0].item_count, 0);
        assert_eq!(query_recent_sales(&connection, 1).unwrap()[0].id, 2);
        let details = query_sale_details(&connection, "INV-2")
            .unwrap()
            .expect("invoice details");
        assert_eq!(
            details.items.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![1, 2]
        );
        assert!(query_sale_details(&connection, "missing")
            .unwrap()
            .is_none());
    }

    #[test]
    fn medicine_order_usage_counts_recent_real_sales_and_ignores_old_and_demo_invoices() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "Usage medicine", 5);
        insert_batch(&connection, 1, 1, "expired", "2000-01-01", 50, 2.0, None);
        insert_batch(&connection, 2, 1, "current", "2099-01-01", 3, 2.0, None);
        let dates: (String, String, String, String) = connection
            .query_row(
                "SELECT date('now', 'localtime'), date('now', 'localtime', '-10 days'), date('now', 'localtime', '-29 days'), date('now', 'localtime', '-30 days')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("compute order-usage dates");
        let sales = [
            (1, "RECENT-TODAY", dates.0.as_str(), 3, 2),
            (2, "RECENT-OLDER", dates.1.as_str(), 4, 1),
            (3, "RECENT-BOUNDARY", dates.2.as_str(), 2, 2),
            (4, "OUTSIDE-30-DAYS", dates.3.as_str(), 9, 2),
            (5, "DEV-DEMO-SALE-1", dates.0.as_str(), 20, 2),
        ];
        for (id, invoice_no, date, quantity, batch_id) in sales {
            connection
                .execute(
                    r#"INSERT INTO sales
                       (id, invoice_no, subtotal, flat_discount, grand_total, payment_mode, created_at)
                       VALUES (?1, ?2, 1, 0, 1, 'CASH', datetime(?3 || ' 12:00:00'))"#,
                    params![id, invoice_no, date],
                )
                .expect("insert order-usage sale");
            connection
                .execute(
                    r#"INSERT INTO sale_items
                       (sale_id, batch_id, quantity, unit_price, item_discount, total_price, purchase_rate_at_sale)
                       VALUES (?1, ?2, ?3, 1, 0, ?3, 1)"#,
                    params![id, batch_id, quantity],
                )
                .expect("insert order-usage sale line");
        }

        let quick_check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .expect("quick-check the isolated QA database");
        assert_eq!(quick_check, "ok");
        let usage =
            query_medicine_order_usage_for_date(&connection, 1, &dates.0).unwrap();
        assert_eq!(usage.medicine_id, 1);
        assert_eq!(usage.sold_units_30_days, 9);
        assert_eq!(usage.sales_days_30_days, 3);
        assert!(query_medicine_order_usage_for_date(&connection, 99, &dates.0).is_err());
        assert!(query_medicine_order_usage_for_date(&connection, 0, &dates.0).is_err());
    }

    #[test]
    fn report_and_dashboard_reads_preserve_cost_snapshots_buckets_and_empty_aggregates() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "Top", 1);
        let today: String = connection
            .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
            .expect("get local date");
        insert_batch(&connection, 1, 1, "B-1", "2099-01-01", 5, 4.0, None);
        connection
            .execute(
                "INSERT INTO suppliers (id, name) VALUES (1, 'Supplier')",
                [],
            )
            .expect("insert supplier");
        connection
            .execute(
                r#"INSERT INTO sales
                   (id, invoice_no, subtotal, flat_discount, grand_total, payment_mode, created_at)
                   VALUES (1, 'TODAY', 110, 10, 100, 'CASH', datetime(?1 || ' 12:00:00'))"#,
                [&today],
            )
            .expect("insert sale");
        connection
            .execute(
                r#"INSERT INTO sale_items
                   (sale_id, batch_id, quantity, unit_price, item_discount,
                    total_price, purchase_rate_at_sale)
                   VALUES (1, 1, 2, 55, 0, 110, 3)"#,
                [],
            )
            .expect("insert sale line");
        connection
            .execute(
                "INSERT INTO purchases (invoice_no, supplier_id, total_amount, purchase_date) VALUES ('P-1', 1, 30, ?1)",
                [&today],
            )
            .expect("insert today's purchase");

        let summary = query_sales_report_summary(&connection, &today, &today).unwrap();
        assert_eq!(summary.total_revenue, 100.0);
        assert_eq!(summary.gross_profit, 94.0);
        assert_eq!(summary.cash_invoices, 1);
        let rows = query_sales_report_rows(&connection, &today, &today).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].invoice_no, "TODAY");
        let inventory = query_dashboard_inventory_summary(&connection).unwrap();
        assert_eq!(inventory.total_medicines, 1);
        assert_eq!(inventory.stock_value_at_cost, 20.0);
        assert_eq!(inventory.total_suppliers, 1);
        let purchases = query_dashboard_purchase_summary(&connection, &today).unwrap();
        assert_eq!(purchases.total_amount, 30.0);
        assert_eq!(purchases.invoice_count, 1);
        let top = query_top_selling_medicines(&connection).unwrap();
        assert_eq!(top[0].name, "Top");
        assert_eq!(top[0].quantity_sold, 2);

        let empty = migrated_connection();
        let empty_summary = query_sales_report_summary(&empty, &today, &today).unwrap();
        assert_eq!(empty_summary.total_revenue, 0.0);
        assert_eq!(empty_summary.total_invoices, 0);
        assert_eq!(
            query_dashboard_inventory_summary(&empty)
                .unwrap()
                .total_medicines,
            0
        );
        assert!(query_recent_sales(&empty, 10).unwrap().is_empty());
        assert!(query_sales_report_rows(&empty, &today, &today)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn weekly_sales_returns_saved_invoice_totals_for_each_sold_day() {
        let connection = migrated_connection();
        connection
            .execute(
                r#"INSERT INTO sales (invoice_no, subtotal, grand_total, created_at) VALUES
                   ('W-1', 10, 10, '2026-03-02 12:00:00'),
                   ('W-2', 15, 15, '2026-03-04 12:00:00'),
                   ('W-3', 20, 20, '2026-03-04 13:00:00'),
                   ('W-4', 30, 30, '2026-03-08 12:00:00')"#,
                [],
            )
            .expect("insert weekly sales");

        let days = query_weekly_sales(&connection, "2026-03-02", "2026-03-08")
            .expect("read saved sales for the week");
        assert_eq!(days.len(), 3);
        assert_eq!(
            days.iter()
                .map(|day| (day.sale_date.as_str(), day.total_sales, day.invoice_count))
                .collect::<Vec<_>>(),
            vec![
                ("2026-03-02", 10.0, 1),
                ("2026-03-04", 35.0, 2),
                ("2026-03-08", 30.0, 1),
            ]
        );
        assert!(query_weekly_sales(&connection, "2026-03-09", "2026-03-15")
            .expect("read a week without sales")
            .is_empty());
        assert!(query_weekly_sales(&connection, "2026-03-02", "2026-03-09").is_err());
    }

    #[test]
    fn weekly_sales_excludes_only_explicit_development_seed_invoices() {
        let connection = migrated_connection();
        connection
            .execute(
                r#"INSERT INTO sales (invoice_no, subtotal, grand_total, created_at) VALUES
                   ('REAL-1', 10, 10, '2026-03-02 12:00:00'),
                   ('DEV-DEMO-SALE-20260304-TODAY-01', 100, 100, '2026-03-04 12:00:00'),
                   ('REAL-DEV-DEMO-SALE-2', 15, 15, '2026-03-06 12:00:00')"#,
                [],
            )
            .expect("insert regular, development-seeded, and non-prefix invoices");

        let days = query_weekly_sales(&connection, "2026-03-02", "2026-03-08")
            .expect("read weekly sales excluding explicitly seeded demo invoices");
        assert_eq!(
            days.iter()
                .map(|day| (day.sale_date.as_str(), day.total_sales, day.invoice_count))
                .collect::<Vec<_>>(),
            vec![("2026-03-02", 10.0, 1), ("2026-03-06", 15.0, 1)]
        );
    }

    #[test]
    fn order_list_read_joins_local_medicine_and_supplier_records() {
        let connection = migrated_connection();
        insert_medicine(&connection, 1, "Amoxicillin 250 mg", 10);
        connection
            .execute(
                r#"INSERT INTO suppliers (
                     id, name, contact_person, phone, whatsapp_phone, address, notes
                   ) VALUES (7, 'Central Wholesaler', 'Mina Das', '12345', '919876543210',
                             'Market Road', 'Call before delivery')"#,
                [],
            )
            .expect("insert supplier contact");
        connection
            .execute(
                r#"INSERT INTO order_list_items (
                     id, order_date, medicine_id, supplier_id, quantity, note
                   ) VALUES (11, '2026-03-02', 1, 7, 24, 'Urgent restock')"#,
                [],
            )
            .expect("insert order-list item");

        let items = query_order_list(&connection, "2026-03-02").expect("read order list");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].medicine_name, "Amoxicillin 250 mg");
        assert_eq!(
            items[0].supplier_name.as_deref(),
            Some("Central Wholesaler")
        );
        assert_eq!(items[0].quantity, 24);
        assert!(!items[0].ordered);
        let supplier = query_suppliers(&connection, "Mina Das").unwrap();
        assert_eq!(supplier[0].contact_person.as_deref(), Some("Mina Das"));
        assert_eq!(supplier[0].whatsapp_phone.as_deref(), Some("919876543210"));
        assert_eq!(supplier[0].notes.as_deref(), Some("Call before delivery"));
    }

    #[test]
    fn purchase_sale_weekly_order_and_reset_flow_works_after_database_reopen() {
        let directory = crate::unique_internal_path(
            &std::env::temp_dir(),
            "pharmacy-qa-flow",
            "dir",
        );
        std::fs::create_dir_all(&directory).expect("create isolated database directory");
        let database_path = directory.join("pharmacy.db");
        let (today, week_start, week_end) = {
            let mut connection =
                Connection::open(&database_path).expect("open isolated pharmacy database");
            connection
                .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
                .expect("configure isolated database");
            migrate_connection(&mut connection).expect("migrate isolated database");
            insert_medicine(&connection, 1, "QA Medicine", 1);
            connection
                .execute(
                    "INSERT INTO suppliers (id, name, balance_due) VALUES (1, 'QA Supplier', 20)",
                    [],
                )
                .expect("insert isolated supplier");
            connection
                .execute(
                    "INSERT INTO app_settings (setting_key, setting_value) VALUES ('pharmacy_name', 'QA Pharmacy')",
                    [],
                )
                .expect("insert isolated pharmacy setting");

            let today: String = connection
                .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
                .expect("read local test date");
            let week_start: String = connection
                .query_row(
                    "SELECT date('now', 'localtime', 'weekday 0', '-6 days')",
                    [],
                    |row| row.get(0),
                )
                .expect("read local Monday");
            let week_end: String = connection
                .query_row("SELECT date(?1, '+6 days')", [&week_start], |row| row.get(0))
                .expect("read local Sunday");

            let purchase = crate::record_purchase(
                &mut connection,
                crate::PurchaseRequest {
                    supplier_id: 1,
                    invoice_no: "QA-P-1".to_owned(),
                    purchase_date: today.clone(),
                    gst_pricing_mode: None,
                    place_of_supply_state_code: None,
                    items: vec![crate::PurchaseItemRequest {
                        medicine_id: 1,
                        batch_no: "QA-B-1".to_owned(),
                        expiry_date: "2099-12-31".to_owned(),
                        purchase_rate_cents: 400,
                        mrp_cents: 800,
                        sale_rate_cents: 700,
                        quantity: 10,
                        gst_rate_override_basis_points: None,
                    }],
                },
            )
            .expect("record isolated purchase");
            assert_eq!(purchase.total_cents, 4000);
            let batch_id: i64 = connection
                .query_row(
                    "SELECT id FROM medicine_batches WHERE medicine_id = 1",
                    [],
                    |row| row.get(0),
                )
                .expect("read purchased batch");
            let stock_after_purchase: i64 = connection
                .query_row(
                    "SELECT current_stock FROM medicine_batches WHERE id = ?1",
                    [batch_id],
                    |row| row.get(0),
                )
                .expect("read stock after purchase");
            assert_eq!(stock_after_purchase, 10);

            crate::complete_sale_in_connection(
                &mut connection,
                crate::SaleCheckoutRequest {
                    customer_id: None,
                    customer_name: None,
                    customer_phone: None,
                    payment_mode: "CASH".to_owned(),
                    flat_discount_cents: 0,
                    cash_tendered_cents: 700,
                    gst_pricing_mode: None,
                    upi_transaction_id: None,
                    items: vec![crate::SaleCheckoutItem {
                        medicine_id: 1,
                        batch_id,
                        quantity: 1,
                        unit_price_cents: 700,
                        item_discount_cents: 0,
                        gst_rate_override_basis_points: None,
                    }],
                },
            )
            .expect("record isolated sale");
            let stock_after_sale: i64 = connection
                .query_row(
                    "SELECT current_stock FROM medicine_batches WHERE id = ?1",
                    [batch_id],
                    |row| row.get(0),
                )
                .expect("read stock after sale");
            assert_eq!(stock_after_sale, 9);

            let weekly = query_weekly_sales(&connection, &week_start, &week_end)
                .expect("read real weekly sales");
            assert_eq!(
                weekly.iter().map(|day| day.invoice_count).sum::<i64>(),
                1
            );
            assert_eq!(
                weekly.iter().map(|day| day.total_sales).sum::<f64>(),
                7.0
            );

            crate::apply_order_list_mutation_to_connection(
                &mut connection,
                crate::OrderListMutation::SaveItem {
                    id: None,
                    medicine_id: 1,
                    supplier_id: Some(1),
                    quantity: 6,
                    note: Some("QA restock note".to_owned()),
                    order_date: today.clone(),
                },
            )
            .expect("save isolated order-list item");
            (today, week_start, week_end)
        };

        let mut connection =
            Connection::open(&database_path).expect("reopen isolated pharmacy database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable foreign keys after reopen");
        migrate_connection(&mut connection).expect("run idempotent startup migration");
        let order_items = query_order_list(&connection, &today)
            .expect("read persisted order list after database reopen");
        assert_eq!(order_items.len(), 1);
        assert_eq!(order_items[0].supplier_name.as_deref(), Some("QA Supplier"));
        assert_eq!(order_items[0].quantity, 6);
        assert_eq!(order_items[0].note.as_deref(), Some("QA restock note"));

        let reset = crate::reset_business_data_with_backup(
            &mut connection,
            crate::DataResetScope::AllBusinessHistory,
            || Ok("isolated validated backup".to_owned()),
        )
        .expect("reset isolated business history");
        assert_eq!(reset.sales_deleted, 1);
        assert_eq!(reset.purchases_deleted, 1);
        assert_eq!(reset.order_list_items_deleted, 1);
        let after_reset: (i64, i64, i64, i64, f64, String) = connection
            .query_row(
                r#"SELECT
                     (SELECT COUNT(*) FROM sales),
                     (SELECT COUNT(*) FROM purchases),
                     (SELECT COUNT(*) FROM order_list_items),
                     (SELECT current_stock FROM medicine_batches WHERE id = 1),
                     (SELECT balance_due FROM suppliers WHERE id = 1),
                     (SELECT setting_value FROM app_settings WHERE setting_key = 'pharmacy_name')"#,
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
            .expect("read isolated database after reset");
        assert_eq!(after_reset, (0, 0, 0, 9, 0.0, "QA Pharmacy".to_owned()));
        assert!(query_weekly_sales(&connection, &week_start, &week_end)
            .expect("read empty weekly sales after reset")
            .is_empty());
        drop(connection);
        std::fs::remove_dir_all(directory).expect("remove isolated database directory");
    }

    #[cfg(debug_assertions)]
    #[test]
    fn development_empty_database_check_counts_each_protected_table() {
        let connection = migrated_connection();
        let empty = query_development_database_counts(&connection).unwrap();
        assert_eq!(empty.medicines, 0);
        assert_eq!(empty.app_settings, 0);

        insert_medicine(&connection, 1, "Seed blocker", 10);
        let populated = query_development_database_counts(&connection).unwrap();
        assert_eq!(populated.medicines, 1);
    }
}
