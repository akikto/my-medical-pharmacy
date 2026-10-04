import {
  AlertCircle,
  ArrowDownToLine,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileSpreadsheet,
  Filter,
  PackageSearch,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getExpiryAlerts, getLowStockAlerts } from "../../services/inventoryService";
import {
  getCompleteFinancialReport,
  getFinancialReport,
  getReportDateRange,
} from "../../services/financialReportsService";
import { exportFinancialReportExcel } from "../../services/financialReportExportService";
import { getStoreSettings } from "../../services/settingsService";
import { getSuppliers } from "../../services/supplierService";
import type {
  ExpiryAlert,
  ExpiryHorizonDays,
  LowStockAlert,
  StoreSettings,
  Supplier,
} from "../../types";
import type {
  ExpensePeriodTotal,
  FinancialReportData,
  FinancialReportRequest,
  FinancialReportSort,
  FinancialReportType,
  ExpenseReport,
  GstDetailRow,
  ReportDateRange,
  ReportRangePreset,
  ReportTransactionRow,
} from "../../types/financialReports";
import { formatDate, formatDateTime, formatMoney } from "../../utils/money";
import "./reports.css";

const reportOptions: Array<{ id: FinancialReportType; title: string; group: string }> = [
  { id: "sales_summary", title: "Sales Summary", group: "Trading" },
  { id: "purchase_summary", title: "Purchase Summary", group: "Trading" },
  { id: "profit_and_loss", title: "Profit & Loss", group: "Trading" },
  { id: "expenses", title: "Expenses", group: "Trading" },
  { id: "financial_summary", title: "Financial Summary", group: "Overview" },
  { id: "stock_valuation", title: "Stock Valuation", group: "Inventory" },
  { id: "product_sales", title: "Product-wise Sales", group: "Analysis" },
  { id: "company_sales", title: "Company-wise Sales", group: "Analysis" },
  { id: "customer_due", title: "Customer Due", group: "Balances" },
  { id: "supplier_due", title: "Supplier Due", group: "Balances" },
  { id: "gst", title: "GST", group: "Tax" },
];

const presetOptions: Array<{ value: ReportRangePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "custom", label: "Custom" },
];

const pageSize = 30;
type PrintMode = "main" | "low-stock" | "expiry";
type SummaryEntry = [string, string];

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
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

function reportTitle(type: FinancialReportType): string {
  return reportOptions.find((item) => item.id === type)?.title ?? "Report";
}

function isPaged(type: FinancialReportType): boolean {
  return type === "product_sales" || type === "company_sales" ||
    type === "customer_due" || type === "supplier_due";
}

function buildRequest(
  type: FinancialReportType,
  range: ReportDateRange,
  page: number,
  search: string,
  sortBy: FinancialReportSort,
  outstandingOnly: boolean,
  supplierId: number | null,
  nearExpiryDays: number,
): FinancialReportRequest {
  switch (type) {
    case "sales_summary":
    case "profit_and_loss":
    case "expenses":
    case "financial_summary":
    case "gst":
      return { reportType: type, range };
    case "purchase_summary":
      return { reportType: type, range, supplierId };
    case "stock_valuation":
      return { reportType: type, nearExpiryDays };
    case "product_sales":
    case "company_sales":
      return { reportType: type, range, page, pageSize, search, sortBy };
    case "customer_due":
    case "supplier_due":
      return { reportType: type, range, page, pageSize, search, sortBy, outstandingOnly };
  }
}

function rangeLabel(report: FinancialReportData | null, range: ReportDateRange | null): string {
  if (report?.reportType === "stock_valuation") return `As of ${formatDate(report.data.asOfDate)}`;
  if (!range) return "Date range unavailable";
  return range.startDate === range.endDate
    ? formatDate(range.startDate)
    : `${formatDate(range.startDate)} – ${formatDate(range.endDate)}`;
}

