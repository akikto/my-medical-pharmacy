import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Boxes,
  Bell,
  ClipboardList,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  Database,
  PackagePlus,
  Pill,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { getDashboardSnapshot } from "../../services/dashboardService";
import type { DashboardSnapshot } from "../../services/dashboardService";
import { WeeklySalesCard } from "./WeeklySalesCard";
import { searchMedicines } from "../../services/inventoryService";
import type {
  AppSection,
  ExpiryAlert,
  LowStockAlert,
  MedicineSearchResult,
  RecentSale,
} from "../../types";
import { formatDateTime, formatMoney } from "../../utils/money";
import "./dashboard.css";

interface DashboardPageProps {
  onNavigate: (section: AppSection, initialSaleSearch?: string) => void;
  isActive: boolean;
}

const quickActions: Array<{
  id: string;
  label: string;
  detail: string;
  section: AppSection;
  icon: typeof ShoppingCart;
  tone: string;
}> = [
  { id: "pos", label: "New sale", detail: "Open counter billing", section: "pos", icon: ShoppingCart, tone: "blue" },
  { id: "inventory", label: "Add medicine", detail: "Open medicine list", section: "medicine-list", icon: PackagePlus, tone: "teal" },
  { id: "purchases", label: "Purchase entry", detail: "Receive stock", section: "purchases", icon: ShoppingBag, tone: "violet" },
  { id: "suppliers", label: "Suppliers", detail: "View supplier records", section: "suppliers", icon: Truck, tone: "amber" },
  { id: "settings", label: "Backup settings", detail: "Manage backups", section: "settings", icon: Database, tone: "slate" },
  { id: "orders", label: "Today's order list", detail: "Prepare a wholesaler order", section: "orders", icon: ClipboardList, tone: "green" },
  { id: "supplier-contacts", label: "Wholesalers & contacts", detail: "Find supplier contact options", section: "suppliers", icon: Truck, tone: "cyan" },
  { id: "reset-data", label: "Reset accounts/data", detail: "Protected business-data reset", section: "settings", icon: ShieldCheck, tone: "rose" },
];

function localDateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
        weekday: "long",
      }).format(date);
}

function expiryLabel(alert: ExpiryAlert): string {
  if (alert.status === "expired" || alert.days_until_expiry < 0) return "Expired";
  if (alert.days_until_expiry === 0) return "Expires today";
  if (alert.days_until_expiry === 1) return "1 day left";
  return `${alert.days_until_expiry} days left`;
}

function stockSeverity(alert: LowStockAlert): "out" | "low" {
  return alert.available_stock <= 0 ? "out" : "low";
}

function EmptyList({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="dash-empty-list">
      <span className="dash-empty-check" aria-hidden="true"><Check size={15} /></span>
      <div><strong>{title}</strong><span>{detail}</span></div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="dash-skeleton" aria-label="Loading dashboard" role="status" data-testid="status-dashboard-loading">
      <div className="dash-skeleton-heading">
        <span className="dash-skeleton-line dash-skeleton-line--title" />
        <span className="dash-skeleton-line dash-skeleton-line--copy" />
      </div>
      <div className="dash-skeleton-metrics">
        {[0, 1, 2, 3].map((item) => <span className="dash-skeleton-card" key={item} />)}
      </div>
      <div className="dash-skeleton-body"><span /><span /></div>
    </div>
  );
}

function RecentSaleRow({ sale }: { sale: RecentSale }) {
  const paymentLabel = sale.sale.payment_mode === "UPI" ? "UPI" : sale.sale.payment_mode === "CARD" ? "Card" : sale.sale.payment_mode === "CASH" ? "Cash" : sale.sale.payment_mode;

  return (
    <div className="dash-recent-row" data-testid={`row-recent-sale-${sale.sale.id}`}>
      <div className="dash-recent-invoice">
        <strong>{sale.sale.invoice_no}</strong>
        <span>{formatDateTime(sale.sale.created_at)}</span>
      </div>
      <div className="dash-recent-customer">
        <strong>{sale.sale.customer_name?.trim() || "Walk-in customer"}</strong>
        <span>{sale.item_count} {sale.item_count === 1 ? "item" : "items"} · {paymentLabel}</span>
      </div>
      <strong className="dash-recent-total" data-testid={`value-recent-sale-${sale.sale.id}`}>{formatMoney(sale.sale.grand_total)}</strong>
    </div>
  );
}

