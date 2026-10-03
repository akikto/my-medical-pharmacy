import type { WeeklySalesDay, ISODate } from "../../types";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface DayPoint {
  date: ISODate;
  day: string;
  total: number;
  invoiceCount: number;
}

function toIsoLocal(date: Date): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as ISODate;
}

export function getWeekRange(value: string): { start: ISODate; end: ISODate } {
  const current = new Date(`${value}T00:00:00`);
  const offset = (current.getDay() + 6) % 7;
  current.setDate(current.getDate() - offset);
  const start = toIsoLocal(current);
  current.setDate(current.getDate() + 6);
  return { start, end: toIsoLocal(current) };
}

export function buildWeek(
  range: { start: ISODate; end: ISODate },
  saved: WeeklySalesDay[],
): DayPoint[] {
  const byDate = new Map(saved.map((row) => [row.sale_date, row]));
  const firstDay = new Date(`${range.start}T00:00:00`);
  return DAY_LABELS.map((day, index) => {
    const date = new Date(firstDay);
    date.setDate(firstDay.getDate() + index);
    const dateKey = toIsoLocal(date);
    const row = byDate.get(dateKey);
    return {
      date: dateKey,
      day,
      total: row?.total_sales ?? 0,
      invoiceCount: row?.invoice_count ?? 0,
    };
  });
}

export function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}