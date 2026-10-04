import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Copy,
  Minus,
  Plus,
  Printer,
  Search,
  Share2,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  clearOrderListForDate,
  getOrderList,
  removeOrderListItem,
  saveOrderListItem,
  setOrderListItemOrdered,
} from "../../services/orderListService";
import { searchMedicines } from "../../services/inventoryService";
import { getStoreSettings } from "../../services/settingsService";
import { getSuppliers } from "../../services/supplierService";
import type {
  MedicineSearchResult,
  OrderListItem,
  OrderListItemInput,
  StoreSettings,
  Supplier,
} from "../../types";
import "./orders.css";

interface OrderListPageProps {
  onNavigateToSuppliers: () => void;
}

interface EditDraft {
  item?: OrderListItem;
  medicine: MedicineSearchResult["medicine"];
  quantity: number;
  supplierId: string;
  note: string;
}

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function orderText(items: OrderListItem[], pharmacyName: string, orderDate: string): string {
  const lines = [
    pharmacyName,
    `Order list — ${dateLabel(orderDate)}`,
    "",
    ...items.map((item, index) => {
      const details = [`${index + 1}. ${item.medicine_name} — ${item.quantity}`];
      if (item.supplier_name?.trim()) details.push(`Supplier: ${item.supplier_name.trim()}`);
      if (item.note?.trim()) details.push(`Note: ${item.note.trim()}`);
      return details.join("\n");
    }),
  ];
  return lines.join("\n");
}

function OrderSkeleton() {
  return (
    <div className="order-skeleton" aria-label="Loading order list" aria-busy="true" data-testid="status-order-list-loading" role="status">
      <div className="order-skeleton-summary" />
      {[0, 1, 2].map((row) => <div className="order-skeleton-row" key={row}><i /><span /><b /></div>)}
    </div>
  );
}