export function DashboardPage({ onNavigate, isActive }: DashboardPageProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MedicineSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const hasLoadedSnapshot = useRef(false);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    setLoading(!hasLoadedSnapshot.current);
    setLoadError(null);
    void getDashboardSnapshot()
      .then((data) => {
        if (!cancelled) {
          hasLoadedSnapshot.current = true;
          setSnapshot(data);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "The local pharmacy database could not be read.");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [isActive, reloadKey]);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!isActive || debouncedQuery.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      setActiveResult(0);
      if (!isActive) setSearchOpen(false);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    void searchMedicines(debouncedQuery, 8)
      .then((results) => {
        if (!cancelled) {
          setSearchResults(results);
          setActiveResult(0);
          setSearchLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSearchError(error instanceof Error ? error.message : "Medicine search is unavailable.");
          setSearchResults([]);
          setSearchLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [debouncedQuery, isActive]);

  const pharmacyName = snapshot?.store_settings.pharmacy_name.trim() || "MY MEDICAL";
  const formattedNow = useMemo(() => ({
    date: new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).format(now),
    time: new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }).format(now),
  }), [now]);

  const chooseMedicine = (result: MedicineSearchResult) => {
    setQuery("");
    setSearchOpen(false);
    onNavigate("pos", result.medicine.name);
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && searchResults.length > 0) {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((index) => (index + 1) % searchResults.length);
    } else if (event.key === "ArrowUp" && searchResults.length > 0) {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((index) => (index - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === "Enter" && searchOpen && searchResults[activeResult]) {
      event.preventDefault();
      chooseMedicine(searchResults[activeResult]);
    } else if (event.key === "Escape") {
      setSearchOpen(false);
      setActiveResult(0);
    }
  };

  if (loading && !snapshot) return <div className="dashboard-page"><DashboardSkeleton /></div>;

  if (loadError && !snapshot) {
    return (
      <div className="dashboard-page">
        <section className="dash-load-error" role="alert" data-testid="status-dashboard-error">
          <div className="dash-error-icon"><Database size={21} /></div>
          <span className="dash-eyebrow">LOCAL WORKSPACE</span>
          <h1>Dashboard could not load</h1>
          <p>{loadError}</p>
          <div className="dash-error-note"><CircleAlert size={15} /> Local database status is unconfirmed until data loads successfully.</div>
          <button className="dash-button dash-button--primary" type="button" data-testid="button-dashboard-retry" onClick={() => setReloadKey((key) => key + 1)}>
            <RefreshCw size={15} /> Try again
          </button>
        </section>
      </div>
    );
  }

  if (!snapshot) return null;

  const { inventory, sales_today: sales, purchases_today: purchases } = snapshot;
  const lowAlerts = snapshot.low_stock_alerts;
  const expiryAlerts = snapshot.expiry_alerts;
  const stockTotal = inventory.in_stock_medicines + inventory.low_stock_medicines + inventory.out_of_stock_medicines;
  const stockPct = stockTotal > 0 ? {
    in: (inventory.in_stock_medicines / stockTotal) * 100,
    low: (inventory.low_stock_medicines / stockTotal) * 100,
  } : { in: 0, low: 0 };
  const stockRing = stockTotal > 0
    ? `conic-gradient(#1681df 0 ${stockPct.in}%, #e6a744 ${stockPct.in}% ${stockPct.in + stockPct.low}%, #db6463 ${stockPct.in + stockPct.low}% 100%)`
    : "conic-gradient(#e5edf5 0 100%)";
  const totalAlerts = lowAlerts.length + expiryAlerts.length;
  const hasNoMedicines = inventory.total_medicines === 0;

  return (
    <div className="dashboard-page">
      <header className="dash-header">
        <div className="dash-heading">
          <div className="dash-eyebrow"><span className="dash-eyebrow-dot" /> PHARMACY OVERVIEW</div>
          <h1>Good day, <span>{pharmacyName}</span></h1>
          <p>Your counter at a glance. Keep the essentials moving.</p>
        </div>
        <div className="dash-header-tools">
          <div className="dash-clock" data-testid="value-current-datetime">
            <span className="dash-clock-icon"><CalendarDays size={17} /></span>
            <span><strong>{formattedNow.date}</strong><small><Clock3 size={12} /> {formattedNow.time}</small></span>
          </div>
          <button
            aria-label={`Open inventory alerts. ${totalAlerts} active stock and expiry alerts`}
            className="dash-header-alerts"
            data-testid="button-active-alerts"
            onClick={() => onNavigate("inventory")}
            type="button"
          >
            <Bell size={16} />
            <span>Alerts</span>
            <strong data-testid="value-header-alert-count">{totalAlerts}</strong>
          </button>
          <div className="dash-search-wrap">
            <Search className="dash-search-icon" size={17} aria-hidden="true" />
            <input
              aria-activedescendant={searchOpen && searchResults[activeResult] ? `dash-search-option-${searchResults[activeResult].medicine.id}` : undefined}
              aria-autocomplete="list"
              aria-controls="dash-medicine-results"
              aria-expanded={searchOpen && query.trim().length >= 2}
              aria-label="Search medicines"
              autoComplete="off"
              data-testid="input-dashboard-medicine-search"
              onBlur={() => window.setTimeout(() => setSearchOpen(false), 100)}
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Find a medicine to bill…"
              role="combobox"
              value={query}
            />
            {query && (
              <button className="dash-search-clear" type="button" aria-label="Clear medicine search" data-testid="button-clear-medicine-search" onClick={() => { setQuery(""); setSearchOpen(false); }}>
                <X size={15} />
              </button>
            )}
            {searchOpen && query.trim().length >= 2 && (
              <div className="dash-search-popover" id="dash-medicine-results" role="listbox" aria-label="Medicine search results">
                {searchLoading ? <div className="dash-search-message" role="status">Searching local medicine list…</div>
                  : searchError ? <div className="dash-search-message dash-search-message--error" role="alert">{searchError}</div>
                    : searchResults.length === 0 ? <div className="dash-search-message">No matching medicines found.</div>
                      : searchResults.map((result, index) => (
                        <button
                          aria-selected={index === activeResult}
                          className={`dash-search-result ${index === activeResult ? "is-active" : ""}`}
                          data-testid={`option-medicine-search-${result.medicine.id}`}
                          id={`dash-search-option-${result.medicine.id}`}
                          key={result.medicine.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveResult(index)}
                          onClick={() => chooseMedicine(result)}
                          role="option"
                          type="button"
                        >
                          <span className="dash-search-pill"><Pill size={15} /></span>
                          <span className="dash-search-result-main"><strong>{result.medicine.name}</strong><small>{result.medicine.generic_name || result.medicine.company || "Medicine"}</small></span>
                          <span className="dash-search-result-stock">{result.available_stock} <small>in stock</small></span>
                          <ArrowRight size={15} className="dash-search-result-arrow" />
                        </button>
                      ))}
                <div className="dash-search-hint"><kbd>↑</kbd><kbd>↓</kbd> to browse <kbd>Enter</kbd> to bill</div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="dash-local-status" data-testid="status-local-database">
        <span className="dash-local-status-dot" />
        <Database size={14} aria-hidden="true" />
        <strong>{loadError ? "Last refresh failed" : loading ? "Refreshing local database" : "Local database ready"}</strong>
        <span>{loadError ? "Showing the last successfully loaded snapshot" : loading ? "Reading pharmacy data from this device" : "Most recent read succeeded on this device"}</span>
        <button type="button" aria-label="Refresh dashboard data" data-testid="button-refresh-dashboard" onClick={() => setReloadKey((key) => key + 1)} disabled={loading}>
          <RefreshCw size={13} className={loading ? "dash-spin" : ""} /> {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>
      {loadError && (
        <div className="dash-refresh-error" role="alert" data-testid="status-dashboard-refresh-error">
          <CircleAlert size={15} />
          <span>Could not refresh dashboard data: {loadError}</span>
          <button type="button" data-testid="button-retry-dashboard-refresh" onClick={() => setReloadKey((key) => key + 1)}>Retry</button>
        </div>
      )}

      {hasNoMedicines && (
        <div className="dash-first-use" data-testid="status-empty-inventory">
          <div><strong>Your medicine list is ready to begin.</strong><span>Add the medicines and batches you keep at this counter.</span></div>
          <button className="dash-button dash-button--primary" type="button" data-testid="button-add-first-medicine" onClick={() => onNavigate("inventory")}><Plus size={15} /> Add medicine</button>
        </div>
      )}

      <section className="dash-metrics" aria-label="Today's pharmacy summary">
        <article className="dash-metric dash-metric--medicines" data-testid="card-metric-medicines">
          <div className="dash-metric-top"><span className="dash-metric-icon"><Pill size={18} /></span><span className="dash-metric-caption">CATALOGUE</span></div>
          <strong className="dash-metric-value" data-testid="value-total-medicines">{inventory.total_medicines.toLocaleString("en-IN")}</strong>
          <span className="dash-metric-label">Total medicines</span>
          <span className="dash-metric-foot">{inventory.in_stock_medicines.toLocaleString("en-IN")} currently in stock</span>
        </article>
        <article className="dash-metric dash-metric--value" data-testid="card-metric-stock-value">
          <div className="dash-metric-top"><span className="dash-metric-icon"><Boxes size={18} /></span><span className="dash-metric-caption">INVENTORY</span></div>
          <strong className="dash-metric-value dash-metric-value--money" data-testid="value-stock-at-cost">{formatMoney(inventory.stock_value_at_cost)}</strong>
          <span className="dash-metric-label">Stock value at purchase cost</span>
          <span className="dash-metric-foot">Unexpired, sellable units</span>
        </article>
        <article className="dash-metric dash-metric--sales" data-testid="card-metric-sales">
          <div className="dash-metric-top"><span className="dash-metric-icon"><Wallet size={18} /></span><span className="dash-metric-caption">TODAY · {localDateLabel(snapshot.date).split(",")[1]?.trim() || snapshot.date}</span></div>
          <strong className="dash-metric-value dash-metric-value--money" data-testid="value-sales-today">{formatMoney(sales.total_revenue)}</strong>
          <span className="dash-metric-label">Sales today</span>
          <span className="dash-metric-foot">{sales.total_invoices.toLocaleString("en-IN")} {sales.total_invoices === 1 ? "invoice" : "invoices"}</span>
        </article>
        <article className="dash-metric dash-metric--purchases" data-testid="card-metric-purchases">
          <div className="dash-metric-top"><span className="dash-metric-icon"><ShoppingBag size={18} /></span><span className="dash-metric-caption">TODAY</span></div>
          <strong className="dash-metric-value dash-metric-value--money" data-testid="value-purchases-today">{formatMoney(purchases.total_amount)}</strong>
          <span className="dash-metric-label">Purchases today</span>
          <span className="dash-metric-foot">{purchases.invoice_count.toLocaleString("en-IN")} {purchases.invoice_count === 1 ? "entry" : "entries"}</span>
        </article>
      </section>

      <section className="dash-quick-actions" aria-labelledby="dash-quick-title">
        <div className="dash-section-heading dash-section-heading--compact">
          <div><span className="dash-heading-mark"><Activity size={16} /></span><div><h2 id="dash-quick-title">Quick actions</h2><p>Common counter tasks</p></div></div>
        </div>
        <div className="dash-action-row">
          {quickActions.map(({ id, label, detail, section, icon: Icon, tone }) => (
            <button className={`dash-action dash-action--${tone}`} data-testid={`button-quick-${id}`} key={id} onClick={() => onNavigate(section)} type="button">
              <span className={`dash-action-icon dash-action-icon--${tone}`}><Icon size={17} /></span>
              <span><strong>{label}</strong><small>{detail}</small></span>
              <ArrowRight className="dash-action-arrow" size={15} />
            </button>
          ))}
        </div>
      </section>

      <WeeklySalesCard date={snapshot.date} onViewSales={() => onNavigate("sales")} />

      <div className="dash-main-grid">
        <div className="dash-column dash-column--activity">
          <section className="dash-card dash-recent-card" aria-labelledby="dash-recent-title">
            <div className="dash-card-header">
              <div className="dash-section-heading">
                <span className="dash-heading-mark dash-heading-mark--teal"><Clock3 size={16} /></span>
                <div><h2 id="dash-recent-title">Recent sales</h2><p>Latest invoices recorded on this device</p></div>
              </div>
              <button className="dash-text-link" data-testid="button-recent-sales-pos" onClick={() => onNavigate("pos")} type="button">Go to billing <ArrowRight size={14} /></button>
            </div>
            {snapshot.recent_sales.length > 0 ? (
              <div className="dash-recent-list">{snapshot.recent_sales.map((sale) => <RecentSaleRow key={sale.sale.id} sale={sale} />)}</div>
            ) : (
              <EmptyList title="No sales recorded yet" detail="Completed bills will appear here." />
            )}
          </section>

          <section className="dash-card dash-today-card" aria-labelledby="dash-today-title">
            <div className="dash-card-header">
              <div className="dash-section-heading">
                <span className="dash-heading-mark dash-heading-mark--blue"><Wallet size={16} /></span>
                <div><h2 id="dash-today-title">Today’s summary</h2><p>{localDateLabel(snapshot.date)}</p></div>
              </div>
            </div>
            <div className="dash-summary-lines">
              <div className="dash-summary-row"><span>Sales revenue</span><strong data-testid="value-summary-revenue">{formatMoney(sales.total_revenue)}</strong></div>
              <div className="dash-summary-row"><span>Gross profit</span><strong data-testid="value-gross-profit">{formatMoney(sales.gross_profit)}</strong></div>
              <div className="dash-profit-note">
                <span>Gross profit is based on saved sale-time purchase costs.</span>
                {sales.profit_unavailable_invoices > 0 && <strong data-testid="value-profit-unavailable">{sales.profit_unavailable_invoices} {sales.profit_unavailable_invoices === 1 ? "invoice" : "invoices"} excluded: cost unavailable</strong>}
              </div>
              <div className="dash-summary-row"><span>Cash</span><strong data-testid="value-cash-revenue">{formatMoney(sales.cash_revenue)}</strong></div>
              <div className="dash-summary-row"><span>Card &amp; UPI</span><strong data-testid="value-card-upi-revenue">{formatMoney(sales.card_upi_revenue)}</strong></div>
              {sales.other_invoices > 0 && <div className="dash-summary-row"><span>Other payments</span><strong data-testid="value-other-revenue">{formatMoney(sales.other_revenue)}</strong></div>}
              <div className="dash-payment-count">{sales.cash_invoices} cash · {sales.card_upi_invoices} card/UPI{sales.other_invoices > 0 ? ` · ${sales.other_invoices} other` : ""} invoices</div>
            </div>
            <button className="dash-summary-link" data-testid="button-summary-reports" onClick={() => onNavigate("reports")} type="button">See sales reports <ArrowRight size={14} /></button>
          </section>
        </div>

        <div className="dash-column dash-column--inventory">
          <section className="dash-card dash-stock-card" aria-labelledby="dash-stock-title">
            <div className="dash-card-header">
              <div className="dash-section-heading">
                <span className="dash-heading-mark dash-heading-mark--blue"><Boxes size={16} /></span>
                <div><h2 id="dash-stock-title">Stock overview</h2><p>Sellable stock across your medicine catalogue</p></div>
              </div>
              <button className="dash-text-link" data-testid="button-stock-open-inventory" onClick={() => onNavigate("inventory")} type="button">Open inventory <ArrowRight size={14} /></button>
            </div>
            <div className="dash-stock-overview">
              <div className="dash-donut-wrap">
                <div className="dash-donut" style={{ background: stockRing }} role="img" aria-label={`${inventory.in_stock_medicines} in stock, ${inventory.low_stock_medicines} low stock, ${inventory.out_of_stock_medicines} out of stock`}>
                  <div className="dash-donut-hole"><strong data-testid="value-stock-total">{inventory.total_medicines.toLocaleString("en-IN")}</strong><span>medicines</span></div>
                </div>
              </div>
              <div className="dash-stock-legend">
                <div className="dash-stock-legend-row"><span className="dash-legend-label"><i className="dash-legend-dot dash-legend-dot--in" />In stock</span><strong data-testid="value-stock-in">{inventory.in_stock_medicines.toLocaleString("en-IN")}</strong><small>{stockTotal ? `${((inventory.in_stock_medicines / stockTotal) * 100).toFixed(1)}%` : "—"}</small></div>
                <div className="dash-stock-legend-row"><span className="dash-legend-label"><i className="dash-legend-dot dash-legend-dot--low" />Low stock</span><strong data-testid="value-stock-low">{inventory.low_stock_medicines.toLocaleString("en-IN")}</strong><small>{stockTotal ? `${((inventory.low_stock_medicines / stockTotal) * 100).toFixed(1)}%` : "—"}</small></div>
                <div className="dash-stock-legend-row"><span className="dash-legend-label"><i className="dash-legend-dot dash-legend-dot--out" />Out of stock</span><strong data-testid="value-stock-out">{inventory.out_of_stock_medicines.toLocaleString("en-IN")}</strong><small>{stockTotal ? `${((inventory.out_of_stock_medicines / stockTotal) * 100).toFixed(1)}%` : "—"}</small></div>
              </div>
            </div>
          </section>

          <section className="dash-card dash-top-card" aria-labelledby="dash-top-title">
            <div className="dash-card-header">
              <div className="dash-section-heading">
                <span className="dash-heading-mark dash-heading-mark--violet"><ArrowUpRight size={16} /></span>
                <div><h2 id="dash-top-title">Top-selling medicines</h2><p>Sales over the last 30 days</p></div>
              </div>
              <button className="dash-text-link" data-testid="button-top-selling-reports" onClick={() => onNavigate("reports")} type="button">View reports <ArrowRight size={14} /></button>
            </div>
            <div className="dash-top-note">Item sales value is before invoice-wide discount; that discount is not allocated per medicine.</div>
            {snapshot.top_selling_medicines.length > 0 ? (
              <div className="dash-top-list">
                {snapshot.top_selling_medicines.map((medicine, index) => (
                  <div className="dash-top-row" key={medicine.medicine_id} data-testid={`row-top-selling-${medicine.medicine_id}`}>
                    <span className="dash-top-rank">{String(index + 1).padStart(2, "0")}</span>
                    <strong>{medicine.name}</strong>
                    <span className="dash-top-quantity">{medicine.quantity_sold.toLocaleString("en-IN")} sold</span>
                    <span className="dash-top-sales" data-testid={`value-top-selling-${medicine.medicine_id}`}>{formatMoney(medicine.line_sales_before_invoice_discount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyList title="No medicine sales in this period" detail="Once sales are recorded, the best sellers will appear here." />
            )}
          </section>
        </div>

        <aside className="dash-column dash-column--alerts" aria-label="Inventory alerts">
          <section className={`dash-card dash-alert-card ${lowAlerts.length > 0 ? "dash-alert-card--risk" : ""}`} aria-labelledby="dash-low-title">
            <div className="dash-card-header">
              <div className="dash-section-heading">
                <span className="dash-heading-mark dash-heading-mark--orange"><AlertTriangle size={16} /></span>
                <div><h2 id="dash-low-title">Low stock</h2><p>Medicines at or below their threshold</p></div>
              </div>
              <span className={`dash-count-badge ${lowAlerts.length > 0 ? "is-risk" : ""}`} data-testid="value-low-stock-alert-count">{lowAlerts.length}</span>
            </div>
            {lowAlerts.length > 0 ? (
              <>
                <div className="dash-alert-list">
                  {lowAlerts.slice(0, 5).map((alert) => {
                    const severity = stockSeverity(alert);
                    return (
                      <button
                        aria-label={`${alert.name}: ${alert.available_stock} units available; reorder threshold ${alert.min_stock_alert}. Open inventory.`}
                        className="dash-alert-row"
                        key={alert.medicine_id}
                        onClick={() => onNavigate("inventory")}
                        data-testid={`row-low-stock-${alert.medicine_id}`}
                        type="button"
                      >
                        <span className={`dash-alert-mark dash-alert-mark--${severity}`}><Pill size={14} /></span>
                        <span className="dash-alert-copy"><strong>{alert.name}</strong><small>{alert.rack_location ? `Rack ${alert.rack_location} · ` : ""}Reorder at {alert.min_stock_alert}</small></span>
                        <span className={`dash-stock-qty dash-stock-qty--${severity}`} data-testid={`value-low-stock-${alert.medicine_id}`}>{alert.available_stock}<small>{severity === "out" ? "out" : "left"}</small></span>
                      </button>
                    );
                  })}
                </div>
                <button className="dash-alert-action" data-testid="button-low-stock-inventory" onClick={() => onNavigate("inventory")} type="button">{lowAlerts.length > 5 ? `Review all ${lowAlerts.length} low-stock items` : "Review stock"} <ArrowRight size={14} /></button>
              </>
            ) : <EmptyList title="No low-stock medicines" detail="Stock is above the saved reorder thresholds." />}
          </section>

          <section className={`dash-card dash-alert-card ${expiryAlerts.some((item) => item.status === "expired") ? "dash-alert-card--expired" : ""}`} aria-labelledby="dash-expiry-title">
            <div className="dash-card-header">
              <div className="dash-section-heading">
                <span className="dash-heading-mark dash-heading-mark--red"><Clock3 size={16} /></span>
                <div><h2 id="dash-expiry-title">Expiry watch</h2><p>In-stock batches expired or due within 30 days</p></div>
              </div>
              <span className={`dash-count-badge ${expiryAlerts.length > 0 ? "is-risk" : ""}`} data-testid="value-expiry-alert-count">{expiryAlerts.length}</span>
            </div>
            {expiryAlerts.length > 0 ? (
              <>
                <div className="dash-alert-list">
                  {expiryAlerts.slice(0, 5).map((alert) => {
                    const expired = alert.status === "expired" || alert.days_until_expiry < 0;
                    return (
                      <button
                        aria-label={`${alert.medicine_name}, batch ${alert.batch.batch_no}, ${alert.batch.current_stock} units, ${expiryLabel(alert)}. Open inventory.`}
                        className="dash-alert-row"
                        key={alert.batch.id}
                        onClick={() => onNavigate("inventory")}
                        data-testid={`row-expiry-${alert.batch.id}`}
                        type="button"
                      >
                        <span className={`dash-alert-mark ${expired ? "dash-alert-mark--expired" : "dash-alert-mark--expiry"}`}><Pill size={14} /></span>
                        <span className="dash-alert-copy"><strong>{alert.medicine_name}</strong><small>Batch {alert.batch.batch_no || "—"} · {alert.batch.current_stock} units</small></span>
                        <span className={`dash-expiry-status ${expired ? "is-expired" : "is-soon"}`} data-testid={`value-expiry-${alert.batch.id}`}>{expiryLabel(alert)}</span>
                      </button>
                    );
                  })}
                </div>
                <button className="dash-alert-action" data-testid="button-expiry-inventory" onClick={() => onNavigate("expiry")} type="button">{expiryAlerts.length > 5 ? `Review all ${expiryAlerts.length} batches` : "Review batches"} <ArrowRight size={14} /></button>
              </>
            ) : <EmptyList title="No expiry alerts" detail="No in-stock batches are expired or due within 30 days." />}
          </section>

          <section className="dash-card dash-workspace-card" aria-label="Pharmacy workspace">
            <span className="dash-workspace-icon"><ShieldCheck size={17} /></span>
            <div><strong>{pharmacyName}</strong><span>{inventory.total_suppliers.toLocaleString("en-IN")} suppliers in your local records</span></div>
            <button type="button" aria-label="Open settings" data-testid="button-dashboard-settings" onClick={() => onNavigate("settings")}><Settings2 size={16} /></button>
          </section>
          <span className="dash-alert-count-sr" data-testid="value-active-alerts">{totalAlerts} active stock and expiry alerts</span>
        </aside>
      </div>
      <footer className="dash-footer"><span><Database size={13} /> Pharmacy data remains on this device</span><span>Snapshot for {localDateLabel(snapshot.date)}</span></footer>
    </div>
  );
}

export default DashboardPage;