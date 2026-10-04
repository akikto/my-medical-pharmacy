use rusqlite::{params, Connection, Params, Row};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::open_pharmacy_connection;

const REPORT_MAX_ROWS: i64 = 10_000;
const REPORT_DEFAULT_PAGE_SIZE: i64 = 100;
const REPORT_MAX_PAGE_SIZE: i64 = 200;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReportDateRange {
    start_date: String,
    end_date: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReportRangePreset {
    Today,
    Yesterday,
    ThisWeek,
    ThisMonth,
    LastMonth,
    Custom,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FinancialReportType {
    SalesSummary,
    PurchaseSummary,
    ProfitAndLoss,
    Expenses,
    FinancialSummary,
    StockValuation,
    ProductSales,
    CompanySales,
    CustomerDue,
    SupplierDue,
    Gst,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FinancialReportSort {
    Name,
    Quantity,
    NetSales,
    GrossProfit,
    Outstanding,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinancialReportRequest {
    report_type: FinancialReportType,
    range: Option<ReportDateRange>,
    search: Option<String>,
    supplier_id: Option<i64>,
    outstanding_only: Option<bool>,
    near_expiry_days: Option<i64>,
    page: Option<i64>,
    page_size: Option<i64>,
    sort_by: Option<FinancialReportSort>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportTransactionRow {
    kind: String,
    date: String,
    reference: String,
    party_name: Option<String>,
    payment_mode: Option<String>,
    status: Option<String>,
    amount: f64,
    taxable_amount: f64,
    gst_amount: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SalesSummaryReport {
    range: ReportDateRange,
    gross_sales: f64,
    sales_returns: f64,
    void_sales: f64,
    net_sales: f64,
    taxable_sales: f64,
    cgst: f64,
    sgst: f64,
    igst: f64,
    output_gst: f64,
    cash_sales: f64,
    upi_sales: f64,
    other_sales: f64,
    credit_sales: f64,
    invoice_count: i64,
    returned_invoice_count: i64,
    return_transaction_count: i64,
    voided_invoice_count: i64,
    correction_count: i64,
    cost_unavailable_invoices: i64,
    rows: Vec<ReportTransactionRow>,
    total_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PurchaseSummaryReport {
    range: ReportDateRange,
    gross_purchases: f64,
    purchase_returns: f64,
    cancelled_purchases: f64,
    net_purchases: f64,
    taxable_purchases: f64,
    cgst: f64,
    sgst: f64,
    igst: f64,
    input_gst: f64,
    cash_payments: f64,
    bank_payments: f64,
    upi_payments: f64,
    other_payments: f64,
    invoice_count: i64,
    cancelled_invoice_count: i64,
    return_transaction_count: i64,
    rows: Vec<ReportTransactionRow>,
    total_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfitAndLossReport {
    range: ReportDateRange,
    gross_sales: f64,
    sales_returns: f64,
    net_sales: f64,
    cogs: Option<f64>,
    gross_profit: Option<f64>,
    gross_margin_percent: Option<f64>,
    operating_expenses: f64,
    net_profit: Option<f64>,
    net_margin_percent: Option<f64>,
    cost_unavailable_invoices: i64,
    product_rows: Vec<ProductSalesRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpenseReportRow {
    id: i64,
    expense_date: String,
    category_name: String,
    description: String,
    amount: f64,
    payment_method: String,
    reference_number: Option<String>,
    status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpenseCategoryTotal {
    category_name: String,
    amount: f64,
    count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpensePaymentTotal {
    payment_method: String,
    amount: f64,
    count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExpensePeriodTotal {
    period: String,
    amount: f64,
    count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseReport {
    range: ReportDateRange,
    total_expenses: f64,
    active_count: i64,
    cancelled_count: i64,
    category_totals: Vec<ExpenseCategoryTotal>,
    payment_method_totals: Vec<ExpensePaymentTotal>,
    daily_totals: Vec<ExpensePeriodTotal>,
    monthly_totals: Vec<ExpensePeriodTotal>,
    rows: Vec<ExpenseReportRow>,
    total_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FinancialSummaryReport {
    range: ReportDateRange,
    gross_sales: f64,
    sales_returns: f64,
    net_sales: f64,
    gross_purchases: f64,
    purchase_returns: f64,
    net_purchases: f64,
    cogs: Option<f64>,
    gross_profit: Option<f64>,
    operating_expenses: f64,
    net_profit: Option<f64>,
    customer_outstanding: f64,
    supplier_outstanding: f64,
    stock_valuation: f64,
    stock_quantity: i64,
    cost_unavailable_invoices: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StockValuationReport {
    as_of_date: String,
    near_expiry_days: i64,
    sellable_quantity: i64,
    sellable_cost_value: f64,
    sellable_mrp_value: f64,
    sellable_sale_value: f64,
    expired_quantity: i64,
    expired_cost_value: f64,
    near_expiry_quantity: i64,
    near_expiry_cost_value: f64,
    low_stock_items: i64,
    total_stock_quantity: i64,
    total_stock_cost_value: f64,
    total_stock_mrp_value: f64,
    rows: Vec<StockValuationRow>,
    total_rows: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockValuationRow {
    medicine_id: i64,
    medicine_name: String,
    company: Option<String>,
    barcode: Option<String>,
    batch_no: String,
    expiry_date: String,
    quantity: i64,
    purchase_cost: f64,
    mrp: f64,
    sale_rate: f64,
    cost_value: f64,
    mrp_value: f64,
    sale_value: f64,
    stock_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductSalesRow {
    medicine_id: i64,
    medicine_name: String,
    barcode: Option<String>,
    company: Option<String>,
    quantity_sold: i64,
    returned_quantity: i64,
    voided_quantity: i64,
    net_quantity: i64,
    gross_sales: f64,
    returns: f64,
    voided_sales: f64,
    net_sales: f64,
    taxable_sales: f64,
    gst: f64,
    cogs: Option<f64>,
    gross_profit: Option<f64>,
    margin_percent: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProductSalesReport {
    range: ReportDateRange,
    rows: Vec<ProductSalesRow>,
    total_rows: i64,
    page: i64,
    page_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CompanySalesRow {
    company: String,
    quantity_sold: i64,
    returned_quantity: i64,
    voided_quantity: i64,
    net_quantity: i64,
    gross_sales: f64,
    returns: f64,
    voided_sales: f64,
    net_sales: f64,
    gst: f64,
    cogs: Option<f64>,
    gross_profit: Option<f64>,
    margin_percent: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanySalesReport {
    range: ReportDateRange,
    rows: Vec<CompanySalesRow>,
    total_rows: i64,
    page: i64,
    page_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CustomerDueRow {
    customer_id: i64,
    customer_name: String,
    phone: Option<String>,
    total_credit: f64,
    total_paid: f64,
    outstanding_balance: f64,
    last_transaction_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CustomerDueReport {
    range: ReportDateRange,
    rows: Vec<CustomerDueRow>,
    total_rows: i64,
    page: i64,
    page_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupplierDueRow {
    supplier_id: i64,
    supplier_name: String,
    contact_person: Option<String>,
    phone: Option<String>,
    total_purchases: f64,
    purchase_returns: f64,
    payments: f64,
    outstanding_balance: f64,
    last_transaction_date: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SupplierDueReport {
    range: ReportDateRange,
    rows: Vec<SupplierDueRow>,
    total_rows: i64,
    page: i64,
    page_size: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GstReport {
    range: ReportDateRange,
    taxable_sales: f64,
    output_cgst: f64,
    output_sgst: f64,
    output_igst: f64,
    total_output_gst: f64,
    taxable_purchases: f64,
    input_cgst: f64,
    input_sgst: f64,
    input_igst: f64,
    total_input_gst: f64,
    net_gst_position: f64,
    same_state_output_taxable: f64,
    interstate_output_taxable: f64,
    same_state_input_taxable: f64,
    interstate_input_taxable: f64,
    sales_rows: Vec<GstDetailRow>,
    purchase_rows: Vec<GstDetailRow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GstDetailRow {
    kind: String,
    date: String,
    invoice_no: String,
    party_name: Option<String>,
    tax_type: String,
    taxable_amount: f64,
    cgst: f64,
    sgst: f64,
    igst: f64,
    total_gst: f64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "reportType", content = "data", rename_all = "snake_case")]
pub(crate) enum FinancialReportData {
    SalesSummary(SalesSummaryReport),
    PurchaseSummary(PurchaseSummaryReport),
    ProfitAndLoss(ProfitAndLossReport),
    Expenses(ExpenseReport),
    FinancialSummary(FinancialSummaryReport),
    StockValuation(StockValuationReport),
    ProductSales(ProductSalesReport),
    CompanySales(CompanySalesReport),
    CustomerDue(CustomerDueReport),
    SupplierDue(SupplierDueReport),
    Gst(GstReport),
}

fn money(cents: i64) -> f64 {
    cents as f64 / 100.0
}

fn checked_query<T, P, F>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    mut map_row: F,
) -> Result<Vec<T>, String>
where
    P: Params,
    F: FnMut(&Row<'_>) -> rusqlite::Result<T>,
{
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| format!("Could not prepare a financial report: {error}"))?;
    let rows = statement
        .query_map(parameters, |row| map_row(row))
        .map_err(|error| format!("Could not read a financial report: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read a financial report row: {error}"))
}

fn valid_iso_date(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if year.len() != 4
        || month.len() != 2
        || day.len() != 2
        || !year.bytes().all(|byte| byte.is_ascii_digit())
        || !month.bytes().all(|byte| byte.is_ascii_digit())
        || !day.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<i32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days_in_month = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap_year => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days_in_month).contains(&day)
}

fn validate_range(range: &ReportDateRange) -> Result<(), String> {
    if !valid_iso_date(&range.start_date)
        || !valid_iso_date(&range.end_date)
        || range.start_date > range.end_date
    {
        return Err(
            "Choose a valid report date range with a start date on or before the end date."
                .to_owned(),
        );
    }
    Ok(())
}

fn resolve_date_range(
    connection: &Connection,
    preset: ReportRangePreset,
    custom_start_date: Option<&str>,
    custom_end_date: Option<&str>,
    today_override: Option<&str>,
) -> Result<ReportDateRange, String> {
    let today = if let Some(today) = today_override {
        today.to_owned()
    } else {
        connection
            .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
            .map_err(|error| format!("Could not read the local business date: {error}"))?
    };
    if !valid_iso_date(&today) {
        return Err("The local business date is invalid.".to_owned());
    }
    let range = match preset {
        ReportRangePreset::Custom => {
            let start_date = custom_start_date
                .ok_or_else(|| "Choose a start date for the custom report range.".to_owned())?;
            let end_date = custom_end_date
                .ok_or_else(|| "Choose an end date for the custom report range.".to_owned())?;
            ReportDateRange {
                start_date: start_date.to_owned(),
                end_date: end_date.to_owned(),
            }
        }
        preset => {
            let sql = match preset {
                ReportRangePreset::Today => {
                    "SELECT ?1, ?1"
                }
                ReportRangePreset::Yesterday => {
                    "SELECT date(?1, '-1 day'), date(?1, '-1 day')"
                }
                ReportRangePreset::ThisWeek => {
                    "SELECT date(?1, printf('-%d days', (CAST(strftime('%w', ?1) AS INTEGER) + 6) % 7)), ?1"
                }
                ReportRangePreset::ThisMonth => {
                    "SELECT date(?1, 'start of month'), ?1"
                }
                ReportRangePreset::LastMonth => {
                    "SELECT date(?1, 'start of month', '-1 month'), date(?1, 'start of month', '-1 day')"
                }
                ReportRangePreset::Custom => unreachable!(),
            };
            let (start_date, end_date): (String, String) = connection
                .query_row(sql, [&today], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|error| format!("Could not calculate the report date range: {error}"))?;
            ReportDateRange {
                start_date,
                end_date,
            }
        }
    };
    validate_range(&range)?;
    Ok(range)
}

#[tauri::command]
pub(crate) fn get_report_date_range(
    app: AppHandle,
    preset: ReportRangePreset,
    custom_start_date: Option<String>,
    custom_end_date: Option<String>,
) -> Result<ReportDateRange, String> {
    resolve_date_range(
        &open_pharmacy_connection(&app)?,
        preset,
        custom_start_date.as_deref(),
        custom_end_date.as_deref(),
        None,
    )
}

#[tauri::command]
pub(crate) fn get_financial_report(
    app: AppHandle,
    request: FinancialReportRequest,
) -> Result<FinancialReportData, String> {
    let connection = open_pharmacy_connection(&app)?;
    match request.report_type {
        FinancialReportType::SalesSummary => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_sales_summary(&connection, range).map(FinancialReportData::SalesSummary)
        }
        FinancialReportType::PurchaseSummary => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_purchase_summary(&connection, range, request.supplier_id)
                .map(FinancialReportData::PurchaseSummary)
        }
        FinancialReportType::ProfitAndLoss => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_profit_and_loss(&connection, range).map(FinancialReportData::ProfitAndLoss)
        }
        FinancialReportType::Expenses => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_expenses_report(&connection, range).map(FinancialReportData::Expenses)
        }
        FinancialReportType::FinancialSummary => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_financial_summary(&connection, range).map(FinancialReportData::FinancialSummary)
        }
        FinancialReportType::StockValuation => {
            query_stock_valuation(&connection, request.near_expiry_days.unwrap_or(30))
                .map(FinancialReportData::StockValuation)
        }
        FinancialReportType::ProductSales => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_product_sales(
                &connection,
                range,
                request.search.as_deref(),
                request.sort_by.as_ref(),
                request.page.unwrap_or(1),
                request.page_size.unwrap_or(REPORT_DEFAULT_PAGE_SIZE),
            )
            .map(FinancialReportData::ProductSales)
        }
        FinancialReportType::CompanySales => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_company_sales(
                &connection,
                range,
                request.search.as_deref(),
                request.sort_by.as_ref(),
                request.page.unwrap_or(1),
                request.page_size.unwrap_or(REPORT_DEFAULT_PAGE_SIZE),
            )
            .map(FinancialReportData::CompanySales)
        }
        FinancialReportType::CustomerDue => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_customer_due(
                &connection,
                range,
                request.search.as_deref(),
                request.outstanding_only.unwrap_or(false),
                request.sort_by.as_ref(),
                request.page.unwrap_or(1),
                request.page_size.unwrap_or(REPORT_DEFAULT_PAGE_SIZE),
            )
            .map(FinancialReportData::CustomerDue)
        }
        FinancialReportType::SupplierDue => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_supplier_due(
                &connection,
                range,
                request.search.as_deref(),
                request.outstanding_only.unwrap_or(false),
                request.sort_by.as_ref(),
                request.page.unwrap_or(1),
                request.page_size.unwrap_or(REPORT_DEFAULT_PAGE_SIZE),
            )
            .map(FinancialReportData::SupplierDue)
        }
        FinancialReportType::Gst => {
            let range = required_range(&connection, request.range.as_ref())?;
            query_gst_report(&connection, range).map(FinancialReportData::Gst)
        }
    }
}

fn required_range<'a>(
    _connection: &Connection,
    range: Option<&'a ReportDateRange>,
) -> Result<&'a ReportDateRange, String> {
    let range =
        range.ok_or_else(|| "Choose an explicit start and end date for this report.".to_owned())?;
    validate_range(range)?;
    Ok(range)
}

fn page_values(page: i64, page_size: i64) -> (i64, i64) {
    let size = page_size.clamp(1, REPORT_MAX_PAGE_SIZE);
    let page = page.max(1);
    ((page - 1).saturating_mul(size).min(REPORT_MAX_ROWS), size)
}

fn sort_fragment(sort: Option<&FinancialReportSort>, default: &str) -> &'static str {
    match sort {
        Some(FinancialReportSort::Name) => "name COLLATE NOCASE ASC",
        Some(FinancialReportSort::Quantity) => "net_quantity DESC, name COLLATE NOCASE ASC",
        Some(FinancialReportSort::NetSales) => "net_sales_cents DESC, name COLLATE NOCASE ASC",
        Some(FinancialReportSort::GrossProfit) => {
            "gross_profit_cents DESC, name COLLATE NOCASE ASC"
        }
        Some(FinancialReportSort::Outstanding) => "net_sales_cents DESC, name COLLATE NOCASE ASC",
        None => match default {
            "name" => "name COLLATE NOCASE ASC",
            "quantity" => "net_quantity DESC, name COLLATE NOCASE ASC",
            "outstanding" => "outstanding_cents DESC, name COLLATE NOCASE ASC",
            _ => "net_sales_cents DESC, name COLLATE NOCASE ASC",
        },
    }
}

fn query_sales_summary(
    connection: &Connection,
    range: &ReportDateRange,
) -> Result<SalesSummaryReport, String> {
    let start = &range.start_date;
    let end = &range.end_date;
    let totals: (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = connection
        .query_row(
            r#"SELECT
                 COALESCE(SUM(CAST(ROUND(grand_total * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(taxable_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(cgst_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(sgst_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(igst_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CASE WHEN payment_mode = 'CASH'
                   THEN CAST(ROUND(grand_total * 100) AS INTEGER) ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN payment_mode = 'UPI'
                   THEN CAST(ROUND(grand_total * 100) AS INTEGER) ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN payment_mode = 'CREDIT'
                   THEN CAST(ROUND(grand_total * 100) AS INTEGER) ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN payment_mode NOT IN ('CASH', 'UPI', 'CREDIT')
                   THEN CAST(ROUND(grand_total * 100) AS INTEGER) ELSE 0 END), 0),
                 COUNT(*),
                 (SELECT COUNT(DISTINCT sale_id) FROM sale_returns
                   WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2),
                 (SELECT COUNT(*) FROM sale_returns
                   WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2),
                 (SELECT COUNT(*) FROM sale_voids
                   WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2),
                 (SELECT COUNT(*) FROM sale_corrections
                   WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2),
                 (SELECT COALESCE(SUM(total_cents), 0) FROM sale_returns
                   WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2),
                 (SELECT COALESCE(SUM(refund_cents), 0) FROM sale_voids
                   WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2),
                 (SELECT COALESCE(SUM(taxable_cents), 0) FROM sale_return_items ri
                   JOIN sale_returns r ON r.id = ri.return_id
                   WHERE date(r.created_at, 'localtime') BETWEEN ?1 AND ?2)
               FROM sales
               WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2"#,
            params![start, end],
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
                    row.get(15)?,
                    row.get(16)?,
                ))
            },
        )
        .map_err(|error| format!("Could not calculate sales report totals: {error}"))?;

    let void_taxes: (i64, i64, i64, i64) = connection
        .query_row(
            r#"SELECT
                 COALESCE(SUM(CAST(ROUND(s.taxable_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(s.cgst_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(s.sgst_amount * 100) AS INTEGER)), 0),
                 COALESCE(SUM(CAST(ROUND(s.igst_amount * 100) AS INTEGER)), 0)
               FROM sale_voids v JOIN sales s ON s.id = v.sale_id
               WHERE date(v.created_at, 'localtime') BETWEEN ?1 AND ?2"#,
            params![start, end],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .map_err(|error| format!("Could not calculate cancelled sale taxes: {error}"))?;

    let return_taxes: (i64, i64, i64) = connection
        .query_row(
            r#"SELECT
                 COALESCE(SUM(cgst_cents), 0),
                 COALESCE(SUM(sgst_cents), 0),
                 COALESCE(SUM(igst_cents), 0)
               FROM sale_return_items ri
               JOIN sale_returns r ON r.id = ri.return_id
               WHERE date(r.created_at, 'localtime') BETWEEN ?1 AND ?2"#,
            params![start, end],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| format!("Could not calculate returned sale taxes: {error}"))?;

    let cost_unavailable: i64 = connection
        .query_row(
            r#"WITH affected AS (
                 SELECT s.id FROM sales s
                 JOIN sale_items si ON si.sale_id = s.id
                 WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
                   AND si.purchase_rate_at_sale IS NULL
                 UNION
                 SELECT s.id FROM sale_returns r
                 JOIN sale_return_items ri ON ri.return_id = r.id
                 JOIN sale_items si ON si.id = ri.sale_item_id
                 JOIN sales s ON s.id = si.sale_id
                 WHERE date(r.created_at, 'localtime') BETWEEN ?1 AND ?2
                   AND si.purchase_rate_at_sale IS NULL
                 UNION
                 SELECT s.id FROM sale_voids v
                 JOIN sales s ON s.id = v.sale_id
                 JOIN sale_items si ON si.sale_id = s.id
                 WHERE date(v.created_at, 'localtime') BETWEEN ?1 AND ?2
                   AND si.purchase_rate_at_sale IS NULL
               )
               SELECT COUNT(*) FROM affected"#,
            params![start, end],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not check saved sale costs: {error}"))?;

    let returned_total = totals.14;
    let void_total = totals.15;
    let net_taxable = totals.1 - totals.16 - void_taxes.0;
    let net_cgst = totals.2 - return_taxes.0 - void_taxes.1;
    let net_sgst = totals.3 - return_taxes.1 - void_taxes.2;
    let net_igst = totals.4 - return_taxes.2 - void_taxes.3;
    let rows = checked_query(
        connection,
        r#"SELECT kind, date, reference, party_name, payment_mode, status,
                  amount_cents, taxable_cents, gst_cents
           FROM (
             SELECT 'SALE' AS kind, date(s.created_at, 'localtime') AS date,
                    s.invoice_no AS reference, COALESCE(NULLIF(TRIM(c.name), ''), s.customer_name) AS party_name,
                    s.payment_mode, s.status,
                    CAST(ROUND(s.grand_total * 100) AS INTEGER) AS amount_cents,
                    CAST(ROUND(s.taxable_amount * 100) AS INTEGER) AS taxable_cents,
                    CAST(ROUND(s.total_gst * 100) AS INTEGER) AS gst_cents,
                    s.created_at AS sort_date, s.id AS sort_id
             FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
             WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
             UNION ALL
             SELECT 'RETURN', date(r.created_at, 'localtime'), r.return_no,
                    COALESCE(NULLIF(TRIM(c.name), ''), s.customer_name), r.refund_mode,
                    'RETURN',
                    -r.total_cents,
                    -COALESCE(t.taxable_cents, 0),
                    -COALESCE(t.gst_cents, 0),
                    r.created_at, r.id
             FROM sale_returns r JOIN sales s ON s.id = r.sale_id
             LEFT JOIN customers c ON c.id = s.customer_id
             LEFT JOIN (
               SELECT return_id, SUM(taxable_cents) AS taxable_cents,
                      SUM(total_gst_cents) AS gst_cents
               FROM sale_return_items GROUP BY return_id
             ) t ON t.return_id = r.id
             WHERE date(r.created_at, 'localtime') BETWEEN ?1 AND ?2
             UNION ALL
             SELECT 'VOID', date(v.created_at, 'localtime'), s.invoice_no,
                    COALESCE(NULLIF(TRIM(c.name), ''), s.customer_name), v.refund_mode,
                    'CANCELLED',
                    -v.refund_cents,
                    -CAST(ROUND(s.taxable_amount * 100) AS INTEGER),
                    -CAST(ROUND(s.total_gst * 100) AS INTEGER),
                    v.created_at, v.id
             FROM sale_voids v JOIN sales s ON s.id = v.sale_id
             LEFT JOIN customers c ON c.id = s.customer_id
             WHERE date(v.created_at, 'localtime') BETWEEN ?1 AND ?2
           )
           ORDER BY sort_date DESC, sort_id DESC LIMIT ?3"#,
        params![start, end, REPORT_MAX_ROWS],
        |row| {
            Ok(ReportTransactionRow {
                kind: row.get(0)?,
                date: row.get(1)?,
                reference: row.get(2)?,
                party_name: row.get(3)?,
                payment_mode: row.get(4)?,
                status: row.get(5)?,
                amount: money(row.get(6)?),
                taxable_amount: money(row.get(7)?),
                gst_amount: money(row.get(8)?),
            })
        },
    )?;
    let total_rows: i64 = connection
        .query_row(
            r#"SELECT
                 (SELECT COUNT(*) FROM sales WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2)
                 + (SELECT COUNT(*) FROM sale_returns WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2)
                 + (SELECT COUNT(*) FROM sale_voids WHERE date(created_at, 'localtime') BETWEEN ?1 AND ?2)"#,
            params![start, end],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count sales report transactions: {error}"))?;

    Ok(SalesSummaryReport {
        range: range.clone(),
        gross_sales: money(totals.0),
        sales_returns: money(returned_total),
        void_sales: money(void_total),
        net_sales: money(totals.0 - returned_total - void_total),
        taxable_sales: money(net_taxable),
        cgst: money(net_cgst),
        sgst: money(net_sgst),
        igst: money(net_igst),
        output_gst: money(net_cgst + net_sgst + net_igst),
        cash_sales: money(totals.5),
        upi_sales: money(totals.6),
        credit_sales: money(totals.7),
        other_sales: money(totals.8),
        invoice_count: totals.9,
        returned_invoice_count: totals.10,
        return_transaction_count: totals.11,
        voided_invoice_count: totals.12,
        correction_count: totals.13,
        cost_unavailable_invoices: cost_unavailable,
        rows,
        total_rows,
    })
}

const PURCHASE_RETURN_TAX_CTE: &str = r#"purchase_return_tax AS (
    WITH ordered AS (
      SELECT pr.id AS return_id, pr.purchase_id, pr.supplier_id, pr.return_date,
             pri.id AS return_item_id, pri.purchase_item_id, pri.quantity,
             pi.quantity AS purchased_quantity,
             CAST(ROUND(pi.taxable_amount * 100) AS INTEGER) AS taxable_total_cents,
             CAST(ROUND(pi.cgst_amount * 100) AS INTEGER) AS cgst_total_cents,
             CAST(ROUND(pi.sgst_amount * 100) AS INTEGER) AS sgst_total_cents,
             CAST(ROUND(pi.igst_amount * 100) AS INTEGER) AS igst_total_cents,
             SUM(pri.quantity) OVER (
               PARTITION BY pri.purchase_item_id
               ORDER BY pr.return_date, pr.id, pri.id
             ) AS returned_after
      FROM purchase_return_items pri
      JOIN purchase_returns pr ON pr.id = pri.return_id
      JOIN purchase_items pi ON pi.id = pri.purchase_item_id
    ),
    allocated AS (
      SELECT return_id, purchase_id, supplier_id, return_date,
             CAST(ROUND(taxable_total_cents * 1.0 * returned_after / purchased_quantity) AS INTEGER)
               - CAST(ROUND(taxable_total_cents * 1.0 * (returned_after - quantity) / purchased_quantity) AS INTEGER)
               AS taxable_cents,
             CAST(ROUND(cgst_total_cents * 1.0 * returned_after / purchased_quantity) AS INTEGER)
               - CAST(ROUND(cgst_total_cents * 1.0 * (returned_after - quantity) / purchased_quantity) AS INTEGER)
               AS cgst_cents,
             CAST(ROUND(sgst_total_cents * 1.0 * returned_after / purchased_quantity) AS INTEGER)
               - CAST(ROUND(sgst_total_cents * 1.0 * (returned_after - quantity) / purchased_quantity) AS INTEGER)
               AS sgst_cents,
             CAST(ROUND(igst_total_cents * 1.0 * returned_after / purchased_quantity) AS INTEGER)
               - CAST(ROUND(igst_total_cents * 1.0 * (returned_after - quantity) / purchased_quantity) AS INTEGER)
               AS igst_cents
      FROM ordered
    )
    SELECT return_id, purchase_id, supplier_id, return_date,
           SUM(taxable_cents) AS taxable_cents,
           SUM(cgst_cents) AS cgst_cents,
           SUM(sgst_cents) AS sgst_cents,
           SUM(igst_cents) AS igst_cents
    FROM allocated
    GROUP BY return_id, purchase_id, supplier_id, return_date
)"#;

fn query_purchase_summary(
    connection: &Connection,
    range: &ReportDateRange,
    supplier_id: Option<i64>,
) -> Result<PurchaseSummaryReport, String> {
    let start = &range.start_date;
    let end = &range.end_date;
    let summary_sql = format!(
        r#"WITH {PURCHASE_RETURN_TAX_CTE}
           SELECT
             COALESCE((SELECT SUM(CAST(ROUND(p.total_amount * 100) AS INTEGER))
               FROM purchases p
               WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(pr.total_cents) FROM purchase_returns pr
               WHERE pr.return_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR pr.supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CAST(ROUND(p.total_amount * 100) AS INTEGER))
               FROM purchases p
               WHERE p.status = 'CANCELLED' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CAST(ROUND(p.taxable_amount * 100) AS INTEGER))
               FROM purchases p
               WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)), 0)
               - COALESCE((SELECT SUM(taxable_cents) FROM purchase_return_tax
                 WHERE return_date BETWEEN ?1 AND ?2
                   AND (?3 IS NULL OR supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CAST(ROUND(p.cgst_amount * 100) AS INTEGER))
               FROM purchases p
               WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)), 0)
               - COALESCE((SELECT SUM(cgst_cents) FROM purchase_return_tax
                 WHERE return_date BETWEEN ?1 AND ?2
                   AND (?3 IS NULL OR supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CAST(ROUND(p.sgst_amount * 100) AS INTEGER))
               FROM purchases p
               WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)), 0)
               - COALESCE((SELECT SUM(sgst_cents) FROM purchase_return_tax
                 WHERE return_date BETWEEN ?1 AND ?2
                   AND (?3 IS NULL OR supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CAST(ROUND(p.igst_amount * 100) AS INTEGER))
               FROM purchases p
               WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)), 0)
               - COALESCE((SELECT SUM(igst_cents) FROM purchase_return_tax
                 WHERE return_date BETWEEN ?1 AND ?2
                   AND (?3 IS NULL OR supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CASE WHEN l.payment_method = 'CASH' THEN l.credit_cents ELSE 0 END)
               FROM supplier_ledger l
               WHERE l.entry_type = 'PAYMENT' AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR l.supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CASE WHEN l.payment_method = 'BANK' THEN l.credit_cents ELSE 0 END)
               FROM supplier_ledger l
               WHERE l.entry_type = 'PAYMENT' AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR l.supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CASE WHEN l.payment_method = 'UPI' THEN l.credit_cents ELSE 0 END)
               FROM supplier_ledger l
               WHERE l.entry_type = 'PAYMENT' AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR l.supplier_id = ?3)), 0),
             COALESCE((SELECT SUM(CASE WHEN l.payment_method NOT IN ('CASH', 'BANK', 'UPI')
                   OR l.payment_method IS NULL THEN l.credit_cents ELSE 0 END)
               FROM supplier_ledger l
               WHERE l.entry_type = 'PAYMENT' AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR l.supplier_id = ?3)), 0),
             (SELECT COUNT(*) FROM purchases p
               WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)),
             (SELECT COUNT(*) FROM purchases p
               WHERE p.status = 'CANCELLED' AND p.purchase_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR p.supplier_id = ?3)),
             (SELECT COUNT(*) FROM purchase_returns pr
               WHERE pr.return_date BETWEEN ?1 AND ?2
                 AND (?3 IS NULL OR pr.supplier_id = ?3))"#,
    );
    let totals: (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = connection
        .query_row(&summary_sql, params![start, end, supplier_id], |row| {
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
            ))
        })
        .map_err(|error| format!("Could not calculate purchase report totals: {error}"))?;

    let events_sql = format!(
        r#"WITH {PURCHASE_RETURN_TAX_CTE}
           SELECT kind, date, reference, party_name, payment_mode, status,
                  amount_cents, taxable_cents, gst_cents
           FROM (
             SELECT CASE WHEN p.status = 'CANCELLED' THEN 'CANCELLED_PURCHASE'
                         ELSE 'PURCHASE' END AS kind,
                    p.purchase_date AS date, p.invoice_no AS reference, s.name AS party_name,
                    NULL AS payment_mode, p.status,
                    CASE WHEN p.status = 'CANCELLED'
                         THEN -CAST(ROUND(p.total_amount * 100) AS INTEGER)
                         ELSE CAST(ROUND(p.total_amount * 100) AS INTEGER) END AS amount_cents,
                    CASE WHEN p.status = 'CANCELLED'
                         THEN -CAST(ROUND(p.taxable_amount * 100) AS INTEGER)
                         ELSE CAST(ROUND(p.taxable_amount * 100) AS INTEGER) END AS taxable_cents,
                    CASE WHEN p.status = 'CANCELLED'
                         THEN -CAST(ROUND(p.total_gst * 100) AS INTEGER)
                         ELSE CAST(ROUND(p.total_gst * 100) AS INTEGER) END AS gst_cents,
                    p.purchase_date AS sort_date, p.id AS sort_id
             FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.purchase_date BETWEEN ?1 AND ?2 AND (?3 IS NULL OR p.supplier_id = ?3)
             UNION ALL
             SELECT 'PURCHASE_RETURN', pr.return_date, COALESCE(p.invoice_no, 'Purchase return'),
                    s.name, NULL, 'RETURN', -pr.total_cents,
                    -COALESCE(tax.taxable_cents, 0),
                    -COALESCE(tax.cgst_cents + tax.sgst_cents + tax.igst_cents, 0),
                    pr.return_date, pr.id
             FROM purchase_returns pr
             LEFT JOIN purchases p ON p.id = pr.purchase_id
             LEFT JOIN suppliers s ON s.id = pr.supplier_id
             LEFT JOIN purchase_return_tax tax ON tax.return_id = pr.id
             WHERE pr.return_date BETWEEN ?1 AND ?2 AND (?3 IS NULL OR pr.supplier_id = ?3)
             UNION ALL
             SELECT 'PAYMENT', date(l.created_at, 'localtime'),
                    COALESCE(NULLIF(TRIM(l.reference), ''), NULLIF(TRIM(l.transaction_reference), ''), 'Supplier payment'),
                    s.name, l.payment_method, 'PAYMENT', -l.credit_cents, 0, 0,
                    l.created_at, l.id
             FROM supplier_ledger l JOIN suppliers s ON s.id = l.supplier_id
             WHERE l.entry_type = 'PAYMENT'
               AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2
               AND (?3 IS NULL OR l.supplier_id = ?3)
           )
           ORDER BY sort_date DESC, sort_id DESC LIMIT ?4"#,
    );
    let rows = checked_query(
        connection,
        &events_sql,
        params![start, end, supplier_id, REPORT_MAX_ROWS],
        |row| {
            Ok(ReportTransactionRow {
                kind: row.get(0)?,
                date: row.get(1)?,
                reference: row.get(2)?,
                party_name: row.get(3)?,
                payment_mode: row.get(4)?,
                status: row.get(5)?,
                amount: money(row.get(6)?),
                taxable_amount: money(row.get(7)?),
                gst_amount: money(row.get(8)?),
            })
        },
    )?;
    let total_rows: i64 = connection
        .query_row(
            r#"SELECT
                 (SELECT COUNT(*) FROM purchases p
                   WHERE p.purchase_date BETWEEN ?1 AND ?2 AND (?3 IS NULL OR p.supplier_id = ?3))
                 + (SELECT COUNT(*) FROM purchase_returns pr
                   WHERE pr.return_date BETWEEN ?1 AND ?2 AND (?3 IS NULL OR pr.supplier_id = ?3))
                 + (SELECT COUNT(*) FROM supplier_ledger l
                   WHERE l.entry_type = 'PAYMENT'
                     AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2
                     AND (?3 IS NULL OR l.supplier_id = ?3))"#,
            params![start, end, supplier_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count purchase report transactions: {error}"))?;

    Ok(PurchaseSummaryReport {
        range: range.clone(),
        gross_purchases: money(totals.0),
        purchase_returns: money(totals.1),
        cancelled_purchases: money(totals.2),
        net_purchases: money(totals.0 - totals.1),
        taxable_purchases: money(totals.3),
        cgst: money(totals.4),
        sgst: money(totals.5),
        igst: money(totals.6),
        input_gst: money(totals.4 + totals.5 + totals.6),
        cash_payments: money(totals.7),
        bank_payments: money(totals.8),
        upi_payments: money(totals.9),
        other_payments: money(totals.10),
        invoice_count: totals.11,
        cancelled_invoice_count: totals.12,
        return_transaction_count: totals.13,
        rows,
        total_rows,
    })
}

const SALES_LINE_EVENTS_CTE: &str = r#"line_events AS (
    SELECT m.id AS medicine_id, m.name, m.barcode, m.company,
           s.id AS sale_id, s.created_at AS event_at, 'SALE' AS event_kind,
           si.quantity AS sold_quantity, 0 AS returned_quantity, 0 AS voided_quantity,
           CAST(ROUND((si.taxable_amount + si.total_gst) * 100) AS INTEGER) AS gross_sales_cents,
           0 AS returns_cents, 0 AS voided_sales_cents,
           CAST(ROUND(si.taxable_amount * 100) AS INTEGER) AS taxable_delta_cents,
           CAST(ROUND(si.total_gst * 100) AS INTEGER) AS gst_delta_cents,
           CASE WHEN si.purchase_rate_at_sale IS NULL THEN 0
                ELSE CAST(ROUND(si.purchase_rate_at_sale * 100) AS INTEGER) * si.quantity
           END AS cogs_delta_cents,
           CASE WHEN si.purchase_rate_at_sale IS NULL THEN 1 ELSE 0 END AS cost_missing
    FROM sales s
    JOIN sale_items si ON si.sale_id = s.id
    JOIN medicine_batches b ON b.id = si.batch_id
    JOIN medicines m ON m.id = b.medicine_id
    WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
    UNION ALL
    SELECT m.id, m.name, m.barcode, m.company,
           s.id, r.created_at, 'RETURN',
           0, ri.quantity, 0, 0, ri.refund_cents, 0,
           -ri.taxable_cents, -ri.total_gst_cents,
           CASE WHEN si.purchase_rate_at_sale IS NULL THEN 0
                ELSE -(CAST(ROUND(si.purchase_rate_at_sale * 100) AS INTEGER) * ri.quantity)
           END,
           CASE WHEN si.purchase_rate_at_sale IS NULL THEN 1 ELSE 0 END
    FROM sale_returns r
    JOIN sales s ON s.id = r.sale_id
    JOIN sale_return_items ri ON ri.return_id = r.id
    JOIN sale_items si ON si.id = ri.sale_item_id
    JOIN medicine_batches b ON b.id = ri.batch_id
    JOIN medicines m ON m.id = b.medicine_id
    WHERE date(r.created_at, 'localtime') BETWEEN ?1 AND ?2
    UNION ALL
    SELECT m.id, m.name, m.barcode, m.company,
           s.id, v.created_at, 'VOID',
           0, 0, si.quantity, 0, 0,
           CAST(ROUND((si.taxable_amount + si.total_gst) * 100) AS INTEGER),
           -CAST(ROUND(si.taxable_amount * 100) AS INTEGER),
           -CAST(ROUND(si.total_gst * 100) AS INTEGER),
           CASE WHEN si.purchase_rate_at_sale IS NULL THEN 0
                ELSE -(CAST(ROUND(si.purchase_rate_at_sale * 100) AS INTEGER) * si.quantity)
           END,
           CASE WHEN si.purchase_rate_at_sale IS NULL THEN 1 ELSE 0 END
    FROM sale_voids v
    JOIN sales s ON s.id = v.sale_id
    JOIN sale_items si ON si.sale_id = s.id
    JOIN medicine_batches b ON b.id = si.batch_id
    JOIN medicines m ON m.id = b.medicine_id
    WHERE date(v.created_at, 'localtime') BETWEEN ?1 AND ?2
)"#;

fn product_sales_sql(sort: &'static str) -> String {
    format!(
        r#"WITH {SALES_LINE_EVENTS_CTE},
           product_totals AS (
             SELECT medicine_id, name, barcode, company,
                    SUM(sold_quantity) AS quantity_sold,
                    SUM(returned_quantity) AS returned_quantity,
                    SUM(voided_quantity) AS voided_quantity,
                    SUM(sold_quantity - returned_quantity - voided_quantity) AS net_quantity,
                    SUM(gross_sales_cents) AS gross_sales_cents,
                    SUM(returns_cents) AS returns_cents,
                    SUM(voided_sales_cents) AS voided_sales_cents,
                    SUM(gross_sales_cents - returns_cents - voided_sales_cents) AS net_sales_cents,
                    SUM(taxable_delta_cents) AS taxable_sales_cents,
                    SUM(gst_delta_cents) AS gst_cents,
                    SUM(cogs_delta_cents) AS cogs_cents,
                    SUM(taxable_delta_cents - cogs_delta_cents) AS gross_profit_cents,
                    COUNT(DISTINCT CASE WHEN cost_missing = 1 THEN sale_id END) AS cost_missing_count
             FROM line_events
             GROUP BY medicine_id, name, barcode, company
           )
           SELECT medicine_id, name, barcode, company, quantity_sold, returned_quantity,
                  voided_quantity, net_quantity, gross_sales_cents, returns_cents,
                  voided_sales_cents, net_sales_cents, taxable_sales_cents, gst_cents,
                  cogs_cents, cost_missing_count,
                  CASE WHEN taxable_sales_cents = 0 THEN NULL
                       ELSE (taxable_sales_cents - cogs_cents) * 100.0 / taxable_sales_cents
                  END AS margin_percent
           FROM product_totals
           WHERE (?3 = '' OR name LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(barcode, '') LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(company, '') LIKE '%' || ?3 || '%' COLLATE NOCASE)
           ORDER BY {sort}
           LIMIT ?4 OFFSET ?5"#
    )
}

fn product_sales_count(
    connection: &Connection,
    range: &ReportDateRange,
    search: Option<&str>,
) -> Result<i64, String> {
    let sql = format!(
        r#"WITH {SALES_LINE_EVENTS_CTE},
           product_totals AS (
             SELECT medicine_id, name, barcode, company
             FROM line_events
             GROUP BY medicine_id, name, barcode, company
           )
           SELECT COUNT(*) FROM product_totals
           WHERE (?3 = '' OR name LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(barcode, '') LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(company, '') LIKE '%' || ?3 || '%' COLLATE NOCASE)"#
    );
    connection
        .query_row(
            &sql,
            params![
                range.start_date,
                range.end_date,
                search.unwrap_or("").trim()
            ],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count product sales rows: {error}"))
}

fn query_product_sales(
    connection: &Connection,
    range: &ReportDateRange,
    search: Option<&str>,
    sort_by: Option<&FinancialReportSort>,
    page: i64,
    page_size: i64,
) -> Result<ProductSalesReport, String> {
    let (offset, page_size) = page_values(page, page_size);
    let sql = product_sales_sql(sort_fragment(sort_by, "net_sales"));
    let rows = checked_query(
        connection,
        &sql,
        params![
            range.start_date,
            range.end_date,
            search.unwrap_or("").trim(),
            page_size,
            offset
        ],
        |row| {
            let taxable_sales_cents: i64 = row.get(12)?;
            let cogs_cents: i64 = row.get(14)?;
            let cost_missing_count: i64 = row.get(15)?;
            let gross_profit = if cost_missing_count == 0 {
                Some(money(taxable_sales_cents - cogs_cents))
            } else {
                None
            };
            let taxable_sales = money(taxable_sales_cents);
            Ok(ProductSalesRow {
                medicine_id: row.get(0)?,
                medicine_name: row.get(1)?,
                barcode: row.get(2)?,
                company: row.get(3)?,
                quantity_sold: row.get(4)?,
                returned_quantity: row.get(5)?,
                voided_quantity: row.get(6)?,
                net_quantity: row.get(7)?,
                gross_sales: money(row.get(8)?),
                returns: money(row.get(9)?),
                voided_sales: money(row.get(10)?),
                net_sales: money(row.get(11)?),
                taxable_sales,
                gst: money(row.get(13)?),
                cogs: if cost_missing_count == 0 {
                    Some(money(cogs_cents))
                } else {
                    None
                },
                gross_profit,
                margin_percent: if cost_missing_count == 0 && taxable_sales_cents != 0 {
                    Some(
                        (taxable_sales_cents - cogs_cents) as f64 * 100.0
                            / taxable_sales_cents as f64,
                    )
                } else {
                    None
                },
            })
        },
    )?;
    let total_rows = product_sales_count(connection, range, search)?;
    Ok(ProductSalesReport {
        range: range.clone(),
        rows,
        total_rows,
        page: page.max(1),
        page_size,
    })
}

fn query_company_sales(
    connection: &Connection,
    range: &ReportDateRange,
    search: Option<&str>,
    sort_by: Option<&FinancialReportSort>,
    page: i64,
    page_size: i64,
) -> Result<CompanySalesReport, String> {
    let (offset, page_size) = page_values(page, page_size);
    let sort = match sort_by {
        Some(FinancialReportSort::Name) => "company COLLATE NOCASE ASC",
        Some(FinancialReportSort::Quantity) => "net_quantity DESC, company COLLATE NOCASE ASC",
        Some(FinancialReportSort::GrossProfit) => {
            "gross_profit_cents DESC, company COLLATE NOCASE ASC"
        }
        Some(FinancialReportSort::NetSales) | None => {
            "net_sales_cents DESC, company COLLATE NOCASE ASC"
        }
        Some(FinancialReportSort::Outstanding) => {
            "net_sales_cents DESC, company COLLATE NOCASE ASC"
        }
    };
    let sql = format!(
        r#"WITH {SALES_LINE_EVENTS_CTE},
           company_totals AS (
             SELECT COALESCE(NULLIF(TRIM(company), ''), 'Unknown/Unspecified') AS company,
                    SUM(sold_quantity) AS quantity_sold,
                    SUM(returned_quantity) AS returned_quantity,
                    SUM(voided_quantity) AS voided_quantity,
                    SUM(sold_quantity - returned_quantity - voided_quantity) AS net_quantity,
                    SUM(gross_sales_cents) AS gross_sales_cents,
                    SUM(returns_cents) AS returns_cents,
                    SUM(voided_sales_cents) AS voided_sales_cents,
                    SUM(gross_sales_cents - returns_cents - voided_sales_cents) AS net_sales_cents,
                    SUM(gst_delta_cents) AS gst_cents,
                    SUM(taxable_delta_cents) AS taxable_sales_cents,
                    SUM(cogs_delta_cents) AS cogs_cents,
                    SUM(taxable_delta_cents - cogs_delta_cents) AS gross_profit_cents,
                    COUNT(DISTINCT CASE WHEN cost_missing = 1 THEN sale_id END) AS cost_missing_count
             FROM line_events
             GROUP BY COALESCE(NULLIF(TRIM(company), ''), 'Unknown/Unspecified')
           )
           SELECT company, quantity_sold, returned_quantity, voided_quantity, net_quantity,
                  gross_sales_cents, returns_cents, voided_sales_cents, net_sales_cents,
                  gst_cents, taxable_sales_cents, cogs_cents, cost_missing_count
           FROM company_totals
           WHERE (?3 = '' OR company LIKE '%' || ?3 || '%' COLLATE NOCASE)
           ORDER BY {sort} LIMIT ?4 OFFSET ?5"#
    );
    let rows = checked_query(
        connection,
        &sql,
        params![
            range.start_date,
            range.end_date,
            search.unwrap_or("").trim(),
            page_size,
            offset
        ],
        |row| {
            let taxable_sales_cents: i64 = row.get(10)?;
            let cogs_cents: i64 = row.get(11)?;
            let cost_missing_count: i64 = row.get(12)?;
            Ok(CompanySalesRow {
                company: row.get(0)?,
                quantity_sold: row.get(1)?,
                returned_quantity: row.get(2)?,
                voided_quantity: row.get(3)?,
                net_quantity: row.get(4)?,
                gross_sales: money(row.get(5)?),
                returns: money(row.get(6)?),
                voided_sales: money(row.get(7)?),
                net_sales: money(row.get(8)?),
                gst: money(row.get(9)?),
                cogs: if cost_missing_count == 0 {
                    Some(money(cogs_cents))
                } else {
                    None
                },
                gross_profit: if cost_missing_count == 0 {
                    Some(money(taxable_sales_cents - cogs_cents))
                } else {
                    None
                },
                margin_percent: if cost_missing_count == 0 && taxable_sales_cents != 0 {
                    Some(
                        (taxable_sales_cents - cogs_cents) as f64 * 100.0
                            / taxable_sales_cents as f64,
                    )
                } else {
                    None
                },
            })
        },
    )?;
    let total_rows: i64 = connection
        .query_row(
            &format!(
                r#"WITH {SALES_LINE_EVENTS_CTE}
                   SELECT COUNT(*) FROM (
                     SELECT COALESCE(NULLIF(TRIM(company), ''), 'Unknown/Unspecified') AS company
                     FROM line_events GROUP BY COALESCE(NULLIF(TRIM(company), ''), 'Unknown/Unspecified')
                   )
                   WHERE (?3 = '' OR company LIKE '%' || ?3 || '%' COLLATE NOCASE)"#
            ),
            params![
                range.start_date,
                range.end_date,
                search.unwrap_or("").trim()
            ],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count company sales rows: {error}"))?;
    Ok(CompanySalesReport {
        range: range.clone(),
        rows,
        total_rows,
        page: page.max(1),
        page_size,
    })
}

fn query_profit_and_loss(
    connection: &Connection,
    range: &ReportDateRange,
) -> Result<ProfitAndLossReport, String> {
    let sales = query_sales_summary(connection, range)?;
    let cogs_totals: (i64, i64) = connection
        .query_row(
            &format!(
                r#"WITH {SALES_LINE_EVENTS_CTE}
                   SELECT COALESCE(SUM(cogs_delta_cents), 0),
                          COUNT(DISTINCT CASE WHEN cost_missing = 1 THEN sale_id END)
                   FROM line_events"#
            ),
            params![range.start_date, range.end_date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Could not calculate saved sale costs: {error}"))?;
    let complete_costs = cogs_totals.1 == 0;
    let net_sales = sales.taxable_sales;
    let cogs = complete_costs.then_some(money(cogs_totals.0));
    let gross_profit = cogs.map(|cost| net_sales - cost);
    let gross_margin_percent = gross_profit
        .and_then(|profit| (net_sales.abs() > f64::EPSILON).then_some(profit * 100.0 / net_sales));
    let operating_expenses = money(query_operating_expense_cents(connection, range)?);
    let net_profit = gross_profit.map(|profit| profit - operating_expenses);
    let net_margin_percent = net_profit
        .and_then(|profit| (net_sales.abs() > f64::EPSILON).then_some(profit * 100.0 / net_sales));
    let products = query_product_sales(connection, range, None, None, 1, 20)?.rows;
    Ok(ProfitAndLossReport {
        range: range.clone(),
        gross_sales: sales.gross_sales,
        sales_returns: sales.sales_returns,
        net_sales,
        cogs,
        gross_profit,
        gross_margin_percent,
        operating_expenses,
        net_profit,
        net_margin_percent,
        cost_unavailable_invoices: cogs_totals.1,
        product_rows: products,
    })
}

fn query_operating_expense_cents(
    connection: &Connection,
    range: &ReportDateRange,
) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0)
             FROM expenses
             WHERE status = 'ACTIVE' AND expense_date BETWEEN ?1 AND ?2",
            params![range.start_date, range.end_date],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not calculate operating expenses: {error}"))
}

fn query_expenses_report(
    connection: &Connection,
    range: &ReportDateRange,
) -> Result<ExpenseReport, String> {
    validate_range(range)?;
    let (active_cents, active_count, cancelled_count, total_rows): (i64, i64, i64, i64) =
        connection
            .query_row(
                r#"SELECT
                     COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN amount_cents ELSE 0 END), 0),
                     SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END),
                     SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END),
                     COUNT(*)
                   FROM expenses WHERE expense_date BETWEEN ?1 AND ?2"#,
                params![range.start_date, range.end_date],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                        row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                        row.get(3)?,
                    ))
                },
            )
            .map_err(|error| format!("Could not calculate expense report totals: {error}"))?;

    let category_totals = checked_query(
        connection,
        r#"SELECT c.name, SUM(e.amount_cents), COUNT(*)
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           WHERE e.status = 'ACTIVE' AND e.expense_date BETWEEN ?1 AND ?2
           GROUP BY c.id, c.name
           ORDER BY SUM(e.amount_cents) DESC, c.name COLLATE NOCASE"#,
        params![range.start_date, range.end_date],
        |row| {
            Ok(ExpenseCategoryTotal {
                category_name: row.get(0)?,
                amount: money(row.get(1)?),
                count: row.get(2)?,
            })
        },
    )?;

    let payment_method_amounts = checked_query(
        connection,
        r#"SELECT payment_method, SUM(amount_cents), COUNT(*)
           FROM expenses
           WHERE status = 'ACTIVE' AND expense_date BETWEEN ?1 AND ?2
           GROUP BY payment_method"#,
        params![range.start_date, range.end_date],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        },
    )?;
    let payment_method_totals = ["CASH", "BANK", "UPI", "OTHER"]
        .into_iter()
        .map(|method| {
            let (amount_cents, count) = payment_method_amounts
                .iter()
                .find(|(payment_method, _, _)| payment_method == method)
                .map(|(_, amount_cents, count)| (*amount_cents, *count))
                .unwrap_or((0, 0));
            ExpensePaymentTotal {
                payment_method: method.to_owned(),
                amount: money(amount_cents),
                count,
            }
        })
        .collect();

    let period_totals = |sql: &str| {
        checked_query(
            connection,
            sql,
            params![range.start_date, range.end_date],
            |row| {
                Ok(ExpensePeriodTotal {
                    period: row.get(0)?,
                    amount: money(row.get(1)?),
                    count: row.get(2)?,
                })
            },
        )
    };
    let daily_totals = period_totals(
        r#"SELECT expense_date, SUM(amount_cents), COUNT(*)
           FROM expenses
           WHERE status = 'ACTIVE' AND expense_date BETWEEN ?1 AND ?2
           GROUP BY expense_date ORDER BY expense_date"#,
    )?;
    let monthly_totals = period_totals(
        r#"SELECT substr(expense_date, 1, 7), SUM(amount_cents), COUNT(*)
           FROM expenses
           WHERE status = 'ACTIVE' AND expense_date BETWEEN ?1 AND ?2
           GROUP BY substr(expense_date, 1, 7) ORDER BY substr(expense_date, 1, 7)"#,
    )?;
    let rows = checked_query(
        connection,
        r#"SELECT e.id, e.expense_date, c.name, e.description, e.amount_cents,
                  e.payment_method, e.reference_number, e.status
           FROM expenses e JOIN expense_categories c ON c.id = e.category_id
           WHERE e.expense_date BETWEEN ?1 AND ?2
           ORDER BY e.expense_date DESC, e.id DESC LIMIT ?3"#,
        params![range.start_date, range.end_date, REPORT_MAX_ROWS],
        |row| {
            Ok(ExpenseReportRow {
                id: row.get(0)?,
                expense_date: row.get(1)?,
                category_name: row.get(2)?,
                description: row.get(3)?,
                amount: money(row.get(4)?),
                payment_method: row.get(5)?,
                reference_number: row.get(6)?,
                status: row.get(7)?,
            })
        },
    )?;
    Ok(ExpenseReport {
        range: range.clone(),
        total_expenses: money(active_cents),
        active_count,
        cancelled_count,
        category_totals,
        payment_method_totals,
        daily_totals,
        monthly_totals,
        rows,
        total_rows,
    })
}

