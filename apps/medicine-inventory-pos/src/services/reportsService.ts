import type {
  PaymentMode,
  SalesReport,
  SalesReportRow,
  SalesReportSummary,
} from "../types";
import { invoke } from "@tauri-apps/api/core";

interface RawSalesReportSummary {
  total_revenue: number | string | null;
  gross_profit: number | string | null;
  total_invoices: number | string | null;
  cash_revenue: number | string | null;
  cash_invoices: number | string | null;
  card_upi_revenue: number | string | null;
  card_upi_invoices: number | string | null;
  other_revenue: number | string | null;
  other_invoices: number | string | null;
  profit_unavailable_invoices: number | string | null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toFiniteNumber(value: number | string | null): number {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) {
    throw new Error("The local database returned an invalid report total.");
  }
  return result;
}

function mapSummary(row: RawSalesReportSummary): SalesReportSummary {
  return {
    total_revenue: toFiniteNumber(row.total_revenue),
    gross_profit: toFiniteNumber(row.gross_profit),
    total_invoices: toFiniteNumber(row.total_invoices),
    cash_revenue: toFiniteNumber(row.cash_revenue),
    cash_invoices: toFiniteNumber(row.cash_invoices),
    card_upi_revenue: toFiniteNumber(row.card_upi_revenue),
    card_upi_invoices: toFiniteNumber(row.card_upi_invoices),
    other_revenue: toFiniteNumber(row.other_revenue),
    other_invoices: toFiniteNumber(row.other_invoices),
    profit_unavailable_invoices: toFiniteNumber(row.profit_unavailable_invoices),
  };
}

function assertValidDateRange(startDate: string, endDate: string): void {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw new Error("Choose a valid report date range.");
  }
}

async function querySalesReportSummary(
  startDate: string,
  endDate: string,
): Promise<SalesReportSummary> {
  const rawSummary = await invoke<RawSalesReportSummary>(
    "get_sales_report_summary",
    { startDate, endDate },
  );
  return mapSummary(rawSummary);
}

export async function getSalesReportSummary(
  startDate: string,
  endDate: string,
): Promise<SalesReportSummary> {
  assertValidDateRange(startDate, endDate);
  return querySalesReportSummary(startDate, endDate);
}

export async function getSalesReport(
  startDate: string,
  endDate: string,
): Promise<SalesReport> {
  assertValidDateRange(startDate, endDate);

  const [summary, sales] = await Promise.all([
    querySalesReportSummary(startDate, endDate),
    invoke<SalesReportRow[]>("get_sales_report_rows", { startDate, endDate }),
  ]);

  return {
    summary,
    sales: sales.map((sale) => ({
      ...sale,
      id: Number(sale.id),
      payment_mode: sale.payment_mode as PaymentMode,
      grand_total: Number(sale.grand_total),
    })),
  };
}