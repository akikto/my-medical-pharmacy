import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarDays,
  Check,
  Clock3,
  Pencil,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Tag,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelExpense,
  getExpenseCategories,
  getExpenses,
  saveExpense,
  saveExpenseCategory,
  setExpenseCategoryActive,
} from "../../services/expensesService";
import type {
  ExpenseCategory,
  ExpenseCategoryInput,
  ExpenseInput,
  ExpenseListResult,
  ExpensePaymentMethod,
  ExpenseRecord,
} from "../../types/expenses";
import { formatDate, formatDateTime, formatMoney, fromCents, toCents } from "../../utils/money";
import "./expenses.css";

const PAGE_SIZE = 12;

type ExpenseDraft = {
  expenseDate: string;
  categoryId: string;
  description: string;
  amount: string;
  paymentMethod: ExpensePaymentMethod;
  referenceNumber: string;
};

const EMPTY_DRAFT = (): ExpenseDraft => ({
  expenseDate: localToday(),
  categoryId: "",
  description: "",
  amount: "",
  paymentMethod: "CASH",
  referenceNumber: "",
});

function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function paymentLabel(method: ExpensePaymentMethod): string {
  return method === "UPI" ? "UPI" : method.charAt(0) + method.slice(1).toLowerCase();
}

function toDraft(expense: ExpenseRecord): ExpenseDraft {
  return {
    expenseDate: expense.expenseDate.slice(0, 10),
    categoryId: String(expense.categoryId),
    description: expense.description,
    amount: String(fromCents(toCents(expense.amount))),
    paymentMethod: expense.paymentMethod,
    referenceNumber: expense.referenceNumber ?? "",
  };
}

function updateCategoryDraft(
  categoryId: number | null,
  name: string,
): ExpenseCategoryInput {
  return categoryId == null ? { name: name.trim() } : { id: categoryId, name: name.trim() };
}

