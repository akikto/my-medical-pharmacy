import {
  AlertCircle,
  ArrowDownToLine,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  PackageSearch,
  Printer,
  ReceiptText,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getExpiryAlerts, getLowStockAlerts } from "../../services/inventoryService";
import { getSalesReport } from "../../services/reportsService";
import type {
  ExpiryAlert,
  ExpiryHorizonDays,
  LowStockAlert,
  SalesReport,
} from "../../types";
import { formatDate, formatDateTime, formatMoney } from "../../utils/money";
import "./reports.css";

type DatePreset = "today" | "week" | "month" | "custom";

function toISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

const paymentLabel: Record<string, string> = {
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  CREDIT: "Credit",
  OTHER: "Other",
};

export function ReportsPage() {
  const today = toISODate(new Date());
  const [preset, setPreset] = useState<DatePreset>("today");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportRequestKey, setReportRequestKey] = useState(0);
  const [horizon, setHorizon] = useState<ExpiryHorizonDays>(30);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [expiry, setExpiry] = useState<ExpiryAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsRequestKey, setAlertsRequestKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (startDate > endDate) {
      setReportLoading(false);
      setReportError(null);
      return () => {
        cancelled = true;
      };
    }
    setReportLoading(true);
    setReportError(null);
    getSalesReport(startDate, endDate)
      .then((result: SalesReport) => {
        if (!cancelled) setReport(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) setReportError(errorMessage(error, "Sales report could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, reportRequestKey]);

  useEffect(() => {
    let cancelled = false;
    setAlertsLoading(true);
    setAlertsError(null);
    Promise.all([getLowStockAlerts(), getExpiryAlerts(horizon)])
      .then(([stockRows, expiryRows]) => {
        if (cancelled) return;
        setLowStock(stockRows);
        setExpiry(expiryRows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAlertsError(errorMessage(error, "Inventory alerts could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setAlertsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [horizon, alertsRequestKey]);

  function selectPreset(nextPreset: DatePreset) {
    setPreset(nextPreset);
    if (nextPreset === "custom") return;
    const now = new Date();
    const current = toISODate(now);
    if (nextPreset === "today") {
      setStartDate(current);
      setEndDate(current);
    } else if (nextPreset === "week") {
      setStartDate(toISODate(startOfWeek(now)));
      setEndDate(current);
    } else {
      setStartDate(toISODate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setEndDate(current);
    }
  }

  function printSurface(surface: "sales" | "stock" | "expiry") {
    document.body.dataset.reportPrint = surface;
    const clearPrintMode = () => {
      delete document.body.dataset.reportPrint;
      window.removeEventListener("afterprint", clearPrintMode);
    };
    window.addEventListener("afterprint", clearPrintMode, { once: true });
    window.print();
    window.setTimeout(clearPrintMode, 1500);
  }

  function exportSales() {
    if (!report) return;
    const rows = [
      ["Report start", "Report end", "Revenue", "Gross profit", "Invoice count", "Cash revenue", "Cash invoices", "Card & UPI revenue", "Card & UPI invoices", "Other revenue", "Other invoices", "Profit unavailable invoices"],
      [
        startDate,
        endDate,
        report.summary.total_revenue,
        report.summary.gross_profit,
        report.summary.total_invoices,
        report.summary.cash_revenue,
        report.summary.cash_invoices,
        report.summary.card_upi_revenue,
        report.summary.card_upi_invoices,
        report.summary.other_revenue,
        report.summary.other_invoices,
        report.summary.profit_unavailable_invoices,
      ],
      [],
      ["Invoice", "Customer", "Payment mode", "Amount", "Created at"],
      ...report.sales.map((sale) => [
        sale.invoice_no,
        sale.customer_name || "Walk-in customer",
        paymentLabel[sale.payment_mode] ?? sale.payment_mode,
        sale.grand_total,
        sale.created_at,
      ]),
    ];
    downloadCsv(`my-medical-sales-${startDate}-to-${endDate}.csv`, rows);
  }

  function exportLowStock() {
    downloadCsv("my-medical-low-stock.csv", [
      ["Medicine", "Generic name", "Company", "Rack", "Available stock", "Minimum stock"],
      ...lowStock.map((item) => [
        item.name,
        item.generic_name,
        item.company,
        item.rack_location,
        item.available_stock,
        item.min_stock_alert,
      ]),
    ]);
  }

  function exportExpiry() {
    downloadCsv(`my-medical-expiry-${horizon}-days.csv`, [
      ["Medicine", "Batch", "Expiry date", "Days until expiry", "Status", "Current stock"],
      ...expiry.map((item) => [
        item.medicine_name,
        item.batch.batch_no,
        item.batch.expiry_date,
        item.days_until_expiry,
        item.status,
        item.batch.current_stock,
      ]),
    ]);
  }

  const summary = report?.summary;
  const customRangeInvalid = startDate > endDate;

  return (
    <section className="workspace-page reports-page" data-testid="page-reports">
      <header className="workspace-page-header reports-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> LOCAL BUSINESS RECORDS</div>
          <h1>Reports</h1>
          <p>Sales performance and stock actions, drawn from this device’s records.</p>
        </div>
        <div className="reports-local-badge"><CheckCircle2 size={15} /> Available offline</div>
      </header>

      <section className="workspace-card report-controls" aria-label="Sales report date range">
        <div className="report-control-heading">
          <span className="report-heading-icon"><CalendarDays size={17} /></span>
          <div><h2>Sales report</h2><p>Choose the invoice dates to include.</p></div>
        </div>
        <div className="report-range-controls">
          <div className="report-preset-list" role="group" aria-label="Date range preset">
            {([
              ["today", "Today"],
              ["week", "This week"],
              ["month", "This month"],
              ["custom", "Custom range"],
            ] as Array<[DatePreset, string]>).map(([value, label]) => (
              <button
                aria-pressed={preset === value}
                className={`report-preset ${preset === value ? "is-selected" : ""}`}
                data-testid={`button-report-range-${value}`}
                key={value}
                onClick={() => selectPreset(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="report-date-inputs">
              <label>From
                <input
                  aria-label="Report start date"
                  className="workspace-input"
                  data-testid="input-report-start-date"
                  onChange={(event) => setStartDate(event.target.value)}
                  type="date"
                  value={startDate}
                />
              </label>
              <span aria-hidden="true" className="report-date-separator">to</span>
              <label>Through
                <input
                  aria-label="Report end date"
                  className="workspace-input"
                  data-testid="input-report-end-date"
                  onChange={(event) => setEndDate(event.target.value)}
                  type="date"
                  value={endDate}
                />
              </label>
            </div>
          )}
          <div className="report-range-caption" data-testid="text-report-date-range">
            {startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} — ${formatDate(endDate)}`}
          </div>
        </div>
      </section>

      {customRangeInvalid && (
        <div className="workspace-error workspace-error--banner" role="alert" data-testid="status-report-range-error">
          <AlertCircle size={16} /> Start date must be on or before the end date.
        </div>
      )}

      <section className="report-sales-surface" data-report-surface="sales" aria-label="Sales report results">
        <div className="report-surface-toolbar">
          <div>
            <span className="report-section-kicker">PERIOD TOTALS</span>
            <strong>{startDate} <span>to</span> {endDate}</strong>
          </div>
          <div className="report-actions">
            <button className="button button-secondary" data-testid="button-export-sales-csv" disabled={!report || reportLoading || Boolean(reportError) || customRangeInvalid} onClick={exportSales} type="button">
              <ArrowDownToLine size={15} /> Export CSV
            </button>
            <button className="button button-secondary" data-testid="button-print-sales-report" disabled={!report || reportLoading || Boolean(reportError) || customRangeInvalid} onClick={() => printSurface("sales")} type="button">
              <Printer size={15} /> Print
            </button>
          </div>
        </div>

        {reportError && (
          <div className="workspace-error workspace-error--banner" role="alert" data-testid="status-sales-report-error">
            <AlertCircle size={16} /> <span>{reportError}</span>
            <button className="button button-secondary" data-testid="button-retry-sales-report" onClick={() => setReportRequestKey((current) => current + 1)} type="button"><RefreshCw size={14} /> Retry</button>
          </div>
        )}

        {reportLoading ? (
          <div className="report-metrics-grid report-skeleton" aria-label="Loading sales totals" aria-busy="true" data-testid="loading-sales-report">
            {[1, 2, 3, 4].map((item) => <div className="report-skeleton-card" key={item}><span /><strong /></div>)}
          </div>
        ) : reportError || customRangeInvalid ? null : summary ? (
          <>
            <div className="report-metrics-grid" data-testid="report-summary">
              <article className="report-metric report-metric--primary">
                <span className="report-metric-icon"><TrendingUp size={17} /></span>
                <span className="report-metric-label">Revenue</span>
                <strong data-testid="value-report-revenue">{formatMoney(summary.total_revenue)}</strong>
                <small>Sales recorded in this period</small>
              </article>
              <article className="report-metric">
                <span className="report-metric-icon report-metric-icon--profit"><FileSpreadsheet size={16} /></span>
                <span className="report-metric-label">Gross profit</span>
                <strong data-testid="value-report-gross-profit">{formatMoney(summary.gross_profit)}</strong>
                <small>{summary.profit_unavailable_invoices} invoice{summary.profit_unavailable_invoices === 1 ? "" : "s"} without cost data</small>
              </article>
              <article className="report-metric">
                <span className="report-metric-icon"><ReceiptText size={16} /></span>
                <span className="report-metric-label">Total invoices</span>
                <strong data-testid="value-report-invoices">{summary.total_invoices.toLocaleString("en-IN")}</strong>
                <small>Invoices in the selected period</small>
              </article>
              <article className="report-metric report-metric--payments">
                <span className="report-metric-label">Payment breakdown</span>
                <div className="payment-breakdown-line"><span><i className="payment-dot payment-dot--cash" /> Cash</span><strong>{formatMoney(summary.cash_revenue)}</strong><small>{summary.cash_invoices} invoices</small></div>
                <div className="payment-breakdown-line"><span><i className="payment-dot payment-dot--card" /> Card &amp; UPI</span><strong>{formatMoney(summary.card_upi_revenue)}</strong><small>{summary.card_upi_invoices} invoices</small></div>
                <div className="payment-breakdown-line"><span><i className="payment-dot payment-dot--other" /> Other</span><strong>{formatMoney(summary.other_revenue)}</strong><small>{summary.other_invoices} invoices</small></div>
              </article>
            </div>
            {summary.profit_unavailable_invoices > 0 && (
              <p className="report-profit-note" data-testid="text-profit-unavailable">
                Gross profit excludes {summary.profit_unavailable_invoices} invoice{summary.profit_unavailable_invoices === 1 ? "" : "s"} where purchase cost was unavailable.
              </p>
            )}
          </>
        ) : null}

        {!reportLoading && !reportError && !customRangeInvalid && report && (
          <section className="workspace-card report-table-card" aria-labelledby="sales-invoices-title">
            <div className="report-table-heading">
              <div className="report-card-title"><span className="report-heading-icon"><ReceiptText size={16} /></span><div><h2 id="sales-invoices-title">Invoice detail</h2><p>{report.sales.length} recorded sale{report.sales.length === 1 ? "" : "s"} in this period</p></div></div>
              <span className="report-date-stamp">{startDate} — {endDate}</span>
            </div>
            {report.sales.length === 0 ? (
              <div className="workspace-empty report-empty" data-testid="empty-sales-report">
                <ReceiptText size={23} />
                <strong>No invoices in this date range</strong>
                <span>Completed sales saved on this device will appear here.</span>
              </div>
            ) : (
              <div className="workspace-table-scroll">
                <table className="workspace-table report-sales-table">
                  <thead><tr><th scope="col">Invoice</th><th scope="col">Customer</th><th scope="col">Payment</th><th scope="col">Date &amp; time</th><th scope="col" className="report-align-right">Total</th></tr></thead>
                  <tbody>
                    {report.sales.map((sale) => (
                      <tr key={sale.id} data-testid={`row-report-sale-${sale.id}`}>
                        <td><strong>{sale.invoice_no}</strong></td>
                        <td>{sale.customer_name || <span className="workspace-muted">Walk-in customer</span>}</td>
                        <td><span className="report-payment-tag">{paymentLabel[sale.payment_mode] ?? sale.payment_mode}</span></td>
                        <td>{formatDateTime(sale.created_at)}</td>
                        <td className="report-align-right"><strong>{formatMoney(sale.grand_total)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </section>

      <section className="report-inventory-section" aria-label="Inventory alerts">
        <div className="report-inventory-heading">
          <div><span className="report-section-kicker">INVENTORY WATCH</span><h2>Stock that needs attention</h2><p>Local alerts from medicine batches and minimum stock levels.</p></div>
          <div className="report-alert-refresh"><PackageSearch size={17} /> Inventory alerts</div>
        </div>

        {alertsError && (
          <div className="workspace-error workspace-error--banner" role="alert" data-testid="status-inventory-alerts-error">
            <AlertCircle size={16} /> <span>{alertsError}</span>
            <button className="button button-secondary" data-testid="button-retry-inventory-alerts" onClick={() => setAlertsRequestKey((current) => current + 1)} type="button"><RefreshCw size={14} /> Retry</button>
          </div>
        )}

        <div className="report-alert-grid">
          <section className="workspace-card report-alert-card" data-report-surface="stock" aria-labelledby="low-stock-title">
            <div className="report-alert-card-heading">
              <div className="report-card-title"><span className="report-heading-icon report-heading-icon--amber"><PackageSearch size={16} /></span><div><h3 id="low-stock-title">Low stock</h3><p>Below the set minimum quantity</p></div></div>
              <div className="report-actions">
                <button aria-label="Export low stock as CSV" className="report-icon-action" data-testid="button-export-low-stock-csv" onClick={exportLowStock} disabled={alertsLoading || Boolean(alertsError)} type="button"><ArrowDownToLine size={15} /></button>
                <button aria-label="Print low stock report" className="report-icon-action" data-testid="button-print-low-stock" onClick={() => printSurface("stock")} disabled={alertsLoading || Boolean(alertsError)} type="button"><Printer size={15} /></button>
              </div>
            </div>
            {alertsLoading ? <div className="report-list-loading" aria-busy="true" data-testid="loading-low-stock"><span /><span /><span /></div>
              : alertsError ? <p className="report-inline-error">Low stock alerts are unavailable.</p>
                : lowStock.length === 0 ? <div className="report-alert-empty" data-testid="empty-low-stock"><CheckCircle2 size={18} /><span>All medicines are at or above minimum stock.</span></div>
                  : <div className="report-alert-list">
                    {lowStock.map((item) => (
                      <div className="report-alert-row" data-testid={`row-low-stock-${item.medicine_id}`} key={item.medicine_id}>
                        <div className="report-alert-main"><strong>{item.name}</strong><span>{item.generic_name || item.company || "Medicine"}{item.rack_location ? ` · Rack ${item.rack_location}` : ""}</span></div>
                        <div className="report-stock-quantity"><strong>{item.available_stock}</strong><span>of {item.min_stock_alert}</span></div>
                      </div>
                    ))}
                  </div>}
          </section>

          <section className="workspace-card report-alert-card" data-report-surface="expiry" aria-labelledby="expiry-title">
            <div className="report-alert-card-heading report-expiry-heading">
              <div className="report-card-title"><span className="report-heading-icon report-heading-icon--amber"><CalendarDays size={16} /></span><div><h3 id="expiry-title">Expiry batches</h3><p>Expired or nearing expiry</p></div></div>
              <div className="report-alert-tools">
                <label className="sr-only" htmlFor="expiry-horizon">Expiry horizon</label>
                <select id="expiry-horizon" aria-label="Expiry horizon" className="report-horizon-select" data-testid="select-expiry-horizon" onChange={(event) => setHorizon(Number(event.target.value) as ExpiryHorizonDays)} value={horizon}>
                  <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
                </select>
                <button aria-label="Export expiry batches as CSV" className="report-icon-action" data-testid="button-export-expiry-csv" onClick={exportExpiry} disabled={alertsLoading || Boolean(alertsError)} type="button"><ArrowDownToLine size={15} /></button>
                <button aria-label="Print expiry batches report" className="report-icon-action" data-testid="button-print-expiry" onClick={() => printSurface("expiry")} disabled={alertsLoading || Boolean(alertsError)} type="button"><Printer size={15} /></button>
              </div>
            </div>
            {alertsLoading ? <div className="report-list-loading" aria-busy="true" data-testid="loading-expiry"><span /><span /><span /></div>
              : alertsError ? <p className="report-inline-error">Expiry alerts are unavailable.</p>
                : expiry.length === 0 ? <div className="report-alert-empty" data-testid="empty-expiry"><CheckCircle2 size={18} /><span>No batches expire within {horizon} days.</span></div>
                  : <div className="report-alert-list report-alert-list--expiry">
                    {expiry.map((item) => (
                      <div className="report-alert-row" data-testid={`row-expiry-${item.batch.id}`} key={item.batch.id}>
                        <div className="report-alert-main"><strong>{item.medicine_name}</strong><span>Batch {item.batch.batch_no} · Exp {item.batch.expiry_date}</span></div>
                        <div className={`report-expiry-status ${item.status === "expired" ? "is-expired" : ""}`}><strong>{item.status === "expired" ? "Expired" : `${item.days_until_expiry} days`}</strong><span>{item.batch.current_stock} units</span></div>
                      </div>
                    ))}
                  </div>}
          </section>
        </div>
      </section>
    </section>
  );
}