use rusqlite::{params, Connection, Params, Row};
use serde::Serialize;
use tauri::AppHandle;

use crate::{open_pharmacy_connection, validate_iso_date};

#[derive(Debug, Serialize)]
pub(crate) struct MedicineInventoryRecord {
    id: i64,
    name: String,
    generic_name: Option<String>,
    company: Option<String>,
    rack_location: Option<String>,
    min_stock_alert: i64,
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
    rack_location: Option<String>,
    min_stock_alert: i64,
    created_at: String,
    available_stock: f64,
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
pub(crate) struct SaleRecord {
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
    medicine_name: String,
    generic_name: Option<String>,
    batch_no: String,
    expiry_date: String,
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
             m.rack_location,
             m.min_stock_alert,
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
                rack_location: row.get("rack_location")?,
                min_stock_alert: row.get("min_stock_alert")?,
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
             m.rack_location,
             m.min_stock_alert,
             m.created_at,
             COALESCE((
               SELECT SUM(stock_batch.current_stock)
               FROM medicine_batches AS stock_batch
               WHERE stock_batch.medicine_id = m.id
                 AND stock_batch.expiry_date >= date('now', 'localtime')
             ), 0) AS available_stock,
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
               ORDER BY
                 CASE WHEN candidate.barcode = ?2 THEN 0 ELSE 1 END,
                 candidate.expiry_date ASC,
                 candidate.id ASC
               LIMIT 1
             )
           WHERE m.name LIKE ?1 ESCAPE '!'
              OR COALESCE(m.generic_name, '') LIKE ?1 ESCAPE '!'
              OR COALESCE(m.company, '') LIKE ?1 ESCAPE '!'
              OR EXISTS (
                SELECT 1 FROM medicine_batches AS barcode_batch
                WHERE barcode_batch.medicine_id = m.id
                  AND (
                    barcode_batch.barcode = ?2
                    OR barcode_batch.barcode LIKE ?1 ESCAPE '!'
                  )
              )
           ORDER BY
             CASE WHEN EXISTS (
               SELECT 1 FROM medicine_batches AS exact_barcode
               WHERE exact_barcode.medicine_id = m.id
                 AND exact_barcode.barcode = ?2
             ) THEN 0 ELSE 1 END,
             m.name COLLATE NOCASE ASC,
             m.id ASC
           LIMIT ?3"#,
        params![pattern, search_term, limit],
        |row| {
            Ok(MedicineSearchRecord {
                id: row.get("id")?,
                name: row.get("name")?,
                generic_name: row.get("generic_name")?,
                company: row.get("company")?,
                rack_location: row.get("rack_location")?,
                min_stock_alert: row.get("min_stock_alert")?,
                created_at: row.get("created_at")?,
                available_stock: row.get("available_stock")?,
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
             id, name, contact_person, phone, whatsapp_phone, address, notes, balance_due
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
                balance_due: row.get("balance_due")?,
            })
        },
    )
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

fn map_sale(row: &Row<'_>) -> rusqlite::Result<SaleRecord> {
    Ok(SaleRecord {
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
        r#"SELECT id, invoice_no, customer_name, customer_phone, subtotal, discount,
                  flat_discount, grand_total, payment_mode, cash_tendered, change_due,
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
                    items: vec![crate::PurchaseItemRequest {
                        medicine_id: 1,
                        batch_no: "QA-B-1".to_owned(),
                        expiry_date: "2099-12-31".to_owned(),
                        purchase_rate_cents: 400,
                        mrp_cents: 800,
                        sale_rate_cents: 700,
                        quantity: 10,
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
                    customer_name: None,
                    customer_phone: None,
                    payment_mode: "CASH".to_owned(),
                    flat_discount_cents: 0,
                    cash_tendered_cents: 700,
                    items: vec![crate::SaleCheckoutItem {
                        medicine_id: 1,
                        batch_id,
                        quantity: 1,
                        unit_price_cents: 700,
                        item_discount_cents: 0,
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
