import type {
  ExpiryAlert,
  LowStockAlert,
  RecentSale,
  SalesReportSummary,
  StoreSettings,
} from "../types";
import { getLowStockAlerts, getExpiryAlerts } from "./inventoryService";
import { getRecentSales } from "./salesService";
import { getStoreSettings } from "./settingsService";
import { getSalesReportSummary } from "./reportsService";
import { invoke } from "@tauri-apps/api/core";

export interface DashboardInventorySummary {
  total_medicines: number;
  stock_value_at_cost: number;
  in_stock_medicines: number;
  low_stock_medicines: number;
  out_of_stock_medicines: number;
  total_suppliers: number;
}

export interface DashboardPurchaseSummary {
  total_amount: number;
  invoice_count: number;
}

export interface TopSellingMedicine {
  medicine_id: number;
  name: string;
  quantity_sold: number;
  line_sales_before_invoice_discount: number;
}

export interface DashboardSnapshot {
  date: string;
  inventory: DashboardInventorySummary;
  sales_today: SalesReportSummary;
  purchases_today: DashboardPurchaseSummary;
  recent_sales: RecentSale[];
  top_selling_medicines: TopSellingMedicine[];
  low_stock_alerts: LowStockAlert[];
  expiry_alerts: ExpiryAlert[];
  store_settings: StoreSettings;
}

interface DashboardInventorySummaryRow {
  total_medicines: number | string | null;
  stock_value_at_cost: number | string | null;
  in_stock_medicines: number | string | null;
  low_stock_medicines: number | string | null;
  out_of_stock_medicines: number | string | null;
  total_suppliers: number | string | null;
}

interface DashboardPurchaseSummaryRow {
  total_amount: number | string | null;
  invoice_count: number | string | null;
}

interface TopSellingMedicineRow {
  medicine_id: number | string;
  name: string;
  quantity_sold: number | string | null;
  line_sales_before_invoice_discount: number | string | null;
}

function toFiniteNumber(value: number | string | null, label: string): number {
  const result = Number(value ?? 0);
  if (!Number.isFinite(result)) {
    throw new Error(`The local database returned an invalid ${label}.`);
  }
  return result;
}

function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function getInventorySummary(): Promise<DashboardInventorySummary> {
  const row = await invoke<DashboardInventorySummaryRow>(
    "get_dashboard_inventory_summary",
  );

  return {
    total_medicines: toFiniteNumber(row.total_medicines, "medicine count"),
    stock_value_at_cost: toFiniteNumber(row.stock_value_at_cost, "stock value"),
    in_stock_medicines: toFiniteNumber(row.in_stock_medicines, "in-stock count"),
    low_stock_medicines: toFiniteNumber(row.low_stock_medicines, "low-stock count"),
    out_of_stock_medicines: toFiniteNumber(row.out_of_stock_medicines, "out-of-stock count"),
    total_suppliers: toFiniteNumber(row.total_suppliers, "supplier count"),
  };
}

async function getPurchaseSummary(today: string): Promise<DashboardPurchaseSummary> {
  const row = await invoke<DashboardPurchaseSummaryRow>(
    "get_dashboard_purchase_summary",
    { today },
  );
  return {
    total_amount: toFiniteNumber(row.total_amount, "purchase total"),
    invoice_count: toFiniteNumber(row.invoice_count, "purchase count"),
  };
}

async function getTopSellingMedicines(): Promise<TopSellingMedicine[]> {
  const rows = await invoke<TopSellingMedicineRow[]>("get_top_selling_medicines");

  return rows.map((row) => ({
    medicine_id: toFiniteNumber(row.medicine_id, "medicine id"),
    name: row.name,
    quantity_sold: toFiniteNumber(row.quantity_sold, "quantity sold"),
    line_sales_before_invoice_discount: toFiniteNumber(
      row.line_sales_before_invoice_discount,
      "item sales value",
    ),
  }));
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const today = toLocalIsoDate(new Date());
  const [
    inventory,
    sales_today,
    purchases_today,
    recent_sales,
    top_selling_medicines,
    low_stock_alerts,
    expiry_alerts,
    store_settings,
  ] = await Promise.all([
    getInventorySummary(),
    getSalesReportSummary(today, today),
    getPurchaseSummary(today),
    getRecentSales(5),
    getTopSellingMedicines(),
    getLowStockAlerts(),
    getExpiryAlerts(30),
    getStoreSettings(),
  ]);

  return {
    date: today,
    inventory,
    sales_today,
    purchases_today,
    recent_sales,
    top_selling_medicines,
    low_stock_alerts,
    expiry_alerts,
    store_settings,
  };
}