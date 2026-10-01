import type {
  PaymentMode,
  SalesReport,
  SalesReportRow,
  SalesReportSummary,
} from "../types";
import { selectSql } from "./db";

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

export async function getSalesReport(
  startDate: string,
  endDate: string,
): Promise<SalesReport> {
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    throw new Error("Choose a valid report date range.");
  }

  const summaryRows = await selectSql<RawSalesReportSummary[]>(
    `WITH in_range AS (
       SELECT id, grand_total, flat_discount, payment_mode
       FROM sales
       WHERE date(created_at, 'localtime') BETWEEN $1 AND $2
     ),
     profit_by_sale AS (
       SELECT
         ranged.id,
         ranged.flat_discount,
         COUNT(item.id) AS line_count,
         COUNT(item.purchase_rate_at_sale) AS costed_line_count,
         COALESCE(SUM(item.total_price), 0) AS line_revenue,
         COALESCE(SUM(item.purchase_rate_at_sale * item.quantity), 0) AS purchase_cost
       FROM in_range AS ranged
       LEFT JOIN sale_items AS item ON item.sale_id = ranged.id
       GROUP BY ranged.id
     )
     SELECT
       COALESCE(SUM(ranged.grand_total), 0) AS total_revenue,
       COALESCE(SUM(
         CASE
           WHEN profit.line_count > 0
             AND profit.line_count = profit.costed_line_count
           THEN profit.line_revenue - profit.flat_discount - profit.purchase_cost
           ELSE 0
         END
       ), 0) AS gross_profit,
       COUNT(ranged.id) AS total_invoices,
       COALESCE(SUM(CASE WHEN ranged.payment_mode = 'CASH' THEN ranged.grand_total ELSE 0 END), 0)
         AS cash_revenue,
       COALESCE(SUM(CASE WHEN ranged.payment_mode = 'CASH' THEN 1 ELSE 0 END), 0)
         AS cash_invoices,
       COALESCE(SUM(
         CASE WHEN ranged.payment_mode IN ('UPI', 'CARD') THEN ranged.grand_total ELSE 0 END
       ), 0) AS card_upi_revenue,
       COALESCE(SUM(
         CASE WHEN ranged.payment_mode IN ('UPI', 'CARD') THEN 1 ELSE 0 END
       ), 0) AS card_upi_invoices,
       COALESCE(SUM(
         CASE WHEN ranged.payment_mode IN ('CREDIT', 'OTHER') THEN ranged.grand_total ELSE 0 END
       ), 0) AS other_revenue,
       COALESCE(SUM(
         CASE WHEN ranged.payment_mode IN ('CREDIT', 'OTHER') THEN 1 ELSE 0 END
       ), 0) AS other_invoices,
       COALESCE(SUM(
         CASE
           WHEN profit.line_count > profit.costed_line_count THEN 1
           ELSE 0
         END
       ), 0) AS profit_unavailable_invoices
     FROM in_range AS ranged
     LEFT JOIN profit_by_sale AS profit ON profit.id = ranged.id`,
    [startDate, endDate],
  );

  const sales = await selectSql<SalesReportRow[]>(
    `SELECT
       id,
       invoice_no,
       customer_name,
       payment_mode,
       grand_total,
       created_at
     FROM sales
     WHERE date(created_at, 'localtime') BETWEEN $1 AND $2
     ORDER BY created_at DESC, id DESC`,
    [startDate, endDate],
  );

  const rawSummary = summaryRows[0];
  if (!rawSummary) {
    throw new Error("The local database did not return a report summary.");
  }

  return {
    summary: mapSummary(rawSummary),
    sales: sales.map((sale) => ({
      ...sale,
      id: Number(sale.id),
      payment_mode: sale.payment_mode as PaymentMode,
      grand_total: Number(sale.grand_total),
    })),
  };
}