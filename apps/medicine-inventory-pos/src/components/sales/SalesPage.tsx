import {
  AlertCircle,
  Ban,
  FileText,
  LoaderCircle,
  Pencil,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getCustomers } from "../../services/customerService";
import {
  cancelSale,
  correctSale,
  createSaleReturn,
  getSaleDetails,
  getSalesHistory,
} from "../../services/salesService";
import type {
  Customer,
  SaleCorrectionInput,
  SaleDetails,
  SaleReturnInput,
  SalesHistoryFilters,
  SalesHistoryRecord,
  SaleVoidInput,
} from "../../types";
import { formatDateTime, formatMoney } from "../../utils/money";
import { ReceiptPrint } from "../pos/ReceiptPrint";
import { SaleActionDialog, type SaleActionKind } from "./SaleActionDialog";
import "./sales.css";

const SALES_HISTORY_LIMIT = 500;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sales history could not be loaded.";
}

export function SalesPage() {
  const [sales, setSales] = useState<SalesHistoryRecord[]>([]);
  const [filters, setFilters] = useState<SalesHistoryFilters>({
    search_invoice: "",
    from_date: "",
    to_date: "",
    customer_id: null,
    payment_mode: "",
    status: "",
    limit: SALES_HISTORY_LIMIT,
  });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerFilterError, setCustomerFilterError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [openingInvoice, setOpeningInvoice] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<{
    invoiceNo: string;
    message: string;
  } | null>(null);
  const [receiptSale, setReceiptSale] = useState<SaleDetails | null>(null);
  const [actionSale, setActionSale] = useState<SaleDetails | null>(null);
  const [actionKind, setActionKind] = useState<SaleActionKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSavingAction, setIsSavingAction] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const invalidRange =
      Boolean(filters.from_date && filters.to_date && filters.from_date > filters.to_date);
    setLoadError(null);
    setInvoiceError(null);
    if (invalidRange) {
      setSales([]);
      setIsLoading(false);
      setLoadError("Start date must be on or before the end date.");
      return () => {
        cancelled = true;
      };
    }
    setIsLoading(true);
    const timeout = window.setTimeout(() => {
      getSalesHistory(filters)
        .then((result) => {
          if (!cancelled) setSales(result);
        })
        .catch((error: unknown) => {
          if (!cancelled) setLoadError(getErrorMessage(error));
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
    }, filters.search_invoice.trim() ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [filters, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    getCustomers("", true)
      .then((result) => {
        if (!cancelled) setCustomers(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCustomerFilterError(getErrorMessage(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function openInvoice(invoiceNo: string) {
    setOpeningInvoice(invoiceNo);
    setInvoiceError(null);
    try {
      const details = await getSaleDetails(invoiceNo);
      if (!details) {
        setInvoiceError({
          invoiceNo,
          message: `Invoice ${invoiceNo} could not be found. Refresh the history and try again.`,
        });
        return;
      }
      setReceiptSale(details);
    } catch (error) {
      setInvoiceError({ invoiceNo, message: getErrorMessage(error) });
    } finally {
      setOpeningInvoice(null);
    }
  }

  async function openAction(invoiceNo: string, kind: SaleActionKind) {
    setOpeningInvoice(invoiceNo);
    setInvoiceError(null);
    setActionError(null);
    try {
      const details = await getSaleDetails(invoiceNo);
      if (!details) {
        setInvoiceError({
          invoiceNo,
          message: `Invoice ${invoiceNo} could not be found. Refresh the history and try again.`,
        });
        return;
      }
      setActionKind(kind);
      setActionSale(details);
    } catch (error) {
      setInvoiceError({ invoiceNo, message: getErrorMessage(error) });
    } finally {
      setOpeningInvoice(null);
    }
  }

  async function handleReturn(input: SaleReturnInput) {
    setIsSavingAction(true);
    setActionError(null);
    try {
      const result = await createSaleReturn(input);
      setActionSale(null);
      setActionKind(null);
      setNotice(`Return ${result.returnNo} recorded for ${formatMoney(result.totalCents / 100)}.`);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsSavingAction(false);
    }
  }

  async function handleCancel(input: SaleVoidInput) {
    setIsSavingAction(true);
    setActionError(null);
    try {
      const result = await cancelSale(input);
      setActionSale(null);
      setActionKind(null);
      setNotice(`Invoice cancelled. ${formatMoney(result.refundCents / 100)} recorded as the refund.`);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsSavingAction(false);
    }
  }

  async function handleCorrection(input: SaleCorrectionInput) {
    setIsSavingAction(true);
    setActionError(null);
    try {
      const result = await correctSale(input);
      setActionSale(null);
      setActionKind(null);
      setNotice(`Invoice ${result.invoiceNo} corrected. The audit record was saved.`);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      setActionError(getErrorMessage(error));
    } finally {
      setIsSavingAction(false);
    }
  }

  function updateFilter<Key extends keyof SalesHistoryFilters>(
    key: Key,
    value: SalesHistoryFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const hasActiveFilters = Boolean(
    filters.search_invoice.trim()
      || filters.from_date
      || filters.to_date
      || filters.customer_id !== null
      || filters.payment_mode
      || filters.status,
  );

  return (
    <section className="workspace-page sales-page" data-testid="page-sales">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> SALES HISTORY</div>
          <h1>Sales</h1>
          <p>Review and reprint the latest invoices recorded on this device.</p>
        </div>
        <button
          className="button button-secondary sales-refresh-button"
          data-testid="button-refresh-sales-history"
          disabled={isLoading}
          onClick={() => setRefreshKey((current) => current + 1)}
          type="button"
        >
          {isLoading ? <LoaderCircle className="sales-history-spinner" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </header>

      {notice && (
        <div className="workspace-notice customer-notice customer-notice--success" role="status" data-testid="status-sales-action-success">
          <span>{notice}</span>
          <button
            aria-label="Dismiss sales notification"
            className="notice-close"
            onClick={() => setNotice(null)}
            type="button"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {invoiceError && (
        <div className="workspace-notice workspace-notice--error sales-invoice-error" role="alert" data-testid="status-sales-invoice-error">
          <AlertCircle size={16} />
          <span>{invoiceError.message}</span>
          <button
            className="button button-secondary"
            data-testid="button-retry-sales-invoice"
            disabled={openingInvoice === invoiceError.invoiceNo}
            onClick={() => void openInvoice(invoiceError.invoiceNo)}
            type="button"
          >
            {openingInvoice === invoiceError.invoiceNo ? "Loading…" : "Retry"}
          </button>
          <button
            aria-label="Dismiss invoice error"
            className="notice-close"
            data-testid="button-dismiss-sales-invoice-error"
            onClick={() => setInvoiceError(null)}
            type="button"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section className="workspace-card sales-history-card" aria-labelledby="sales-history-title">
        <div className="sales-history-toolbar">
          <div className="sales-history-heading">
            <span className="sales-history-icon"><FileText size={17} /></span>
            <div>
              <h2 id="sales-history-title">Invoice history</h2>
              <p>
                {sales.length.toLocaleString("en-IN")} matching invoices · limit {SALES_HISTORY_LIMIT}
              </p>
            </div>
          </div>
          <div className="sales-history-search">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Search invoice number"
              data-testid="input-sales-history-search"
              onChange={(event) => updateFilter("search_invoice", event.target.value)}
              placeholder="Invoice number"
              value={filters.search_invoice}
            />
            {filters.search_invoice.length > 0 && (
              <button
                aria-label="Clear sales search"
                className="sales-history-search-clear"
                data-testid="button-clear-sales-search"
                onClick={() => updateFilter("search_invoice", "")}
                title="Clear search"
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="sales-history-filters" aria-label="Sales history filters">
          <label>
            From
            <input
              aria-label="Sales history start date"
              className="workspace-input"
              data-testid="input-sales-history-from-date"
              onChange={(event) => updateFilter("from_date", event.target.value)}
              type="date"
              value={filters.from_date}
            />
          </label>
          <label>
            Through
            <input
              aria-label="Sales history end date"
              className="workspace-input"
              data-testid="input-sales-history-to-date"
              onChange={(event) => updateFilter("to_date", event.target.value)}
              type="date"
              value={filters.to_date}
            />
          </label>
          <label>
            Customer
            <select
              aria-label="Filter by customer"
              className="workspace-input"
              data-testid="select-sales-history-customer"
              onChange={(event) =>
                updateFilter("customer_id", event.target.value ? Number(event.target.value) : null)
              }
              value={filters.customer_id ?? ""}
            >
              <option value="">All customers</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}{customer.active ? "" : " (archived)"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Payment
            <select
              aria-label="Filter by payment method"
              className="workspace-input"
              data-testid="select-sales-history-payment"
              onChange={(event) =>
                updateFilter("payment_mode", event.target.value as SalesHistoryFilters["payment_mode"])
              }
              value={filters.payment_mode}
            >
              <option value="">All methods</option>
              {(["CASH", "CARD", "UPI", "CREDIT", "OTHER"] as const).map((mode) => (
                <option key={mode} value={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              aria-label="Filter by invoice status"
              className="workspace-input"
              data-testid="select-sales-history-status"
              onChange={(event) =>
                updateFilter("status", event.target.value as SalesHistoryFilters["status"])
              }
              value={filters.status}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="PARTIALLY_RETURNED">Partially returned</option>
              <option value="RETURNED">Returned</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </label>
          {(filters.search_invoice || filters.from_date || filters.to_date || filters.customer_id !== null || filters.payment_mode || filters.status) && (
            <button
              className="button button-secondary"
              data-testid="button-clear-sales-history-filters"
              onClick={() =>
                setFilters({
                  search_invoice: "",
                  from_date: "",
                  to_date: "",
                  customer_id: null,
                  payment_mode: "",
                  status: "",
                  limit: SALES_HISTORY_LIMIT,
                })
              }
              type="button"
            >
              Clear filters
            </button>
          )}
        </div>
        {customerFilterError && <p className="field-hint">{customerFilterError}</p>}

        {loadError ? (
          <div className="workspace-empty sales-history-state" role="alert" data-testid="status-sales-history-error">
            <AlertCircle size={23} />
            <strong>Sales history could not be loaded</strong>
            <span>{loadError}</span>
            <button
              className="button button-secondary"
              data-testid="button-retry-sales-history"
              onClick={() => setRefreshKey((current) => current + 1)}
              type="button"
            >
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className="workspace-empty sales-history-state" role="status" aria-live="polite" data-testid="status-sales-history-loading">
            <LoaderCircle className="sales-history-spinner" size={22} />
            <strong>Loading invoices…</strong>
          </div>
        ) : sales.length === 0 && !hasActiveFilters ? (
          <div className="workspace-empty sales-history-state" data-testid="status-sales-history-empty">
            <ReceiptText size={23} />
            <strong>No sales recorded yet</strong>
            <span>Completed invoices from POS Billing will appear here.</span>
          </div>
        ) : sales.length === 0 ? (
          <div className="workspace-empty sales-history-state" data-testid="status-sales-search-empty">
            <Search size={23} />
            <strong>No invoices match these filters</strong>
            <span>Change the search or filters to see more local sales.</span>
          </div>
        ) : (
          <div className="workspace-table-scroll sales-history-table-scroll">
            <table className="workspace-table sales-history-table">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Date &amp; time</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Items</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Total</th>
                  <th scope="col">Returned / voided</th>
                  <th scope="col"><span className="sr-only">Invoice actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => {
                  const canReturn = sale.status === "ACTIVE" || sale.status === "PARTIALLY_RETURNED";
                  const canCorrectOrCancel = sale.status === "ACTIVE" && sale.returned_total === 0;
                  const returnedOrVoided =
                    sale.status === "CANCELLED" ? sale.grand_total : sale.returned_total;
                  return (
                    <tr key={sale.id} data-testid={`row-sales-invoice-${sale.id}`}>
                      <td><strong className="workspace-number sales-invoice-number">{sale.invoice_no}</strong></td>
                      <td>{formatDateTime(sale.created_at)}</td>
                      <td>
                        <div className="sales-customer">
                          <strong>{sale.customer_name || "Walk-in"}</strong>
                          {sale.customer_phone && <span>{sale.customer_phone}</span>}
                        </div>
                      </td>
                      <td className="sales-item-count">{sale.item_count}</td>
                      <td>
                        <span className="sales-payment-pill">{sale.payment_mode}</span>
                        {sale.payment_reference && <small className="sales-history-reference">{sale.payment_reference}</small>}
                      </td>
                      <td>
                        <span className={`sales-status-pill sales-status-pill--${sale.status.toLowerCase().replaceAll("_", "-")}`}>
                          {sale.status === "PARTIALLY_RETURNED" ? "Partially returned" : sale.status.toLowerCase().replaceAll("_", " ")}
                        </span>
                      </td>
                      <td><strong className="sales-invoice-total">{formatMoney(sale.grand_total)}</strong></td>
                      <td>
                        {returnedOrVoided > 0
                          ? <strong className="sales-return-total">{formatMoney(returnedOrVoided)}</strong>
                          : <span className="workspace-muted">—</span>}
                      </td>
                      <td>
                        <div className="sales-row-actions">
                          <button
                            aria-label={`View invoice ${sale.invoice_no}`}
                            className="button button-secondary sales-view-button"
                            data-testid={`button-view-sales-invoice-${sale.id}`}
                            disabled={openingInvoice === sale.invoice_no}
                            onClick={() => void openInvoice(sale.invoice_no)}
                            type="button"
                          >
                            {openingInvoice === sale.invoice_no ? (
                              <LoaderCircle className="sales-history-spinner" size={14} />
                            ) : (
                              <ReceiptText size={14} />
                            )}
                            View
                          </button>
                          {canReturn && (
                            <button
                              className="button button-secondary sales-view-button"
                              data-testid={`button-return-sales-invoice-${sale.id}`}
                              disabled={openingInvoice === sale.invoice_no}
                              onClick={() => void openAction(sale.invoice_no, "return")}
                              type="button"
                            >
                              <RotateCcw size={14} /> Return
                            </button>
                          )}
                          {canCorrectOrCancel && (
                            <>
                              <button
                                className="button button-secondary sales-view-button"
                                data-testid={`button-correct-sales-invoice-${sale.id}`}
                                disabled={openingInvoice === sale.invoice_no}
                                onClick={() => void openAction(sale.invoice_no, "correct")}
                                type="button"
                              >
                                <Pencil size={14} /> Correct
                              </button>
                              <button
                                className="button button-secondary sales-view-button sales-cancel-button"
                                data-testid={`button-cancel-sales-invoice-${sale.id}`}
                                disabled={openingInvoice === sale.invoice_no}
                                onClick={() => void openAction(sale.invoice_no, "cancel")}
                                type="button"
                              >
                                <Ban size={14} /> Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {receiptSale && (
        <ReceiptPrint
          autoPrint={false}
          onClose={() => setReceiptSale(null)}
          sale={receiptSale}
        />
      )}
      {actionSale && actionKind && (
        <SaleActionDialog
          kind={actionKind}
          sale={actionSale}
          customers={customers}
          error={actionError}
          isSaving={isSavingAction}
          onClose={() => {
            if (!isSavingAction) {
              setActionSale(null);
              setActionKind(null);
            }
          }}
          onReturn={(input) => void handleReturn(input)}
          onCancelSale={(input) => void handleCancel(input)}
          onCorrect={(input) => void handleCorrection(input)}
        />
      )}
    </section>
  );
}