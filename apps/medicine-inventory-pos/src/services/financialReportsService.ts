import { invoke } from "@tauri-apps/api/core";
import type {
  FinancialReportData,
  FinancialReportRequest,
  PagedFinancialReportRequest,
  ReportDateRange,
  ReportRangePreset,
} from "../types/financialReports";

export async function getReportDateRange(
  preset: ReportRangePreset,
  custom?: Partial<ReportDateRange>,
): Promise<ReportDateRange> {
  if (
    preset === "custom" &&
    (!custom?.startDate || !custom.endDate || custom.startDate > custom.endDate)
  ) {
    throw new Error("Choose a valid custom range with a start date on or before the end date.");
  }
  return invoke<ReportDateRange>("get_report_date_range", {
    preset,
    customStartDate: custom?.startDate,
    customEndDate: custom?.endDate,
  });
}

function isValidDateRange(range: ReportDateRange): boolean {
  const isIsoDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  return (
    isIsoDate(range.startDate) &&
    isIsoDate(range.endDate) &&
    range.startDate <= range.endDate
  );
}

export async function getFinancialReport(
  request: FinancialReportRequest,
): Promise<FinancialReportData> {
  if ("range" in request && !isValidDateRange(request.range)) {
    throw new Error("Choose a valid report date range.");
  }
  if (
    request.reportType === "stock_valuation" &&
    (!Number.isInteger(request.nearExpiryDays) ||
      request.nearExpiryDays < 0 ||
      request.nearExpiryDays > 3650)
  ) {
    throw new Error("Near-expiry days must be between 0 and 3650.");
  }
  const result = await invoke<FinancialReportData>("get_financial_report", { request });
  if (result.reportType !== request.reportType) {
    throw new Error("The local database returned a different report than requested.");
  }
  return result;
}

function isPagedRequest(
  request: FinancialReportRequest,
): request is PagedFinancialReportRequest {
  return "page" in request;
}

function appendReportRows(
  current: FinancialReportData,
  next: FinancialReportData,
): FinancialReportData {
  if (current.reportType !== next.reportType) {
    throw new Error("The local database returned inconsistent report pages.");
  }
  switch (current.reportType) {
    case "product_sales":
      if (next.reportType !== "product_sales") break;
      return {
        ...current,
        data: { ...current.data, rows: [...current.data.rows, ...next.data.rows] },
      };
    case "company_sales":
      if (next.reportType !== "company_sales") break;
      return {
        ...current,
        data: { ...current.data, rows: [...current.data.rows, ...next.data.rows] },
      };
    case "customer_due":
      if (next.reportType !== "customer_due") break;
      return {
        ...current,
        data: { ...current.data, rows: [...current.data.rows, ...next.data.rows] },
      };
    case "supplier_due":
      if (next.reportType !== "supplier_due") break;
      return {
        ...current,
        data: { ...current.data, rows: [...current.data.rows, ...next.data.rows] },
      };
    default:
      return current;
  }
  throw new Error("The local database returned inconsistent report pages.");
}

export async function getCompleteFinancialReport(
  request: FinancialReportRequest,
): Promise<FinancialReportData> {
  const first = await getFinancialReport(request);
  if (!isPagedRequest(request)) return first;
  const data = first.data;
  if (
    !("totalRows" in data) ||
    !("pageSize" in data) ||
    !("page" in data)
  ) {
    return first;
  }
  const maxRows = Math.min(data.totalRows, 10_000);
  const pageSize = data.pageSize;
  let complete = first;
  for (let page = 2; (page - 1) * pageSize < maxRows; page += 1) {
    const next = await getFinancialReport({ ...request, page });
    complete = appendReportRows(complete, next);
  }
  return complete;
}