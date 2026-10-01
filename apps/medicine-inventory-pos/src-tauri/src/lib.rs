use std::time::Duration;

use rusqlite::{
    params, params_from_iter, types::Value as SqliteValue, Connection, OptionalExtension,
    TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

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

fn open_pharmacy_connection(app: &AppHandle) -> Result<Connection, String> {
    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not locate the app configuration directory: {error}"))?;
    std::fs::create_dir_all(&app_config_dir)
        .map_err(|error| format!("Could not create the app configuration directory: {error}"))?;

    let connection = Connection::open(app_config_dir.join("pharmacy.db"))
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

        let line_gross_cents = item
            .unit_price_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| "Sale item total exceeds the supported amount.".to_owned())?;
        let line_total_cents = line_gross_cents - item.item_discount_cents;
        transaction
            .execute(
                r#"INSERT INTO sale_items (
                     sale_id, batch_id, quantity, unit_price, item_discount, total_price
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                params![
                    sale_id,
                    item.batch_id,
                    item.quantity,
                    item.unit_price_cents as f64 / 100.0,
                    item.item_discount_cents as f64 / 100.0,
                    line_total_cents as f64 / 100.0,
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
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            execute_sql_transaction,
            complete_sale,
            complete_purchase
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
