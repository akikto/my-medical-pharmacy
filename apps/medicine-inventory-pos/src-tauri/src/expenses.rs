use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::open_pharmacy_connection;

const MAX_PAGE_SIZE: i64 = 200;
const MAX_AMOUNT_CENTS: i64 = 9_000_000_000_000_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseListRequest {
    start_date: Option<String>,
    end_date: Option<String>,
    category_id: Option<i64>,
    payment_method: Option<String>,
    status: Option<String>,
    search: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseCategoryInput {
    id: Option<i64>,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseInput {
    id: Option<i64>,
    expense_date: String,
    category_id: i64,
    description: String,
    amount_cents: i64,
    payment_method: String,
    reference_number: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseCategory {
    id: i64,
    name: String,
    active: bool,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseRecord {
    id: i64,
    expense_date: String,
    category_id: i64,
    category_name: String,
    description: String,
    amount: f64,
    payment_method: String,
    reference_number: Option<String>,
    status: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpenseListResult {
    rows: Vec<ExpenseRecord>,
    total_rows: i64,
    page: i64,
    page_size: i64,
    active_total: f64,
    cancelled_total: f64,
}

#[derive(Debug)]
struct ExpenseFilters {
    start_date: Option<String>,
    end_date: Option<String>,
    category_id: Option<i64>,
    payment_method: Option<String>,
    status: Option<String>,
    search: Option<String>,
}

const FILTERS_SQL: &str = r#"
    (?1 IS NULL OR e.expense_date >= ?1)
    AND (?2 IS NULL OR e.expense_date <= ?2)
    AND (?3 IS NULL OR e.category_id = ?3)
    AND (?4 IS NULL OR e.payment_method = ?4)
    AND (?5 IS NULL OR instr(lower(c.name), lower(?5)) > 0
         OR instr(lower(e.description), lower(?5)) > 0
         OR instr(lower(COALESCE(e.reference_number, '')), lower(?5)) > 0)
"#;

fn normalized_text(value: &str, max_length: usize, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label} cannot be empty."));
    }
    if value.chars().count() > max_length {
        return Err(format!("{label} cannot exceed {max_length} characters."));
    }
    Ok(value.to_owned())
}

fn valid_iso_date(connection: &Connection, value: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT date(?1) IS NOT NULL AND date(?1) = ?1",
            [value],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not validate the expense date: {error}"))
}

fn normalize_method(value: &str) -> Result<String, String> {
    let method = value.trim().to_ascii_uppercase();
    match method.as_str() {
        "CASH" | "BANK" | "UPI" | "OTHER" => Ok(method),
        _ => Err("Choose Cash, Bank, UPI, or Other as the payment method.".to_owned()),
    }
}

fn normalize_filters(
    connection: &Connection,
    request: &ExpenseListRequest,
) -> Result<ExpenseFilters, String> {
    match (&request.start_date, &request.end_date) {
        (Some(start), Some(end)) => {
            if !valid_iso_date(connection, start)?
                || !valid_iso_date(connection, end)?
                || start > end
            {
                return Err(
                    "Choose a valid date range with a start date on or before the end date."
                        .to_owned(),
                );
            }
        }
        (None, None) => {}
        _ => return Err("Choose both the start and end dates for an expense range.".to_owned()),
    }
    if request.category_id.is_some_and(|id| id <= 0) {
        return Err("Choose a valid expense category.".to_owned());
    }
    let payment_method = request
        .payment_method
        .as_deref()
        .filter(|value| !value.trim().is_empty() && !value.eq_ignore_ascii_case("all"))
        .map(normalize_method)
        .transpose()?;
    let status = request
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"))
        .map(|value| value.to_ascii_uppercase());
    if status
        .as_deref()
        .is_some_and(|value| value != "ACTIVE" && value != "CANCELLED")
    {
        return Err("Choose Active or Cancelled as the expense status filter.".to_owned());
    }
    let search = request
        .search
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.chars().count() > 120 {
                Err("Expense search cannot exceed 120 characters.".to_owned())
            } else {
                Ok(value.to_owned())
            }
        })
        .transpose()?;
    Ok(ExpenseFilters {
        start_date: request.start_date.clone(),
        end_date: request.end_date.clone(),
        category_id: request.category_id,
        payment_method,
        status,
        search,
    })
}

fn category_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExpenseCategory> {
    Ok(ExpenseCategory {
        id: row.get(0)?,
        name: row.get(1)?,
        active: row.get::<_, i64>(2)? != 0,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn expense_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExpenseRecord> {
    let amount_cents: i64 = row.get(6)?;
    Ok(ExpenseRecord {
        id: row.get(0)?,
        expense_date: row.get(1)?,
        category_id: row.get(2)?,
        category_name: row.get(3)?,
        description: row.get(4)?,
        amount: amount_cents as f64 / 100.0,
        payment_method: row.get(5)?,
        reference_number: row.get(7)?,
        status: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn get_expense_from_connection(
    connection: &Connection,
    expense_id: i64,
) -> Result<ExpenseRecord, String> {
    connection
        .query_row(
            r#"SELECT e.id, e.expense_date, e.category_id, c.name, e.description,
                      e.payment_method, e.amount_cents, e.reference_number, e.status,
                      e.created_at, e.updated_at
               FROM expenses AS e
               JOIN expense_categories AS c ON c.id = e.category_id
               WHERE e.id = ?1"#,
            [expense_id],
            expense_from_row,
        )
        .map_err(|error| format!("Could not read the saved expense: {error}"))
}

fn get_expense_categories_from_connection(
    connection: &Connection,
    include_inactive: bool,
) -> Result<Vec<ExpenseCategory>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, active, created_at, updated_at
             FROM expense_categories
             WHERE (?1 OR active = 1)
             ORDER BY active DESC, name COLLATE NOCASE, id",
        )
        .map_err(|error| format!("Could not prepare expense categories: {error}"))?;
    let rows = statement
        .query_map([include_inactive], category_from_row)
        .map_err(|error| format!("Could not read expense categories: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read expense categories: {error}"))
}

#[tauri::command]
pub(crate) fn get_expense_categories(
    app: AppHandle,
    include_inactive: bool,
) -> Result<Vec<ExpenseCategory>, String> {
    let connection = open_pharmacy_connection(&app)?;
    get_expense_categories_from_connection(&connection, include_inactive)
}

fn get_expenses_from_connection(
    connection: &Connection,
    request: ExpenseListRequest,
) -> Result<ExpenseListResult, String> {
    let filters = normalize_filters(connection, &request)?;
    let page = request.page.unwrap_or(1).max(1);
    let page_size = request.page_size.unwrap_or(50).clamp(1, MAX_PAGE_SIZE);
    let offset = page.saturating_sub(1).saturating_mul(page_size);
    let base_params = params![
        filters.start_date.as_deref(),
        filters.end_date.as_deref(),
        filters.category_id,
        filters.payment_method.as_deref(),
        filters.search.as_deref()
    ];
    let total_rows: i64 = connection
        .query_row(
            &format!(
                "SELECT COUNT(*) FROM expenses AS e
                 JOIN expense_categories AS c ON c.id = e.category_id
                 WHERE {FILTERS_SQL}
                   AND (?6 IS NULL OR e.status = ?6)"
            ),
            params![
                filters.start_date.as_deref(),
                filters.end_date.as_deref(),
                filters.category_id,
                filters.payment_method.as_deref(),
                filters.search.as_deref(),
                filters.status.as_deref()
            ],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not count expense records: {error}"))?;
    let (active_cents, cancelled_cents): (i64, i64) = connection
        .query_row(
            &format!(
                "SELECT COALESCE(SUM(CASE WHEN e.status = 'ACTIVE' THEN e.amount_cents ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN e.status = 'CANCELLED' THEN e.amount_cents ELSE 0 END), 0)
                 FROM expenses AS e
                 JOIN expense_categories AS c ON c.id = e.category_id
                 WHERE {FILTERS_SQL}"
            ),
            base_params,
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| format!("Could not total expense records: {error}"))?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT e.id, e.expense_date, e.category_id, c.name, e.description,
                    e.payment_method, e.amount_cents, e.reference_number, e.status,
                    e.created_at, e.updated_at
             FROM expenses AS e
             JOIN expense_categories AS c ON c.id = e.category_id
             WHERE {FILTERS_SQL}
               AND (?6 IS NULL OR e.status = ?6)
             ORDER BY e.expense_date DESC, e.id DESC
             LIMIT ?7 OFFSET ?8"
        ))
        .map_err(|error| format!("Could not prepare expense records: {error}"))?;
    let rows = statement
        .query_map(
            params![
                filters.start_date.as_deref(),
                filters.end_date.as_deref(),
                filters.category_id,
                filters.payment_method.as_deref(),
                filters.search.as_deref(),
                filters.status.as_deref(),
                page_size,
                offset
            ],
            expense_from_row,
        )
        .map_err(|error| format!("Could not read expense records: {error}"))?;
    let rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not read expense records: {error}"))?;
    Ok(ExpenseListResult {
        rows,
        total_rows,
        page,
        page_size,
        active_total: active_cents as f64 / 100.0,
        cancelled_total: cancelled_cents as f64 / 100.0,
    })
}

#[tauri::command]
pub(crate) fn get_expenses(
    app: AppHandle,
    request: ExpenseListRequest,
) -> Result<ExpenseListResult, String> {
    let connection = open_pharmacy_connection(&app)?;
    get_expenses_from_connection(&connection, request)
}

fn save_expense_category_on_connection(
    connection: &mut Connection,
    input: ExpenseCategoryInput,
) -> Result<ExpenseCategory, String> {
    let name = normalized_text(&input.name, 60, "Category name")?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the category update: {error}"))?;
    if let Some(id) = input.id {
        if id <= 0 {
            return Err("Choose a valid expense category.".to_owned());
        }
        let updated = transaction
            .execute(
                "UPDATE expense_categories
                 SET name = ?1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?2",
                params![name, id],
            )
            .map_err(|error| {
                if error.to_string().contains("UNIQUE constraint failed") {
                    "An expense category with that name already exists.".to_owned()
                } else {
                    format!("Could not update the expense category: {error}")
                }
            })?;
        if updated != 1 {
            return Err("The selected expense category no longer exists.".to_owned());
        }
        let category = transaction
            .query_row(
                "SELECT id, name, active, created_at, updated_at
                 FROM expense_categories WHERE id = ?1",
                [id],
                category_from_row,
            )
            .map_err(|error| format!("Could not read the updated category: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not save the expense category: {error}"))?;
        Ok(category)
    } else {
        transaction
            .execute("INSERT INTO expense_categories (name) VALUES (?1)", [&name])
            .map_err(|error| {
                if error.to_string().contains("UNIQUE constraint failed") {
                    "An expense category with that name already exists.".to_owned()
                } else {
                    format!("Could not create the expense category: {error}")
                }
            })?;
        let id = transaction.last_insert_rowid();
        let category = transaction
            .query_row(
                "SELECT id, name, active, created_at, updated_at
                 FROM expense_categories WHERE id = ?1",
                [id],
                category_from_row,
            )
            .map_err(|error| format!("Could not read the new category: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Could not save the expense category: {error}"))?;
        Ok(category)
    }
}

#[tauri::command]
pub(crate) fn save_expense_category(
    app: AppHandle,
    category: ExpenseCategoryInput,
) -> Result<ExpenseCategory, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    save_expense_category_on_connection(&mut connection, category)
}

fn set_expense_category_active_on_connection(
    connection: &mut Connection,
    category_id: i64,
    active: bool,
) -> Result<ExpenseCategory, String> {
    if category_id <= 0 {
        return Err("Choose a valid expense category.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the category update: {error}"))?;
    let updated = transaction
        .execute(
            "UPDATE expense_categories
             SET active = ?1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?2",
            params![active, category_id],
        )
        .map_err(|error| format!("Could not update the expense category: {error}"))?;
    if updated != 1 {
        return Err("The selected expense category no longer exists.".to_owned());
    }
    let category = transaction
        .query_row(
            "SELECT id, name, active, created_at, updated_at
             FROM expense_categories WHERE id = ?1",
            [category_id],
            category_from_row,
        )
        .map_err(|error| format!("Could not read the updated category: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("Could not save the category status: {error}"))?;
    Ok(category)
}

#[tauri::command]
pub(crate) fn set_expense_category_active(
    app: AppHandle,
    category_id: i64,
    active: bool,
) -> Result<ExpenseCategory, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    set_expense_category_active_on_connection(&mut connection, category_id, active)
}

fn save_expense_on_connection(
    connection: &mut Connection,
    input: ExpenseInput,
) -> Result<ExpenseRecord, String> {
    if !valid_iso_date(connection, &input.expense_date)? {
        return Err("Choose a valid expense date.".to_owned());
    }
    if input.category_id <= 0 {
        return Err("Choose an expense category.".to_owned());
    }
    if input.amount_cents <= 0 || input.amount_cents > MAX_AMOUNT_CENTS {
        return Err("Enter an expense amount greater than zero.".to_owned());
    }
    let payment_method = normalize_method(&input.payment_method)?;
    if input.description.chars().count() > 500 {
        return Err("Expense description cannot exceed 500 characters.".to_owned());
    }
    let description = input.description.trim().to_owned();
    let reference_number = input
        .reference_number
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if reference_number
        .as_ref()
        .is_some_and(|value| value.chars().count() > 100)
    {
        return Err("Reference number cannot exceed 100 characters.".to_owned());
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin the expense update: {error}"))?;
    let category_active: Option<bool> = transaction
        .query_row(
            "SELECT active = 1 FROM expense_categories WHERE id = ?1",
            [input.category_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not validate the expense category: {error}"))?;
    let category_active =
        category_active.ok_or_else(|| "Choose an existing expense category.".to_owned())?;

    let expense_id = if let Some(id) = input.id {
        if id <= 0 {
            return Err("Choose a valid expense to edit.".to_owned());
        }
        let existing: Option<(i64, String)> = transaction
            .query_row(
                "SELECT category_id, status FROM expenses WHERE id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("Could not read the expense to edit: {error}"))?;
        let (existing_category_id, existing_status) =
            existing.ok_or_else(|| "The selected expense no longer exists.".to_owned())?;
        if existing_status != "ACTIVE" {
            return Err("Cancelled expenses cannot be edited.".to_owned());
        }
        if !category_active && existing_category_id != input.category_id {
            return Err("Choose an active expense category.".to_owned());
        }
        let updated = transaction
            .execute(
                r#"UPDATE expenses
                   SET expense_date = ?1, category_id = ?2, description = ?3,
                       amount_cents = ?4, payment_method = ?5, reference_number = ?6,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?7 AND status = 'ACTIVE'"#,
                params![
                    input.expense_date,
                    input.category_id,
                    description,
                    input.amount_cents,
                    payment_method,
                    reference_number,
                    id
                ],
            )
            .map_err(|error| format!("Could not update the expense: {error}"))?;
        if updated != 1 {
            return Err("The expense could not be updated.".to_owned());
        }
        id
    } else {
        if !category_active {
            return Err("Choose an active expense category.".to_owned());
        }
        transaction
            .execute(
                r#"INSERT INTO expenses
                   (expense_date, category_id, description, amount_cents,
                    payment_method, reference_number)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
                params![
                    input.expense_date,
                    input.category_id,
                    description,
                    input.amount_cents,
                    payment_method,
                    reference_number
                ],
            )
            .map_err(|error| format!("Could not create the expense: {error}"))?;
        transaction.last_insert_rowid()
    };
    let record = get_expense_from_connection(&transaction, expense_id)?;
    transaction
        .commit()
        .map_err(|error| format!("Could not save the expense: {error}"))?;
    Ok(record)
}

#[tauri::command]
pub(crate) fn save_expense(app: AppHandle, expense: ExpenseInput) -> Result<ExpenseRecord, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    save_expense_on_connection(&mut connection, expense)
}

fn cancel_expense_on_connection(
    connection: &mut Connection,
    expense_id: i64,
) -> Result<ExpenseRecord, String> {
    if expense_id <= 0 {
        return Err("Choose a valid expense to cancel.".to_owned());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("Could not begin expense cancellation: {error}"))?;
    let updated = transaction
        .execute(
            "UPDATE expenses SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?1 AND status = 'ACTIVE'",
            [expense_id],
        )
        .map_err(|error| format!("Could not cancel the expense: {error}"))?;
    if updated != 1 {
        return Err("The expense is already cancelled or no longer exists.".to_owned());
    }
    let record = get_expense_from_connection(&transaction, expense_id)?;
    transaction
        .commit()
        .map_err(|error| format!("Could not save expense cancellation: {error}"))?;
    Ok(record)
}

#[tauri::command]
pub(crate) fn cancel_expense(app: AppHandle, expense_id: i64) -> Result<ExpenseRecord, String> {
    let mut connection = open_pharmacy_connection(&app)?;
    cancel_expense_on_connection(&mut connection, expense_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open test database");
        super::super::migrate_connection(&mut connection).expect("migrate test database");
        connection
    }

    fn expense_input(
        id: Option<i64>,
        expense_date: &str,
        category_id: i64,
        amount_cents: i64,
        payment_method: &str,
    ) -> ExpenseInput {
        ExpenseInput {
            id,
            expense_date: expense_date.to_owned(),
            category_id,
            description: "Monthly bill".to_owned(),
            amount_cents,
            payment_method: payment_method.to_owned(),
            reference_number: Some("INV-42".to_owned()),
        }
    }

    #[test]
    fn expense_create_edit_cancel_and_filter_totals_are_consistent() {
        let mut connection = migrated_connection();
        let categories =
            get_expense_categories_from_connection(&connection, false).expect("seed categories");
        let rent_id = categories
            .iter()
            .find(|category| category.name == "Rent")
            .expect("rent category")
            .id;
        let electricity_id = categories
            .iter()
            .find(|category| category.name == "Electricity")
            .expect("electricity category")
            .id;

        let rent = save_expense_on_connection(
            &mut connection,
            expense_input(None, "2026-09-01", rent_id, 25_000, "cash"),
        )
        .expect("create rent expense");
        assert_eq!(rent.amount, 250.0);
        assert_eq!(rent.status, "ACTIVE");

        let edited = save_expense_on_connection(
            &mut connection,
            expense_input(Some(rent.id), "2026-09-02", rent_id, 31_500, "BANK"),
        )
        .expect("edit rent expense");
        assert_eq!(edited.amount, 315.0);
        assert_eq!(edited.expense_date, "2026-09-02");

        let electricity = save_expense_on_connection(
            &mut connection,
            expense_input(None, "2026-10-01", electricity_id, 8_000, "UPI"),
        )
        .expect("create electricity expense");
        cancel_expense_on_connection(&mut connection, electricity.id).expect("cancel expense");

        let rent_filter = ExpenseListRequest {
            start_date: Some("2026-09-01".to_owned()),
            end_date: Some("2026-09-30".to_owned()),
            category_id: Some(rent_id),
            payment_method: Some("BANK".to_owned()),
            status: None,
            search: Some("monthly".to_owned()),
            page: Some(1),
            page_size: Some(20),
        };
        let filtered =
            get_expenses_from_connection(&connection, rent_filter).expect("filter expenses");
        assert_eq!(filtered.total_rows, 1);
        assert_eq!(filtered.active_total, 315.0);
        assert_eq!(filtered.cancelled_total, 0.0);
        assert_eq!(filtered.rows[0].id, rent.id);

        let all = get_expenses_from_connection(
            &connection,
            ExpenseListRequest {
                start_date: None,
                end_date: None,
                category_id: None,
                payment_method: Some("UPI".to_owned()),
                status: None,
                search: None,
                page: Some(1),
                page_size: Some(20),
            },
        )
        .expect("filter by payment method");
        assert_eq!(all.total_rows, 1);
        assert_eq!(all.active_total, 0.0);
        assert_eq!(all.cancelled_total, 80.0);
        assert_eq!(all.rows[0].status, "CANCELLED");
    }

    #[test]
    fn categories_are_renamable_but_deactivation_never_deletes_history() {
        let mut connection = migrated_connection();
        let rent = get_expense_categories_from_connection(&connection, false)
            .expect("read seeded categories")
            .into_iter()
            .find(|category| category.name == "Rent")
            .expect("rent category");
        let renamed = save_expense_category_on_connection(
            &mut connection,
            ExpenseCategoryInput {
                id: Some(rent.id),
                name: "Premises".to_owned(),
            },
        )
        .expect("rename category");
        assert_eq!(renamed.name, "Premises");
        let inactive = set_expense_category_active_on_connection(&mut connection, rent.id, false)
            .expect("deactivate category");
        assert!(!inactive.active);
        assert_eq!(
            get_expense_categories_from_connection(&connection, false)
                .expect("list active categories")
                .iter()
                .filter(|category| category.id == rent.id)
                .count(),
            0
        );
        assert_eq!(
            get_expense_categories_from_connection(&connection, true)
                .expect("list all categories")
                .iter()
                .filter(|category| category.id == rent.id)
                .count(),
            1
        );
    }
}
