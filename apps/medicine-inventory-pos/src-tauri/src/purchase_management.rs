use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::{
    calculate_gst_amounts, open_pharmacy_connection, normalized_state_code,
    normalized_optional_text, validate_optional_gst_rate,
};

const MAX_PURCHASE_LINES: usize = 500;
const MAX_ATTACHMENT_BYTES: u64 = 20_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurchaseItemRequest {
    pub medicine_id: i64,
    pub batch_no: String,
    pub expiry_date: String,
    pub purchase_rate_cents: i64,
    pub mrp_cents: i64,
    pub sale_rate_cents: i64,
    pub quantity: i64,
    #[serde(default)]
    pub gst_rate_override_basis_points: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurchaseRequest {
    pub supplier_id: i64,
    pub invoice_no: String,
    pub purchase_date: String,
    #[serde(default)]
    pub gst_pricing_mode: Option<String>,
    #[serde(default)]
    pub place_of_supply_state_code: Option<String>,
    pub items: Vec<PurchaseItemRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurchaseResult {
    pub(crate) purchase_id: i64,
    pub(crate) total_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupplierPaymentRequest {
    supplier_id: i64,
    payment_date: String,
    amount_cents: i64,
    payment_method: String,
    transaction_reference: Option<String>,
    note: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupplierPaymentResult {
    ledger_entry_id: i64,
    balance_due_cents: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PurchaseReturnItemRequest {
    purchase_item_id: i64,
    quantity: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurchaseReturnRequest {
    purchase_id: i64,
    return_date: String,
    note: Option<String>,
    items: Vec<PurchaseReturnItemRequest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurchaseReturnResult {
    return_id: i64,
    total_cents: i64,
}

#[derive(Clone, Debug)]
struct TaxSnapshot {
    enabled: bool,
    pricing_mode: String,
    tax_type: String,
    place_of_supply: Option<String>,
    taxable_cents: i64,
    cgst_cents: i64,
    sgst_cents: i64,
    igst_cents: i64,
    total_gst_cents: i64,
    total_cents: i64,
}

#[derive(Clone, Debug)]
struct ComputedLine {
    request: PurchaseItemRequest,
    batch_no: String,
    gst_rate_basis_points: i64,
    taxable_cents: i64,
    cgst_cents: i64,
    sgst_cents: i64,
    igst_cents: i64,
    total_gst_cents: i64,
}

fn valid_date(transaction: &Transaction<'_>, date: &str, label: &str) -> Result<(), String> {
    let valid: bool = transaction
        .query_row(
            "SELECT COALESCE(length(?1) = 10 AND date(?1) = ?1, 0)",
            [date],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not validate the {label}: {error}"))?;
    if !valid {
        return Err(format!("Enter a valid {label}."));
    }
    Ok(())
}

fn setting(transaction: &Transaction<'_>, key: &str) -> Result<Option<String>, String> {
    transaction
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read the {key} setting: {error}"))
}

fn compute_purchase_lines(
    transaction: &Transaction<'_>,
    purchase: &PurchaseRequest,
    excluding_purchase_id: Option<i64>,
) -> Result<(Vec<ComputedLine>, TaxSnapshot), String> {
    let invoice_no = purchase.invoice_no.trim();
    if invoice_no.is_empty() || invoice_no.len() > 100 {
        return Err("Enter a purchase invoice number of 1 to 100 characters.".to_owned());
    }
    if purchase.supplier_id <= 0 {
        return Err("Select a supplier before saving the purchase.".to_owned());
    }
    if purchase.items.is_empty() || purchase.items.len() > MAX_PURCHASE_LINES {
        return Err("A purchase must contain between 1 and 500 line items.".to_owned());
    }
    valid_date(transaction, &purchase.purchase_date, "purchase date")?;

    let supplier: Option<Option<String>> = transaction
        .query_row(
            "SELECT state_code FROM suppliers WHERE id = ?1",
            [purchase.supplier_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not validate the supplier: {error}"))?;
    let supplier_state = supplier
        .ok_or_else(|| "The selected supplier no longer exists. Refresh the supplier list.".to_owned())?;

    let duplicate_invoice: bool = transaction
        .query_row(
            r#"SELECT EXISTS(
                 SELECT 1 FROM purchases
                 WHERE supplier_id = ?1 AND invoice_no = ?2 COLLATE NOCASE
                   AND (?3 IS NULL OR id <> ?3)
               )"#,
            params![purchase.supplier_id, invoice_no, excluding_purchase_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check the supplier invoice number: {error}"))?;
    if duplicate_invoice {
        return Err("That invoice number is already recorded for this supplier.".to_owned());
    }

    let gst_enabled = setting(transaction, "gst_enabled")?
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let default_rate = setting(transaction, "gst_default_rate_basis_points")?
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .parse::<i64>()
                .map_err(|_| "The configured default GST rate is invalid.".to_owned())
        })
        .transpose()?;
    validate_optional_gst_rate(default_rate)?;
    let configured_mode = setting(transaction, "gst_pricing_mode")?
        .unwrap_or_else(|| "EXCLUSIVE".to_owned())
        .to_ascii_uppercase();
    if !matches!(configured_mode.as_str(), "INCLUSIVE" | "EXCLUSIVE") {
        return Err("The configured GST pricing mode is invalid.".to_owned());
    }
    let pricing_mode = purchase
        .gst_pricing_mode
        .as_deref()
        .unwrap_or(&configured_mode)
        .trim()
        .to_ascii_uppercase();
    if !matches!(pricing_mode.as_str(), "INCLUSIVE" | "EXCLUSIVE") {
        return Err("Purchase GST pricing mode must be inclusive or exclusive.".to_owned());
    }
    let pharmacy_state = normalized_state_code(setting(transaction, "gst_pharmacy_state_code")?)?;
    if gst_enabled && pharmacy_state.is_none() {
        return Err("Set the pharmacy state in Settings before recording a GST purchase.".to_owned());
    }
    let requested_place = normalized_state_code(purchase.place_of_supply_state_code.clone())?;
    let place_of_supply = requested_place.or(supplier_state).or_else(|| pharmacy_state.clone());
    let interstate = gst_enabled && place_of_supply.as_deref() != pharmacy_state.as_deref();
    let tax_type = if !gst_enabled {
        "NONE"
    } else if interstate {
        "IGST"
    } else {
        "CGST_SGST"
    };

    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::with_capacity(purchase.items.len());
    let mut taxable_cents = 0_i64;
    let mut cgst_cents = 0_i64;
    let mut sgst_cents = 0_i64;
    let mut igst_cents = 0_i64;
    let mut total_gst_cents = 0_i64;
    let mut total_cents = 0_i64;
    for (index, item) in purchase.items.iter().enumerate() {
        let line_number = index + 1;
        let batch_no = item.batch_no.trim().to_owned();
        if item.medicine_id <= 0
            || item.quantity <= 0
            || item.quantity > 1_000_000_000
            || batch_no.is_empty()
            || batch_no.len() > 80
            || item.purchase_rate_cents < 0
            || item.mrp_cents < 0
            || item.sale_rate_cents < 0
        {
            return Err(format!(
                "Purchase line {line_number} needs a medicine, batch number, valid prices, and a positive quantity."
            ));
        }
        if !seen.insert(format!(
            "{}:{}:{}",
            item.medicine_id,
            batch_no.to_lowercase(),
            item.expiry_date
        )) {
            return Err(format!(
                "Combine duplicate batch {batch_no} into one purchase line."
            ));
        }
        valid_date(transaction, &item.expiry_date, "batch expiry date")?;
        let valid_expiry: bool = transaction
            .query_row(
                "SELECT COALESCE(?1 >= date('now', 'localtime'), 0)",
                [&item.expiry_date],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not validate expiry for batch {batch_no}: {error}"))?;
        if !valid_expiry {
            return Err(format!("Batch {batch_no} must expire today or later."));
        }
        let medicine_rate: Option<i64> = transaction
            .query_row(
                "SELECT gst_rate_basis_points FROM medicines WHERE id = ?1",
                [item.medicine_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Could not validate medicine on line {line_number}: {error}"))?
            .flatten();
        if medicine_rate.is_none() {
            let exists: bool = transaction
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM medicines WHERE id = ?1)",
                    [item.medicine_id],
                    |row| row.get(0),
                )
                .map_err(|error| format!("Could not validate medicine on line {line_number}: {error}"))?;
            if !exists {
                return Err(format!("Medicine on line {line_number} no longer exists."));
            }
        }
        let rate = if gst_enabled {
            let rate = item
                .gst_rate_override_basis_points
                .or(medicine_rate)
                .or(default_rate)
                .ok_or_else(|| {
                    format!("GST is enabled, but line {line_number} has no medicine or default rate.")
                })?;
            validate_optional_gst_rate(Some(rate))?;
            rate
        } else {
            0
        };
        let base_total = item
            .purchase_rate_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| format!("Purchase line {line_number} exceeds the supported amount."))?;
        let amounts = calculate_gst_amounts(base_total, rate, &pricing_mode, interstate, gst_enabled)?;
        let payable = if gst_enabled && pricing_mode == "EXCLUSIVE" {
            base_total
                .checked_add(amounts.total_gst_cents)
                .ok_or_else(|| "The purchase total exceeds the supported amount.".to_owned())?
        } else {
            base_total
        };
        total_cents = total_cents
            .checked_add(payable)
            .ok_or_else(|| "The purchase total exceeds the supported amount.".to_owned())?;
        taxable_cents = taxable_cents.checked_add(amounts.taxable_cents)
            .ok_or_else(|| "The taxable purchase amount exceeds the supported amount.".to_owned())?;
        cgst_cents = cgst_cents.checked_add(amounts.cgst_cents)
            .ok_or_else(|| "The CGST amount exceeds the supported amount.".to_owned())?;
        sgst_cents = sgst_cents.checked_add(amounts.sgst_cents)
            .ok_or_else(|| "The SGST amount exceeds the supported amount.".to_owned())?;
        igst_cents = igst_cents.checked_add(amounts.igst_cents)
            .ok_or_else(|| "The IGST amount exceeds the supported amount.".to_owned())?;
        total_gst_cents = total_gst_cents.checked_add(amounts.total_gst_cents)
            .ok_or_else(|| "The purchase GST exceeds the supported amount.".to_owned())?;
        lines.push(ComputedLine {
            request: item.clone(),
            batch_no,
            gst_rate_basis_points: rate,
            taxable_cents: amounts.taxable_cents,
            cgst_cents: amounts.cgst_cents,
            sgst_cents: amounts.sgst_cents,
            igst_cents: amounts.igst_cents,
            total_gst_cents: amounts.total_gst_cents,
        });
    }
    Ok((
        lines,
        TaxSnapshot {
            enabled: gst_enabled,
            pricing_mode,
            tax_type: tax_type.to_owned(),
            place_of_supply,
            taxable_cents,
            cgst_cents,
            sgst_cents,
            igst_cents,
            total_gst_cents,
            total_cents,
        },
    ))
}

impl Clone for PurchaseItemRequest {
    fn clone(&self) -> Self {
        Self {
            medicine_id: self.medicine_id,
            batch_no: self.batch_no.clone(),
            expiry_date: self.expiry_date.clone(),
            purchase_rate_cents: self.purchase_rate_cents,
            mrp_cents: self.mrp_cents,
            sale_rate_cents: self.sale_rate_cents,
            quantity: self.quantity,
            gst_rate_override_basis_points: self.gst_rate_override_basis_points,
        }
    }
}

fn add_ledger_entry(
    transaction: &Transaction<'_>,
    supplier_id: i64,
    entry_type: &str,
    purchase_id: Option<i64>,
    reference: Option<&str>,
    debit_cents: i64,
    credit_cents: i64,
    payment_method: Option<&str>,
    transaction_reference: Option<&str>,
    note: Option<&str>,
    created_at: Option<&str>,
) -> Result<(i64, i64), String> {
    if supplier_id <= 0
        || debit_cents < 0
        || credit_cents < 0
        || !((debit_cents > 0 && credit_cents == 0)
            || (debit_cents == 0 && credit_cents > 0))
    {
        return Err("Supplier ledger amounts must be valid non-negative values.".to_owned());
    }
    let current_cents: i64 = transaction
        .query_row(
            "SELECT CAST(ROUND(balance_due * 100) AS INTEGER) FROM suppliers WHERE id = ?1",
            [supplier_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read the supplier balance: {error}"))?
        .ok_or_else(|| "The supplier no longer exists.".to_owned())?;
    let next_cents = current_cents
        .checked_add(debit_cents)
        .and_then(|value| value.checked_sub(credit_cents))
        .ok_or_else(|| "The supplier balance exceeds the supported amount.".to_owned())?;
    if next_cents < 0 {
        return Err("This transaction is greater than the supplier's outstanding balance.".to_owned());
    }
    transaction
        .execute(
            r#"INSERT INTO supplier_ledger (
                 supplier_id, entry_type, purchase_id, reference, debit_cents, credit_cents,
                 payment_method, transaction_reference, note, created_at
               ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, COALESCE(?10, CURRENT_TIMESTAMP))"#,
            params![
                supplier_id,
                entry_type,
                purchase_id,
                reference,
                debit_cents,
                credit_cents,
                payment_method,
                transaction_reference,
                note,
                created_at,
            ],
        )
        .map_err(|error| format!("Could not record the supplier ledger transaction: {error}"))?;
    let entry_id = transaction.last_insert_rowid();
    transaction
        .execute(
            "UPDATE suppliers SET balance_due = ?1 / 100.0 WHERE id = ?2",
            params![next_cents, supplier_id],
        )
        .map_err(|error| format!("Could not update the supplier balance: {error}"))?;
    Ok((entry_id, next_cents))
}

fn update_batch_stock_in(
    transaction: &Transaction<'_>,
    line: &ComputedLine,
) -> Result<i64, String> {
    let item = &line.request;
    let existing_batch: Option<(i64, i64)> = transaction
        .query_row(
            r#"SELECT id, current_stock FROM medicine_batches
               WHERE medicine_id = ?1 AND batch_no = ?2 COLLATE NOCASE AND expiry_date = ?3
               ORDER BY id LIMIT 1"#,
            params![item.medicine_id, line.batch_no, item.expiry_date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not find batch {}: {error}", line.batch_no))?;
    if let Some((batch_id, current_stock)) = existing_batch {
        let new_stock = current_stock
            .checked_add(item.quantity)
            .ok_or_else(|| format!("Stock for batch {} exceeds the supported amount.", line.batch_no))?;
        transaction
            .execute(
                r#"UPDATE medicine_batches
                   SET purchase_rate = ?1, mrp = ?2, sale_rate = ?3, current_stock = ?4
                   WHERE id = ?5"#,
                params![
                    item.purchase_rate_cents as f64 / 100.0,
                    item.mrp_cents as f64 / 100.0,
                    item.sale_rate_cents as f64 / 100.0,
                    new_stock,
                    batch_id,
                ],
            )
            .map_err(|error| format!("Could not receive batch {}: {error}", line.batch_no))?;
        Ok(batch_id)
    } else {
        transaction
            .execute(
                r#"INSERT INTO medicine_batches
                   (medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
                params![
                    item.medicine_id,
                    line.batch_no,
                    item.expiry_date,
                    item.purchase_rate_cents as f64 / 100.0,
                    item.mrp_cents as f64 / 100.0,
                    item.sale_rate_cents as f64 / 100.0,
                    item.quantity,
                ],
            )
            .map_err(|error| format!("Could not create batch {}: {error}", line.batch_no))?;
        Ok(transaction.last_insert_rowid())
    }
}

fn insert_purchase_lines(
    transaction: &Transaction<'_>,
    purchase_id: i64,
    lines: &[ComputedLine],
) -> Result<(), String> {
    for line in lines {
        let batch_id = update_batch_stock_in(transaction, line)?;
        let item = &line.request;
        let base_total = item
            .purchase_rate_cents
            .checked_mul(item.quantity)
            .ok_or_else(|| "A purchase line exceeds the supported amount.".to_owned())?;
        transaction
            .execute(
                r#"INSERT INTO purchase_items (
                     purchase_id, batch_id, quantity, rate, total, gst_rate_basis_points,
                     taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst
                   ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)"#,
                params![
                    purchase_id,
                    batch_id,
                    item.quantity,
                    item.purchase_rate_cents as f64 / 100.0,
                    base_total as f64 / 100.0,
                    line.gst_rate_basis_points,
                    line.taxable_cents as f64 / 100.0,
                    line.cgst_cents as f64 / 100.0,
                    line.sgst_cents as f64 / 100.0,
                    line.igst_cents as f64 / 100.0,
                    line.total_gst_cents as f64 / 100.0,
                ],
            )
            .map_err(|error| format!("Could not save purchase line {}: {error}", line.batch_no))?;
    }
    Ok(())
}

fn save_purchase_header(
    transaction: &Transaction<'_>,
    purchase_id: i64,
    purchase: &PurchaseRequest,
    tax: &TaxSnapshot,
) -> Result<(), String> {
    transaction
        .execute(
            r#"UPDATE purchases
               SET invoice_no = ?1, supplier_id = ?2, total_amount = ?3, purchase_date = ?4,
                   gst_enabled = ?5, gst_pricing_mode = ?6, tax_type = ?7,
                   taxable_amount = ?8, cgst_amount = ?9, sgst_amount = ?10,
                   igst_amount = ?11, total_gst = ?12, place_of_supply_state_code = ?13
               WHERE id = ?14"#,
            params![
                purchase.invoice_no.trim(),
                purchase.supplier_id,
                tax.total_cents as f64 / 100.0,
                purchase.purchase_date,
                tax.enabled,
                tax.pricing_mode,
                tax.tax_type,
                tax.taxable_cents as f64 / 100.0,
                tax.cgst_cents as f64 / 100.0,
                tax.sgst_cents as f64 / 100.0,
                tax.igst_cents as f64 / 100.0,
                tax.total_gst_cents as f64 / 100.0,
                tax.place_of_supply,
                purchase_id,
            ],
        )
        .map_err(|error| format!("Could not save the purchase invoice: {error}"))?;
    Ok(())
}

pub(crate) fn record_purchase(
    connection: &mut Connection,
    purchase: PurchaseRequest,
) -> Result<PurchaseResult, String> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the purchase transaction: {error}"))?;
    let (lines, tax) = compute_purchase_lines(&transaction, &purchase, None)?;
    transaction
        .execute(
            r#"INSERT INTO purchases (invoice_no, supplier_id, total_amount, purchase_date)
               VALUES (?1, ?2, 0, ?3)"#,
            params![purchase.invoice_no.trim(), purchase.supplier_id, purchase.purchase_date],
        )
        .map_err(|error| format!("Could not create the purchase invoice: {error}"))?;
    let purchase_id = transaction.last_insert_rowid();
    save_purchase_header(&transaction, purchase_id, &purchase, &tax)?;
    insert_purchase_lines(&transaction, purchase_id, &lines)?;
    if tax.total_cents > 0 {
        add_ledger_entry(
            &transaction,
            purchase.supplier_id,
            "PURCHASE",
            Some(purchase_id),
            Some(purchase.invoice_no.trim()),
            tax.total_cents,
            0,
            None,
            None,
            Some("Purchase invoice recorded"),
            Some(&purchase.purchase_date),
        )?;
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the purchase and stock-in: {error}"))?;
    Ok(PurchaseResult {
        purchase_id,
        total_cents: tax.total_cents,
    })
}

#[tauri::command]
pub(crate) fn complete_purchase(
    app: AppHandle,
    purchase: PurchaseRequest,
) -> Result<PurchaseResult, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    record_purchase(&mut connection, purchase)
}

fn reverse_purchase_stock(
    transaction: &Transaction<'_>,
    purchase_id: i64,
    include_returned: bool,
) -> Result<(), String> {
    let rows = {
        let mut statement = transaction
            .prepare(
                r#"SELECT pi.id, pi.batch_id, pi.quantity,
                          COALESCE((SELECT SUM(pri.quantity)
                                    FROM purchase_return_items pri
                                    JOIN purchase_returns pr ON pr.id = pri.return_id
                                    WHERE pri.purchase_item_id = pi.id), 0) AS returned
                   FROM purchase_items pi WHERE pi.purchase_id = ?1 ORDER BY pi.id"#,
            )
            .map_err(|error| format!("Could not inspect purchase stock: {error}"))?;
        let mapped = statement
            .query_map([purchase_id], |row| {
                Ok((
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|error| format!("Could not inspect purchase stock: {error}"))?;
        mapped
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Could not read purchase stock: {error}"))?
    };
    for (batch_id, quantity, returned) in rows {
        if !include_returned && returned > 0 {
            return Err("A purchase with recorded returns cannot be edited.".to_owned());
        }
        let remaining = quantity - returned;
        let changed = transaction
            .execute(
                "UPDATE medicine_batches SET current_stock = current_stock - ?1 WHERE id = ?2 AND current_stock >= ?1",
                params![remaining, batch_id],
            )
            .map_err(|error| format!("Could not reverse purchase stock: {error}"))?;
        if changed != 1 {
            return Err("Stock from this purchase has already been sold or adjusted; the change cannot safely reverse it.".to_owned());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn edit_purchase(
    app: AppHandle,
    purchase_id: i64,
    purchase: PurchaseRequest,
) -> Result<PurchaseResult, String> {
    if purchase_id <= 0 {
        return Err("Purchase id must be a positive whole number.".to_owned());
    }
    let mut connection = open_pharmacy_connection(&app)?;
    edit_purchase_in_connection(&mut connection, purchase_id, purchase)
}

fn edit_purchase_in_connection(
    connection: &mut Connection,
    purchase_id: i64,
    purchase: PurchaseRequest,
) -> Result<PurchaseResult, String> {
    if purchase_id <= 0 {
        return Err("Purchase id must be a positive whole number.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the purchase edit: {error}"))?;
    let current: Option<(String, i64, i64, String, String)> = transaction
        .query_row(
            "SELECT invoice_no, supplier_id, CAST(ROUND(total_amount * 100) AS INTEGER), purchase_date, status FROM purchases WHERE id = ?1",
            [purchase_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read the purchase invoice: {error}"))?;
    let (old_invoice, old_supplier, old_total_cents, _, status) =
        current.ok_or_else(|| "The purchase invoice no longer exists.".to_owned())?;
    if status != "ACTIVE" {
        return Err("A cancelled purchase cannot be edited.".to_owned());
    }
    let has_returns: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM purchase_returns WHERE purchase_id = ?1)",
            [purchase_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check purchase returns: {error}"))?;
    if has_returns {
        return Err("A purchase with recorded returns cannot be edited.".to_owned());
    }
    let (lines, tax) = compute_purchase_lines(&transaction, &purchase, Some(purchase_id))?;
    reverse_purchase_stock(&transaction, purchase_id, false)?;
    transaction
        .execute("DELETE FROM purchase_items WHERE purchase_id = ?1", [purchase_id])
        .map_err(|error| format!("Could not replace purchase lines: {error}"))?;
    insert_purchase_lines(&transaction, purchase_id, &lines)?;
    save_purchase_header(&transaction, purchase_id, &purchase, &tax)?;
    if old_supplier == purchase.supplier_id {
        if tax.total_cents > old_total_cents {
            add_ledger_entry(
                &transaction, old_supplier, "ADJUSTMENT", Some(purchase_id),
                Some(&purchase.invoice_no), tax.total_cents - old_total_cents, 0, None, None,
                Some("Purchase invoice edited: amount increased"), Some(&purchase.purchase_date),
            )?;
        } else if old_total_cents > tax.total_cents {
            add_ledger_entry(
                &transaction, old_supplier, "ADJUSTMENT", Some(purchase_id),
                Some(&old_invoice), 0, old_total_cents - tax.total_cents, None, None,
                Some("Purchase invoice edited: amount decreased"), Some(&purchase.purchase_date),
            )?;
        }
    } else {
        if old_total_cents > 0 {
            add_ledger_entry(
                &transaction, old_supplier, "ADJUSTMENT", Some(purchase_id),
                Some(&old_invoice), 0, old_total_cents, None, None,
                Some("Purchase invoice reassigned to another supplier"), Some(&purchase.purchase_date),
            )?;
        }
        if tax.total_cents > 0 {
            add_ledger_entry(
                &transaction, purchase.supplier_id, "ADJUSTMENT", Some(purchase_id),
                Some(&purchase.invoice_no), tax.total_cents, 0, None, None,
                Some("Purchase invoice reassigned from another supplier"), Some(&purchase.purchase_date),
            )?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the purchase edit: {error}"))?;
    Ok(PurchaseResult {
        purchase_id,
        total_cents: tax.total_cents,
    })
}

#[tauri::command]
pub(crate) fn cancel_purchase(app: AppHandle, purchase_id: i64) -> Result<(), String> {
    if purchase_id <= 0 {
        return Err("Purchase id must be a positive whole number.".to_owned());
    }
    let mut connection = open_pharmacy_connection(&app)?;
    cancel_purchase_in_connection(&mut connection, purchase_id)
}

fn cancel_purchase_in_connection(
    connection: &mut Connection,
    purchase_id: i64,
) -> Result<(), String> {
    if purchase_id <= 0 {
        return Err("Purchase id must be a positive whole number.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin purchase cancellation: {error}"))?;
    let record: Option<(i64, String, i64, String)> = transaction
        .query_row(
            "SELECT supplier_id, invoice_no, CAST(ROUND(total_amount * 100) AS INTEGER), status FROM purchases WHERE id = ?1",
            [purchase_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read the purchase invoice: {error}"))?;
    let (supplier_id, invoice_no, total_cents, status) =
        record.ok_or_else(|| "The purchase invoice no longer exists.".to_owned())?;
    if status != "ACTIVE" {
        return Err("This purchase is already cancelled.".to_owned());
    }
    reverse_purchase_stock(&transaction, purchase_id, true)?;
    let returned_cents: i64 = transaction
        .query_row(
            "SELECT COALESCE(SUM(total_cents), 0) FROM purchase_returns WHERE purchase_id = ?1",
            [purchase_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not total purchase returns: {error}"))?;
    let credit_cents = total_cents.saturating_sub(returned_cents);
    if credit_cents > 0 {
        add_ledger_entry(
            &transaction,
            supplier_id,
            "ADJUSTMENT",
            Some(purchase_id),
            Some(&invoice_no),
            0,
            credit_cents,
            None,
            None,
            Some("Purchase invoice cancelled"),
            None,
        )?;
    }
    transaction
        .execute(
            "UPDATE purchases SET status = 'CANCELLED' WHERE id = ?1 AND status = 'ACTIVE'",
            [purchase_id],
        )
        .map_err(|error| format!("Could not cancel the purchase invoice: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit purchase cancellation: {error}"))
}

fn return_line_totals(
    transaction: &Transaction<'_>,
    purchase_id: i64,
    item: &PurchaseReturnItemRequest,
) -> Result<(i64, i64, i64, i64), String> {
    if item.purchase_item_id <= 0 || item.quantity <= 0 {
        return Err("Return lines need a saved purchase item and a positive quantity.".to_owned());
    }
    let line: Option<(i64, i64, i64, bool, String, String, i64)> = transaction
        .query_row(
            r#"SELECT pi.batch_id, pi.quantity, CAST(ROUND(pi.rate * 100) AS INTEGER),
                      p.gst_enabled, p.gst_pricing_mode, p.tax_type, pi.gst_rate_basis_points
               FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
               WHERE pi.id = ?1 AND p.id = ?2 AND p.status = 'ACTIVE'"#,
            params![item.purchase_item_id, purchase_id],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?,
            )),
        )
        .optional()
        .map_err(|error| format!("Could not inspect the purchase item for return: {error}"))?;
    let (
        batch_id,
        purchased_quantity,
        rate_cents,
        gst_enabled,
        pricing_mode,
        tax_type,
        gst_rate,
    ) =
        line.ok_or_else(|| "The purchase line is missing or its invoice is cancelled.".to_owned())?;
    let already_returned: i64 = transaction
        .query_row(
            "SELECT COALESCE(SUM(quantity), 0) FROM purchase_return_items WHERE purchase_item_id = ?1",
            [item.purchase_item_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not read previously returned quantity: {error}"))?;
    if item.quantity > purchased_quantity - already_returned {
        return Err("Return quantity exceeds the available quantity on this purchase line.".to_owned());
    }
    let base_cents = rate_cents
        .checked_mul(item.quantity)
        .ok_or_else(|| "Return value exceeds the supported amount.".to_owned())?;
    let amounts = calculate_gst_amounts(
        base_cents,
        gst_rate,
        &pricing_mode,
        tax_type == "IGST",
        gst_enabled,
    )?;
    let total_cents = if gst_enabled && pricing_mode == "EXCLUSIVE" {
        base_cents
            .checked_add(amounts.total_gst_cents)
            .ok_or_else(|| "Return value exceeds the supported amount.".to_owned())?
    } else {
        base_cents
    };
    Ok((batch_id, base_cents, total_cents, amounts.total_gst_cents))
}

#[tauri::command]
pub(crate) fn return_purchase(
    app: AppHandle,
    request: PurchaseReturnRequest,
) -> Result<PurchaseReturnResult, String> {
    if request.purchase_id <= 0 || request.items.is_empty() {
        return Err("Select a purchase invoice and at least one return line.".to_owned());
    }
    let mut connection = open_pharmacy_connection(&app)?;
    return_purchase_in_connection(&mut connection, request)
}

fn return_purchase_in_connection(
    connection: &mut Connection,
    request: PurchaseReturnRequest,
) -> Result<PurchaseReturnResult, String> {
    if request.purchase_id <= 0 || request.items.is_empty() {
        return Err("Select a purchase invoice and at least one return line.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the purchase return: {error}"))?;
    valid_date(&transaction, &request.return_date, "return date")?;
    let header: Option<(i64, String, String)> = transaction
        .query_row(
            "SELECT supplier_id, invoice_no, status FROM purchases WHERE id = ?1",
            [request.purchase_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read the purchase invoice: {error}"))?;
    let (supplier_id, invoice_no, status) =
        header.ok_or_else(|| "The purchase invoice no longer exists.".to_owned())?;
    if status != "ACTIVE" {
        return Err("A cancelled purchase cannot be returned.".to_owned());
    }
    let mut total_cents = 0_i64;
    let mut computed = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in &request.items {
        if !seen.insert(item.purchase_item_id) {
            return Err("Combine duplicate return lines for the same purchase item.".to_owned());
        }
        let values = return_line_totals(&transaction, request.purchase_id, item)?;
        let enough_stock: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM medicine_batches WHERE id = ?1 AND current_stock >= ?2)",
                params![values.0, item.quantity],
                |row| row.get(0),
            )
            .map_err(|error| format!("Could not verify stock for return: {error}"))?;
        if !enough_stock {
            return Err("Current batch stock is insufficient for this return; returned or sold units cannot be removed again.".to_owned());
        }
        total_cents = total_cents
            .checked_add(values.2)
            .ok_or_else(|| "Purchase return total exceeds the supported amount.".to_owned())?;
        computed.push((item.purchase_item_id, item.quantity, values));
    }
    if total_cents <= 0 {
        return Err("Purchase return total must be greater than zero.".to_owned());
    }
    let note = normalized_optional_text(request.note.clone(), 500, "Return note")?;
    transaction
        .execute(
            "INSERT INTO purchase_returns (purchase_id, supplier_id, return_date, total_cents, note) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![request.purchase_id, supplier_id, request.return_date, total_cents, note],
        )
        .map_err(|error| format!("Could not record the purchase return: {error}"))?;
    let return_id = transaction.last_insert_rowid();
    for (purchase_item_id, quantity, (batch_id, base_cents, line_total_cents, _gst)) in computed {
        let changed = transaction
            .execute(
                "UPDATE medicine_batches SET current_stock = current_stock - ?1 WHERE id = ?2 AND current_stock >= ?1",
                params![quantity, batch_id],
            )
            .map_err(|error| format!("Could not remove returned stock: {error}"))?;
        if changed != 1 {
            return Err("Current batch stock changed before the return could be saved.".to_owned());
        }
        transaction
            .execute(
                "INSERT INTO purchase_return_items (return_id, purchase_item_id, batch_id, quantity, rate_cents, total_cents) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![return_id, purchase_item_id, batch_id, quantity, base_cents / quantity, line_total_cents],
            )
            .map_err(|error| format!("Could not save purchase return lines: {error}"))?;
    }
    add_ledger_entry(
        &transaction,
        supplier_id,
        "PURCHASE_RETURN",
        Some(request.purchase_id),
        Some(&invoice_no),
        0,
        total_cents,
        None,
        None,
        note.as_deref().or(Some("Purchase return")),
        Some(&request.return_date),
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit the purchase return: {error}"))?;
    Ok(PurchaseReturnResult {
        return_id,
        total_cents,
    })
}

#[tauri::command]
pub(crate) fn create_supplier_payment(
    app: AppHandle,
    payment: SupplierPaymentRequest,
) -> Result<SupplierPaymentResult, String> {
    validate_supplier_payment(&payment)?;
    let mut connection = open_pharmacy_connection(&app)?;
    create_supplier_payment_in_connection(&mut connection, payment)
}

fn validate_supplier_payment(
    payment: &SupplierPaymentRequest,
) -> Result<(String, Option<String>), String> {
    if payment.supplier_id <= 0 || payment.amount_cents <= 0 {
        return Err("Choose a supplier and enter a payment greater than zero.".to_owned());
    }
    let payment_method = payment.payment_method.trim().to_ascii_uppercase();
    if !matches!(payment_method.as_str(), "CASH" | "BANK" | "UPI" | "OTHER") {
        return Err("Choose Cash, Bank, UPI, or Other as the payment method.".to_owned());
    }
    if payment.transaction_reference.as_ref().is_some_and(|value| value.len() > 120) {
        return Err("Payment reference must be 120 characters or fewer.".to_owned());
    }
    let note = normalized_optional_text(payment.note.clone(), 500, "Payment note")?;
    Ok((payment_method, note))
}

fn create_supplier_payment_in_connection(
    connection: &mut Connection,
    payment: SupplierPaymentRequest,
) -> Result<SupplierPaymentResult, String> {
    let (payment_method, note) = validate_supplier_payment(&payment)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin supplier payment: {error}"))?;
    valid_date(&transaction, &payment.payment_date, "payment date")?;
    let reference = payment.transaction_reference.as_deref();
    let (ledger_entry_id, balance_due_cents) = add_ledger_entry(
        &transaction,
        payment.supplier_id,
        "PAYMENT",
        None,
        None,
        0,
        payment.amount_cents,
        Some(&payment_method),
        reference,
        note.as_deref(),
        Some(&payment.payment_date),
    )?;
    transaction
        .commit()
        .map_err(|error| format!("Could not commit supplier payment: {error}"))?;
    Ok(SupplierPaymentResult {
        ledger_entry_id,
        balance_due_cents,
    })
}

fn attachment_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("purchase-attachments"))
        .map_err(|error| format!("Could not access local purchase attachment storage: {error}"))
}

fn supported_attachment(path: &Path) -> Result<(&'static str, &'static str), String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "pdf" => Ok(("pdf", "application/pdf")),
        "jpg" | "jpeg" => Ok(("jpg", "image/jpeg")),
        "png" => Ok(("png", "image/png")),
        _ => Err("Attach a PDF, JPG, JPEG, or PNG invoice file.".to_owned()),
    }
}

fn valid_purchase_attachment_ref(file_ref: &str) -> bool {
    if file_ref.len() > 255
        || !file_ref.is_ascii()
        || !file_ref
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return false;
    }

    let Some((stem, extension)) = file_ref.rsplit_once('.') else {
        return false;
    };
    if stem.contains('.') || !matches!(extension, "pdf" | "jpg" | "png") {
        return false;
    }
    let Some(identifier) = stem.strip_prefix("purchase-") else {
        return false;
    };
    let Some((purchase_id, timestamp)) = identifier.split_once('-') else {
        return false;
    };
    purchase_id.parse::<i64>().is_ok_and(|id| id > 0)
        && !timestamp.is_empty()
        && timestamp.bytes().all(|byte| byte.is_ascii_digit())
}

#[tauri::command]
pub(crate) fn add_purchase_attachment(
    app: AppHandle,
    purchase_id: i64,
    source_path: String,
) -> Result<(), String> {
    if purchase_id <= 0 {
        return Err("Purchase id must be a positive whole number.".to_owned());
    }
    let source = Path::new(&source_path);
    let (extension, mime_type) = supported_attachment(source)?;
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Could not access the selected invoice attachment: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err("The attachment must be a regular file between 1 byte and 20 MB.".to_owned());
    }
    let bytes = fs::read(source).map_err(|error| format!("Could not read the invoice attachment: {error}"))?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("The invoice attachment is larger than 20 MB.".to_owned());
    }
    let valid_content = match mime_type {
        "application/pdf" => bytes.starts_with(b"%PDF-"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        _ => false,
    };
    if !valid_content {
        return Err("The selected file does not match its supported attachment type.".to_owned());
    }
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.len() <= 255)
        .ok_or_else(|| "The attachment filename is invalid.".to_owned())?
        .to_owned();
    let directory = attachment_directory(&app)?;
    crate::ensure_local_storage_directory(&directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The local clock is invalid; the attachment was not saved.".to_owned())?
        .as_nanos();
    let file_ref = format!("purchase-{purchase_id}-{timestamp}.{extension}");
    let destination = directory.join(&file_ref);
    let temporary = directory.join(format!(".{file_ref}.tmp"));
    let mut staged = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("Could not stage the invoice attachment: {error}"))?;
    if let Err(error) = staged.write_all(&bytes).and_then(|()| staged.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not safely save the invoice attachment: {error}"));
    }
    drop(staged);

    let mut connection = open_pharmacy_connection(&app)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin attachment save: {error}"))?;
    let exists: bool = transaction
        .query_row("SELECT EXISTS(SELECT 1 FROM purchases WHERE id = ?1)", [purchase_id], |row| row.get(0))
        .map_err(|error| format!("Could not validate the purchase invoice: {error}"))?;
    if !exists {
        let _ = fs::remove_file(&temporary);
        return Err("The purchase invoice no longer exists.".to_owned());
    }
    transaction
        .execute(
            r#"INSERT INTO purchase_attachments
               (purchase_id, file_ref, file_name, mime_type, size_bytes, sha256)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            params![
                purchase_id,
                file_ref,
                file_name,
                mime_type,
                bytes.len() as i64,
                format!("{:x}", Sha256::digest(&bytes)),
            ],
        )
        .map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Could not save purchase attachment details: {error}")
        })?;
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Could not install the invoice attachment: {error}"));
    }
    if let Err(error) = transaction.commit() {
        let _ = fs::remove_file(&destination);
        return Err(format!("Could not finish saving the invoice attachment: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_purchase_attachment_path(
    app: AppHandle,
    attachment_id: i64,
) -> Result<String, String> {
    if attachment_id <= 0 {
        return Err("Attachment id must be a positive whole number.".to_owned());
    }
    let connection = open_pharmacy_connection(&app)?;
    let (purchase_id, file_ref): (i64, String) = connection
        .query_row(
            "SELECT purchase_id, file_ref FROM purchase_attachments WHERE id = ?1",
            [attachment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("Could not read the purchase attachment: {error}"))?
        .ok_or_else(|| "The purchase attachment no longer exists.".to_owned())?;
    if !valid_purchase_attachment_ref(&file_ref)
        || !file_ref.starts_with(&format!("purchase-{purchase_id}-"))
    {
        return Err("The saved attachment reference is invalid.".to_owned());
    }
    let directory = attachment_directory(&app)?;
    crate::ensure_local_storage_directory(&directory)?;
    let path = directory.join(file_ref);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("The saved invoice attachment is unavailable: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err("The saved invoice attachment is not a supported regular file.".to_owned());
    }
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open purchase test database");
        connection
            .execute_batch("PRAGMA foreign_keys = ON")
            .expect("enable purchase test foreign keys");
        crate::migrate_connection(&mut connection).expect("migrate purchase test database");
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name) VALUES (1, 'Purchase test medicine');
                INSERT INTO suppliers (id, name, state_code) VALUES (1, 'Purchase test supplier', '27');
                "#,
            )
            .expect("seed purchase test records");
        connection
    }

    fn purchase_request(invoice_no: &str, quantity: i64, rate_cents: i64) -> PurchaseRequest {
        PurchaseRequest {
            supplier_id: 1,
            invoice_no: invoice_no.to_owned(),
            purchase_date: "2026-10-03".to_owned(),
            gst_pricing_mode: Some("EXCLUSIVE".to_owned()),
            place_of_supply_state_code: None,
            items: vec![PurchaseItemRequest {
                medicine_id: 1,
                batch_no: "LOT-PURCHASE-1".to_owned(),
                expiry_date: "2099-12-31".to_owned(),
                purchase_rate_cents: rate_cents,
                mrp_cents: 30_000,
                sale_rate_cents: 20_000,
                quantity,
                gst_rate_override_basis_points: None,
            }],
        }
    }

    fn batch_stock(connection: &Connection) -> i64 {
        connection
            .query_row(
                "SELECT current_stock FROM medicine_batches WHERE medicine_id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read purchase test stock")
    }

    fn supplier_balance_cents(connection: &Connection) -> i64 {
        connection
            .query_row(
                "SELECT CAST(ROUND(balance_due * 100) AS INTEGER) FROM suppliers WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read purchase test supplier balance")
    }

    #[test]
    fn purchase_edit_return_and_cancel_keep_stock_and_supplier_ledger_balanced() {
        let mut connection = database();
        let created = record_purchase(
            &mut connection,
            purchase_request("PUR-TEST-001", 5, 2_500),
        )
        .expect("record purchase");
        assert_eq!(created.total_cents, 12_500);
        assert_eq!(batch_stock(&connection), 5);
        assert_eq!(supplier_balance_cents(&connection), 12_500);

        let edited = edit_purchase_in_connection(
            &mut connection,
            created.purchase_id,
            purchase_request("PUR-TEST-001", 6, 3_000),
        )
        .expect("edit purchase");
        assert_eq!(edited.total_cents, 18_000);
        assert_eq!(batch_stock(&connection), 6);
        assert_eq!(supplier_balance_cents(&connection), 18_000);

        let purchase_item_id: i64 = connection
            .query_row(
                "SELECT id FROM purchase_items WHERE purchase_id = ?1",
                [created.purchase_id],
                |row| row.get(0),
            )
            .expect("read edited purchase line id");
        let returned = return_purchase_in_connection(
            &mut connection,
            PurchaseReturnRequest {
                purchase_id: created.purchase_id,
                return_date: "2026-10-04".to_owned(),
                note: Some("Two damaged units".to_owned()),
                items: vec![PurchaseReturnItemRequest {
                    purchase_item_id,
                    quantity: 2,
                }],
            },
        )
        .expect("return two units");
        assert_eq!(returned.total_cents, 6_000);
        assert_eq!(batch_stock(&connection), 4);
        assert_eq!(supplier_balance_cents(&connection), 12_000);

        let excess_return = return_purchase_in_connection(
            &mut connection,
            PurchaseReturnRequest {
                purchase_id: created.purchase_id,
                return_date: "2026-10-04".to_owned(),
                note: None,
                items: vec![PurchaseReturnItemRequest {
                    purchase_item_id,
                    quantity: 5,
                }],
            },
        )
        .expect_err("reject quantity above the unreturned invoice amount");
        assert!(excess_return.contains("exceeds the available quantity"));
        assert_eq!(batch_stock(&connection), 4);
        assert_eq!(supplier_balance_cents(&connection), 12_000);

        cancel_purchase_in_connection(&mut connection, created.purchase_id)
            .expect("cancel remaining invoice quantity");
        assert_eq!(batch_stock(&connection), 0);
        assert_eq!(supplier_balance_cents(&connection), 0);
        let status: String = connection
            .query_row(
                "SELECT status FROM purchases WHERE id = ?1",
                [created.purchase_id],
                |row| row.get(0),
            )
            .expect("read cancelled purchase status");
        assert_eq!(status, "CANCELLED");
        assert!(cancel_purchase_in_connection(&mut connection, created.purchase_id)
            .expect_err("reject repeated cancellation")
            .contains("already cancelled"));
    }

    #[test]
    fn supplier_payments_and_unsafe_purchase_reversals_are_transactional() {
        let mut connection = database();
        let created = record_purchase(
            &mut connection,
            purchase_request("PUR-TEST-002", 4, 2_500),
        )
        .expect("record purchase");
        let payment = SupplierPaymentRequest {
            supplier_id: 1,
            payment_date: "2026-10-03".to_owned(),
            amount_cents: 4_000,
            payment_method: "CASH".to_owned(),
            transaction_reference: None,
            note: Some("Part payment".to_owned()),
        };
        let result = create_supplier_payment_in_connection(&mut connection, payment)
            .expect("record supplier payment");
        assert_eq!(result.balance_due_cents, 6_000);
        assert_eq!(supplier_balance_cents(&connection), 6_000);

        let overpayment = create_supplier_payment_in_connection(
            &mut connection,
            SupplierPaymentRequest {
                supplier_id: 1,
                payment_date: "2026-10-03".to_owned(),
                amount_cents: 7_000,
                payment_method: "BANK".to_owned(),
                transaction_reference: None,
                note: None,
            },
        )
        .expect_err("reject a payment greater than the outstanding balance");
        assert!(overpayment.contains("greater than the supplier's outstanding balance"));
        assert_eq!(supplier_balance_cents(&connection), 6_000);

        connection
            .execute(
                "UPDATE medicine_batches SET current_stock = 3 WHERE medicine_id = 1",
                [],
            )
            .expect("simulate one unit already sold");
        let unsafe_edit = edit_purchase_in_connection(
            &mut connection,
            created.purchase_id,
            purchase_request("PUR-TEST-002", 5, 2_500),
        )
        .expect_err("reject edit when purchase stock is no longer available");
        assert!(unsafe_edit.contains("cannot safely reverse"));
        assert_eq!(batch_stock(&connection), 3);
        assert_eq!(supplier_balance_cents(&connection), 6_000);

        let unsafe_cancel = cancel_purchase_in_connection(&mut connection, created.purchase_id)
            .expect_err("reject cancellation when purchase stock is no longer available");
        assert!(unsafe_cancel.contains("cannot safely reverse"));
        assert_eq!(batch_stock(&connection), 3);
        assert_eq!(supplier_balance_cents(&connection), 6_000);
        let status: String = connection
            .query_row(
                "SELECT status FROM purchases WHERE id = ?1",
                [created.purchase_id],
                |row| row.get(0),
            )
            .expect("read unchanged purchase status");
        assert_eq!(status, "ACTIVE");
    }

    #[test]
    fn purchase_gst_snapshot_survives_later_store_setting_changes() {
        let mut connection = database();
        connection
            .execute_batch(
                r#"
                INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES
                    ('gst_enabled', 'true'),
                    ('gst_default_rate_basis_points', '1800'),
                    ('gst_pricing_mode', 'EXCLUSIVE'),
                    ('gst_pharmacy_state_code', '27');
                "#,
            )
            .expect("configure GST for purchase test");
        let created = record_purchase(
            &mut connection,
            purchase_request("PUR-TEST-GST", 1, 10_000),
        )
        .expect("record GST purchase");
        assert_eq!(created.total_cents, 11_800);

        connection
            .execute_batch(
                "UPDATE app_settings SET setting_value = 'false' WHERE setting_key = 'gst_enabled';
                 UPDATE app_settings SET setting_value = '500' WHERE setting_key = 'gst_default_rate_basis_points';
                 UPDATE suppliers SET state_code = '29' WHERE id = 1;",
            )
            .expect("change store and supplier GST settings");
        let snapshot: (bool, String, String, i64, i64, i64, i64) = connection
            .query_row(
                r#"SELECT gst_enabled, gst_pricing_mode, tax_type,
                          CAST(ROUND(taxable_amount * 100) AS INTEGER),
                          CAST(ROUND(cgst_amount * 100) AS INTEGER),
                          CAST(ROUND(sgst_amount * 100) AS INTEGER),
                          CAST(ROUND(total_gst * 100) AS INTEGER)
                   FROM purchases WHERE id = ?1"#,
                [created.purchase_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .expect("read saved purchase GST snapshot");
        assert_eq!(snapshot, (true, "EXCLUSIVE".to_owned(), "CGST_SGST".to_owned(), 10_000, 900, 900, 1_800));
    }

    #[test]
    fn saved_attachment_references_cannot_escape_local_storage() {
        for safe in [
            "purchase-1-1728000000000000000.pdf",
            "purchase-21-1728000000000000001.jpg",
            "purchase-7-1728000000000000002.png",
        ] {
            assert!(valid_purchase_attachment_ref(safe), "{safe}");
        }

        for unsafe_ref in [
            "../purchase-1-1.pdf",
            r"..\purchase-1-1.pdf",
            "C:purchase-1-1.pdf",
            "purchase-1-1.pdf:stream",
            ".purchase-1-1.pdf",
            "purchase-1-1.exe",
            "purchase--1.pdf",
            "purchase-1-no-timestamp.pdf",
        ] {
            assert!(
                !valid_purchase_attachment_ref(unsafe_ref),
                "{unsafe_ref}"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn local_storage_rejects_a_symlink_outside_the_app_data_folder() {
        use std::os::unix::fs::symlink;

        let test_root = std::env::temp_dir().join(format!(
            "my-medical-local-storage-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock is after Unix epoch")
                .as_nanos()
        ));
        let app_data = test_root.join("app-data");
        let outside = test_root.join("outside");
        fs::create_dir_all(&app_data).expect("create app-data fixture");
        fs::create_dir_all(&outside).expect("create outside fixture");
        let storage = app_data.join("purchase-attachments");
        symlink(&outside, &storage).expect("create storage symlink");

        assert!(crate::ensure_local_storage_directory(&storage).is_err());
        fs::remove_dir_all(&test_root).expect("remove local storage fixture");
    }
}