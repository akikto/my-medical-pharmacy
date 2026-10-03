import { BarChart3, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getWeeklySales } from "../../services/dashboardService";
import type { WeeklySalesDay, ISODate } from "../../types";
import { formatMoney } from "../../utils/money";
import "./weeklySales.css";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface WeeklySalesCardProps {
  date: string;
  onViewSales: () => void;
}

interface DayPoint {
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

function getWeekRange(value: string): { start: ISODate; end: ISODate } {
  const current = new Date(`${value}T00:00:00`);
  const offset = (current.getDay() + 6) % 7;
  current.setDate(current.getDate() - offset);
  const start = toIsoLocal(current);
  current.setDate(current.getDate() + 6);
  return { start, end: toIsoLocal(current) };
}

function buildWeek(range: { start: ISODate; end: ISODate }, saved: WeeklySalesDay[]): DayPoint[] {
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

function formatCompactMoney(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function chartScale(maximum: number): number {
  if (maximum <= 0) return 100;
  const power = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / power;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * power;
}

export function WeeklySalesCard({ date, onViewSales }: WeeklySalesCardProps) {
  const [rows, setRows] = useState<WeeklySalesDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const range = useMemo(() => getWeekRange(date), [date]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    void getWeeklySales(range.start, range.end)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Weekly sales could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.end, range.start, retryKey]);

  const points = useMemo(() => buildWeek(range, rows), [range, rows]);
  const weekTotal = points.reduce((total, point) => total + point.total, 0);
  const maxValue = chartScale(Math.max(...points.map((point) => point.total), 0));
  const plotTop = 24;
  const plotBottom = 153;
  const plotHeight = plotBottom - plotTop;
  const chartWidth = 700;
  const plotLeft = 64;
  const plotRight = chartWidth - 14;
  const groupWidth = (plotRight - plotLeft) / 7;

  return (
    <section className="dash-card dash-weekly-card" aria-labelledby="dash-weekly-sales-title" data-testid="card-weekly-sales">
      <div className="dash-card-header dash-weekly-header">
        <div className="dash-section-heading">
          <span className="dash-heading-mark dash-heading-mark--teal"><BarChart3 size={16} /></span>
          <div>
            <h2 id="dash-weekly-sales-title">Weekly sales</h2>
            <p>Monday–Sunday · {range.start} to {range.end}</p>
          </div>
        </div>
        <div className="dash-weekly-actions">
          <div className="dash-weekly-total">
            <span>This week</span>
            <strong data-testid="value-weekly-sales-total">{formatMoney(weekTotal)}</strong>
          </div>
          <button className="dash-text-link" data-testid="button-weekly-sales-history" onClick={onViewSales} type="button">
            View Sales
          </button>
        </div>
      </div>

      {loading ? (
        <div className="dash-weekly-status" role="status" data-testid="status-weekly-sales-loading">Loading saved sales…</div>
      ) : error ? (
        <div className="dash-weekly-error" role="alert" data-testid="status-weekly-sales-error">
          <span>{error}</span>
          <button className="dash-text-link" onClick={() => setRetryKey((key) => key + 1)} type="button">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : (
        <div className="dash-weekly-chart-wrap">
          <svg
            aria-label={`Weekly sales from Monday to Sunday. Total ${formatMoney(weekTotal)}.`}
            className="dash-weekly-chart"
            data-testid="chart-weekly-sales"
            role="img"
            viewBox={`0 0 ${chartWidth} 196`}
          >
            {[0, 1, 2, 3].map((step) => {
              const value = (maxValue * (3 - step)) / 3;
              const y = plotTop + (plotHeight * step) / 3;
              return (
                <g key={step}>
                  <line className="dash-weekly-gridline" x1={plotLeft} x2={plotRight} y1={y} y2={y} />
                  <text className="dash-weekly-axis-label" textAnchor="end" x={plotLeft - 9} y={y + 3}>
                    {formatCompactMoney(value)}
                  </text>
                </g>
              );
            })}
            {points.map((point, index) => {
              const barWidth = Math.min(38, groupWidth * 0.52);
              const height = (point.total / maxValue) * plotHeight;
              const x = plotLeft + index * groupWidth + (groupWidth - barWidth) / 2;
              const y = plotBottom - height;
              return (
                <g key={point.date} data-testid={`weekly-sales-day-${point.day.toLowerCase()}`}>
                  <title>{`${point.day}, ${point.date}: ${formatMoney(point.total)} across ${point.invoiceCount} ${point.invoiceCount === 1 ? "invoice" : "invoices"}`}</title>
                  <rect
                    className={point.total > 0 ? "dash-weekly-bar" : "dash-weekly-bar dash-weekly-bar--empty"}
                    data-value={point.total}
                    height={Math.max(2, height)}
                    rx="5"
                    width={barWidth}
                    x={x}
                    y={height > 0 ? y : plotBottom - 2}
                  />
                  <text className="dash-weekly-value-label" textAnchor="middle" x={x + barWidth / 2} y={Math.max(plotTop - 4, y - 7)}>
                    {formatCompactMoney(point.total)}
                  </text>
                  <text className="dash-weekly-day-label" textAnchor="middle" x={x + barWidth / 2} y={177}>
                    {point.day}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="dash-weekly-footnote">
            {points.some((point) => point.total > 0)
              ? "Sales totals come from invoices saved on this device."
              : "No saved sales this week. Each day is shown as ₹0."}
          </p>
        </div>
      )}
    </section>
  );
}