export function ExpensesPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [result, setResult] = useState<ExpenseListResult | null>(null);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [refreshCategoriesKey, setRefreshCategoriesKey] = useState(0);
  const [refreshLedgerKey, setRefreshLedgerKey] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<ExpensePaymentMethod | "ALL">("ALL");
  const [page, setPage] = useState(1);
  const [expenseDialog, setExpenseDialog] = useState<"new" | ExpenseRecord | null>(null);
  const [expenseDraft, setExpenseDraft] = useState<ExpenseDraft>(EMPTY_DRAFT);
  const [expenseError, setExpenseError] = useState<string | null>(null);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [categoryDraftId, setCategoryDraftId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [categoryBusyId, setCategoryBusyId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const expenseDialogRef = useRef<HTMLDivElement>(null);
  const categoryDialogRef = useRef<HTMLDivElement>(null);
  const expenseDateRef = useRef<HTMLInputElement>(null);
  const categoryNameRef = useRef<HTMLInputElement>(null);
  const savingExpenseRef = useRef(isSavingExpense);
  const savingCategoryRef = useRef(isSavingCategory);
  savingExpenseRef.current = isSavingExpense;
  savingCategoryRef.current = isSavingCategory;

  const activeCategories = useMemo(() => categories.filter((category) => category.active), [categories]);
  const currentExpense = typeof expenseDialog === "object" ? expenseDialog : null;
  const isExpenseDialogOpen = expenseDialog !== null;
  const pageCount = Math.max(1, Math.ceil((result?.totalRows ?? 0) / PAGE_SIZE));
  const firstVisibleRow = result && result.totalRows > 0 ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastVisibleRow = result ? Math.min(page * PAGE_SIZE, result.totalRows) : 0;
  const amountPreview = Number(expenseDraft.amount);
  const normalizedPreview = Number.isFinite(amountPreview) ? fromCents(toCents(amountPreview)) : 0;
  const isEditing = currentExpense !== null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    setCategoriesError(null);
    void getExpenseCategories(true)
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setCategoriesError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshCategoriesKey]);

  useEffect(() => {
    let cancelled = false;
    setLedgerLoading(true);
    setLedgerError(null);
    const validDateRange = Boolean(startDate && endDate && startDate <= endDate);
    void getExpenses({
      ...(validDateRange ? { startDate, endDate } : {}),
      categoryId: categoryFilter ? Number(categoryFilter) : null,
      paymentMethod: paymentFilter,
      status: "ALL",
      search,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((ledger) => {
        if (!cancelled) {
          setResult(ledger);
          if (ledger.page !== page) setPage(ledger.page);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLedgerError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryFilter, endDate, page, paymentFilter, refreshLedgerKey, search, startDate]);

  useEffect(() => {
    if (!isExpenseDialogOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => expenseDateRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!savingExpenseRef.current) {
          setExpenseDialog(null);
          setExpenseError(null);
        }
      }
      if (event.key === "Tab" && expenseDialogRef.current) {
        const focusable = Array.from(expenseDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [isExpenseDialogOpen]);

  useEffect(() => {
    if (!categoryDialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => categoryNameRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!savingCategoryRef.current) {
          setCategoryDialog(false);
          setCategoryDraftId(null);
          setCategoryName("");
          setCategoryError(null);
        }
      }
      if (event.key === "Tab" && categoryDialogRef.current) {
        const focusable = Array.from(categoryDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [categoryDialog]);

  function refreshAfterMutation() {
    setRefreshCategoriesKey((current) => current + 1);
    setRefreshLedgerKey((current) => current + 1);
  }

  function openNewExpense() {
    setExpenseDraft(EMPTY_DRAFT());
    setExpenseError(null);
    setExpenseDialog("new");
  }

  function openEditExpense(expense: ExpenseRecord) {
    if (expense.status !== "ACTIVE") return;
    setExpenseDraft(toDraft(expense));
    setExpenseError(null);
    setExpenseDialog(expense);
  }

  function closeExpenseDialog() {
    if (isSavingExpense) return;
    setExpenseDialog(null);
    setExpenseError(null);
  }

  function openCategoryDialog() {
    setCategoryDraftId(null);
    setCategoryName("");
    setCategoryError(null);
    setCategoryDialog(true);
  }

  function closeCategoryDialog() {
    if (isSavingCategory) return;
    setCategoryDialog(false);
    setCategoryDraftId(null);
    setCategoryName("");
    setCategoryError(null);
  }

  function clearFilters() {
    setSearchDraft("");
    setSearch("");
    setStartDate("");
    setEndDate("");
    setCategoryFilter("");
    setPaymentFilter("ALL");
    setPage(1);
  }

  async function handleExpenseSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExpenseError(null);
    setNotice(null);
    const amount = Number(expenseDraft.amount);
    const amountCents = toCents(amount);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
      setExpenseError("Enter an amount greater than ₹0.00.");
      return;
    }
    const selectedCategoryId = Number(expenseDraft.categoryId);
    const selectedCategoryAvailable = activeCategories.some((item) => item.id === selectedCategoryId)
      || (isEditing && currentExpense?.categoryId === selectedCategoryId);
    if (!expenseDraft.categoryId || !selectedCategoryAvailable) {
      setExpenseError("Choose an active expense category.");
      return;
    }
    setIsSavingExpense(true);
    const input: ExpenseInput = {
      ...(currentExpense ? { id: currentExpense.id } : {}),
      expenseDate: expenseDraft.expenseDate,
      categoryId: Number(expenseDraft.categoryId),
      description: expenseDraft.description.trim(),
      amountCents,
      paymentMethod: expenseDraft.paymentMethod,
      referenceNumber: expenseDraft.referenceNumber.trim() || null,
    };
    try {
      const saved = await saveExpense(input);
      setExpenseDialog(null);
      setNotice({
        kind: "success",
        text: `${isEditing ? "Expense updated" : "Expense recorded"} · ${saved.categoryName} · ${formatMoney(saved.amount)}.`,
      });
      setPage(1);
      refreshAfterMutation();
    } catch (error) {
      setExpenseError(getErrorMessage(error));
    } finally {
      setIsSavingExpense(false);
    }
  }

  async function handleCategorySave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryError(null);
    setNotice(null);
    const name = categoryName.trim();
    if (!name || name.length > 60) {
      setCategoryError("Enter a category name up to 60 characters long.");
      return;
    }
    setIsSavingCategory(true);
    try {
      const saved = await saveExpenseCategory(updateCategoryDraft(categoryDraftId, name));
      setCategoryDraftId(null);
      setCategoryName("");
      setCategoryError(null);
      setNotice({ kind: "success", text: `${saved.name} ${saved.id === categoryDraftId ? "updated" : "added"}.` });
      refreshAfterMutation();
    } catch (error) {
      setCategoryError(getErrorMessage(error));
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleCategoryActiveChange(category: ExpenseCategory, active: boolean) {
    setCategoryBusyId(category.id);
    setCategoryError(null);
    setNotice(null);
    try {
      const saved = await setExpenseCategoryActive(category.id, active);
      setNotice({ kind: "success", text: `${saved.name} ${active ? "reactivated" : "deactivated"}.` });
      if (categoryDraftId === category.id) {
        setCategoryDraftId(null);
        setCategoryName("");
      }
      refreshAfterMutation();
    } catch (error) {
      setCategoryError(getErrorMessage(error));
    } finally {
      setCategoryBusyId(null);
    }
  }

  async function handleCancelExpense(expense: ExpenseRecord) {
    if (expense.status !== "ACTIVE" || cancellingId !== null) return;
    const confirmed = window.confirm(
      `Cancel this ${formatMoney(expense.amount)} expense for “${expense.description || expense.categoryName}”? It will remain in the ledger and no longer count in active totals.`,
    );
    if (!confirmed) return;
    setCancellingId(expense.id);
    setNotice(null);
    try {
      const saved = await cancelExpense(expense.id);
      setResult((current) => current
        ? {
            ...current,
            rows: current.rows.map((row) => row.id === saved.id ? saved : row),
          }
        : current);
      setNotice({ kind: "success", text: `Expense #${saved.id} cancelled and retained in the ledger.` });
      refreshAfterMutation();
    } catch (error) {
      setNotice({ kind: "error", text: getErrorMessage(error) });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <section className="workspace-page expenses-page" data-testid="page-expenses">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> DAILY OPERATIONS</div>
          <h1>Expenses</h1>
          <p>Record day-to-day costs. Sales, purchases, and supplier balances stay untouched.</p>
        </div>
        <div className="expense-heading-actions">
          <span className="expense-trust-note"><Check aria-hidden="true" size={14} /> Local ledger · audited history</span>
          <button
            className="expense-primary-action"
            data-testid="button-add-expense"
            onClick={openNewExpense}
            type="button"
          >
            <Plus aria-hidden="true" size={15} /> Record expense
          </button>
        </div>
      </header>

      {notice && (
        <div
          className={`expense-notice ${notice.kind === "error" ? "expense-notice--error" : ""}`}
          data-testid="status-expense-notice"
          role={notice.kind === "error" ? "alert" : "status"}
        >
          {notice.kind === "error" ? <AlertCircle aria-hidden="true" size={15} /> : <Check aria-hidden="true" size={15} />}
          <span>{notice.text}</span>
          <button aria-label="Dismiss message" data-testid="button-dismiss-expense-notice" onClick={() => setNotice(null)} type="button">
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      )}

      {(categoriesError || ledgerError) && (
        <div className="expense-notice expense-notice--error" data-testid="status-expense-load-error" role="alert">
          <AlertCircle aria-hidden="true" size={15} />
          <span>{categoriesError ? `Categories: ${categoriesError}` : `Ledger: ${ledgerError}`}</span>
          <button
            className="expense-secondary-action"
            data-testid="button-retry-expenses"
            onClick={() => {
              setRefreshCategoriesKey((current) => current + 1);
              setRefreshLedgerKey((current) => current + 1);
            }}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} /> Retry
          </button>
        </div>
      )}

      <section aria-label="Expense totals" className="expense-overview" data-testid="panel-expense-totals">
        <div className="expense-overview-primary">
          <div className="expense-overview-mark"><Wallet aria-hidden="true" size={21} /></div>
          <div>
            <span className="expense-overview-label">Active expenses</span>
            <strong data-testid="text-expense-active-total">
              {ledgerLoading && !result ? "—" : formatMoney(result?.activeTotal ?? 0)}
            </strong>
            <small>For the current ledger filters</small>
          </div>
        </div>
        <div className="expense-overview-secondary">
          <div>
            <span className="expense-overview-label">Cancelled · excluded</span>
            <strong data-testid="text-expense-cancelled-total">
              {ledgerLoading && !result ? "—" : formatMoney(result?.cancelledTotal ?? 0)}
            </strong>
            <small>Retained for review</small>
          </div>
        </div>
        <div className="expense-overview-aside">
          Totals follow the selected dates, category, payment method, and search.
        </div>
      </section>

      <section aria-labelledby="expense-ledger-title" className="workspace-card expense-ledger-card">
        <div className="expense-ledger-heading">
          <div className="expense-section-symbol"><ReceiptText aria-hidden="true" size={17} /></div>
          <div>
            <h2 id="expense-ledger-title">Expense ledger</h2>
            <p>Every saved entry stays here, including cancelled expenses.</p>
          </div>
          <span className="expense-row-count" data-testid="text-expense-row-count">
            {result?.totalRows ?? 0} record{result?.totalRows === 1 ? "" : "s"}
          </span>
          <button
            className="expense-secondary-action"
            data-testid="button-manage-expense-categories"
            onClick={openCategoryDialog}
            type="button"
          >
            <Tag aria-hidden="true" size={14} /> Categories
          </button>
        </div>

        <div aria-label="Filter expenses" className="expense-filters">
          <label className="expense-search-field">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="Search expenses"
              data-testid="input-expense-search"
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search description or reference"
              type="search"
              value={searchDraft}
            />
          </label>
          <label className="expense-date-field">
            <CalendarDays aria-hidden="true" size={14} />
            <input
              aria-label="Start date"
              data-testid="input-expense-start-date"
              onChange={(event) => {
                setStartDate(event.target.value);
                setPage(1);
              }}
              type="date"
              value={startDate}
            />
          </label>
          <label className="expense-date-field">
            <span aria-hidden="true" className="expense-date-to">to</span>
            <input
              aria-label="End date"
              data-testid="input-expense-end-date"
              onChange={(event) => {
                setEndDate(event.target.value);
                setPage(1);
              }}
              type="date"
              value={endDate}
            />
          </label>
          <select
            aria-label="Filter by category"
            data-testid="select-expense-category-filter"
            onChange={(event) => {
              setCategoryFilter(event.target.value);
              setPage(1);
            }}
            value={categoryFilter}
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}{category.active ? "" : " · inactive"}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by payment method"
            data-testid="select-expense-payment-filter"
            onChange={(event) => {
              setPaymentFilter(event.target.value as ExpensePaymentMethod | "ALL");
              setPage(1);
            }}
            value={paymentFilter}
          >
            <option value="ALL">All methods</option>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank</option>
            <option value="UPI">UPI</option>
            <option value="OTHER">Other</option>
          </select>
          <button className="expense-filter-reset" data-testid="button-reset-expense-filters" onClick={clearFilters} type="button">
            Clear
          </button>
        </div>

        {startDate !== endDate && (!startDate || !endDate) && (
          <div className="expense-filter-hint" data-testid="status-expense-date-range">
            Choose both dates to apply the date range.
          </div>
        )}
        {startDate && endDate && startDate > endDate && (
          <div className="expense-filter-hint expense-filter-hint--error" data-testid="status-expense-date-range-error" role="alert">
            Start date must be on or before end date.
          </div>
        )}

        {ledgerLoading ? (
          <div aria-label="Loading expense ledger" className="expense-ledger-skeleton" data-testid="loading-expense-ledger">
            <i /><i /><i /><i />
          </div>
        ) : ledgerError ? (
          <div className="expense-empty" data-testid="empty-expense-ledger-error">
            <span><AlertCircle aria-hidden="true" size={21} /></span>
            <strong>Ledger could not be loaded</strong>
            <span>Retry to reload expense history from this device.</span>
            <button
              className="expense-secondary-action"
              data-testid="button-retry-expense-ledger"
              onClick={() => setRefreshLedgerKey((current) => current + 1)}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} /> Retry ledger
            </button>
          </div>
        ) : result && result.rows.length > 0 ? (
          <div className="expense-ledger-scroll">
            <table className="workspace-table expense-ledger-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Category</th>
                  <th scope="col">Description / notes</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Status</th>
                  <th className="expense-ledger-amount" scope="col">Amount</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((expense) => (
                  <tr
                    className={expense.status === "CANCELLED" ? "is-cancelled" : ""}
                    data-testid={`row-expense-${expense.id}`}
                    key={expense.id}
                  >
                    <td>{formatDate(expense.expenseDate)}</td>
                    <td>{expense.categoryName}</td>
                    <td className="expense-description-cell">
                      <strong>{expense.description || "—"}</strong>
                      <small data-testid={`text-expense-updated-${expense.id}`}>
                        <Clock3 aria-hidden="true" size={10} /> Created {formatDateTime(expense.createdAt)} · Updated {formatDateTime(expense.updatedAt)}
                      </small>
                    </td>
                    <td><span className="expense-method">{paymentLabel(expense.paymentMethod)}</span></td>
                    <td>{expense.referenceNumber || <span className="workspace-muted">—</span>}</td>
                    <td>
                      <span
                        className={`expense-status-pill ${expense.status === "CANCELLED" ? "is-cancelled" : ""}`}
                        data-testid={`status-expense-${expense.id}`}
                      >
                        {expense.status === "CANCELLED" ? "Cancelled" : "Active"}
                      </span>
                    </td>
                    <td className="expense-ledger-amount"><strong>{formatMoney(expense.amount)}</strong></td>
                    <td>
                      <div className="expense-row-actions">
                        <button
                          aria-label={`Edit expense ${expense.id}`}
                          className="expense-text-action"
                          data-testid={`button-edit-expense-${expense.id}`}
                          disabled={expense.status !== "ACTIVE"}
                          onClick={() => openEditExpense(expense)}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={12} /> Edit
                        </button>
                        <button
                          aria-label={`Cancel expense ${expense.id}`}
                          className="expense-text-action expense-text-action--cancel"
                          data-testid={`button-cancel-expense-${expense.id}`}
                          disabled={expense.status !== "ACTIVE" || cancellingId !== null}
                          onClick={() => void handleCancelExpense(expense)}
                          type="button"
                        >
                          <Ban aria-hidden="true" size={12} /> {cancellingId === expense.id ? "Saving…" : "Cancel"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="expense-empty" data-testid="empty-expense-ledger">
            <span><ReceiptText aria-hidden="true" size={21} /></span>
            <strong>{result?.totalRows === 0 && (search || categoryFilter || paymentFilter !== "ALL" || startDate || endDate)
              ? "No expenses match these filters"
              : "No expenses recorded yet"}</strong>
            <span>
              {result?.totalRows === 0 && (search || categoryFilter || paymentFilter !== "ALL" || startDate || endDate)
                ? "Clear some filters or widen the date range to see more of the ledger."
                : "Record routine operating costs here. Saving an expense does not change sales, stock, or supplier balances."}
            </span>
            {result?.totalRows === 0 && !search && !categoryFilter && paymentFilter === "ALL" && !startDate && !endDate && (
              <button className="expense-primary-action" data-testid="button-record-first-expense" onClick={openNewExpense} type="button">
                <Plus aria-hidden="true" size={14} /> Record first expense
              </button>
            )}
          </div>
        )}

        <footer className="expense-history-footer">
          <span data-testid="text-expense-ledger-range">
            {ledgerLoading ? "Refreshing ledger…" : `${firstVisibleRow}–${lastVisibleRow} of ${result?.totalRows ?? 0} records`}
          </span>
          <div aria-label="Expense ledger pagination" className="expense-pagination">
            <button
              aria-label="Previous page"
              className="expense-page-button"
              data-testid="button-expense-previous-page"
              disabled={page <= 1 || ledgerLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={14} />
            </button>
            <span data-testid="text-expense-page">Page {Math.min(page, pageCount)} of {pageCount}</span>
            <button
              aria-label="Next page"
              className="expense-page-button"
              data-testid="button-expense-next-page"
              disabled={page >= pageCount || ledgerLoading}
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              type="button"
            >
              <ArrowRight aria-hidden="true" size={14} />
            </button>
          </div>
        </footer>
      </section>

      {isExpenseDialogOpen && (
        <div
          className="expense-dialog-backdrop"
          data-testid="dialog-expense-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeExpenseDialog();
          }}
        >
          <section
            aria-labelledby="expense-dialog-title"
            aria-modal="true"
            className="expense-dialog"
            data-testid="dialog-expense"
            ref={expenseDialogRef}
            role="dialog"
          >
            <header className="expense-dialog-header">
              <div className="expense-dialog-icon"><Wallet aria-hidden="true" size={18} /></div>
              <div className="expense-dialog-heading">
                <h2 id="expense-dialog-title">{isEditing ? "Edit expense" : "Record an expense"}</h2>
                <p>Store this operating cost in the local expense ledger.</p>
              </div>
              <button
                aria-label="Close expense form"
                className="expense-dialog-close"
                data-testid="button-close-expense-dialog"
                disabled={isSavingExpense}
                onClick={closeExpenseDialog}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </header>
            <form onSubmit={(event) => void handleExpenseSave(event)}>
              <div className="expense-dialog-body">
                <div className="expense-form-grid">
                  <label className="field-label">
                    Expense date
                    <input
                      className="workspace-input"
                      data-testid="input-expense-date"
                      onChange={(event) => setExpenseDraft((current) => ({ ...current, expenseDate: event.target.value }))}
                      ref={expenseDateRef}
                      required
                      type="date"
                      value={expenseDraft.expenseDate}
                    />
                  </label>
                  <label className="field-label">
                    Category
                    <select
                      className="workspace-input"
                      data-testid="select-expense-category"
                      onChange={(event) => setExpenseDraft((current) => ({ ...current, categoryId: event.target.value }))}
                      required
                      value={expenseDraft.categoryId}
                    >
                      <option value="">Select category</option>
                      {categories.filter((category) => category.active || (isEditing && category.id === currentExpense?.categoryId)).map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}{category.active ? "" : " · inactive"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field-label">
                    Amount
                    <input
                      className="workspace-input"
                      data-testid="input-expense-amount"
                      inputMode="decimal"
                      min="0.01"
                      onChange={(event) => setExpenseDraft((current) => ({ ...current, amount: event.target.value }))}
                      placeholder="0.00"
                      required
                      step="0.01"
                      type="number"
                      value={expenseDraft.amount}
                    />
                  </label>
                  <label className="field-label">
                    Payment method
                    <select
                      className="workspace-input"
                      data-testid="select-expense-payment-method"
                      onChange={(event) => setExpenseDraft((current) => ({
                        ...current,
                        paymentMethod: event.target.value as ExpensePaymentMethod,
                      }))}
                      value={expenseDraft.paymentMethod}
                    >
                      <option value="CASH">Cash</option>
                      <option value="BANK">Bank</option>
                      <option value="UPI">UPI</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label className="field-label expense-field-wide">
                    Description / notes <span className="workspace-muted">Optional · up to 500 characters</span>
                    <textarea
                      className="workspace-input workspace-textarea"
                      data-testid="input-expense-description"
                      maxLength={500}
                      onChange={(event) => setExpenseDraft((current) => ({ ...current, description: event.target.value }))}
                      placeholder="For example, monthly shop electricity"
                      value={expenseDraft.description}
                    />
                  </label>
                  <label className="field-label expense-field-wide">
                    Reference number <span className="workspace-muted">Optional</span>
                    <input
                      className="workspace-input"
                      data-testid="input-expense-reference"
                      maxLength={100}
                      onChange={(event) => setExpenseDraft((current) => ({ ...current, referenceNumber: event.target.value }))}
                      placeholder="Receipt or transaction reference"
                      value={expenseDraft.referenceNumber}
                    />
                  </label>
                </div>
                <div className="expense-amount-preview">
                  <span>Amount to record</span>
                  <strong data-testid="text-expense-amount-preview">{formatMoney(normalizedPreview)}</strong>
                </div>
                {expenseError && <p className="expense-dialog-error" data-testid="status-expense-form-error" role="alert">{expenseError}</p>}
                {activeCategories.length === 0 && !categoriesLoading && (
                  <p className="expense-dialog-error" data-testid="status-no-expense-categories" role="alert">
                    Add and activate a category before recording an expense.
                  </p>
                )}
              </div>
              <footer className="expense-dialog-actions">
                <button
                  className="expense-secondary-action"
                  data-testid="button-cancel-expense-form"
                  disabled={isSavingExpense}
                  onClick={closeExpenseDialog}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="expense-primary-action"
                  data-testid="button-save-expense"
                  disabled={isSavingExpense || categoriesLoading || activeCategories.length === 0}
                  type="submit"
                >
                  <Check aria-hidden="true" size={14} /> {isSavingExpense ? "Saving…" : isEditing ? "Save changes" : "Save expense"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {categoryDialog && (
        <div
          className="expense-dialog-backdrop"
          data-testid="dialog-expense-categories-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCategoryDialog();
          }}
        >
          <section
            aria-labelledby="expense-categories-title"
            aria-modal="true"
            className="expense-dialog expense-dialog--categories"
            data-testid="dialog-expense-categories"
            ref={categoryDialogRef}
            role="dialog"
          >
            <header className="expense-dialog-header">
              <div className="expense-dialog-icon"><Tag aria-hidden="true" size={18} /></div>
              <div className="expense-dialog-heading">
                <h2 id="expense-categories-title">Expense categories</h2>
                <p>Categories organize entries; deactivation preserves prior records.</p>
              </div>
              <button
                aria-label="Close category manager"
                className="expense-dialog-close"
                data-testid="button-close-expense-categories"
                disabled={isSavingCategory}
                onClick={closeCategoryDialog}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </header>
            <div className="expense-dialog-body">
              <form className="expense-category-form" onSubmit={(event) => void handleCategorySave(event)}>
                <label className="field-label">
                  {categoryDraftId === null ? "New category" : "Rename category"}
                  <input
                    className="workspace-input"
                    data-testid="input-expense-category-name"
                    maxLength={60}
                    onChange={(event) => setCategoryName(event.target.value)}
                    placeholder="e.g. Pharmacy utilities"
                    ref={categoryNameRef}
                    required
                    value={categoryName}
                  />
                </label>
                <button
                  className="expense-primary-action"
                  data-testid="button-save-expense-category"
                  disabled={isSavingCategory}
                  type="submit"
                >
                  {categoryDraftId === null ? <Plus aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
                  {isSavingCategory ? "Saving…" : categoryDraftId === null ? "Add category" : "Save name"}
                </button>
              </form>

              {categoryError && <p className="expense-dialog-error" data-testid="status-expense-category-error" role="alert">{categoryError}</p>}
              {categoriesLoading ? (
                <div aria-label="Loading categories" className="expense-ledger-skeleton" data-testid="loading-expense-categories">
                  <i /><i /><i />
                </div>
              ) : categories.length > 0 ? (
                <div aria-label="Expense categories" className="expense-category-list">
                  {categories.map((category) => (
                    <div className="expense-category-row" data-testid={`row-expense-category-${category.id}`} key={category.id}>
                      <div className="expense-category-name">
                        <strong>{category.name}</strong>
                        <span
                          className={`expense-category-state ${category.active ? "" : "is-inactive"}`}
                          data-testid={`status-expense-category-${category.id}`}
                        >
                          {category.active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div className="expense-row-subtle" title={`Updated ${formatDateTime(category.updatedAt)}`}>
                        Updated {formatDateTime(category.updatedAt)}
                      </div>
                      <div className="expense-category-actions">
                        <button
                          data-testid={`button-rename-expense-category-${category.id}`}
                          disabled={isSavingCategory || categoryBusyId !== null}
                          onClick={() => {
                            setCategoryDraftId(category.id);
                            setCategoryName(category.name);
                            setCategoryError(null);
                            window.requestAnimationFrame(() => categoryNameRef.current?.focus());
                          }}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={11} /> Rename
                        </button>
                        <button
                          data-testid={`button-toggle-expense-category-${category.id}`}
                          disabled={categoryBusyId !== null || isSavingCategory}
                          onClick={() => void handleCategoryActiveChange(category, !category.active)}
                          type="button"
                        >
                          {categoryBusyId === category.id
                            ? "Saving…"
                            : category.active
                              ? <><Ban aria-hidden="true" size={11} /> Deactivate</>
                              : <><Check aria-hidden="true" size={11} /> Reactivate</>}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="expense-category-empty" data-testid="empty-expense-categories">
                  No categories yet. Add one to start recording expenses.
                </div>
              )}
            </div>
            <footer className="expense-dialog-actions">
              <button
                className="expense-secondary-action"
                data-testid="button-cancel-category-edit"
                disabled={isSavingCategory}
                onClick={() => {
                  setCategoryDraftId(null);
                  setCategoryName("");
                  setCategoryError(null);
                }}
                type="button"
              >
                {categoryDraftId === null ? "Reset form" : "Discard rename"}
              </button>
              <button
                className="expense-primary-action"
                data-testid="button-finish-expense-categories"
                disabled={isSavingCategory}
                onClick={closeCategoryDialog}
                type="button"
              >
                Done
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}