fn query_customer_outstanding(connection: &Connection) -> Result<f64, String> {
    let cents: i64 = connection
        .query_row(
            r#"WITH all_entries AS (
                 SELECT customer_id, debit_cents, credit_cents FROM customer_ledger
                 UNION ALL
                 SELECT customer_id, debit_cents, credit_cents FROM customer_ledger_events
               ),
               balances AS (
                 SELECT customer_id, SUM(debit_cents - credit_cents) AS outstanding_cents
                 FROM all_entries GROUP BY customer_id
               )
               SELECT COALESCE(SUM(CASE WHEN outstanding_cents > 0
                                        THEN outstanding_cents ELSE 0 END), 0)
               FROM balances"#,
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not calculate current customer outstanding: {error}"))?;
    Ok(money(cents))
}

fn query_supplier_outstanding(connection: &Connection) -> Result<f64, String> {
    let cents: i64 = connection
        .query_row(
            r#"SELECT COALESCE(SUM(CASE WHEN outstanding_cents > 0
                                        THEN outstanding_cents ELSE 0 END), 0)
               FROM (
                 SELECT supplier_id, SUM(debit_cents - credit_cents) AS outstanding_cents
                 FROM supplier_ledger GROUP BY supplier_id
               )"#,
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not calculate current supplier outstanding: {error}"))?;
    Ok(money(cents))
}

