import { invoke } from "@tauri-apps/api/core";
import type {
  ExpenseCategory,
  ExpenseCategoryInput,
  ExpenseInput,
  ExpenseListRequest,
  ExpenseListResult,
  ExpenseRecord,
} from "../types/expenses";

const MAX_AMOUNT_CENTS = 9_000_000_000_000_000;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateRange(request: ExpenseListRequest): void {
  const { startDate, endDate } = request;
  if (Boolean(startDate) !== Boolean(endDate)) {
    throw new Error("Choose both the start and end dates for an expense range.");
  }
  if (
    startDate &&
    endDate &&
    (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate)
  ) {
    throw new Error("Choose a valid expense date range.");
  }
}

export async function getExpenseCategories(
  includeInactive = false,
): Promise<ExpenseCategory[]> {
  return invoke<ExpenseCategory[]>("get_expense_categories", { includeInactive });
}

export async function getExpenses(
  request: ExpenseListRequest = {},
): Promise<ExpenseListResult> {
  validateRange(request);
  if (request.categoryId != null && (!Number.isInteger(request.categoryId) || request.categoryId <= 0)) {
    throw new Error("Choose a valid expense category.");
  }
  const page = request.page ?? 1;
  const pageSize = request.pageSize ?? 50;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("Choose a valid expense ledger page.");
  }
  return invoke<ExpenseListResult>("get_expenses", {
    request: { ...request, page, pageSize },
  });
}

export async function saveExpenseCategory(
  category: ExpenseCategoryInput,
): Promise<ExpenseCategory> {
  const name = category.name.trim();
  if (!name || name.length > 60) {
    throw new Error("Enter a category name up to 60 characters long.");
  }
  return invoke<ExpenseCategory>("save_expense_category", {
    category: { ...category, name },
  });
}

export async function setExpenseCategoryActive(
  categoryId: number,
  active: boolean,
): Promise<ExpenseCategory> {
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error("Choose a valid expense category.");
  }
  return invoke<ExpenseCategory>("set_expense_category_active", {
    categoryId,
    active,
  });
}

export async function saveExpense(expense: ExpenseInput): Promise<ExpenseRecord> {
  if (!isIsoDate(expense.expenseDate)) {
    throw new Error("Choose a valid expense date.");
  }
  if (!Number.isInteger(expense.amountCents) || expense.amountCents <= 0 || expense.amountCents > MAX_AMOUNT_CENTS) {
    throw new Error("Enter an expense amount greater than zero.");
  }
  if (!Number.isInteger(expense.categoryId) || expense.categoryId <= 0) {
    throw new Error("Choose an expense category.");
  }
  if (!["CASH", "BANK", "UPI", "OTHER"].includes(expense.paymentMethod)) {
    throw new Error("Choose Cash, Bank, UPI, or Other as the payment method.");
  }
  if (expense.description.length > 500 || (expense.referenceNumber?.length ?? 0) > 100) {
    throw new Error("The description or reference is too long.");
  }
  return invoke<ExpenseRecord>("save_expense", { expense });
}

export async function cancelExpense(expenseId: number): Promise<ExpenseRecord> {
  if (!Number.isInteger(expenseId) || expenseId <= 0) {
    throw new Error("Choose a valid expense to cancel.");
  }
  return invoke<ExpenseRecord>("cancel_expense", { expenseId });
}