export function OrderListPage({ onNavigateToSuppliers }: OrderListPageProps) {
  const [orderDate, setOrderDate] = useState(() => localDateValue(new Date()));
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [pharmacyName, setPharmacyName] = useState("MY MEDICAL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [results, setResults] = useState<MedicineSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyItemIds, setBusyItemIds] = useState<number[]>([]);
  const [busyAction, setBusyAction] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shareFallback, setShareFallback] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getOrderList(orderDate)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(error, "The local order list could not be loaded."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [orderDate, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void getSuppliers()
      .then((rows) => {
        if (!cancelled) {
          setSuppliers(rows);
          setSupplierError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setSupplierError(getErrorMessage(error, "Supplier records could not be loaded."));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getStoreSettings()
      .then((settings: StoreSettings) => {
        if (!cancelled && settings.pharmacy_name.trim()) setPharmacyName(settings.pharmacy_name.trim());
      })
      .catch(() => {
        // The order list remains usable if pharmacy details are unavailable.
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (debouncedSearch.length < 2) {
      setResults([]);
      setSearchLoading(false);
      setSearchError(null);
      setActiveResult(0);
      return;
    }
    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    void searchMedicines(debouncedSearch, 8)
      .then((matches) => {
        if (!cancelled) {
          setResults(matches);
          setActiveResult(0);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSearchError(getErrorMessage(error, "Medicine search is unavailable."));
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setSearchLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedSearch]);

  const totalUnits = useMemo(() => items.reduce((sum, item) => sum + item.quantity, 0), [items]);
  const openDraft = (medicine: MedicineSearchResult["medicine"], existing?: OrderListItem) => {
    setDraft({
      item: existing,
      medicine,
      quantity: existing?.quantity ?? 1,
      supplierId: existing?.supplier_id ? String(existing.supplier_id) : "",
      note: existing?.note ?? "",
    });
    setSearchOpen(false);
    setSearch("");
    setActionError(null);
  };

  const reload = () => setReloadKey((key) => key + 1);

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !Number.isFinite(draft.quantity) || draft.quantity < 1) return;
    setSaving(true);
    setActionError(null);
    const input: OrderListItemInput = {
      ...(draft.item ? { id: draft.item.id } : {}),
      medicine_id: draft.medicine.id,
      ...(draft.supplierId ? { supplier_id: Number(draft.supplierId) } : {}),
      quantity: Math.floor(draft.quantity),
      note: draft.note.trim(),
      order_date: orderDate,
    };
    try {
      await saveOrderListItem(input);
      setDraft(null);
      setNotice(`${draft.medicine.name} ${draft.item ? "updated" : "added"} to the order list.`);
      reload();
    } catch (error) {
      setActionError(getErrorMessage(error, "This order item could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  async function updateQuantity(item: OrderListItem, quantity: number) {
    if (quantity < 1 || busyItemIds.includes(item.id)) return;
    setBusyItemIds((ids) => [...ids, item.id]);
    setActionError(null);
    try {
      const input: OrderListItemInput = {
        id: item.id,
        medicine_id: item.medicine_id,
        ...(item.supplier_id ? { supplier_id: item.supplier_id } : {}),
        quantity,
        note: item.note ?? "",
        order_date: item.order_date,
      };
      await saveOrderListItem(input);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, quantity } : row));
    } catch (error) {
      setActionError(getErrorMessage(error, "The quantity could not be updated."));
    } finally {
      setBusyItemIds((ids) => ids.filter((id) => id !== item.id));
    }
  }

  async function toggleOrdered(item: OrderListItem) {
    setBusyItemIds((ids) => [...ids, item.id]);
    setActionError(null);
    try {
      await setOrderListItemOrdered(item.id, !item.ordered);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, ordered: !row.ordered } : row));
    } catch (error) {
      setActionError(getErrorMessage(error, "The order status could not be updated."));
    } finally {
      setBusyItemIds((ids) => ids.filter((id) => id !== item.id));
    }
  }

  async function removeItem(item: OrderListItem) {
    setBusyItemIds((ids) => [...ids, item.id]);
    setActionError(null);
    try {
      await removeOrderListItem(item.id);
      setItems((current) => current.filter((row) => row.id !== item.id));
      setNotice(`${item.medicine_name} removed from the order list.`);
    } catch (error) {
      setActionError(getErrorMessage(error, "The order item could not be removed."));
    } finally {
      setBusyItemIds((ids) => ids.filter((id) => id !== item.id));
    }
  }

  async function clearToday() {
    setBusyAction(true);
    setActionError(null);
    try {
      await clearOrderListForDate(orderDate);
      setItems([]);
      setConfirmClear(false);
      setNotice("The order list for this date has been cleared.");
    } catch (error) {
      setActionError(getErrorMessage(error, "The order list could not be cleared."));
      setConfirmClear(false);
    } finally {
      setBusyAction(false);
    }
  }

  async function copyOrderText() {
    try {
      await navigator.clipboard.writeText(orderText(items, pharmacyName, orderDate));
      setCopyStatus("Order text copied to clipboard.");
      setShareFallback(false);
    } catch {
      setShareFallback(true);
      setCopyStatus("Clipboard access is unavailable. Select and copy the order text below.");
    }
  }

  async function shareOrder() {
    const url = `https://wa.me/?text=${encodeURIComponent(orderText(items, pharmacyName, orderDate))}`;
    try {
      await openUrl(url);
      setShareFallback(false);
      setCopyStatus("WhatsApp share opened. Review the message before sending.");
    } catch {
      setShareFallback(true);
      setCopyStatus("WhatsApp could not be opened. Copy the order text below to share it manually.");
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && results.length) {
      event.preventDefault();
      setSearchOpen(true);
      setActiveResult((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp" && results.length) {
      event.preventDefault();
      setActiveResult((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && searchOpen && results[activeResult]) {
      event.preventDefault();
      openDraft(results[activeResult].medicine);
    } else if (event.key === "Escape") {
      setSearchOpen(false);
    }
  }

  const printDate = dateLabel(orderDate);

  return (
    <section className="order-list-page" data-testid="page-order-list">
      <header className="order-page-header">
        <div>
          <div className="order-kicker"><span className="order-kicker-dot" /> LOCAL ORDER WORKSPACE</div>
          <h1>Today’s order list</h1>
          <p>Build the next stock order, then share or print it when you’re ready.</p>
        </div>
        <div className="order-header-actions">
          <button className="order-button order-button--outline" data-testid="button-order-suppliers" onClick={onNavigateToSuppliers} type="button">
            <Truck size={15} /> Suppliers
          </button>
          <button className="order-button order-button--outline" data-testid="button-print-order-list" disabled={items.length === 0} onClick={() => window.print()} type="button">
            <Printer size={15} /> Export PDF / Print
          </button>
        </div>
      </header>

      <div className="order-private-strip" data-testid="status-order-local">
        <span className="order-private-dot" />
        <CheckCircle2 aria-hidden="true" size={15} />
        <strong>Saved on this device</strong>
        <span>Order items stay in your local pharmacy database.</span>
        <label className="order-date-control">
          <span>Order date</span>
          <input aria-label="Order date" data-testid="input-order-date" onChange={(event) => setOrderDate(event.target.value)} type="date" value={orderDate} />
        </label>
      </div>

      {notice && (
        <div className="order-notice" role="status" data-testid="status-order-notice">
          <CheckCircle2 size={16} /><span>{notice}</span>
          <button aria-label="Dismiss message" data-testid="button-dismiss-order-notice" onClick={() => setNotice(null)} type="button"><X size={15} /></button>
        </div>
      )}
      {actionError && (
        <div className="order-error-banner" role="alert" data-testid="status-order-action-error">
          <AlertCircle size={16} /><span>{actionError}</span>
          <button aria-label="Dismiss error" data-testid="button-dismiss-order-error" onClick={() => setActionError(null)} type="button"><X size={15} /></button>
        </div>
      )}
      {supplierError && (
        <div className="order-error-banner order-error-banner--quiet" role="status" data-testid="status-order-supplier-error">
          <AlertCircle size={15} /><span>{supplierError} You can still add medicines without a wholesaler.</span>
        </div>
      )}

      <div className="order-overview">
        <section className="order-summary-card" aria-label="Order list summary" data-testid="card-order-summary">
          <div className="order-summary-icon"><ClipboardList size={19} /></div>
          <div className="order-summary-copy">
            <span>ORDER LINES</span>
            <strong data-testid="value-order-line-count">{items.length}</strong>
          </div>
          <div className="order-summary-rule" />
          <div className="order-summary-copy order-summary-copy--units">
            <span>TOTAL UNITS</span>
            <strong data-testid="value-order-total-units">{totalUnits.toLocaleString("en-IN")}</strong>
          </div>
          <span className="order-date-caption" data-testid="text-order-date">{printDate}</span>
        </section>
        <aside className="order-share-card" aria-label="Share order list">
          <span className="order-share-mark"><Share2 size={16} /></span>
          <div><strong>Ready for your wholesaler?</strong><span>Share the list or print a local copy.</span></div>
          <button className="order-button order-button--share" data-testid="button-share-whatsapp" disabled={items.length === 0} onClick={() => void shareOrder()} type="button">
            <Share2 size={15} /> Share on WhatsApp <ArrowUpRight size={14} />
          </button>
        </aside>
      </div>

      <div className="order-work-grid">
        <section className="order-list-card" aria-labelledby="order-lines-title">
          <div className="order-card-heading">
            <div className="order-section-title">
              <span className="order-heading-icon"><ShoppingCart size={16} /></span>
              <div><h2 id="order-lines-title">Order items</h2><p>{items.length} {items.length === 1 ? "medicine" : "medicines"} · {totalUnits} total units</p></div>
            </div>
            {items.length > 0 && (
              <button className="order-text-button order-text-button--danger" data-testid="button-clear-order-list" onClick={() => setConfirmClear(true)} type="button">
                <Trash2 size={14} /> Clear list
              </button>
            )}
          </div>

          <div className="order-search-area">
            <div className="order-search-label"><label htmlFor="order-medicine-search">Add a medicine</label><span>Search the local catalogue</span></div>
            <div className="order-search-wrap">
              <Search aria-hidden="true" className="order-search-icon" size={17} />
              <input
                aria-activedescendant={searchOpen && results[activeResult] ? `order-medicine-option-${results[activeResult].medicine.id}` : undefined}
                aria-autocomplete="list"
                aria-controls="order-medicine-results"
                aria-expanded={searchOpen && search.trim().length >= 2}
                autoComplete="off"
                data-testid="input-order-medicine-search"
                id="order-medicine-search"
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                onChange={(event) => { setSearch(event.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Type a medicine name or generic"
                role="combobox"
                value={search}
              />
              {search && <button aria-label="Clear medicine search" className="order-search-clear" data-testid="button-clear-order-search" onClick={() => { setSearch(""); setSearchOpen(false); }} type="button"><X size={15} /></button>}
              {searchOpen && search.trim().length >= 2 && (
                <div className="order-search-popover" id="order-medicine-results" role="listbox" aria-label="Medicine search results">
                  {searchLoading ? <div className="order-search-message" role="status" data-testid="status-order-search-loading">Searching local catalogue…</div>
                    : searchError ? <div className="order-search-message order-search-message--error" role="alert" data-testid="status-order-search-error">{searchError}</div>
                      : results.length === 0 ? <div className="order-search-message" data-testid="status-order-search-empty">No matching medicines found.</div>
                        : results.map((result, index) => (
                          <button
                            aria-selected={activeResult === index}
                            className={`order-search-result ${activeResult === index ? "is-active" : ""}`}
                            data-testid={`option-order-medicine-${result.medicine.id}`}
                            id={`order-medicine-option-${result.medicine.id}`}
                            key={result.medicine.id}
                            onClick={() => openDraft(result.medicine)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveResult(index)}
                            role="option"
                            type="button"
                          >
                            <span className="order-result-icon"><Plus size={15} /></span>
                            <span className="order-result-main"><strong>{result.medicine.name}</strong><small>{[result.medicine.generic_name, result.medicine.company].filter(Boolean).join(" · ") || "Medicine"}</small></span>
                            <span className="order-result-stock">{result.available_stock}<small>in stock</small></span>
                            <ChevronDown className="order-result-arrow" size={15} />
                          </button>
                        ))}
                  <div className="order-search-footnote">Choose a result to set quantity and wholesaler</div>
                </div>
              )}
            </div>
          </div>

          {loadError && (
            <div className="order-load-error" role="alert" data-testid="status-order-list-error">
              <AlertCircle size={19} />
              <div><strong>Order list could not be loaded</strong><span>{loadError}</span></div>
              <button className="order-button order-button--outline" data-testid="button-retry-order-list" onClick={reload} type="button">Try again</button>
            </div>
          )}
          {!loadError && loading ? <OrderSkeleton /> : !loadError && items.length === 0 ? (
            <div className="order-empty-state" data-testid="status-order-list-empty">
              <span className="order-empty-icon"><ClipboardList size={24} /></span>
              <strong>Your list is clear.</strong>
              <span>Search your medicine catalogue above to prepare an order for this date.</span>
            </div>
          ) : !loadError && (
            <div className="order-items-list" data-testid="list-order-items">
              {items.map((item) => {
                const busy = busyItemIds.includes(item.id);
                return (
                  <article className={`order-item ${item.ordered ? "is-ordered" : ""}`} data-testid={`row-order-item-${item.id}`} key={item.id}>
                    <button
                      aria-label={item.ordered ? `Mark ${item.medicine_name} as not ordered` : `Mark ${item.medicine_name} as ordered`}
                      aria-pressed={item.ordered}
                      className="order-check-button"
                      data-testid={`button-toggle-ordered-${item.id}`}
                      disabled={busy}
                      onClick={() => void toggleOrdered(item)}
                      type="button"
                    >
                      {item.ordered && <Check size={15} />}
                    </button>
                    <div className="order-item-main">
                      <div className="order-item-title-row"><h3 data-testid={`text-order-medicine-${item.id}`}>{item.medicine_name}</h3>{item.ordered && <span className="order-ordered-badge">Ordered</span>}</div>
                      <p>{[item.generic_name, item.company].filter(Boolean).join(" · ") || "Medicine"}</p>
                      {(item.supplier_name || item.note) && (
                        <div className="order-item-meta">
                          {item.supplier_name && <span className="order-supplier-tag"><Truck size={12} />{item.supplier_name}</span>}
                          {item.note && <span className="order-note-text">{item.note}</span>}
                        </div>
                      )}
                    </div>
                    <div className="order-quantity-control" aria-label={`Quantity for ${item.medicine_name}`}>
                      <button aria-label={`Decrease ${item.medicine_name} quantity`} className="order-quantity-button" data-testid={`button-decrease-quantity-${item.id}`} disabled={busy || item.quantity <= 1} onClick={() => void updateQuantity(item, item.quantity - 1)} type="button"><Minus size={13} /></button>
                      <strong data-testid={`value-order-quantity-${item.id}`}>{item.quantity}</strong>
                      <button aria-label={`Increase ${item.medicine_name} quantity`} className="order-quantity-button" data-testid={`button-increase-quantity-${item.id}`} disabled={busy} onClick={() => void updateQuantity(item, item.quantity + 1)} type="button"><Plus size={13} /></button>
                    </div>
                    <div className="order-item-actions">
                      <button aria-label={`Edit ${item.medicine_name}`} className="order-icon-button" data-testid={`button-edit-order-item-${item.id}`} disabled={busy} onClick={() => openDraft({ id: item.medicine_id, name: item.medicine_name, generic_name: item.generic_name, company: item.company, product_type: null, strength: null, composition: null, barcode: null, uses: null, adult_dose: null, child_dose: null, photo_ref: null, rack_location: null, min_stock_alert: 0, gst_rate_basis_points: null, created_at: "" }, item)} type="button">Edit</button>
                      <button aria-label={`Remove ${item.medicine_name}`} className="order-icon-button order-icon-button--remove" data-testid={`button-remove-order-item-${item.id}`} disabled={busy} onClick={() => void removeItem(item)} type="button"><Trash2 size={15} /></button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!loadError && items.length > 0 && (
            <div className="order-list-footer" data-testid="status-order-list-count">
              <span><CheckCircle2 size={14} /> {items.filter((item) => item.ordered).length} ordered</span>
              <span>{items.length - items.filter((item) => item.ordered).length} remaining</span>
            </div>
          )}
        </section>

        <aside className="order-side-column">
          <section className="order-guide-card" aria-labelledby="order-guide-title">
            <div className="order-guide-heading"><span className="order-guide-icon"><Share2 size={16} /></span><div><h2 id="order-guide-title">Share this order</h2><p>Keep a clear record before you send.</p></div></div>
            <div className="order-share-actions">
              <button className="order-share-action" data-testid="button-copy-order-text" disabled={items.length === 0} onClick={() => void copyOrderText()} type="button"><span><Copy size={15} /></span><span><strong>Copy order text</strong><small>Paste into any message</small></span><ArrowUpRight size={14} /></button>
              <button className="order-share-action" data-testid="button-print-order-side" disabled={items.length === 0} onClick={() => window.print()} type="button"><span><Printer size={15} /></span><span><strong>Export PDF / Print</strong><small>Choose “Save as PDF” in the system dialog</small></span><ArrowUpRight size={14} /></button>
            </div>
            <div className="order-local-note"><CheckCircle2 size={14} /><span>No message is sent automatically. Review the WhatsApp message before sending.</span></div>
          </section>

          <section className="order-supplier-card" aria-labelledby="order-supplier-title">
            <div className="order-supplier-heading"><span className="order-supplier-icon"><Truck size={16} /></span><div><h2 id="order-supplier-title">Wholesalers</h2><p>Assign a supplier to individual items.</p></div></div>
            <div className="order-supplier-count" data-testid="value-order-supplier-count"><strong>{suppliers.length}</strong><span>{suppliers.length === 1 ? "supplier saved locally" : "suppliers saved locally"}</span></div>
            {suppliers.length === 0 && !supplierError && <p className="order-no-suppliers">No supplier records yet. You can still prepare the list and add a wholesaler later.</p>}
            <button className="order-text-button order-supplier-link" data-testid="button-open-suppliers" onClick={onNavigateToSuppliers} type="button">Open supplier directory <ArrowUpRight size={14} /></button>
          </section>

          <section className="order-share-preview" aria-labelledby="order-preview-title">
            <div><span className="order-preview-kicker">MESSAGE PREVIEW</span><h2 id="order-preview-title">Order text</h2></div>
            <pre data-testid="text-order-share-preview">{orderText(items, pharmacyName, orderDate)}</pre>
            {copyStatus && <p className="order-copy-status" role="status" data-testid="status-order-copy">{copyStatus}</p>}
            {shareFallback && (
              <div className="order-copy-fallback" data-testid="panel-order-copy-fallback">
                <p>WhatsApp did not open. Copy this text and share it manually.</p>
                <button className="order-button order-button--outline" data-testid="button-copy-order-fallback" onClick={() => void copyOrderText()} type="button"><Copy size={14} /> Copy order text</button>
              </div>
            )}
          </section>
        </aside>
      </div>

      <div className="order-print-document" aria-hidden="true">
        <header><h1>{pharmacyName}</h1><p>Order list · {printDate}</p></header>
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <div><strong>{item.medicine_name}</strong><span>Quantity: {item.quantity}</span></div>
              {item.supplier_name && <p>Supplier: {item.supplier_name}</p>}
              {item.note && <p>Note: {item.note}</p>}
            </li>
          ))}
        </ol>
      </div>

      {draft && (
        <div className="order-dialog-backdrop" data-testid="dialog-order-item">
          <section aria-describedby="order-item-dialog-description" aria-labelledby="order-item-dialog-title" aria-modal="true" className="order-dialog" role="dialog">
            <header className="order-dialog-header">
              <div><span className="order-dialog-kicker">{draft.item ? "EDIT ORDER LINE" : "ADD ORDER LINE"}</span><h2 id="order-item-dialog-title">{draft.item ? "Edit order item" : "Add to order list"}</h2><p id="order-item-dialog-description">Set the quantity and any wholesaler or note for this medicine.</p></div>
              <button aria-label="Close order item form" className="order-icon-button" data-testid="button-close-order-dialog" disabled={saving} onClick={() => setDraft(null)} type="button"><X size={18} /></button>
            </header>
            <div className="order-dialog-medicine"><span className="order-dialog-pill"><ShoppingCart size={16} /></span><span><strong>{draft.medicine.name}</strong><small>{[draft.medicine.generic_name, draft.medicine.company].filter(Boolean).join(" · ") || "Medicine"}</small></span></div>
            <form className="order-dialog-form" onSubmit={(event) => void saveDraft(event)}>
              <label className="order-field"><span>Quantity <b aria-hidden="true">*</b></span><input autoFocus data-testid="input-order-item-quantity" min="1" onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) })} required type="number" value={draft.quantity} /></label>
              <label className="order-field"><span>Wholesaler <em>Optional</em></span><select data-testid="select-order-item-supplier" onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })} value={draft.supplierId}><option value="">No wholesaler selected</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              <label className="order-field"><span>Note <em>Optional</em></span><textarea data-testid="input-order-item-note" maxLength={300} onChange={(event) => setDraft({ ...draft, note: event.target.value })} placeholder="For example: preferred pack or delivery detail" rows={3} value={draft.note} /></label>
              {actionError && <p className="order-dialog-error" data-testid="status-order-dialog-error" role="alert">{actionError}</p>}
              <footer className="order-dialog-actions"><button className="order-button order-button--outline" data-testid="button-cancel-order-item" disabled={saving} onClick={() => setDraft(null)} type="button">Cancel</button><button className="order-button order-button--primary" data-testid="button-save-order-item" disabled={saving || draft.quantity < 1} type="submit">{saving ? "Saving…" : draft.item ? "Save changes" : "Add item"}</button></footer>
            </form>
          </section>
        </div>
      )}

      {confirmClear && (
        <div className="order-dialog-backdrop" data-testid="dialog-confirm-clear-order">
          <section aria-describedby="order-clear-description" aria-labelledby="order-clear-title" aria-modal="true" className="order-dialog order-dialog--confirm" role="alertdialog">
            <span className="order-confirm-icon"><Trash2 size={19} /></span>
            <span className="order-dialog-kicker">CLEAR ORDER LIST</span>
            <h2 id="order-clear-title">Remove every item for this date?</h2>
            <p id="order-clear-description">This clears {items.length} {items.length === 1 ? "line" : "lines"} from {printDate}. This cannot be undone.</p>
            {actionError && <p className="order-dialog-error" role="alert">{actionError}</p>}
            <div className="order-dialog-actions"><button className="order-button order-button--outline" data-testid="button-cancel-clear-order" disabled={busyAction} onClick={() => setConfirmClear(false)} type="button">Keep list</button><button className="order-button order-button--danger" data-testid="button-confirm-clear-order" disabled={busyAction} onClick={() => void clearToday()} type="button">{busyAction ? "Clearing…" : "Clear list"}</button></div>
          </section>
        </div>
      )}
    </section>
  );
}

export default OrderListPage;