fn query_financial_summary(
    connection: &Connection,
    range: &ReportDateRange,
) -> Result<FinancialSummaryReport, String> {
    let profit = query_profit_and_loss(connection, range)?;
    let purchases = query_purchase_summary(connection, range, None)?;
    let stock = query_stock_valuation(connection, 30)?;
    Ok(FinancialSummaryReport {
        range: range.clone(),
        gross_sales: profit.gross_sales,
        sales_returns: profit.sales_returns,
        net_sales: profit.net_sales,
        gross_purchases: purchases.gross_purchases,
        purchase_returns: purchases.purchase_returns,
        net_purchases: purchases.net_purchases,
        cogs: profit.cogs,
        gross_profit: profit.gross_profit,
        operating_expenses: profit.operating_expenses,
        net_profit: profit.net_profit,
        customer_outstanding: query_customer_outstanding(connection)?,
        supplier_outstanding: query_supplier_outstanding(connection)?,
        stock_valuation: stock.total_stock_cost_value,
        stock_quantity: stock.total_stock_quantity,
        cost_unavailable_invoices: profit.cost_unavailable_invoices,
    })
}

fn query_stock_valuation(
    connection: &Connection,
    near_expiry_days: i64,
) -> Result<StockValuationReport, String> {
    if !(0..=3650).contains(&near_expiry_days) {
        return Err("Near-expiry days must be between 0 and 3650.".to_owned());
    }
    let as_of_date: String = connection
        .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
        .map_err(|error| format!("Could not read the local business date: {error}"))?;
    let summary: (i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, i64) = connection
        .query_row(
            r#"WITH medicine_stock AS (
                 SELECT m.id, m.min_stock_alert,
                        COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                          THEN b.current_stock ELSE 0 END), 0) AS sellable_quantity
                 FROM medicines m
                 LEFT JOIN medicine_batches b ON b.medicine_id = m.id
                 GROUP BY m.id, m.min_stock_alert
               )
               SELECT
                 COALESCE(SUM(CASE WHEN b.expiry_date >= ?1 THEN b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                   THEN CAST(ROUND(b.purchase_rate * 100) AS INTEGER) * b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                   THEN CAST(ROUND(b.mrp * 100) AS INTEGER) * b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                   THEN CAST(ROUND(b.sale_rate * 100) AS INTEGER) * b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date < ?1 THEN b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date < ?1
                   THEN CAST(ROUND(b.purchase_rate * 100) AS INTEGER) * b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                   AND b.expiry_date <= date(?1, '+' || ?2 || ' days')
                   THEN b.current_stock ELSE 0 END), 0),
                 COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                   AND b.expiry_date <= date(?1, '+' || ?2 || ' days')
                   THEN CAST(ROUND(b.purchase_rate * 100) AS INTEGER) * b.current_stock ELSE 0 END), 0),
                 (SELECT COUNT(*) FROM medicine_stock
                   WHERE min_stock_alert > 0 AND sellable_quantity <= min_stock_alert),
                 COALESCE(SUM(b.current_stock), 0),
                 COALESCE(SUM(CAST(ROUND(b.purchase_rate * 100) AS INTEGER) * b.current_stock), 0),
                 COALESCE(SUM(CAST(ROUND(b.mrp * 100) AS INTEGER) * b.current_stock), 0)
               FROM medicine_batches b"#,
            params![as_of_date, near_expiry_days],
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
        .map_err(|error| format!("Could not calculate stock valuation totals: {error}"))?;
    let all_rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM medicine_batches WHERE current_stock > 0",
            [],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count stock valuation rows: {error}"))?;
    let rows = checked_query(
        connection,
        r#"WITH medicine_stock AS (
             SELECT m.id,
                    COALESCE(SUM(CASE WHEN b.expiry_date >= ?1
                      THEN b.current_stock ELSE 0 END), 0) AS sellable_quantity
             FROM medicines m
             LEFT JOIN medicine_batches b ON b.medicine_id = m.id
             GROUP BY m.id
           )
           SELECT m.id, m.name, m.company, COALESCE(b.barcode, m.barcode),
                  b.batch_no, b.expiry_date, b.current_stock,
                  CAST(ROUND(b.purchase_rate * 100) AS INTEGER),
                  CAST(ROUND(b.mrp * 100) AS INTEGER),
                  CAST(ROUND(b.sale_rate * 100) AS INTEGER),
                  CASE
                    WHEN b.expiry_date < ?1 THEN 'EXPIRED'
                    WHEN b.expiry_date <= date(?1, '+' || ?2 || ' days') THEN 'NEAR_EXPIRY'
                    WHEN m.min_stock_alert > 0 AND ms.sellable_quantity <= m.min_stock_alert
                      THEN 'LOW_STOCK'
                    ELSE 'SELLABLE'
                  END AS stock_status
           FROM medicine_batches b
           JOIN medicines m ON m.id = b.medicine_id
           JOIN medicine_stock ms ON ms.id = m.id
           WHERE b.current_stock > 0
           ORDER BY b.expiry_date ASC, m.name COLLATE NOCASE ASC, b.id ASC
           LIMIT ?3"#,
        params![as_of_date, near_expiry_days, REPORT_MAX_ROWS],
        |row| {
            let quantity: i64 = row.get(6)?;
            let purchase_cost_cents: i64 = row.get(7)?;
            let mrp_cents: i64 = row.get(8)?;
            let sale_rate_cents: i64 = row.get(9)?;
            Ok(StockValuationRow {
                medicine_id: row.get(0)?,
                medicine_name: row.get(1)?,
                company: row.get(2)?,
                barcode: row.get(3)?,
                batch_no: row.get(4)?,
                expiry_date: row.get(5)?,
                quantity,
                purchase_cost: money(purchase_cost_cents),
                mrp: money(mrp_cents),
                sale_rate: money(sale_rate_cents),
                cost_value: money(purchase_cost_cents * quantity),
                mrp_value: money(mrp_cents * quantity),
                sale_value: money(sale_rate_cents * quantity),
                stock_status: row.get(10)?,
            })
        },
    )?;
    Ok(StockValuationReport {
        as_of_date,
        near_expiry_days,
        sellable_quantity: summary.0,
        sellable_cost_value: money(summary.1),
        sellable_mrp_value: money(summary.2),
        sellable_sale_value: money(summary.3),
        expired_quantity: summary.4,
        expired_cost_value: money(summary.5),
        near_expiry_quantity: summary.6,
        near_expiry_cost_value: money(summary.7),
        low_stock_items: summary.8,
        total_stock_quantity: summary.9,
        total_stock_cost_value: money(summary.10),
        total_stock_mrp_value: money(summary.11),
        rows,
        total_rows: all_rows,
    })
}