function summaryEntries(report: FinancialReportData): SummaryEntry[] {
  switch (report.reportType) {
    case "sales_summary":
      return [
        ["Gross sales", formatMoney(report.data.grossSales)],
        ["Returns", formatMoney(report.data.salesReturns)],
        ["Cancelled / void", formatMoney(report.data.voidSales)],
        ["Net sales", formatMoney(report.data.netSales)],
        ["Taxable sales", formatMoney(report.data.taxableSales)],
        ["CGST · SGST · IGST", `${formatMoney(report.data.cgst)} · ${formatMoney(report.data.sgst)} · ${formatMoney(report.data.igst)}`],
        ["Output GST", formatMoney(report.data.outputGst)],
        ["Cash · UPI · other", `${formatMoney(report.data.cashSales)} · ${formatMoney(report.data.upiSales)} · ${formatMoney(report.data.otherSales)}`],
        ["Credit sales", formatMoney(report.data.creditSales)],
        ["Invoices", report.data.invoiceCount.toLocaleString("en-IN")],
        ["Returns · voids · corrections", `${report.data.returnTransactionCount} · ${report.data.voidedInvoiceCount} · ${report.data.correctionCount}`],
      ];
    case "purchase_summary":
      return [
        ["Gross purchases", formatMoney(report.data.grossPurchases)],
        ["Returns", formatMoney(report.data.purchaseReturns)],
        ["Cancelled purchases", formatMoney(report.data.cancelledPurchases)],
        ["Net purchases", formatMoney(report.data.netPurchases)],
        ["Taxable purchases", formatMoney(report.data.taxablePurchases)],
        ["CGST · SGST · IGST", `${formatMoney(report.data.cgst)} · ${formatMoney(report.data.sgst)} · ${formatMoney(report.data.igst)}`],
        ["Input GST", formatMoney(report.data.inputGst)],
        ["Cash · bank · UPI · other payments", `${formatMoney(report.data.cashPayments)} · ${formatMoney(report.data.bankPayments)} · ${formatMoney(report.data.upiPayments)} · ${formatMoney(report.data.otherPayments)}`],
        ["Invoices", report.data.invoiceCount.toLocaleString("en-IN")],
        ["Cancelled · return transactions", `${report.data.cancelledInvoiceCount} · ${report.data.returnTransactionCount}`],
      ];
    case "profit_and_loss":
      return [
        ["Gross sales", formatMoney(report.data.grossSales)],
        ["Sales returns", formatMoney(report.data.salesReturns)],
        ["Net sales · excl. GST", formatMoney(report.data.netSales)],
        ["COGS", report.data.cogs === null ? "Unavailable" : formatMoney(report.data.cogs)],
        ["Gross profit", report.data.grossProfit === null ? "Unavailable" : formatMoney(report.data.grossProfit)],
        ["Operating expenses", formatMoney(report.data.operatingExpenses)],
        ["Net profit", report.data.netProfit === null ? "Unavailable" : formatMoney(report.data.netProfit)],
        ["Gross · net margin", `${report.data.grossMarginPercent === null ? "Unavailable" : `${report.data.grossMarginPercent.toFixed(2)}%`} · ${report.data.netMarginPercent === null ? "Unavailable" : `${report.data.netMarginPercent.toFixed(2)}%`}`],
        ["Cost unavailable invoices", report.data.costUnavailableInvoices.toLocaleString("en-IN")],
      ];
    case "expenses":
      return [
        ["Total expenses", formatMoney(report.data.totalExpenses)],
        ["Active · cancelled", `${report.data.activeCount.toLocaleString("en-IN")} · ${report.data.cancelledCount.toLocaleString("en-IN")}`],
        ["By payment method", report.data.paymentMethodTotals.map((item) => `${item.paymentMethod}: ${formatMoney(item.amount)}`).join(" · ")],
        ["Top categories", report.data.categoryTotals.slice(0, 3).map((item) => `${item.categoryName}: ${formatMoney(item.amount)}`).join(" · ") || "No active expenses"],
        ["Expense records", report.data.totalRows.toLocaleString("en-IN")],
      ];
    case "financial_summary":
      return [
        ["Net sales · excl. GST", formatMoney(report.data.netSales)],
        ["Net purchases", formatMoney(report.data.netPurchases)],
        ["Sales · purchase returns", `${formatMoney(report.data.salesReturns)} · ${formatMoney(report.data.purchaseReturns)}`],
        ["COGS", report.data.cogs === null ? "Unavailable" : formatMoney(report.data.cogs)],
        ["Gross profit", report.data.grossProfit === null ? "Unavailable" : formatMoney(report.data.grossProfit)],
        ["Operating expenses", formatMoney(report.data.operatingExpenses)],
        ["Net profit", report.data.netProfit === null ? "Unavailable" : formatMoney(report.data.netProfit)],
        ["Customer · supplier outstanding", `${formatMoney(report.data.customerOutstanding)} · ${formatMoney(report.data.supplierOutstanding)}`],
        ["Stock · cost value", `${report.data.stockQuantity.toLocaleString("en-IN")} units · ${formatMoney(report.data.stockValuation)}`],
      ];
    case "stock_valuation":
      return [
        ["Total quantity", report.data.totalStockQuantity.toLocaleString("en-IN")],
        ["Stock at cost", formatMoney(report.data.totalStockCostValue)],
        ["Stock at MRP", formatMoney(report.data.totalStockMrpValue)],
        ["Sellable at cost", formatMoney(report.data.sellableCostValue)],
        ["Sellable at MRP · sale rate", `${formatMoney(report.data.sellableMrpValue)} · ${formatMoney(report.data.sellableSaleValue)}`],
        ["Expired batches", report.data.expiredQuantity.toLocaleString("en-IN")],
        ["Expired cost · near expiry qty", `${formatMoney(report.data.expiredCostValue)} · ${report.data.nearExpiryQuantity.toLocaleString("en-IN")}`],
        ["Near expiry value · low-stock items", `${formatMoney(report.data.nearExpiryCostValue)} · ${report.data.lowStockItems}`],
      ];
    case "product_sales":
    case "company_sales":
      return [["Rows matching", report.data.totalRows.toLocaleString("en-IN")]];
    case "customer_due":
      return [
        ["Customers listed", report.data.totalRows.toLocaleString("en-IN")],
        ["Balance basis", "Current lifetime outstanding"],
      ];
    case "supplier_due":
      return [
        ["Suppliers listed", report.data.totalRows.toLocaleString("en-IN")],
        ["Balance basis", "Current lifetime outstanding"],
      ];
    case "gst":
      return [
        ["Output GST", formatMoney(report.data.totalOutputGst)],
        ["Input GST", formatMoney(report.data.totalInputGst)],
        ["Net GST position", formatMoney(report.data.netGstPosition)],
        ["Taxable sales", formatMoney(report.data.taxableSales)],
        ["Taxable purchases", formatMoney(report.data.taxablePurchases)],
        ["Same-state output · interstate", `${formatMoney(report.data.sameStateOutputTaxable)} · ${formatMoney(report.data.interstateOutputTaxable)}`],
        ["Same-state input · interstate", `${formatMoney(report.data.sameStateInputTaxable)} · ${formatMoney(report.data.interstateInputTaxable)}`],
      ];
  }
}

