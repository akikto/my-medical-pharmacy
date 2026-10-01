import {
  AlertCircle,
  FileText,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getRecentSales, getSaleDetails } from "../../services/salesService";
import type { RecentSale, SaleDetails } from "../../types";
import { formatDateTime, formatMoney } from "../../utils/money";
import { ReceiptPrint } from "../pos/ReceiptPrint";
import "./sales.css";

const SALES_HISTORY_LIMIT = 100;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Sales history could not be loaded.";
}

export function SalesPage() {
  const [sales, setSales] = useState<RecentSale[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openingInvoice, setOpeningInvoice] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<{
    invoiceNo: string;
    message: string;
  } | null>(null);
  const [receiptSale, setReceiptSale] = useState<SaleDetails | null>(null);

  const refreshSales = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setInvoiceError(null);
    try {
      setSales(await getRecentSales(SALES_HISTORY_LIMIT));
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSales();
  }, [refreshSales]);

  const filteredSales = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return sales;

    return sales.filter(({ sale }) =>
      [sale.invoice_no, sale.customer_name ?? "", sale.customer_phone ?? ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [sales, searchQuery]);

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
          onClick={() => void refreshSales()}
          type="button"
        >
          {isLoading ? <LoaderCircle className="sales-history-spinner" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </header>

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
                {sales.length.toLocaleString("en-IN")} of up to {SALES_HISTORY_LIMIT} most recent invoices
              </p>
            </div>
          </div>
          <div className="sales-history-search">
            <Search aria-hidden="true" size={16} />
            <input
              aria-label="Search invoices by number, customer, or phone"
              data-testid="input-sales-history-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Invoice, customer, or phone"
              value={searchQuery}
            />
            {searchQuery.length > 0 && (
              <button
                aria-label="Clear sales search"
                className="sales-history-search-clear"
                data-testid="button-clear-sales-search"
                onClick={() => setSearchQuery("")}
                title="Clear search"
                type="button"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {loadError ? (
          <div className="workspace-empty sales-history-state" role="alert" data-testid="status-sales-history-error">
            <AlertCircle size={23} />
            <strong>Sales history could not be loaded</strong>
            <span>{loadError}</span>
            <button
              className="button button-secondary"
              data-testid="button-retry-sales-history"
              onClick={() => void refreshSales()}
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
        ) : sales.length === 0 ? (
          <div className="workspace-empty sales-history-state" data-testid="status-sales-history-empty">
            <ReceiptText size={23} />
            <strong>No sales recorded yet</strong>
            <span>Completed invoices from POS Billing will appear here.</span>
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="workspace-empty sales-history-state" data-testid="status-sales-search-empty">
            <Search size={23} />
            <strong>No invoices match this search</strong>
            <span>Try a different invoice number, customer name, or phone number.</span>
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
                  <th scope="col">Total</th>
                  <th scope="col"><span className="sr-only">Invoice actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredSales.map(({ sale, item_count }) => (
                  <tr key={sale.id} data-testid={`row-sales-invoice-${sale.id}`}>
                    <td><strong className="workspace-number sales-invoice-number">{sale.invoice_no}</strong></td>
                    <td>{formatDateTime(sale.created_at)}</td>
                    <td>
                      <div className="sales-customer">
                        <strong>{sale.customer_name || "Walk-in"}</strong>
                        {sale.customer_phone && <span>{sale.customer_phone}</span>}
                      </div>
                    </td>
                    <td className="sales-item-count">{item_count}</td>
                    <td><span className="sales-payment-pill">{sale.payment_mode}</span></td>
                    <td><strong className="sales-invoice-total">{formatMoney(sale.grand_total)}</strong></td>
                    <td>
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
                    </td>
                  </tr>
                ))}
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
    </section>
  );
}