fn query_customer_due(
    connection: &Connection,
    range: &ReportDateRange,
    search: Option<&str>,
    outstanding_only: bool,
    sort_by: Option<&FinancialReportSort>,
    page: i64,
    page_size: i64,
) -> Result<CustomerDueReport, String> {
    let (offset, page_size) = page_values(page, page_size);
    let sort = match sort_by {
        Some(FinancialReportSort::Name) => "name COLLATE NOCASE ASC",
        Some(FinancialReportSort::Outstanding) | None => {
            "outstanding_cents DESC, name COLLATE NOCASE ASC"
        }
        Some(_) => "outstanding_cents DESC, name COLLATE NOCASE ASC",
    };
    let common_ctes = r#"WITH all_entries AS (
      SELECT customer_id, debit_cents, credit_cents, created_at FROM customer_ledger
      UNION ALL
      SELECT customer_id, debit_cents, credit_cents, created_at FROM customer_ledger_events
    ),
    balances AS (
      SELECT customer_id, SUM(debit_cents - credit_cents) AS outstanding_cents
      FROM all_entries GROUP BY customer_id
    ),
    last_entries AS (
      SELECT customer_id, MAX(created_at) AS last_transaction_at
      FROM all_entries GROUP BY customer_id
    )"#;
    let count_sql = format!(
        r#"{common_ctes}
           SELECT COUNT(*) FROM customers c
           LEFT JOIN balances b ON b.customer_id = c.id
           WHERE (?1 = '' OR c.name LIKE '%' || ?1 || '%' COLLATE NOCASE
                 OR COALESCE(c.phone, '') LIKE '%' || ?1 || '%' COLLATE NOCASE)
             AND (?2 = 0 OR COALESCE(b.outstanding_cents, 0) > 0)"#
    );
    let total_rows: i64 = connection
        .query_row(
            &count_sql,
            params![
                search.unwrap_or("").trim(),
                if outstanding_only { 1_i64 } else { 0_i64 }
            ],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count customer due rows: {error}"))?;
    let sql = format!(
        r#"{common_ctes}
           SELECT c.id, c.name, c.phone,
                  COALESCE((SELECT SUM(debit_cents) FROM customer_ledger l
                    WHERE l.customer_id = c.id AND l.entry_type = 'CREDIT_SALE'
                      AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2), 0) AS total_credit_cents,
                  COALESCE((SELECT SUM(credit_cents) FROM customer_ledger l
                    WHERE l.customer_id = c.id AND l.entry_type = 'COLLECTION'
                      AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2), 0) AS total_paid_cents,
                  COALESCE(b.outstanding_cents, 0) AS outstanding_cents,
                  date(le.last_transaction_at, 'localtime') AS last_transaction_date
           FROM customers c
           LEFT JOIN balances b ON b.customer_id = c.id
           LEFT JOIN last_entries le ON le.customer_id = c.id
           WHERE (?3 = '' OR c.name LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(c.phone, '') LIKE '%' || ?3 || '%' COLLATE NOCASE)
             AND (?4 = 0 OR COALESCE(b.outstanding_cents, 0) > 0)
           ORDER BY {sort} LIMIT ?5 OFFSET ?6"#
    );
    let rows = checked_query(
        connection,
        &sql,
        params![
            range.start_date,
            range.end_date,
            search.unwrap_or("").trim(),
            if outstanding_only { 1_i64 } else { 0_i64 },
            page_size,
            offset
        ],
        |row| {
            Ok(CustomerDueRow {
                customer_id: row.get(0)?,
                customer_name: row.get(1)?,
                phone: row.get(2)?,
                total_credit: money(row.get(3)?),
                total_paid: money(row.get(4)?),
                outstanding_balance: money(row.get(5)?),
                last_transaction_date: row.get(6)?,
            })
        },
    )?;
    Ok(CustomerDueReport {
        range: range.clone(),
        rows,
        total_rows,
        page: page.max(1),
        page_size,
    })
}