function TransactionTable({ rows }: { rows: ReportTransactionRow[] }) {
  return (
    <div className="workspace-table-scroll reports-table-scroll">
      <table className="workspace-table reports-data-table">
        <thead><tr>
          <th>Date</th><th>Activity</th><th>Reference</th><th>Party</th><th>Payment</th><th>Status</th>
          <th className="report-align-right">Amount</th><th className="report-align-right">Taxable</th><th className="report-align-right">GST</th>
        </tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={`${row.date}-${row.reference}-${index}`}>
            <td>{formatDate(row.date)}</td><td><span className="report-kind">{row.kind}</span></td>
            <td><strong>{row.reference || "—"}</strong></td><td>{row.partyName || "—"}</td>
            <td>{row.paymentMode || "—"}</td><td>{row.status || "—"}</td>
            <td className="report-align-right">{formatMoney(row.amount)}</td>
            <td className="report-align-right">{formatMoney(row.taxableAmount)}</td>
            <td className="report-align-right">{formatMoney(row.gstAmount)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function GstDetailTable({ title, rows }: { title: string; rows: GstDetailRow[] }) {
  return (
    <section className="report-detail-block">
      <div className="report-detail-heading"><h3>{title}</h3><span>{rows.length.toLocaleString("en-IN")} entries</span></div>
      {rows.length === 0 ? <div className="report-table-empty">No GST detail for this side of the period.</div> : (
        <div className="workspace-table-scroll reports-table-scroll">
          <table className="workspace-table reports-data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Invoice</th><th>Customer / supplier</th><th>Tax type</th><th className="report-align-right">Taxable</th><th className="report-align-right">CGST</th><th className="report-align-right">SGST</th><th className="report-align-right">IGST</th><th className="report-align-right">Total GST</th></tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${row.date}-${row.invoiceNo}-${index}`} className={/return|void/i.test(row.kind) ? "report-signed-row" : ""}>
                <td>{formatDate(row.date)}</td><td>{row.kind}</td><td><strong>{row.invoiceNo}</strong></td>
                <td>{row.partyName || "—"}</td><td>{row.taxType}</td>
                <td className="report-align-right">{formatMoney(row.taxableAmount)}</td>
                <td className="report-align-right">{formatMoney(row.cgst)}</td>
                <td className="report-align-right">{formatMoney(row.sgst)}</td>
                <td className="report-align-right">{formatMoney(row.igst)}</td>
                <td className="report-align-right"><strong>{formatMoney(row.totalGst)}</strong></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export interface ReportsPageProps {
  onOpenCustomerLedger?: (customerId: number) => void;
}

export function ReportsPage({ onOpenCustomerLedger }: ReportsPageProps) {
  const [reportType, setReportType] = useState<FinancialReportType>("sales_summary");
  const [preset, setPreset] = useState<ReportRangePreset>("this_month");
  const [range, setRange] = useState<ReportDateRange | null>(null);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [report, setReport] = useState<FinancialReportData | null>(null);
  const [reportLoading, setReportLoading] = useState(true);
  const [reportError, setReportError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<FinancialReportSort>("net_sales");
  const [outstandingOnly, setOutstandingOnly] = useState(true);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [nearExpiryDays, setNearExpiryDays] = useState(90);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printReport, setPrintReport] = useState<FinancialReportData | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersError, setSuppliersError] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<ExpiryHorizonDays>(30);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [expiry, setExpiry] = useState<ExpiryAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertsRefresh, setAlertsRefresh] = useState(0);
  const rangeSeq = useRef(0);

  useEffect(() => {
    let current = true;
    getStoreSettings().then((value) => {
      if (current) setSettings(value);
    }).catch(() => {
      if (current) setSettings(null);
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    getSuppliers().then((rows) => {
      if (current) {
        setSuppliers(rows);
        setSuppliersError(null);
      }
    }).catch((error: unknown) => {
      if (current) setSuppliersError(errorText(error, "Supplier list could not be loaded."));
    });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    setAlertsLoading(true);
    setAlertsError(null);
    Promise.all([getLowStockAlerts(), getExpiryAlerts(horizon)]).then(([stockRows, expiryRows]) => {
      if (!current) return;
      setLowStock(stockRows);
      setExpiry(expiryRows);
    }).catch((error: unknown) => {
      if (current) setAlertsError(errorText(error, "Inventory alerts could not be loaded."));
    }).finally(() => {
      if (current) setAlertsLoading(false);
    });
    return () => { current = false; };
  }, [horizon, alertsRefresh]);

  useEffect(() => {
    if (preset === "custom") return;
    const seq = ++rangeSeq.current;
    setRange(null);
    getReportDateRange(preset).then((nextRange) => {
      if (seq === rangeSeq.current) setRange(nextRange);
    }).catch((error: unknown) => {
      if (seq === rangeSeq.current) {
        setReportLoading(false);
        setReportError(errorText(error, "Date range could not be loaded."));
      }
    });
  }, [preset]);

  const request = useMemo(() => {
    if (!range && reportType !== "stock_valuation") return null;
    const usableRange = range ?? { startDate: "", endDate: "" };
    return buildRequest(reportType, usableRange, page, search.trim(), sortBy, outstandingOnly, supplierId, nearExpiryDays);
  }, [reportType, range, page, search, sortBy, outstandingOnly, supplierId, nearExpiryDays]);

  useEffect(() => {
    if (!request) {
      setReport(null);
      setReportLoading(preset !== "custom");
      return;
    }
    let current = true;
    setReportLoading(true);
    setReportError(null);
    setActionError(null);
    getFinancialReport(request).then((result) => {
      if (current) setReport(result);
    }).catch((error: unknown) => {
      if (current) {
        setReport(null);
        setReportError(errorText(error, "This report could not be loaded from the local database."));
      }
    }).finally(() => {
      if (current) setReportLoading(false);
    });
    return () => { current = false; };
  }, [request, refreshKey, preset]);

  const customRangeInvalid = preset === "custom" && (!customStart || !customEnd || customStart > customEnd);
  const visibleReport = printReport ?? report;
  const currentRange = visibleReport?.reportType === "stock_valuation"
    ? null
    : visibleReport && "range" in visibleReport.data ? visibleReport.data.range : range;
  const rowsTotal = visibleReport && "totalRows" in visibleReport.data ? visibleReport.data.totalRows : 0;
  const totalPages = visibleReport && "pageSize" in visibleReport.data
    ? Math.max(1, Math.ceil(visibleReport.data.totalRows / visibleReport.data.pageSize))
    : 1;
  const isPagedReport = isPaged(reportType);

  function choosePreset(value: ReportRangePreset) {
    setPreset(value);
    setPage(1);
    if (value === "custom") {
      setCustomStart(range?.startDate ?? "");
      setCustomEnd(range?.endDate ?? "");
    }
  }

  function setCustomDate(which: "start" | "end", value: string) {
    setPreset("custom");
    setPage(1);
    if (which === "start") setCustomStart(value);
    else setCustomEnd(value);
    const start = which === "start" ? value : customStart;
    const end = which === "end" ? value : customEnd;
    const seq = ++rangeSeq.current;
    setRange(null);
    if (start && end && start <= end) {
      setReportLoading(true);
      setReportError(null);
      getReportDateRange("custom", { startDate: start, endDate: end }).then((nextRange) => {
        if (seq === rangeSeq.current) setRange(nextRange);
      }).catch((error: unknown) => {
        if (seq === rangeSeq.current) {
          setReportLoading(false);
          setReportError(errorText(error, "Choose a valid custom date range."));
        }
      });
    }
  }

  function selectReport(type: FinancialReportType) {
    setReportType(type);
    setPage(1);
    setSearch("");
    setSortBy(type === "customer_due" || type === "supplier_due" ? "outstanding" : "net_sales");
    setSupplierId(null);
  }

  function startPrint(mode: PrintMode) {
    if (mode !== "main") {
      setPrintMode(mode);
      document.body.dataset.reportPrint = mode;
      const clear = () => {
        delete document.body.dataset.reportPrint;
        setPrintMode(null);
      };
      window.addEventListener("afterprint", clear, { once: true });
      window.setTimeout(() => window.print(), 80);
      window.setTimeout(clear, 1800);
      return;
    }
    if (!request) return;
    setActionError(null);
    setExportBusy(true);
    const completeRequest: FinancialReportRequest = "page" in request ? { ...request, page: 1 } : request;
    getCompleteFinancialReport(completeRequest).then((result) => {
      setPrintReport(result);
      setPrintMode("main");
      document.body.dataset.reportPrint = "main";
      const clear = () => {
        delete document.body.dataset.reportPrint;
        setPrintReport(null);
        setPrintMode(null);
      };
      window.addEventListener("afterprint", clear, { once: true });
      window.setTimeout(() => window.print(), 80);
      window.setTimeout(clear, 1800);
    }).catch((error: unknown) => {
      setActionError(errorText(error, "The complete report could not be prepared for printing."));
    }).finally(() => setExportBusy(false));
  }

  async function exportExcel() {
    if (!request || !settings) return;
    setActionError(null);
    setExportBusy(true);
    try {
      const completeRequest: FinancialReportRequest = "page" in request ? { ...request, page: 1 } : request;
      const fullReport = await getCompleteFinancialReport(completeRequest);
      await exportFinancialReportExcel(fullReport, settings);
    } catch (error) {
      setActionError(errorText(error, "Excel export could not be prepared."));
    } finally {
      setExportBusy(false);
    }
  }

  const selectedTitle = reportTitle(reportType);
  const dateCaption = rangeLabel(visibleReport, currentRange);
  const generatedLabel = formatDateTime(new Date().toISOString());
  const storeName = settings?.pharmacy_name.trim() || "MY MEDICAL";

  return (
    <section className="workspace-page reports-page" data-print-mode={printMode ?? undefined} data-testid="page-reports">
      <header className="workspace-page-header reports-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> LOCAL BUSINESS RECORDS</div>
          <h1>Reports</h1>
          <p>Clear records for trading, tax, stock and account follow-up.</p>
        </div>
        <div className="reports-assurance"><ShieldCheck size={15} /><span>Local data, no cloud dependency</span></div>
      </header>

      <div className="reports-layout">
        <aside className="reports-rail" aria-label="Report selection">
          <div className="reports-rail-heading"><span>REPORT LIBRARY</span><BarChart3 size={15} /></div>
          {["Trading", "Overview", "Inventory", "Analysis", "Balances", "Tax"].map((group) => (
            <div className="reports-nav-group" key={group}>
              <span className="reports-nav-label">{group}</span>
              {reportOptions.filter((item) => item.group === group).map((item) => (
                <button
                  aria-current={reportType === item.id ? "page" : undefined}
                  className={`reports-nav-item ${reportType === item.id ? "is-active" : ""}`}
                  data-testid={`button-report-type-${item.id}`}
                  key={item.id}
                  onClick={() => selectReport(item.id)}
                  type="button"
                >
                  <span>{item.title}</span>{reportType === item.id && <span className="reports-nav-mark" />}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className="reports-main">
          <section className="workspace-card reports-filter-card" aria-label="Report filters">
            <div className="reports-filter-top">
              <div className="reports-report-title">
                <span className="report-heading-icon"><CalendarDays size={17} /></span>
                <div><h2>{selectedTitle}</h2><p>{reportType === "stock_valuation" ? "Current stock position, valued as of the local report date." : "Choose a period and refine the records shown below."}</p></div>
              </div>
              <div className="reports-toolbar-actions">
                <button className="button button-secondary reports-action-button" data-testid="button-refresh-report" disabled={reportLoading || !request} onClick={() => setRefreshKey((key) => key + 1)} type="button"><RefreshCw size={14} /> Refresh</button>
                <button className="button button-secondary reports-action-button" data-testid="button-print-report" disabled={reportLoading || !report || exportBusy || customRangeInvalid} onClick={() => startPrint("main")} type="button"><Printer size={14} /> PDF / Print</button>
                <button className="button button-primary reports-action-button" data-testid="button-export-report-excel" disabled={reportLoading || !report || !settings || exportBusy || customRangeInvalid} onClick={() => void exportExcel()} type="button"><FileSpreadsheet size={14} /> {exportBusy ? "Preparing…" : "Excel"}</button>
              </div>
            </div>
            {reportType !== "stock_valuation" && (
              <div className="reports-filter-row">
                <div className="report-preset-list" role="group" aria-label="Report date range">
                  {presetOptions.map(({ value, label }) => (
                    <button aria-pressed={preset === value} className={`report-preset ${preset === value ? "is-selected" : ""}`} data-testid={`button-report-range-${value}`} key={value} onClick={() => choosePreset(value)} type="button">{label}</button>
                  ))}
                </div>
                {preset === "custom" && (
                  <div className="report-date-inputs">
                    <label>From<input aria-label="Report start date" className="workspace-input" data-testid="input-report-start-date" max={customEnd || undefined} onChange={(event) => setCustomDate("start", event.target.value)} type="date" value={customStart} /></label>
                    <span className="report-date-separator">to</span>
                    <label>Through<input aria-label="Report end date" className="workspace-input" data-testid="input-report-end-date" min={customStart || undefined} onChange={(event) => setCustomDate("end", event.target.value)} type="date" value={customEnd} /></label>
                  </div>
                )}
                <span className="reports-date-caption" data-testid="text-report-date-range">{range ? rangeLabel(null, range) : "Choose a valid range"}</span>
              </div>
            )}
            {(reportType === "purchase_summary" || reportType === "stock_valuation" || isPagedReport) && (
              <div className="reports-refine-row">
                {reportType === "purchase_summary" && (
                  <label className="report-select-label"><Filter size={14} /><span>Supplier</span>
                    <select className="report-select" data-testid="select-report-supplier" onChange={(event) => { setSupplierId(event.target.value ? Number(event.target.value) : null); setPage(1); }} value={supplierId ?? ""}>
                      <option value="">All suppliers</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                    </select>
                  </label>
                )}
                {reportType === "stock_valuation" && (
                  <label className="report-select-label"><CalendarDays size={14} /><span>Near-expiry window</span>
                    <select className="report-select" data-testid="select-near-expiry-days" onChange={(event) => setNearExpiryDays(Number(event.target.value))} value={nearExpiryDays}>
                      {[30, 60, 90, 180, 365].map((days) => <option key={days} value={days}>{days} days</option>)}
                    </select>
                  </label>
                )}
                {isPagedReport && (
                  <>
                    <label className="reports-search"><Search size={15} /><input aria-label={`Search ${selectedTitle}`} data-testid="input-report-search" onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={reportType.includes("due") ? "Search name or phone" : "Search medicine or company"} value={search} /></label>
                    <label className="report-select-label"><span>Sort</span>
                      <select className="report-select" data-testid="select-report-sort" onChange={(event) => { setSortBy(event.target.value as FinancialReportSort); setPage(1); }} value={sortBy}>
                        <option value="name">Name</option>
                        {(reportType === "product_sales" || reportType === "company_sales") && <><option value="quantity">Quantity</option><option value="net_sales">Net sales</option><option value="gross_profit">Gross profit</option></>}
                        {(reportType === "customer_due" || reportType === "supplier_due") && <option value="outstanding">Outstanding</option>}
                      </select>
                    </label>
                    {(reportType === "customer_due" || reportType === "supplier_due") && (
                      <label className="reports-check-filter"><input checked={outstandingOnly} data-testid="checkbox-outstanding-only" onChange={(event) => { setOutstandingOnly(event.target.checked); setPage(1); }} type="checkbox" /><span>Outstanding only</span></label>
                    )}
                  </>
                )}
              </div>
            )}
            {reportType === "purchase_summary" && suppliersError && <p className="reports-subtle-warning" role="status">{suppliersError}; showing all suppliers.</p>}
          </section>

          {customRangeInvalid && <div className="reports-alert reports-alert--warning" role="alert"><AlertCircle size={16} /> Set a start and end date, with the start on or before the end.</div>}
          {reportError && !customRangeInvalid && (
            <div className="reports-alert reports-alert--error" role="alert" data-testid="status-report-error">
              <AlertCircle size={16} /><span>{reportError}</span><button className="button button-secondary" data-testid="button-retry-report" onClick={() => setRefreshKey((key) => key + 1)} type="button"><RefreshCw size={14} /> Retry</button>
            </div>
          )}
          {actionError && <div className="reports-alert reports-alert--error" role="alert"><AlertCircle size={16} /><span>{actionError}</span><button aria-label="Dismiss message" className="reports-dismiss" onClick={() => setActionError(null)} type="button">Dismiss</button></div>}

          <section aria-label={`${selectedTitle} results`} className="report-result-surface" data-report-surface="main">
            {reportLoading && !customRangeInvalid ? (
              <div className="reports-loading" aria-busy="true" data-testid="loading-report">
                <div className="reports-loading-heading"><span /><span /></div>
                <div className="reports-loading-metrics">{[1, 2, 3, 4].map((item) => <span key={item} />)}</div>
                <div className="reports-loading-table"><span /><span /><span /><span /></div>
              </div>
            ) : reportError || customRangeInvalid ? null : visibleReport ? (
              <>
                <div className="reports-print-header">
                  <div className="reports-print-brand">{storeName}</div>
                  {settings?.address && <div>{settings.address}</div>}
                  <div>{[settings?.contact_number && `Phone: ${settings.contact_number}`, settings?.drug_license_number && `Drug licence: ${settings.drug_license_number}`].filter(Boolean).join("  |  ")}</div>
                  <h1>{reportTitle(visibleReport.reportType)}</h1>
                  <div>{rangeLabel(visibleReport, currentRange)}</div>
                  <div>Generated {generatedLabel}</div>
                  <div className="reports-print-summary">{summaryEntries(visibleReport).map(([label, value]) => <span key={label}><b>{label}</b> {value}</span>)}</div>
                </div>
                <div className="reports-result-heading">
                  <div><span className="report-section-kicker">REPORT SNAPSHOT</span><strong>{dateCaption}</strong></div>
                  <span className="reports-generated">Updated from local records · {generatedLabel}</span>
                </div>
                {renderReportBody(visibleReport, onOpenCustomerLedger)}
                {isPagedReport && (
                  <div className="reports-pagination no-print">
                    <span>{rowsTotal.toLocaleString("en-IN")} records · Page {page} of {totalPages}</span>
                    <div>
                      <button aria-label="Previous page" className="report-icon-action" data-testid="button-report-previous-page" disabled={page <= 1 || reportLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button"><ChevronLeft size={16} /></button>
                      <button aria-label="Next page" className="report-icon-action" data-testid="button-report-next-page" disabled={page >= totalPages || reportLoading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} type="button"><ChevronRight size={16} /></button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="reports-empty-state" data-testid="empty-report">
                <span className="reports-empty-icon"><BarChart3 size={22} /></span>
                <strong>No report records to show</strong>
                <span>Try a different date range or clear the search filter.</span>
              </div>
            )}
          </section>
        </main>
      </div>

      <section className="report-inventory-section" aria-label="Inventory alerts">
        <div className="report-inventory-heading">
          <div><span className="report-section-kicker">INVENTORY WATCH</span><h2>Stock that needs attention</h2><p>Local alerts from medicine batches and minimum stock levels.</p></div>
          <button className="button button-secondary reports-action-button" data-testid="button-refresh-inventory-alerts" disabled={alertsLoading} onClick={() => setAlertsRefresh((value) => value + 1)} type="button"><RefreshCw size={14} /> Refresh alerts</button>
        </div>
        {alertsError && (
          <div className="reports-alert reports-alert--error" role="alert" data-testid="status-inventory-alerts-error">
            <AlertCircle size={16} /><span>{alertsError}</span><button className="button button-secondary" data-testid="button-retry-inventory-alerts" onClick={() => setAlertsRefresh((value) => value + 1)} type="button"><RefreshCw size={14} /> Retry</button>
          </div>
        )}
        <div className="report-alert-grid">
          <section className="workspace-card report-alert-card" data-report-surface="low-stock" aria-labelledby="low-stock-title">
            <div className="report-alert-card-heading">
              <div className="report-card-title"><span className="report-heading-icon report-heading-icon--amber"><PackageSearch size={16} /></span><div><h3 id="low-stock-title">Low stock</h3><p>Below the set minimum quantity</p></div></div>
              <div className="report-actions no-print">
                <button aria-label="Export low stock as CSV" className="report-icon-action" data-testid="button-export-low-stock-csv" onClick={() => downloadCsv("my-medical-low-stock.csv", [["Medicine", "Generic name", "Company", "Rack", "Available stock", "Minimum stock"], ...lowStock.map((item) => [item.name, item.generic_name, item.company, item.rack_location, item.available_stock, item.min_stock_alert])])} disabled={alertsLoading || Boolean(alertsError)} type="button"><ArrowDownToLine size={15} /></button>
                <button aria-label="Print low stock report" className="report-icon-action" data-testid="button-print-low-stock" onClick={() => startPrint("low-stock")} disabled={alertsLoading || Boolean(alertsError)} type="button"><Printer size={15} /></button>
              </div>
            </div>
            <div className="reports-alert-print-header"><strong>{storeName}</strong>{settings?.address && <span>{settings.address}</span>}<span>{[settings?.contact_number && `Phone: ${settings.contact_number}`, settings?.drug_license_number && `Drug licence: ${settings.drug_license_number}`].filter(Boolean).join("  |  ")}</span><h2>Low stock</h2><span>As of {formatDate(new Date().toISOString())} · Generated {generatedLabel}</span><span>Medicines below minimum: {lowStock.length}</span></div>
            {alertsLoading ? <div className="report-list-loading" aria-busy="true" data-testid="loading-low-stock"><span /><span /><span /></div>
              : alertsError ? <p className="report-inline-error">Low stock alerts are unavailable.</p>
                : lowStock.length === 0 ? <div className="report-alert-empty" data-testid="empty-low-stock"><Check size={17} /><span>All medicines are at or above minimum stock.</span></div>
                  : <div className="report-alert-list">{lowStock.map((item) => (
                    <div className="report-alert-row" data-testid={`row-low-stock-${item.medicine_id}`} key={item.medicine_id}>
                      <div className="report-alert-main"><strong>{item.name}</strong><span>{item.generic_name || item.company || "Medicine"}{item.rack_location ? ` · Rack ${item.rack_location}` : ""}</span></div>
                      <div className="report-stock-quantity"><strong>{item.available_stock}</strong><span>of {item.min_stock_alert}</span></div>
                    </div>
                  ))}</div>}
          </section>
          <section className="workspace-card report-alert-card" data-report-surface="expiry" aria-labelledby="expiry-title">
            <div className="report-alert-card-heading report-expiry-heading">
              <div className="report-card-title"><span className="report-heading-icon report-heading-icon--amber"><CalendarDays size={16} /></span><div><h3 id="expiry-title">Expiry batches</h3><p>Expired or nearing expiry</p></div></div>
              <div className="report-alert-tools no-print">
                <label className="sr-only" htmlFor="expiry-horizon">Expiry horizon</label>
                <select id="expiry-horizon" aria-label="Expiry horizon" className="report-horizon-select" data-testid="select-expiry-horizon" onChange={(event) => setHorizon(Number(event.target.value) as ExpiryHorizonDays)} value={horizon}><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select>
                <button aria-label="Export expiry batches as CSV" className="report-icon-action" data-testid="button-export-expiry-csv" onClick={() => downloadCsv(`my-medical-expiry-${horizon}-days.csv`, [["Medicine", "Batch", "Expiry date", "Days until expiry", "Status", "Current stock"], ...expiry.map((item) => [item.medicine_name, item.batch.batch_no, item.batch.expiry_date, item.days_until_expiry, item.status, item.batch.current_stock])])} disabled={alertsLoading || Boolean(alertsError)} type="button"><ArrowDownToLine size={15} /></button>
                <button aria-label="Print expiry batches report" className="report-icon-action" data-testid="button-print-expiry" onClick={() => startPrint("expiry")} disabled={alertsLoading || Boolean(alertsError)} type="button"><Printer size={15} /></button>
              </div>
            </div>
            <div className="reports-alert-print-header"><strong>{storeName}</strong>{settings?.address && <span>{settings.address}</span>}<span>{[settings?.contact_number && `Phone: ${settings.contact_number}`, settings?.drug_license_number && `Drug licence: ${settings.drug_license_number}`].filter(Boolean).join("  |  ")}</span><h2>Expiry batches</h2><span>Within {horizon} days · as of {formatDate(new Date().toISOString())} · Generated {generatedLabel}</span><span>Batches in report: {expiry.length}</span></div>
            {alertsLoading ? <div className="report-list-loading" aria-busy="true" data-testid="loading-expiry"><span /><span /><span /></div>
              : alertsError ? <p className="report-inline-error">Expiry alerts are unavailable.</p>
                : expiry.length === 0 ? <div className="report-alert-empty" data-testid="empty-expiry"><Check size={17} /><span>No batches expire within {horizon} days.</span></div>
                  : <div className="report-alert-list report-alert-list--expiry">{expiry.map((item) => (
                    <div className="report-alert-row" data-testid={`row-expiry-${item.batch.id}`} key={item.batch.id}>
                      <div className="report-alert-main"><strong>{item.medicine_name}</strong><span>Batch {item.batch.batch_no} · Exp {formatDate(item.batch.expiry_date)}</span></div>
                      <div className={`report-expiry-status ${item.status === "expired" ? "is-expired" : ""}`}><strong>{item.status === "expired" ? "Expired" : `${item.days_until_expiry} days`}</strong><span>{item.batch.current_stock} units</span></div>
                    </div>
                  ))}</div>}
          </section>
        </div>
      </section>
    </section>
  );
}

function MetricGrid({ entries }: { entries: SummaryEntry[] }) {
  const emphasis = new Set(["Net sales", "Gross profit", "Stock at cost", "Net GST position"]);
  return (
    <div className={`reports-metrics ${entries.length > 5 ? "reports-metrics--wide" : ""}`} data-testid="report-summary">
      {entries.map(([label, value], index) => (
        <article
          className={`reports-metric ${index === 0 || emphasis.has(label) ? "is-emphasis" : ""} ${value.includes("·") ? "is-compound" : ""}`}
          key={label}
        >
          <span>{label}</span><strong>{value}</strong>
        </article>
      ))}
    </div>
  );
}

function renderReportBody(
  report: FinancialReportData,
  onOpenCustomerLedger?: (customerId: number) => void,
) {
  const summary = summaryEntries(report);
  switch (report.reportType) {
    case "sales_summary":
    case "purchase_summary":
      return (
        <>
          <MetricGrid entries={summary} />
          <div className="reports-table-card">
            <div className="report-table-heading"><div className="report-card-title"><div><h2>Transactions</h2><p>{report.data.totalRows.toLocaleString("en-IN")} records in the selected period</p></div></div></div>
            {report.data.rows.length ? <TransactionTable rows={report.data.rows} /> : <div className="report-table-empty">No transactions recorded in this period.</div>}
          </div>
        </>
      );
    case "profit_and_loss":
      return (
        <>
          <MetricGrid entries={summary} />
          {(report.data.cogs === null || report.data.grossProfit === null || report.data.netProfit === null) && (
            <div className="reports-note reports-note--amber"><CircleHelp size={15} /><span>Historical purchase cost snapshots are incomplete. Cost of goods and profit are shown as unavailable rather than estimated.</span></div>
          )}
          <p className="reports-definition">Net sales, COGS and profit exclude GST. Gross sales and sales returns follow the saved invoice totals, which include GST. Cancelled expenses are retained in the ledger and excluded from totals.</p>
          <div className="reports-table-card">
            <div className="report-table-heading"><div className="report-card-title"><div><h2>Product contribution</h2><p>Sales, costs and margins where source costs are available</p></div></div></div>
            {report.data.productRows.length ? <ProductRows rows={report.data.productRows} /> : <div className="report-table-empty">No product contribution in this period.</div>}
          </div>
        </>
      );
    case "expenses":
      return <ExpenseReportBody report={report.data} />;
    case "financial_summary":
      return (
        <>
          <MetricGrid entries={summary} />
          <div className="reports-note reports-note--amber">
            <CircleHelp size={15} />
            <span>Customer and supplier outstanding balances and stock valuation are current balances, not historical balances at the selected period end. Sales, COGS and profit exclude GST; saved historical costs are used.</span>
          </div>
        </>
      );
    case "stock_valuation":
      return (
        <>
          <MetricGrid entries={summary} />
          <div className="reports-note"><PackageSearch size={15} /><span>As-of valuation. This report is not filtered by date. Near-expiry threshold: {report.data.nearExpiryDays} days.</span></div>
          <div className="reports-table-card">
            <div className="report-table-heading"><div className="report-card-title"><div><h2>Batch valuation</h2><p>{report.data.totalRows.toLocaleString("en-IN")} batches in view</p></div></div></div>
            {report.data.rows.length ? <StockRows rows={report.data.rows} /> : <div className="report-table-empty">No stock batches to value.</div>}
          </div>
        </>
      );
    case "product_sales":
      return <><MetricGrid entries={summary} /><div className="reports-note"><TrendingUp size={15} /><span>Gross and net sales include GST. Taxable sales and profit exclude GST.</span></div><div className="reports-table-card"><div className="report-table-heading"><div className="report-card-title"><div><h2>Medicine sales</h2><p>{report.data.totalRows.toLocaleString("en-IN")} products matched</p></div></div></div>{report.data.rows.length ? <ProductRows rows={report.data.rows} /> : <div className="report-table-empty">No products match these filters.</div>}</div></>;
    case "company_sales":
      return <><MetricGrid entries={summary} /><div className="reports-note"><TrendingUp size={15} /><span>Gross and net sales include GST. Profit and margin use taxable sales excluding GST.</span></div><div className="reports-table-card"><div className="report-table-heading"><div className="report-card-title"><div><h2>Company sales</h2><p>{report.data.totalRows.toLocaleString("en-IN")} companies matched</p></div></div></div>{report.data.rows.length ? <CompanyRows rows={report.data.rows} /> : <div className="report-table-empty">No companies match these filters.</div>}</div></>;
    case "customer_due":
      return <><MetricGrid entries={summary} /><div className="reports-note reports-note--amber"><CircleHelp size={15} /><span>Credit and collections reflect the selected range. Outstanding is the current lifetime ledger balance. This report does not change balances.</span></div><div className="reports-table-card"><div className="report-table-heading"><div className="report-card-title"><div><h2>Customer balances</h2><p>Open a customer ledger to review the account history</p></div></div></div>{report.data.rows.length ? <CustomerRows rows={report.data.rows} onOpenCustomerLedger={onOpenCustomerLedger} /> : <div className="report-table-empty">No customers match these filters.</div>}</div></>;
    case "supplier_due":
      return <><MetricGrid entries={summary} /><div className="reports-note reports-note--amber"><CircleHelp size={15} /><span>Purchases, returns and payments reflect the selected range. Outstanding is the current lifetime balance.</span></div><div className="reports-table-card"><div className="report-table-heading"><div className="report-card-title"><div><h2>Supplier balances</h2><p>Current outstanding with activity in the selected period</p></div></div></div>{report.data.rows.length ? <SupplierRows rows={report.data.rows} /> : <div className="report-table-empty">No suppliers match these filters.</div>}</div></>;
    case "gst":
      return (
        <>
          <MetricGrid entries={summary} />
          <div className="reports-gst-halves">
            <article><span>Output tax · sales</span><strong>{formatMoney(report.data.totalOutputGst)}</strong><small>CGST {formatMoney(report.data.outputCgst)} · SGST {formatMoney(report.data.outputSgst)} · IGST {formatMoney(report.data.outputIgst)}</small></article>
            <article><span>Input tax · purchases</span><strong>{formatMoney(report.data.totalInputGst)}</strong><small>CGST {formatMoney(report.data.inputCgst)} · SGST {formatMoney(report.data.inputSgst)} · IGST {formatMoney(report.data.inputIgst)}</small></article>
          </div>
          <div className="reports-note"><CircleHelp size={15} /><span>Returns and voids retain their signed GST detail. Input and output tax are reported separately.</span></div>
          <div className="reports-gst-details"><GstDetailTable title="Sales GST detail" rows={report.data.salesRows} /><GstDetailTable title="Purchase GST detail" rows={report.data.purchaseRows} /></div>
        </>
      );
  }
}

function ExpenseReportBody({ report }: { report: ExpenseReport }) {
  return (
    <>
      <MetricGrid entries={summaryEntries({ reportType: "expenses", data: report })} />
      <div className="reports-breakdown-grid">
        <div className="reports-table-card">
          <div className="report-table-heading">
            <div className="report-card-title"><div><h2>Expense by category</h2><p>Active expenses only</p></div></div>
          </div>
          {report.categoryTotals.length ? (
            <div className="workspace-table-scroll reports-table-scroll">
              <table className="workspace-table reports-data-table">
                <thead><tr><th>Category</th><th className="report-align-right">Records</th><th className="report-align-right">Total</th></tr></thead>
                <tbody>{report.categoryTotals.map((item) => (
                  <tr key={item.categoryName} data-testid={`row-expense-category-${item.categoryName}`}>
                    <td><strong>{item.categoryName}</strong></td><td className="report-align-right">{item.count}</td><td className="report-align-right"><strong>{formatMoney(item.amount)}</strong></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <div className="report-table-empty">No active expenses in this period.</div>}
        </div>
        <div className="reports-table-card">
          <div className="report-table-heading">
            <div className="report-card-title"><div><h2>Expense by payment method</h2><p>Cash, bank, UPI and other</p></div></div>
          </div>
          <div className="workspace-table-scroll reports-table-scroll">
            <table className="workspace-table reports-data-table">
              <thead><tr><th>Payment method</th><th className="report-align-right">Records</th><th className="report-align-right">Total</th></tr></thead>
              <tbody>{report.paymentMethodTotals.map((item) => (
                <tr key={item.paymentMethod} data-testid={`row-expense-method-${item.paymentMethod.toLowerCase()}`}>
                  <td><strong>{paymentMethodLabel(item.paymentMethod)}</strong></td><td className="report-align-right">{item.count}</td><td className="report-align-right"><strong>{formatMoney(item.amount)}</strong></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="reports-breakdown-grid">
        <ExpensePeriodTable title="Daily expenses" rows={report.dailyTotals} />
        <ExpensePeriodTable title="Monthly expenses" rows={report.monthlyTotals} />
      </div>
      <div className="reports-table-card">
        <div className="report-table-heading">
          <div className="report-card-title"><div><h2>Expense ledger</h2><p>{report.totalRows.toLocaleString("en-IN")} records, including cancelled expenses</p></div></div>
        </div>
        {report.rows.length ? (
          <div className="workspace-table-scroll reports-table-scroll">
            <table className="workspace-table reports-data-table">
              <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="report-align-right">Amount</th><th>Payment</th><th>Reference</th><th>Status</th></tr></thead>
              <tbody>{report.rows.map((row) => (
                <tr key={row.id} className={row.status === "CANCELLED" ? "reports-expense-cancelled" : undefined} data-testid={`row-expense-report-${row.id}`}>
                  <td>{formatDate(row.expenseDate)}</td>
                  <td><strong>{row.categoryName}</strong></td>
                  <td>{row.description || "—"}</td>
                  <td className="report-align-right"><strong>{formatMoney(row.amount)}</strong></td>
                  <td>{paymentMethodLabel(row.paymentMethod)}</td>
                  <td>{row.referenceNumber || "—"}</td>
                  <td><span className={`reports-expense-status reports-expense-status--${row.status.toLowerCase()}`} data-testid={`status-expense-report-${row.id}`}>{row.status === "ACTIVE" ? "Active" : "Cancelled"}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="report-table-empty">No expense records in this period.</div>}
      </div>
      {report.rows.length < report.totalRows && (
        <div className="reports-note"><CircleHelp size={15} /><span>Showing the first {report.rows.length.toLocaleString("en-IN")} of {report.totalRows.toLocaleString("en-IN")} records. Export is limited to this report window.</span></div>
      )}
    </>
  );
}

function ExpensePeriodTable({ title, rows }: { title: string; rows: ExpensePeriodTotal[] }) {
  return (
    <div className="reports-table-card">
      <div className="report-table-heading">
        <div className="report-card-title"><div><h2>{title}</h2><p>Active expenses only</p></div></div>
      </div>
      {rows.length ? (
        <div className="workspace-table-scroll reports-table-scroll">
          <table className="workspace-table reports-data-table">
            <thead><tr><th>Period</th><th className="report-align-right">Records</th><th className="report-align-right">Total</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.period} data-testid={`row-expense-period-${item.period}`}>
                <td>{item.period}</td><td className="report-align-right">{item.count}</td><td className="report-align-right"><strong>{formatMoney(item.amount)}</strong></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <div className="report-table-empty">No active expenses in this period.</div>}
    </div>
  );
}

function paymentMethodLabel(method: "CASH" | "BANK" | "UPI" | "OTHER"): string {
  return method === "CASH" ? "Cash" : method === "BANK" ? "Bank" : method;
}

function ProductRows({ rows }: { rows: Array<{
  medicineId: number; medicineName: string; barcode: string | null; company: string | null;
  quantitySold: number; returnedQuantity: number; voidedQuantity: number; netQuantity: number;
  grossSales: number; returns: number; voidedSales: number; netSales: number; taxableSales: number;
  gst: number; cogs: number | null; grossProfit: number | null; marginPercent: number | null;
}> }) {
  return <div className="workspace-table-scroll reports-table-scroll"><table className="workspace-table reports-data-table"><thead><tr><th>Medicine</th><th>Company</th><th className="report-align-right">Sold</th><th className="report-align-right">Returned</th><th className="report-align-right">Voided</th><th className="report-align-right">Net qty</th><th className="report-align-right">Gross sales</th><th className="report-align-right">Returns</th><th className="report-align-right">Voids</th><th className="report-align-right">Net sales</th><th className="report-align-right">Taxable</th><th className="report-align-right">GST</th><th className="report-align-right">COGS</th><th className="report-align-right">Profit</th><th className="report-align-right">Margin</th></tr></thead><tbody>{rows.map((row) => <tr key={row.medicineId}><td><strong>{row.medicineName}</strong><small className="report-cell-sub">{row.barcode || "No barcode"}</small></td><td>{row.company || "—"}</td><td className="report-align-right">{row.quantitySold}</td><td className="report-align-right">{row.returnedQuantity}</td><td className="report-align-right">{row.voidedQuantity}</td><td className="report-align-right"><strong>{row.netQuantity}</strong></td><td className="report-align-right">{formatMoney(row.grossSales)}</td><td className="report-align-right">{formatMoney(row.returns)}</td><td className="report-align-right">{formatMoney(row.voidedSales)}</td><td className="report-align-right"><strong>{formatMoney(row.netSales)}</strong></td><td className="report-align-right">{formatMoney(row.taxableSales)}</td><td className="report-align-right">{formatMoney(row.gst)}</td><td className="report-align-right">{row.cogs === null ? "—" : formatMoney(row.cogs)}</td><td className="report-align-right">{row.grossProfit === null ? "—" : formatMoney(row.grossProfit)}</td><td className="report-align-right">{row.marginPercent === null ? "—" : `${row.marginPercent.toFixed(1)}%`}</td></tr>)}</tbody></table></div>;
}

function CompanyRows({ rows }: { rows: Array<{
  company: string; quantitySold: number; returnedQuantity: number; voidedQuantity: number; netQuantity: number;
  grossSales: number; returns: number; voidedSales: number; netSales: number; gst: number;
  cogs: number | null; grossProfit: number | null; marginPercent: number | null;
}> }) {
  return <div className="workspace-table-scroll reports-table-scroll"><table className="workspace-table reports-data-table"><thead><tr><th>Company</th><th className="report-align-right">Sold qty</th><th className="report-align-right">Returned</th><th className="report-align-right">Voided</th><th className="report-align-right">Net qty</th><th className="report-align-right">Gross sales</th><th className="report-align-right">Returns</th><th className="report-align-right">Voids</th><th className="report-align-right">Net sales</th><th className="report-align-right">GST</th><th className="report-align-right">COGS</th><th className="report-align-right">Profit</th><th className="report-align-right">Margin</th></tr></thead><tbody>{rows.map((row) => <tr key={row.company}><td><strong>{row.company}</strong></td><td className="report-align-right">{row.quantitySold}</td><td className="report-align-right">{row.returnedQuantity}</td><td className="report-align-right">{row.voidedQuantity}</td><td className="report-align-right"><strong>{row.netQuantity}</strong></td><td className="report-align-right">{formatMoney(row.grossSales)}</td><td className="report-align-right">{formatMoney(row.returns)}</td><td className="report-align-right">{formatMoney(row.voidedSales)}</td><td className="report-align-right"><strong>{formatMoney(row.netSales)}</strong></td><td className="report-align-right">{formatMoney(row.gst)}</td><td className="report-align-right">{row.cogs === null ? "—" : formatMoney(row.cogs)}</td><td className="report-align-right">{row.grossProfit === null ? "—" : formatMoney(row.grossProfit)}</td><td className="report-align-right">{row.marginPercent === null ? "—" : `${row.marginPercent.toFixed(1)}%`}</td></tr>)}</tbody></table></div>;
}

function StockRows({ rows }: { rows: Array<{
  medicineId: number; medicineName: string; company: string | null; barcode: string | null; batchNo: string;
  expiryDate: string; quantity: number; purchaseCost: number; mrp: number; saleRate: number;
  costValue: number; mrpValue: number; saleValue: number; stockStatus: "EXPIRED" | "NEAR_EXPIRY" | "LOW_STOCK" | "SELLABLE";
}> }) {
  return <div className="workspace-table-scroll reports-table-scroll"><table className="workspace-table reports-data-table"><thead><tr><th>Medicine</th><th>Company</th><th>Batch</th><th>Expiry</th><th>Status</th><th className="report-align-right">Qty</th><th className="report-align-right">Cost / unit</th><th className="report-align-right">MRP / unit</th><th className="report-align-right">Sale rate</th><th className="report-align-right">Cost value</th><th className="report-align-right">MRP value</th><th className="report-align-right">Sale value</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.medicineId}-${row.batchNo}-${index}`}><td><strong>{row.medicineName}</strong><small className="report-cell-sub">{row.barcode || "No barcode"}</small></td><td>{row.company || "—"}</td><td>{row.batchNo}</td><td>{formatDate(row.expiryDate)}</td><td><span className={`report-stock-status report-stock-status--${row.stockStatus.toLowerCase().replace("_", "-")}`}>{row.stockStatus.replace("_", " ")}</span></td><td className="report-align-right">{row.quantity}</td><td className="report-align-right">{formatMoney(row.purchaseCost)}</td><td className="report-align-right">{formatMoney(row.mrp)}</td><td className="report-align-right">{formatMoney(row.saleRate)}</td><td className="report-align-right"><strong>{formatMoney(row.costValue)}</strong></td><td className="report-align-right">{formatMoney(row.mrpValue)}</td><td className="report-align-right">{formatMoney(row.saleValue)}</td></tr>)}</tbody></table></div>;
}

function CustomerRows({ rows, onOpenCustomerLedger }: { rows: Array<{
  customerId: number; customerName: string; phone: string | null; totalCredit: number; totalPaid: number;
  outstandingBalance: number; lastTransactionDate: string | null;
}>; onOpenCustomerLedger?: (customerId: number) => void }) {
  return <div className="workspace-table-scroll reports-table-scroll"><table className="workspace-table reports-data-table"><thead><tr><th>Customer</th><th>Phone</th><th className="report-align-right">Credit in range</th><th className="report-align-right">Collected in range</th><th className="report-align-right">Current outstanding</th><th>Last transaction</th>{onOpenCustomerLedger && <th className="no-print">Ledger</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.customerId}><td><strong>{row.customerName}</strong></td><td>{row.phone || "—"}</td><td className="report-align-right">{formatMoney(row.totalCredit)}</td><td className="report-align-right">{formatMoney(row.totalPaid)}</td><td className="report-align-right"><strong>{formatMoney(row.outstandingBalance)}</strong></td><td>{row.lastTransactionDate ? formatDate(row.lastTransactionDate) : "—"}</td>{onOpenCustomerLedger && <td className="no-print"><button className="report-ledger-link" data-testid={`button-open-customer-ledger-${row.customerId}`} onClick={() => onOpenCustomerLedger(row.customerId)} type="button">View ledger</button></td>}</tr>)}</tbody></table></div>;
}

function SupplierRows({ rows }: { rows: Array<{
  supplierId: number; supplierName: string; contactPerson: string | null; phone: string | null;
  totalPurchases: number; purchaseReturns: number; payments: number; outstandingBalance: number; lastTransactionDate: string | null;
}> }) {
  return <div className="workspace-table-scroll reports-table-scroll"><table className="workspace-table reports-data-table"><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th className="report-align-right">Purchases</th><th className="report-align-right">Returns</th><th className="report-align-right">Payments</th><th className="report-align-right">Current outstanding</th><th>Last transaction</th></tr></thead><tbody>{rows.map((row) => <tr key={row.supplierId}><td><strong>{row.supplierName}</strong></td><td>{row.contactPerson || "—"}</td><td>{row.phone || "—"}</td><td className="report-align-right">{formatMoney(row.totalPurchases)}</td><td className="report-align-right">{formatMoney(row.purchaseReturns)}</td><td className="report-align-right">{formatMoney(row.payments)}</td><td className="report-align-right"><strong>{formatMoney(row.outstandingBalance)}</strong></td><td>{row.lastTransactionDate ? formatDate(row.lastTransactionDate) : "—"}</td></tr>)}</tbody></table></div>;
}