fn query_supplier_due(
    connection: &Connection,
    range: &ReportDateRange,
    search: Option<&str>,
    outstanding_only: bool,
    sort_by: Option<&FinancialReportSort>,
    page: i64,
    page_size: i64,
) -> Result<SupplierDueReport, String> {
    let (offset, page_size) = page_values(page, page_size);
    let sort = match sort_by {
        Some(FinancialReportSort::Name) => "name COLLATE NOCASE ASC",
        Some(FinancialReportSort::Outstanding) | None => {
            "outstanding_cents DESC, name COLLATE NOCASE ASC"
        }
        Some(_) => "outstanding_cents DESC, name COLLATE NOCASE ASC",
    };
    let common_ctes = r#"WITH balances AS (
      SELECT supplier_id, SUM(debit_cents - credit_cents) AS outstanding_cents,
             MAX(created_at) AS last_transaction_at
      FROM supplier_ledger GROUP BY supplier_id
    )"#;
    let count_sql = format!(
        r#"{common_ctes}
           SELECT COUNT(*) FROM suppliers s
           LEFT JOIN balances b ON b.supplier_id = s.id
           WHERE (?1 = '' OR s.name LIKE '%' || ?1 || '%' COLLATE NOCASE
                 OR COALESCE(s.contact_person, '') LIKE '%' || ?1 || '%' COLLATE NOCASE
                 OR COALESCE(s.phone, '') LIKE '%' || ?1 || '%' COLLATE NOCASE
                 OR COALESCE(s.whatsapp_phone, '') LIKE '%' || ?1 || '%' COLLATE NOCASE)
             AND (?2 = 0 OR COALESCE(b.outstanding_cents, 0) > 0)"#
    );
    let total_rows: i64 = connection
        .query_row(
            &count_sql,
            params![
                search.unwrap_or("").trim(),
                if outstanding_only { 1_i64 } else { 0_i64 }
            ],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count supplier due rows: {error}"))?;
    let sql = format!(
        r#"{common_ctes}
           SELECT s.id, s.name, s.contact_person, s.phone,
                  COALESCE((SELECT SUM(CAST(ROUND(p.total_amount * 100) AS INTEGER))
                    FROM purchases p
                    WHERE p.supplier_id = s.id AND p.status = 'ACTIVE'
                      AND p.purchase_date BETWEEN ?1 AND ?2), 0) AS total_purchase_cents,
                  COALESCE((SELECT SUM(pr.total_cents) FROM purchase_returns pr
                    WHERE pr.supplier_id = s.id AND pr.return_date BETWEEN ?1 AND ?2), 0)
                    AS purchase_return_cents,
                  COALESCE((SELECT SUM(l.credit_cents) FROM supplier_ledger l
                    WHERE l.supplier_id = s.id AND l.entry_type = 'PAYMENT'
                      AND date(l.created_at, 'localtime') BETWEEN ?1 AND ?2), 0) AS payments_cents,
                  COALESCE(b.outstanding_cents, 0) AS outstanding_cents,
                  date(b.last_transaction_at, 'localtime') AS last_transaction_date
           FROM suppliers s
           LEFT JOIN balances b ON b.supplier_id = s.id
           WHERE (?3 = '' OR s.name LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(s.contact_person, '') LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(s.phone, '') LIKE '%' || ?3 || '%' COLLATE NOCASE
                 OR COALESCE(s.whatsapp_phone, '') LIKE '%' || ?3 || '%' COLLATE NOCASE)
             AND (?4 = 0 OR COALESCE(b.outstanding_cents, 0) > 0)
           ORDER BY {sort} LIMIT ?5 OFFSET ?6"#
    );
    let rows = checked_query(
        connection,
        &sql,
        params![
            range.start_date,
            range.end_date,
            search.unwrap_or("").trim(),
            if outstanding_only { 1_i64 } else { 0_i64 },
            page_size,
            offset
        ],
        |row| {
            Ok(SupplierDueRow {
                supplier_id: row.get(0)?,
                supplier_name: row.get(1)?,
                contact_person: row.get(2)?,
                phone: row.get(3)?,
                total_purchases: money(row.get(4)?),
                purchase_returns: money(row.get(5)?),
                payments: money(row.get(6)?),
                outstanding_balance: money(row.get(7)?),
                last_transaction_date: row.get(8)?,
            })
        },
    )?;
    Ok(SupplierDueReport {
        range: range.clone(),
        rows,
        total_rows,
        page: page.max(1),
        page_size,
    })
}

fn query_gst_report(connection: &Connection, range: &ReportDateRange) -> Result<GstReport, String> {
    let sales = query_sales_summary(connection, range)?;
    let purchases = query_purchase_summary(connection, range, None)?;
    let sales_rows = checked_query(
        connection,
        r#"SELECT kind, date, invoice_no, party_name, tax_type,
                  taxable_cents, cgst_cents, sgst_cents, igst_cents
           FROM (
             SELECT 'SALE' AS kind, date(s.created_at, 'localtime') AS date,
                    s.invoice_no, COALESCE(NULLIF(TRIM(c.name), ''), s.customer_name) AS party_name,
                    s.tax_type,
                    CAST(ROUND(s.taxable_amount * 100) AS INTEGER) AS taxable_cents,
                    CAST(ROUND(s.cgst_amount * 100) AS INTEGER) AS cgst_cents,
                    CAST(ROUND(s.sgst_amount * 100) AS INTEGER) AS sgst_cents,
                    CAST(ROUND(s.igst_amount * 100) AS INTEGER) AS igst_cents,
                    s.created_at AS sort_date, s.id AS sort_id
             FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
             WHERE date(s.created_at, 'localtime') BETWEEN ?1 AND ?2
             UNION ALL
             SELECT 'SALE_RETURN', date(r.created_at, 'localtime'), s.invoice_no,
                    COALESCE(NULLIF(TRIM(c.name), ''), s.customer_name), s.tax_type,
                    -SUM(ri.taxable_cents), -SUM(ri.cgst_cents), -SUM(ri.sgst_cents),
                    -SUM(ri.igst_cents), r.created_at, r.id
             FROM sale_returns r JOIN sales s ON s.id = r.sale_id
             LEFT JOIN customers c ON c.id = s.customer_id
             JOIN sale_return_items ri ON ri.return_id = r.id
             WHERE date(r.created_at, 'localtime') BETWEEN ?1 AND ?2
             GROUP BY r.id, s.invoice_no, c.name, s.customer_name, s.tax_type
             UNION ALL
             SELECT 'SALE_VOID', date(v.created_at, 'localtime'), s.invoice_no,
                    COALESCE(NULLIF(TRIM(c.name), ''), s.customer_name), s.tax_type,
                    -CAST(ROUND(s.taxable_amount * 100) AS INTEGER),
                    -CAST(ROUND(s.cgst_amount * 100) AS INTEGER),
                    -CAST(ROUND(s.sgst_amount * 100) AS INTEGER),
                    -CAST(ROUND(s.igst_amount * 100) AS INTEGER),
                    v.created_at, v.id
             FROM sale_voids v JOIN sales s ON s.id = v.sale_id
             LEFT JOIN customers c ON c.id = s.customer_id
             WHERE date(v.created_at, 'localtime') BETWEEN ?1 AND ?2
           )
           ORDER BY sort_date DESC, sort_id DESC LIMIT ?3"#,
        params![range.start_date, range.end_date, REPORT_MAX_ROWS],
        |row| {
            let taxable = row.get::<_, i64>(5)?;
            let cgst = row.get::<_, i64>(6)?;
            let sgst = row.get::<_, i64>(7)?;
            let igst = row.get::<_, i64>(8)?;
            Ok(GstDetailRow {
                kind: row.get(0)?,
                date: row.get(1)?,
                invoice_no: row.get(2)?,
                party_name: row.get(3)?,
                tax_type: row.get(4)?,
                taxable_amount: money(taxable),
                cgst: money(cgst),
                sgst: money(sgst),
                igst: money(igst),
                total_gst: money(cgst + sgst + igst),
            })
        },
    )?;
    let purchase_sql = format!(
        r#"WITH {PURCHASE_RETURN_TAX_CTE}
           SELECT kind, date, invoice_no, party_name, tax_type,
                  taxable_cents, cgst_cents, sgst_cents, igst_cents
           FROM (
             SELECT 'PURCHASE' AS kind, p.purchase_date AS date, p.invoice_no,
                    s.name AS party_name, p.tax_type,
                    CAST(ROUND(p.taxable_amount * 100) AS INTEGER) AS taxable_cents,
                    CAST(ROUND(p.cgst_amount * 100) AS INTEGER) AS cgst_cents,
                    CAST(ROUND(p.sgst_amount * 100) AS INTEGER) AS sgst_cents,
                    CAST(ROUND(p.igst_amount * 100) AS INTEGER) AS igst_cents,
                    p.purchase_date AS sort_date, p.id AS sort_id
             FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.status = 'ACTIVE' AND p.purchase_date BETWEEN ?1 AND ?2
             UNION ALL
             SELECT 'PURCHASE_RETURN', tax.return_date, p.invoice_no, s.name, p.tax_type,
                    -tax.taxable_cents, -tax.cgst_cents, -tax.sgst_cents, -tax.igst_cents,
                    tax.return_date, tax.return_id
             FROM purchase_return_tax tax
             LEFT JOIN purchases p ON p.id = tax.purchase_id
             LEFT JOIN suppliers s ON s.id = tax.supplier_id
             WHERE tax.return_date BETWEEN ?1 AND ?2
           )
           ORDER BY sort_date DESC, sort_id DESC LIMIT ?3"#
    );
    let purchase_rows = checked_query(
        connection,
        &purchase_sql,
        params![range.start_date, range.end_date, REPORT_MAX_ROWS],
        |row| {
            let taxable = row.get::<_, i64>(5)?;
            let cgst = row.get::<_, i64>(6)?;
            let sgst = row.get::<_, i64>(7)?;
            let igst = row.get::<_, i64>(8)?;
            Ok(GstDetailRow {
                kind: row.get(0)?,
                date: row.get(1)?,
                invoice_no: row.get(2)?,
                party_name: row.get(3)?,
                tax_type: row.get(4)?,
                taxable_amount: money(taxable),
                cgst: money(cgst),
                sgst: money(sgst),
                igst: money(igst),
                total_gst: money(cgst + sgst + igst),
            })
        },
    )?;
    let same_state_output = sales_rows
        .iter()
        .filter(|row| row.tax_type == "CGST_SGST")
        .map(|row| (row.taxable_amount * 100.0).round() as i64)
        .sum::<i64>();
    let interstate_output = sales_rows
        .iter()
        .filter(|row| row.tax_type == "IGST")
        .map(|row| (row.taxable_amount * 100.0).round() as i64)
        .sum::<i64>();
    let same_state_input = purchase_rows
        .iter()
        .filter(|row| row.tax_type == "CGST_SGST")
        .map(|row| (row.taxable_amount * 100.0).round() as i64)
        .sum::<i64>();
    let interstate_input = purchase_rows
        .iter()
        .filter(|row| row.tax_type == "IGST")
        .map(|row| (row.taxable_amount * 100.0).round() as i64)
        .sum::<i64>();
    let total_output = sales.cgst + sales.sgst + sales.igst;
    let total_input = purchases.cgst + purchases.sgst + purchases.igst;
    Ok(GstReport {
        range: range.clone(),
        taxable_sales: sales.taxable_sales,
        output_cgst: sales.cgst,
        output_sgst: sales.sgst,
        output_igst: sales.igst,
        total_output_gst: total_output,
        taxable_purchases: purchases.taxable_purchases,
        input_cgst: purchases.cgst,
        input_sgst: purchases.sgst,
        input_igst: purchases.igst,
        total_input_gst: total_input,
        net_gst_position: total_output - total_input,
        same_state_output_taxable: money(same_state_output),
        interstate_output_taxable: money(interstate_output),
        same_state_input_taxable: money(same_state_input),
        interstate_input_taxable: money(interstate_input),
        sales_rows,
        purchase_rows,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        super::super::migrate_connection(&mut connection).expect("apply current schema");
        connection
            .pragma_update(None, "foreign_keys", true)
            .expect("enable foreign keys");
        connection
    }

    fn range(start_date: &str, end_date: &str) -> ReportDateRange {
        ReportDateRange {
            start_date: start_date.to_owned(),
            end_date: end_date.to_owned(),
        }
    }

    fn assert_money(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 0.001,
            "expected {expected:.2}, got {actual:.4}"
        );
    }

    fn configure_test_store(
        connection: &mut Connection,
        gst_enabled: bool,
        default_gst_rate_basis_points: Option<i64>,
    ) {
        super::super::apply_pharmacy_mutation_to_connection(
            connection,
            super::super::PharmacyMutation::SaveSettings {
                settings: super::super::StoreSettingsMutation {
                    pharmacy_name: "Financial Report Test Pharmacy".to_owned(),
                    address: String::new(),
                    contact_number: String::new(),
                    drug_license_number: String::new(),
                    receipt_footer_note: String::new(),
                    upi_id: String::new(),
                    upi_display_name: String::new(),
                    gst_enabled,
                    gst_default_rate_basis_points: default_gst_rate_basis_points,
                    gst_pricing_mode: "EXCLUSIVE".to_owned(),
                    gst_pharmacy_state_code: "29".to_owned(),
                },
            },
        )
        .expect("save financial report test settings");
    }

    fn create_test_customer(
        connection: &mut Connection,
        name: &str,
        state_code: Option<&str>,
    ) -> i64 {
        super::super::apply_pharmacy_mutation_to_connection(
            connection,
            super::super::PharmacyMutation::CreateCustomer {
                name: name.to_owned(),
                phone: None,
                address: None,
                notes: None,
                state_code: state_code.map(str::to_owned),
            },
        )
        .expect("create financial report test customer")
        .expect("created customer id")
    }

    fn add_financial_test_batch(
        connection: &Connection,
        batch_id: i64,
        medicine_id: i64,
        expiry_offset_days: i64,
        stock: i64,
        purchase_rate: f64,
        mrp: f64,
        sale_rate: f64,
    ) {
        connection
            .execute(
                r#"INSERT INTO medicine_batches (
                     id, medicine_id, batch_no, expiry_date, purchase_rate,
                     mrp, sale_rate, current_stock
                   ) VALUES (
                     ?1, ?2, ?3, date('now', 'localtime', ?4), ?5, ?6, ?7, ?8
                   )"#,
                params![
                    batch_id,
                    medicine_id,
                    format!("FIN-{batch_id}"),
                    format!("{expiry_offset_days:+} days"),
                    purchase_rate,
                    mrp,
                    sale_rate,
                    stock
                ],
            )
            .expect("insert financial report test batch");
    }

    fn customer_collection_request(
        customer_id: i64,
        amount_cents: i64,
        payment_mode: &str,
        reference: &str,
    ) -> super::super::CustomerPaymentRequest {
        super::super::CustomerPaymentRequest {
            customer_id,
            amount_cents,
            payment_mode: payment_mode.to_owned(),
            payment_reference: Some(reference.to_owned()),
            upi_transaction_id: (payment_mode == "UPI").then(|| format!("UPI-{reference}")),
            note: Some("Automated collection regression".to_owned()),
        }
    }

    fn customer_due_for_test(
        connection: &Connection,
        report_range: &ReportDateRange,
        customer_name: &str,
    ) -> CustomerDueRow {
        let report = query_customer_due(
            connection,
            report_range,
            Some(customer_name),
            false,
            None,
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("query customer due report");
        assert_eq!(report.total_rows, 1);
        report.rows.into_iter().next().expect("customer due row")
    }

    fn customer_ledger_balance_cents(connection: &Connection, customer_id: i64) -> i64 {
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
            .expect("read test customer ledger balance")
    }

    fn financial_fixture() -> Connection {
        let connection = test_connection();
        connection
            .execute_batch(
                r#"
                INSERT INTO suppliers (id, name, phone, contact_person)
                VALUES (1, 'Northstar Pharma', '9000000001', 'Asha');
                INSERT INTO customers (id, name, phone, active)
                VALUES (1, 'Ravi Kumar', '9000000002', 1);
                INSERT INTO medicines
                  (id, name, generic_name, company, min_stock_alert, gst_rate_basis_points)
                VALUES (1, 'Tablet A', 'Compound A', 'Acme Labs', 8, 5000);
                INSERT INTO medicine_batches
                  (id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock, barcode)
                VALUES
                  (1, 1, 'B-01', date('now', 'localtime', '+365 days'), 100, 150, 120, 7, 'BAR-01'),
                  (2, 1, 'B-02', date('now', 'localtime', '-1 day'), 50, 80, 60, 2, 'BAR-02'),
                  (3, 1, 'B-03', date('now', 'localtime', '+15 days'), 40, 60, 50, 1, 'BAR-03');

                INSERT INTO purchases
                  (id, invoice_no, supplier_id, total_amount, purchase_date, status, gst_enabled,
                   gst_pricing_mode, tax_type, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                VALUES
                  (1, 'PUR-1', 1, 118, '2025-03-10', 'ACTIVE', 1, 'EXCLUSIVE',
                   'CGST_SGST', 100, 9, 9, 0, 18);
                INSERT INTO purchase_items
                  (id, purchase_id, batch_id, quantity, rate, total, gst_rate_basis_points,
                   taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                VALUES (1, 1, 1, 10, 10, 100, 1800, 100, 9, 9, 0, 18);

                INSERT INTO sales
                  (id, invoice_no, customer_name, customer_phone, subtotal, discount, grand_total,
                   payment_mode, created_at, total_gst, customer_id, tax_type, taxable_amount,
                   cgst_amount, sgst_amount, igst_amount, status)
                VALUES
                  (1, 'INV-1', 'Ravi Kumar', '9000000002', 100, 0, 118, 'CREDIT',
                   '2025-03-10 12:00:00', 18, 1, 'CGST_SGST', 100, 9, 9, 0, 'PARTIALLY_RETURNED'),
                  (2, 'INV-2', 'Walk-in customer', NULL, 100, 0, 118, 'CASH',
                   '2025-03-10 13:00:00', 18, NULL, 'CGST_SGST', 100, 9, 9, 0, 'CANCELLED');
                INSERT INTO sale_items
                  (id, sale_id, batch_id, quantity, unit_price, total_price, purchase_rate_at_sale,
                   gst_rate_basis_points, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                VALUES
                  (1, 1, 1, 2, 59, 118, 30, 1800, 100, 9, 9, 0, 18),
                  (2, 2, 1, 2, 59, 118, 25, 1800, 100, 9, 9, 0, 18);

                INSERT INTO sale_returns
                  (id, sale_id, return_no, total_cents, customer_due_credit_cents, refund_mode, created_at)
                VALUES (1, 1, 'RET-1', 5900, 5900, 'CASH', '2025-03-11 12:00:00');
                INSERT INTO sale_return_items
                  (id, return_id, sale_item_id, batch_id, quantity, refund_cents, taxable_cents,
                   cgst_cents, sgst_cents, igst_cents, total_gst_cents)
                VALUES (1, 1, 1, 1, 1, 5900, 5000, 450, 450, 0, 900);
                INSERT INTO sale_voids (id, sale_id, refund_cents, refund_mode, created_at)
                VALUES (1, 2, 11800, 'CASH', '2025-03-12 12:00:00');
                INSERT INTO sale_corrections (id, sale_id, before_json, after_json, created_at)
                VALUES (1, 1, '{}', '{}', '2025-03-10 14:00:00');

                INSERT INTO customer_ledger
                  (customer_id, entry_type, invoice_no, debit_cents, credit_cents, created_at)
                VALUES (1, 'CREDIT_SALE', 'INV-1', 11800, 0, '2025-03-10 12:00:00');
                INSERT INTO customer_ledger
                  (customer_id, entry_type, debit_cents, credit_cents, payment_mode, created_at)
                VALUES (1, 'COLLECTION', 0, 2000, 'CASH', '2025-03-12 09:00:00');
                INSERT INTO customer_ledger_events
                  (customer_id, entry_type, invoice_no, reference, debit_cents, credit_cents, created_at)
                VALUES (1, 'SALE_RETURN', 'INV-1', 'RET-1', 0, 5900, '2025-03-11 12:00:00');

                INSERT INTO purchase_returns
                  (id, purchase_id, supplier_id, return_date, total_cents, created_at)
                VALUES (1, 1, 1, '2025-03-11', 5900, '2025-03-11 12:00:00');
                INSERT INTO purchase_return_items
                  (id, return_id, purchase_item_id, batch_id, quantity, rate_cents, total_cents)
                VALUES (1, 1, 1, 1, 5, 1000, 5000);
                INSERT INTO supplier_ledger
                  (supplier_id, entry_type, purchase_id, reference, debit_cents, credit_cents, created_at)
                VALUES (1, 'PURCHASE', 1, 'PUR-1', 11800, 0, '2025-03-10 12:00:00');
                INSERT INTO supplier_ledger
                  (supplier_id, entry_type, purchase_id, reference, debit_cents, credit_cents, created_at)
                VALUES (1, 'PURCHASE_RETURN', 1, 'PUR-RET-1', 0, 5900, '2025-03-11 12:00:00');
                INSERT INTO supplier_ledger
                  (supplier_id, entry_type, reference, debit_cents, credit_cents, payment_method, created_at)
                VALUES (1, 'PAYMENT', 'PAY-1', 0, 2000, 'CASH', '2025-03-12 09:00:00');
                "#,
            )
            .expect("insert report fixture");
        connection
    }

    #[test]
    fn multi_line_checkout_counts_fefo_gst_cost_and_profit_once() {
        let mut connection = test_connection();
        configure_test_store(&mut connection, true, Some(1_800));
        let customer_id = create_test_customer(&mut connection, "Multi-line buyer", Some("29"));
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name, generic_name, company, gst_rate_basis_points)
                VALUES
                  (1, 'Alpha medicine', 'Alpha ingredient', 'Alpha Labs', 500),
                  (2, 'Beta medicine', 'Beta ingredient', 'Beta Labs', 1200);
                "#,
            )
            .expect("insert multi-line sale medicines");
        add_financial_test_batch(&connection, 101, 1, 30, 1, 4.0, 20.0, 10.0);
        add_financial_test_batch(&connection, 102, 1, 180, 4, 4.5, 20.0, 10.0);
        add_financial_test_batch(&connection, 201, 2, 365, 6, 7.0, 30.0, 15.0);

        let sale = super::super::complete_sale_in_connection(
            &mut connection,
            super::super::SaleCheckoutRequest {
                customer_id: Some(customer_id),
                customer_name: None,
                customer_phone: None,
                payment_mode: "CASH".to_owned(),
                flat_discount_cents: 0,
                cash_tendered_cents: 8_000,
                gst_pricing_mode: Some("EXCLUSIVE".to_owned()),
                upi_transaction_id: None,
                items: vec![
                    super::super::SaleCheckoutItem {
                        medicine_id: 1,
                        batch_id: 101,
                        quantity: 2,
                        unit_price_cents: 1_000,
                        item_discount_cents: 0,
                        gst_rate_override_basis_points: None,
                    },
                    super::super::SaleCheckoutItem {
                        medicine_id: 2,
                        batch_id: 201,
                        quantity: 3,
                        unit_price_cents: 1_500,
                        item_discount_cents: 0,
                        gst_rate_override_basis_points: None,
                    },
                ],
            },
        )
        .expect("complete multi-line GST sale");

        let allocations = checked_query(
            &connection,
            r#"SELECT batch_id, quantity, purchase_rate_at_sale
               FROM sale_items WHERE sale_id = ?1 ORDER BY batch_id"#,
            [sale.sale_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, f64>(2)?,
                ))
            },
        )
        .expect("read FEFO allocations");
        assert_eq!(
            allocations,
            vec![(101, 1, 4.0), (102, 1, 4.5), (201, 3, 7.0)]
        );

        let (sale_count, item_count, invoice_total, invoice_taxable, invoice_gst): (
            i64,
            i64,
            i64,
            i64,
            i64,
        ) = connection
            .query_row(
                r#"SELECT
                     (SELECT COUNT(*) FROM sales WHERE id = ?1),
                     (SELECT COUNT(*) FROM sale_items WHERE sale_id = ?1),
                     (SELECT CAST(ROUND(grand_total * 100) AS INTEGER)
                        FROM sales WHERE id = ?1),
                     (SELECT CAST(ROUND(taxable_amount * 100) AS INTEGER)
                        FROM sales WHERE id = ?1),
                     (SELECT CAST(ROUND(total_gst * 100) AS INTEGER)
                        FROM sales WHERE id = ?1)"#,
                [sale.sale_id],
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
            .expect("read multi-line invoice totals");
        assert_eq!(
            (
                sale_count,
                item_count,
                invoice_total,
                invoice_taxable,
                invoice_gst
            ),
            (1, 3, 7_140, 6_500, 640)
        );

        let product_totals = checked_query(
            &connection,
            r#"SELECT mb.medicine_id,
                      SUM(si.quantity),
                      CAST(ROUND(SUM(si.taxable_amount) * 100) AS INTEGER),
                      CAST(ROUND(SUM(si.total_gst) * 100) AS INTEGER),
                      CAST(ROUND(SUM(si.purchase_rate_at_sale * si.quantity) * 100) AS INTEGER)
               FROM sale_items si
               JOIN medicine_batches mb ON mb.id = si.batch_id
               WHERE si.sale_id = ?1
               GROUP BY mb.medicine_id
               ORDER BY mb.medicine_id"#,
            [sale.sale_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .expect("read per-medicine sales, GST, and cost");
        assert_eq!(
            product_totals,
            vec![(1, 2, 2_000, 100, 850), (2, 3, 4_500, 540, 2_100)]
        );

        let (early_stock, later_stock, beta_stock): (i64, i64, i64) = connection
            .query_row(
                r#"SELECT
                     (SELECT current_stock FROM medicine_batches WHERE id = 101),
                     (SELECT current_stock FROM medicine_batches WHERE id = 102),
                     (SELECT current_stock FROM medicine_batches WHERE id = 201)"#,
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read stock after multi-line sale");
        assert_eq!((early_stock, later_stock, beta_stock), (0, 3, 3));

        let today: String = connection
            .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
            .expect("read local report date");
        let report_range = range(&today, &today);
        let sales = query_sales_summary(&connection, &report_range).expect("sales summary");
        assert_eq!(sales.invoice_count, 1);
        assert_eq!(sales.total_rows, 1);
        assert_money(sales.gross_sales, 71.4);
        assert_money(sales.net_sales, 71.4);
        assert_money(sales.taxable_sales, 65.0);
        assert_money(sales.output_gst, 6.4);
        assert_money(sales.cash_sales, 71.4);

        let profit =
            query_profit_and_loss(&connection, &report_range).expect("multi-line profit report");
        assert_money(profit.net_sales, 65.0);
        assert_eq!(profit.cogs, Some(29.5));
        assert_eq!(profit.gross_profit, Some(35.5));
        assert_eq!(profit.cost_unavailable_invoices, 0);
    }

    #[test]
    fn customer_collections_cover_all_methods_partial_full_and_overpayment() {
        let mut connection = test_connection();
        configure_test_store(&mut connection, false, None);
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name, generic_name, company)
                VALUES (1, 'Collection test medicine', 'Collection ingredient', 'Test Labs');
                "#,
            )
            .expect("insert customer collection medicine");
        add_financial_test_batch(&connection, 501, 1, 365, 5, 50.0, 150.0, 100.0);

        let today: String = connection
            .query_row("SELECT date('now', 'localtime')", [], |row| row.get(0))
            .expect("read local customer due report date");
        let report_range = range(&today, &today);

        for payment_mode in ["CASH", "UPI", "CARD", "BANK", "OTHER"] {
            let customer_name = format!("Collection {payment_mode}");
            let customer_id = create_test_customer(&mut connection, &customer_name, Some("29"));
            super::super::complete_sale_in_connection(
                &mut connection,
                super::super::SaleCheckoutRequest {
                    customer_id: Some(customer_id),
                    customer_name: None,
                    customer_phone: None,
                    payment_mode: "CREDIT".to_owned(),
                    flat_discount_cents: 0,
                    cash_tendered_cents: 0,
                    gst_pricing_mode: Some("EXCLUSIVE".to_owned()),
                    upi_transaction_id: None,
                    items: vec![super::super::SaleCheckoutItem {
                        medicine_id: 1,
                        batch_id: 501,
                        quantity: 1,
                        unit_price_cents: 10_000,
                        item_discount_cents: 0,
                        gst_rate_override_basis_points: None,
                    }],
                },
            )
            .expect("record customer credit sale");

            let partial = super::super::collect_customer_payment_in_connection(
                &mut connection,
                customer_collection_request(
                    customer_id,
                    4_000,
                    payment_mode,
                    &format!("{payment_mode}-PARTIAL"),
                ),
            )
            .expect("record partial customer collection");
            assert_eq!(partial.balance_due_cents, 6_000);
            assert_eq!(
                customer_ledger_balance_cents(&connection, customer_id),
                6_000
            );

            let partial_report = customer_due_for_test(&connection, &report_range, &customer_name);
            assert_money(partial_report.total_credit, 100.0);
            assert_money(partial_report.total_paid, 40.0);
            assert_money(partial_report.outstanding_balance, 60.0);

            let overpayment = super::super::collect_customer_payment_in_connection(
                &mut connection,
                customer_collection_request(
                    customer_id,
                    6_001,
                    payment_mode,
                    &format!("{payment_mode}-OVERPAY"),
                ),
            )
            .expect_err("reject collection above the outstanding balance");
            assert!(overpayment.contains("cannot exceed"));
            assert_eq!(
                customer_ledger_balance_cents(&connection, customer_id),
                6_000
            );
            let after_rejection = customer_due_for_test(&connection, &report_range, &customer_name);
            assert_money(after_rejection.total_paid, 40.0);
            assert_money(after_rejection.outstanding_balance, 60.0);

            let full = super::super::collect_customer_payment_in_connection(
                &mut connection,
                customer_collection_request(
                    customer_id,
                    6_000,
                    payment_mode,
                    &format!("{payment_mode}-FULL"),
                ),
            )
            .expect("record final customer collection");
            assert_eq!(full.balance_due_cents, 0);
            assert_eq!(customer_ledger_balance_cents(&connection, customer_id), 0);

            let full_report = customer_due_for_test(&connection, &report_range, &customer_name);
            assert_money(full_report.total_credit, 100.0);
            assert_money(full_report.total_paid, 100.0);
            assert_money(full_report.outstanding_balance, 0.0);

            let saved_method_count: i64 = connection
                .query_row(
                    r#"SELECT COUNT(*) FROM customer_ledger
                       WHERE customer_id = ?1 AND entry_type = 'COLLECTION'
                         AND payment_mode = ?2"#,
                    params![customer_id, payment_mode],
                    |row| row.get(0),
                )
                .expect("count saved collections for payment method");
            assert_eq!(saved_method_count, 2);
        }
    }

    #[test]
    fn date_presets_and_custom_ranges_are_calendar_correct() {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        let expected = [
            (ReportRangePreset::Today, "2024-03-01", "2024-03-01"),
            (ReportRangePreset::Yesterday, "2024-02-29", "2024-02-29"),
            (ReportRangePreset::ThisWeek, "2024-02-26", "2024-03-01"),
            (ReportRangePreset::ThisMonth, "2024-03-01", "2024-03-01"),
            (ReportRangePreset::LastMonth, "2024-02-01", "2024-02-29"),
        ];
        for (preset, expected_start, expected_end) in expected {
            let actual = resolve_date_range(&connection, preset, None, None, Some("2024-03-01"))
                .expect("resolve preset");
            assert_eq!(actual.start_date, expected_start);
            assert_eq!(actual.end_date, expected_end);
        }

        let custom = resolve_date_range(
            &connection,
            ReportRangePreset::Custom,
            Some("2024-02-29"),
            Some("2024-03-01"),
            Some("2024-03-01"),
        )
        .expect("resolve custom range");
        assert_eq!(custom.start_date, "2024-02-29");
        assert_eq!(custom.end_date, "2024-03-01");

        assert!(resolve_date_range(
            &connection,
            ReportRangePreset::Custom,
            Some("2024-02-30"),
            Some("2024-03-01"),
            Some("2024-03-01"),
        )
        .is_err());
        assert!(resolve_date_range(
            &connection,
            ReportRangePreset::Custom,
            Some("2024-03-02"),
            Some("2024-03-01"),
            Some("2024-03-01"),
        )
        .is_err());
    }

    #[test]
    fn empty_date_ranges_return_zero_totals_and_no_rows() {
        let connection = test_connection();
        let report_range = range("2099-01-01", "2099-01-31");
        let sales = query_sales_summary(&connection, &report_range).expect("empty sales");
        assert_money(sales.gross_sales, 0.0);
        assert_money(sales.net_sales, 0.0);
        assert!(sales.rows.is_empty());
        assert_eq!(sales.total_rows, 0);

        let purchases =
            query_purchase_summary(&connection, &report_range, None).expect("empty purchases");
        assert_money(purchases.net_purchases, 0.0);
        assert!(purchases.rows.is_empty());
        assert_eq!(purchases.total_rows, 0);

        let profit = query_profit_and_loss(&connection, &report_range).expect("empty profit");
        assert_money(profit.net_sales, 0.0);
        assert_eq!(profit.cogs, Some(0.0));
        assert_money(profit.operating_expenses, 0.0);
        assert_eq!(profit.gross_profit, Some(0.0));
        assert_eq!(profit.net_profit, Some(0.0));
        assert!(profit.product_rows.is_empty());

        let gst = query_gst_report(&connection, &report_range).expect("empty GST");
        assert_money(gst.net_gst_position, 0.0);
        assert!(gst.sales_rows.is_empty());
        assert!(gst.purchase_rows.is_empty());
    }

    #[test]
    fn returns_voids_and_corrections_use_saved_transaction_snapshots() {
        let connection = financial_fixture();
        let report_range = range("2025-03-10", "2025-03-12");

        let sales = query_sales_summary(&connection, &report_range).expect("sales summary");
        assert_money(sales.gross_sales, 236.0);
        assert_money(sales.sales_returns, 59.0);
        assert_money(sales.void_sales, 118.0);
        assert_money(sales.net_sales, 59.0);
        assert_money(sales.taxable_sales, 50.0);
        assert_money(sales.output_gst, 9.0);
        assert_money(sales.cash_sales, 118.0);
        assert_money(sales.credit_sales, 118.0);
        assert_eq!(sales.invoice_count, 2);
        assert_eq!(sales.return_transaction_count, 1);
        assert_eq!(sales.voided_invoice_count, 1);
        assert_eq!(sales.correction_count, 1);
        assert_eq!(sales.total_rows, 4);

        let profit = query_profit_and_loss(&connection, &report_range).expect("P&L report");
        assert_money(profit.net_sales, 50.0);
        assert_eq!(profit.cogs, Some(30.0));
        assert_eq!(profit.gross_profit, Some(20.0));
        assert_money(profit.operating_expenses, 0.0);
        assert_eq!(profit.net_profit, Some(20.0));
        assert_eq!(profit.gross_margin_percent, Some(40.0));
        assert_eq!(profit.net_margin_percent, Some(40.0));
        assert_eq!(profit.cost_unavailable_invoices, 0);
        assert_eq!(profit.product_rows.len(), 1);

        let products = query_product_sales(
            &connection,
            &report_range,
            None,
            None,
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("product sales");
        let product = &products.rows[0];
        assert_eq!(products.total_rows, 1);
        assert_eq!(product.quantity_sold, 4);
        assert_eq!(product.returned_quantity, 1);
        assert_eq!(product.voided_quantity, 2);
        assert_eq!(product.net_quantity, 1);
        assert_money(product.net_sales, 59.0);
        assert_money(product.taxable_sales, 50.0);
        assert_eq!(product.cogs, Some(30.0));
        assert_eq!(product.gross_profit, Some(20.0));

        let companies = query_company_sales(
            &connection,
            &report_range,
            None,
            Some(&FinancialReportSort::GrossProfit),
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("company sales");
        assert_eq!(companies.total_rows, 1);
        assert_eq!(companies.rows[0].company, "Acme Labs");
        assert_eq!(companies.rows[0].gross_profit, Some(20.0));

        let purchase =
            query_purchase_summary(&connection, &report_range, None).expect("purchase summary");
        assert_money(purchase.gross_purchases, 118.0);
        assert_money(purchase.purchase_returns, 59.0);
        assert_money(purchase.net_purchases, 59.0);
        assert_money(purchase.taxable_purchases, 50.0);
        assert_money(purchase.input_gst, 9.0);
        assert_money(purchase.cash_payments, 20.0);

        let customer_due = query_customer_due(
            &connection,
            &report_range,
            None,
            true,
            Some(&FinancialReportSort::Outstanding),
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("customer due");
        assert_eq!(customer_due.total_rows, 1);
        assert_money(customer_due.rows[0].total_credit, 118.0);
        assert_money(customer_due.rows[0].total_paid, 20.0);
        assert_money(customer_due.rows[0].outstanding_balance, 39.0);

        let supplier_due = query_supplier_due(
            &connection,
            &report_range,
            None,
            true,
            Some(&FinancialReportSort::Outstanding),
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("supplier due");
        assert_eq!(supplier_due.total_rows, 1);
        assert_money(supplier_due.rows[0].total_purchases, 118.0);
        assert_money(supplier_due.rows[0].purchase_returns, 59.0);
        assert_money(supplier_due.rows[0].payments, 20.0);
        assert_money(supplier_due.rows[0].outstanding_balance, 39.0);

        let gst = query_gst_report(&connection, &report_range).expect("GST report");
        assert_money(gst.taxable_sales, 50.0);
        assert_money(gst.total_output_gst, 9.0);
        assert_money(gst.taxable_purchases, 50.0);
        assert_money(gst.total_input_gst, 9.0);
        assert_money(gst.net_gst_position, 0.0);
        assert_money(gst.same_state_output_taxable, 50.0);
        assert_money(gst.same_state_input_taxable, 50.0);
        assert_eq!(gst.sales_rows.len(), 4);
        assert_eq!(gst.purchase_rows.len(), 2);

        let stock = query_stock_valuation(&connection, 30).expect("stock valuation");
        assert_eq!(stock.total_stock_quantity, 10);
        assert_money(stock.total_stock_cost_value, 840.0);
        assert_money(stock.sellable_cost_value, 740.0);
        assert_eq!(stock.expired_quantity, 2);
        assert_money(stock.expired_cost_value, 100.0);
        assert_eq!(stock.near_expiry_quantity, 1);
        assert_money(stock.near_expiry_cost_value, 40.0);
        assert_eq!(stock.low_stock_items, 1);
        assert_eq!(stock.total_rows, 3);
    }

    #[test]
    fn expense_reports_and_financial_summary_exclude_cancelled_costs() {
        let connection = financial_fixture();
        let rent_id: i64 = connection
            .query_row(
                "SELECT id FROM expense_categories WHERE name = 'Rent'",
                [],
                |row| row.get(0),
            )
            .expect("find seeded rent category");
        let salary_id: i64 = connection
            .query_row(
                "SELECT id FROM expense_categories WHERE name = 'Salary'",
                [],
                |row| row.get(0),
            )
            .expect("find seeded salary category");
        connection
            .execute(
                r#"INSERT INTO expenses
                   (expense_date, category_id, description, amount_cents, payment_method, reference_number)
                   VALUES ('2025-03-10', ?1, 'Shop rent', 5000, 'CASH', 'RENT-1')"#,
                [rent_id],
            )
            .expect("insert active cash expense");
        connection
            .execute(
                r#"INSERT INTO expenses
                   (expense_date, category_id, description, amount_cents, payment_method, reference_number)
                   VALUES ('2025-03-11', ?1, 'Staff payroll', 2500, 'BANK', 'SAL-1')"#,
                [salary_id],
            )
            .expect("insert active bank expense");
        connection
            .execute(
                r#"INSERT INTO expenses
                   (expense_date, category_id, description, amount_cents, payment_method, status)
                   VALUES ('2025-03-11', ?1, 'Voided bill', 9000, 'UPI', 'CANCELLED')"#,
                [rent_id],
            )
            .expect("insert cancelled expense");

        let report_range = range("2025-03-10", "2025-03-12");
        let expenses = query_expenses_report(&connection, &report_range).expect("expense report");
        assert_money(expenses.total_expenses, 75.0);
        assert_eq!(expenses.active_count, 2);
        assert_eq!(expenses.cancelled_count, 1);
        assert_eq!(expenses.total_rows, 3);
        assert_eq!(expenses.rows.len(), 3);
        assert_eq!(expenses.daily_totals.len(), 2);
        assert_eq!(expenses.monthly_totals.len(), 1);
        assert_money(expenses.monthly_totals[0].amount, 75.0);
        assert_money(
            expenses
                .payment_method_totals
                .iter()
                .find(|row| row.payment_method == "CASH")
                .expect("cash total")
                .amount,
            50.0,
        );
        assert_money(
            expenses
                .payment_method_totals
                .iter()
                .find(|row| row.payment_method == "UPI")
                .expect("UPI total")
                .amount,
            0.0,
        );
        assert!(expenses.rows.iter().any(|row| row.status == "CANCELLED"));

        let profit = query_profit_and_loss(&connection, &report_range).expect("P&L with expenses");
        assert_eq!(profit.gross_profit, Some(20.0));
        assert_money(profit.operating_expenses, 75.0);
        assert_eq!(profit.net_profit, Some(-55.0));
        assert_eq!(profit.gross_margin_percent, Some(40.0));
        assert_eq!(profit.net_margin_percent, Some(-110.0));

        let summary =
            query_financial_summary(&connection, &report_range).expect("financial summary");
        assert_money(summary.net_sales, 50.0);
        assert_money(summary.operating_expenses, 75.0);
        assert_eq!(summary.net_profit, Some(-55.0));
        assert_money(summary.customer_outstanding, 39.0);
        assert_money(summary.supplier_outstanding, 39.0);
        assert_money(summary.stock_valuation, 840.0);
        assert_eq!(summary.stock_quantity, 10);
    }

    #[test]
    fn product_sales_search_and_pagination_return_only_the_requested_page() {
        let connection = test_connection();
        connection
            .execute_batch(
                r#"
                INSERT INTO medicines (id, name, company, min_stock_alert)
                VALUES (1, 'Tablet Alpha', 'North Labs', 5),
                       (2, 'Tablet Beta', 'South Labs', 5);
                INSERT INTO medicine_batches
                  (id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock)
                VALUES
                  (1, 1, 'A-1', '2030-01-01', 10, 20, 15, 10),
                  (2, 2, 'B-1', '2030-01-01', 15, 30, 25, 10);
                INSERT INTO sales
                  (id, invoice_no, customer_name, subtotal, discount, grand_total, payment_mode,
                   created_at, total_gst, taxable_amount, cgst_amount, sgst_amount, igst_amount)
                VALUES
                  (1, 'PAGE-1', 'Walk-in', 20, 0, 20, 'CASH', '2025-04-10 12:00:00', 0, 20, 0, 0, 0),
                  (2, 'PAGE-2', 'Walk-in', 15, 0, 15, 'CASH', '2025-04-10 13:00:00', 0, 15, 0, 0, 0);
                INSERT INTO sale_items
                  (id, sale_id, batch_id, quantity, unit_price, total_price, purchase_rate_at_sale,
                   gst_rate_basis_points, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                VALUES
                  (1, 1, 1, 1, 20, 20, 10, 0, 20, 0, 0, 0, 0),
                  (2, 2, 2, 1, 15, 15, 15, 0, 15, 0, 0, 0, 0);
                "#,
            )
            .expect("insert pagination fixture");
        let report_range = range("2025-04-10", "2025-04-10");

        let first_page = query_product_sales(
            &connection,
            &report_range,
            None,
            Some(&FinancialReportSort::Name),
            1,
            1,
        )
        .expect("first product page");
        let second_page = query_product_sales(
            &connection,
            &report_range,
            None,
            Some(&FinancialReportSort::Name),
            2,
            1,
        )
        .expect("second product page");
        assert_eq!(first_page.total_rows, 2);
        assert_eq!(first_page.page, 1);
        assert_eq!(first_page.page_size, 1);
        assert_eq!(first_page.rows.len(), 1);
        assert_eq!(first_page.rows[0].medicine_name, "Tablet Alpha");
        assert_eq!(second_page.page, 2);
        assert_eq!(second_page.rows.len(), 1);
        assert_eq!(second_page.rows[0].medicine_name, "Tablet Beta");

        let filtered = query_product_sales(
            &connection,
            &report_range,
            Some("Beta"),
            Some(&FinancialReportSort::NetSales),
            1,
            REPORT_MAX_PAGE_SIZE + 50,
        )
        .expect("filtered product page");
        assert_eq!(filtered.total_rows, 1);
        assert_eq!(filtered.page_size, REPORT_MAX_PAGE_SIZE);
        assert_eq!(filtered.rows.len(), 1);
        assert_eq!(filtered.rows[0].medicine_name, "Tablet Beta");

        assert_eq!(page_values(0, 100), (0, 100));
        assert_eq!(page_values(3, 1), (2, 1));
        assert_eq!(
            page_values(i64::MAX, REPORT_MAX_PAGE_SIZE),
            (REPORT_MAX_ROWS, REPORT_MAX_PAGE_SIZE)
        );
    }

    #[test]
    fn report_queries_handle_thousands_of_isolated_transactions_and_batches() {
        const DOCUMENTS: i64 = 2_000;
        const MEDICINES: i64 = 250;

        let mut connection = test_connection();
        connection
            .execute_batch(
                r#"
                INSERT INTO suppliers (id, name, state_code)
                VALUES (1, 'Load Test Supplier', '27');
                INSERT INTO customers (id, name, phone, active)
                VALUES (1, 'Load Test Customer', '9000000000', 1);
                "#,
            )
            .expect("insert load-test accounts");

        let transaction = connection
            .transaction()
            .expect("begin load-test fixture transaction");
        {
            let mut insert_medicine = transaction
                .prepare(
                    "INSERT INTO medicines (id, name, company, min_stock_alert) VALUES (?1, ?2, 'Load Labs', 5)",
                )
                .expect("prepare medicine insert");
            for medicine_id in 1..=MEDICINES {
                insert_medicine
                    .execute(params![
                        medicine_id,
                        format!("Load medicine {medicine_id}")
                    ])
                    .expect("insert load-test medicine");
            }
        }
        {
            let mut insert_batch = transaction
                .prepare(
                    r#"INSERT INTO medicine_batches
                       (id, medicine_id, batch_no, expiry_date, purchase_rate, mrp, sale_rate, current_stock)
                       VALUES (?1, ?2, ?3, '2099-12-31', 100, 150, 118, 5)"#,
                )
                .expect("prepare batch insert");
            for batch_id in 1..=DOCUMENTS {
                let medicine_id = (batch_id - 1) % MEDICINES + 1;
                insert_batch
                    .execute(params![
                        batch_id,
                        medicine_id,
                        format!("LOAD-{batch_id}")
                    ])
                    .expect("insert load-test batch");
            }
        }
        {
            let mut insert_purchase = transaction
                .prepare(
                    r#"INSERT INTO purchases
                       (id, invoice_no, supplier_id, total_amount, purchase_date, status, gst_enabled,
                        gst_pricing_mode, tax_type, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                       VALUES (?1, ?2, 1, 118, '2025-03-10', 'ACTIVE', 1,
                               'EXCLUSIVE', 'CGST_SGST', 100, 9, 9, 0, 18)"#,
                )
                .expect("prepare purchase insert");
            let mut insert_purchase_item = transaction
                .prepare(
                    r#"INSERT INTO purchase_items
                       (purchase_id, batch_id, quantity, rate, total, gst_rate_basis_points,
                        taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                       VALUES (?1, ?2, 1, 100, 100, 1800, 100, 9, 9, 0, 18)"#,
                )
                .expect("prepare purchase item insert");
            let mut insert_supplier_ledger = transaction
                .prepare(
                    r#"INSERT INTO supplier_ledger
                       (supplier_id, entry_type, purchase_id, reference, debit_cents, credit_cents, created_at)
                       VALUES (1, 'PURCHASE', ?1, ?2, 11800, 0, '2025-03-10 12:00:00')"#,
                )
                .expect("prepare supplier ledger insert");
            let mut insert_supplier_payment = transaction
                .prepare(
                    r#"INSERT INTO supplier_ledger
                       (supplier_id, entry_type, reference, debit_cents, credit_cents,
                        payment_method, created_at)
                       VALUES (1, 'PAYMENT', ?1, 0, 2000, 'UPI', '2025-03-10 12:00:00')"#,
                )
                .expect("prepare supplier payment insert");

            for purchase_id in 1..=DOCUMENTS {
                let invoice_no = format!("LOAD-PUR-{purchase_id:05}");
                insert_purchase
                    .execute(params![purchase_id, invoice_no])
                    .expect("insert load-test purchase");
                insert_purchase_item
                    .execute(params![purchase_id, purchase_id])
                    .expect("insert load-test purchase item");
                insert_supplier_ledger
                    .execute(params![purchase_id, invoice_no])
                    .expect("insert load-test supplier ledger entry");
                if purchase_id % 3 == 0 {
                    insert_supplier_payment
                        .execute([format!("LOAD-PAY-{purchase_id:05}")])
                        .expect("insert load-test supplier payment");
                }
            }
        }
        {
            let mut insert_sale = transaction
                .prepare(
                    r#"INSERT INTO sales
                       (id, invoice_no, customer_name, customer_phone, subtotal, discount, grand_total,
                        payment_mode, created_at, total_gst, customer_id, gst_enabled, gst_pricing_mode,
                        tax_type, taxable_amount, cgst_amount, sgst_amount, igst_amount, status)
                       VALUES (?1, ?2, 'Load Test Customer', '9000000000', 100, 0, 118,
                               ?3, '2025-03-10 12:00:00', 18, ?4, 1, 'EXCLUSIVE',
                               'CGST_SGST', 100, 9, 9, 0, 'ACTIVE')"#,
                )
                .expect("prepare sale insert");
            let mut insert_sale_item = transaction
                .prepare(
                    r#"INSERT INTO sale_items
                       (sale_id, batch_id, quantity, unit_price, total_price, purchase_rate_at_sale,
                        gst_rate_basis_points, taxable_amount, cgst_amount, sgst_amount, igst_amount, total_gst)
                       VALUES (?1, ?2, 1, 118, 118, 30, 1800, 100, 9, 9, 0, 18)"#,
                )
                .expect("prepare sale item insert");
            let mut insert_customer_ledger = transaction
                .prepare(
                    r#"INSERT INTO customer_ledger
                       (customer_id, entry_type, invoice_no, debit_cents, credit_cents, created_at)
                       VALUES (1, 'CREDIT_SALE', ?1, 11800, 0, '2025-03-10 12:00:00')"#,
                )
                .expect("prepare customer ledger insert");

            for sale_id in 1..=DOCUMENTS {
                let invoice_no = format!("LOAD-SALE-{sale_id:05}");
                let payment_mode = match sale_id % 3 {
                    0 => "CREDIT",
                    1 => "CASH",
                    _ => "UPI",
                };
                let customer_id = (payment_mode == "CREDIT").then_some(1_i64);
                insert_sale
                    .execute(params![sale_id, invoice_no, payment_mode, customer_id])
                    .expect("insert load-test sale");
                insert_sale_item
                    .execute(params![sale_id, sale_id])
                    .expect("insert load-test sale item");
                if payment_mode == "CREDIT" {
                    insert_customer_ledger
                        .execute([invoice_no])
                        .expect("insert load-test customer ledger entry");
                }
            }
        }
        transaction.commit().expect("commit load-test fixture");

        let report_range = range("2025-03-10", "2025-03-10");
        let started = std::time::Instant::now();
        let sales = query_sales_summary(&connection, &report_range).expect("large sales history");
        assert_eq!(sales.invoice_count, DOCUMENTS);
        assert_eq!(sales.total_rows, DOCUMENTS);
        assert_money(sales.net_sales, 236_000.0);
        assert_money(sales.taxable_sales, 200_000.0);

        let purchases =
            query_purchase_summary(&connection, &report_range, None).expect("large purchase history");
        assert_eq!(purchases.total_rows, DOCUMENTS + DOCUMENTS / 3);
        assert_money(purchases.net_purchases, 236_000.0);
        assert_money(purchases.taxable_purchases, 200_000.0);

        let profit = query_profit_and_loss(&connection, &report_range).expect("large P&L report");
        assert_eq!(profit.cogs, Some(60_000.0));
        assert_eq!(profit.gross_profit, Some(140_000.0));
        assert_eq!(profit.net_profit, Some(140_000.0));

        let products = query_product_sales(
            &connection,
            &report_range,
            None,
            None,
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("large product sales report");
        assert_eq!(products.total_rows, MEDICINES);
        assert!(!products.rows.is_empty());
        let companies = query_company_sales(
            &connection,
            &report_range,
            None,
            None,
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("large company sales report");
        assert_eq!(companies.total_rows, 1);

        let customers = query_customer_due(
            &connection,
            &report_range,
            None,
            true,
            None,
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("large customer due report");
        assert_eq!(customers.total_rows, 1);
        assert_money(customers.rows[0].outstanding_balance, 78_588.0);
        let suppliers = query_supplier_due(
            &connection,
            &report_range,
            None,
            true,
            None,
            1,
            REPORT_DEFAULT_PAGE_SIZE,
        )
        .expect("large supplier due report");
        assert_eq!(suppliers.total_rows, 1);
        assert_money(suppliers.rows[0].outstanding_balance, 222_680.0);

        let gst = query_gst_report(&connection, &report_range).expect("large GST report");
        assert_money(gst.total_output_gst, 36_000.0);
        assert_money(gst.total_input_gst, 36_000.0);
        assert_eq!(gst.sales_rows.len(), DOCUMENTS as usize);
        assert_eq!(gst.purchase_rows.len(), DOCUMENTS as usize);

        let stock = query_stock_valuation(&connection, 30).expect("large stock valuation");
        assert_eq!(stock.total_stock_quantity, DOCUMENTS * 5);
        assert_money(stock.total_stock_cost_value, 1_000_000.0);
        assert_money(stock.sellable_cost_value, 1_000_000.0);

        let summary =
            query_financial_summary(&connection, &report_range).expect("large financial summary");
        assert_money(summary.net_sales, 200_000.0);
        assert_money(summary.customer_outstanding, 78_588.0);
        assert_money(summary.supplier_outstanding, 222_680.0);
        assert_money(summary.stock_valuation, 1_000_000.0);
        assert_eq!(summary.stock_quantity, DOCUMENTS * 5);
        eprintln!(
            "Queried 2,000 sales, 2,000 purchases, 2,000 batches and related ledgers in {:?}",
            started.elapsed()
        );
    }
}
