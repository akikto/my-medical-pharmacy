import {
  AlertCircle,
  Barcode,
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  CreditCard,
  FileText,
  Keyboard,
  Minus,
  PackageCheck,
  Plus,
  ReceiptText,
  Search,
  ShoppingBasket,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { searchMedicines, getSellableBatches } from "../../services/inventoryService";
import {
  checkoutSale,
  getRecentSales,
  getSaleDetails,
  SaleDetailsUnavailableError,
} from "../../services/salesService";
import type {
  CartItem,
  MedicineSearchResult,
  PaymentMode,
  RecentSale,
  SaleDetails,
} from "../../types";
import { formatDate, formatDateTime, formatMoney, fromCents, toCents } from "../../utils/money";
import { CheckoutDialog } from "./CheckoutDialog";
import { ReceiptPrint } from "./ReceiptPrint";

type Notice = { kind: "success" | "error" | "info"; message: string };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The pharmacy database could not complete that action.";
}

function lineTotal(item: CartItem, quantity = item.quantity, discount = item.item_discount): number {
  return fromCents(
    Math.max(0, toCents(item.unit_price) * quantity - toCents(discount)),
  );
}

function expiryState(expiryDate: string): "expired" | "soon" | "valid" {
  const expiry = new Date(`${expiryDate.slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (Number.isNaN(expiry.getTime()) || expiry < today) {
    return "expired";
  }
  const daysRemaining = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
  return daysRemaining <= 30 ? "soon" : "valid";
}

interface POSBillingProps {
  initialSearchQuery?: string;
  onInitialSearchConsumed?: () => void;
}

export function POSBilling({
  initialSearchQuery,
  onInitialSearchConsumed,
}: POSBillingProps) {
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery?.trim() ?? "");
  const [searchResults, setSearchResults] = useState<MedicineSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [flatDiscountInput, setFlatDiscountInput] = useState("0");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [cashTenderedInput, setCashTenderedInput] = useState("0");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [recentSalesLoading, setRecentSalesLoading] = useState(true);
  const [recentSalesError, setRecentSalesError] = useState<string | null>(null);
  const [openingInvoice, setOpeningInvoice] = useState<string | null>(null);
  const [receiptSale, setReceiptSale] = useState<SaleDetails | null>(null);
  const [printReceiptOnOpen, setPrintReceiptOnOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cartRef = useRef<CartItem[]>([]);
  const addQueueRef = useRef<Promise<void>>(Promise.resolve());
  const isSavingRef = useRef(false);

  const replaceCart = useCallback((updater: (current: CartItem[]) => CartItem[]) => {
    const next = updater(cartRef.current);
    cartRef.current = next;
    setCart(next);
  }, []);

  const totals = useMemo(() => {
    const subtotalCents = cart.reduce(
      (total, item) => total + toCents(item.unit_price) * item.quantity,
      0,
    );
    const itemDiscountCents = cart.reduce(
      (total, item) => total + toCents(item.item_discount),
      0,
    );
    const maxFlatDiscountCents = Math.max(subtotalCents - itemDiscountCents, 0);
    const requestedFlatDiscountCents = Math.max(
      toCents(Number(flatDiscountInput) || 0),
      0,
    );
    const flatDiscountCents = Math.min(
      requestedFlatDiscountCents,
      maxFlatDiscountCents,
    );
    const grandTotalCents = Math.max(
      subtotalCents - itemDiscountCents - flatDiscountCents,
      0,
    );
    const cashCents = Math.max(toCents(Number(cashTenderedInput) || 0), 0);
    return {
      subtotal: fromCents(subtotalCents),
      itemDiscount: fromCents(itemDiscountCents),
      flatDiscount: fromCents(flatDiscountCents),
      maxFlatDiscount: fromCents(maxFlatDiscountCents),
      grandTotal: fromCents(grandTotalCents),
      cashTendered: paymentMode === "CASH" ? fromCents(cashCents) : 0,
      changeDue:
        paymentMode === "CASH"
          ? fromCents(Math.max(cashCents - grandTotalCents, 0))
          : 0,
      itemCount: cart.reduce((total, item) => total + item.quantity, 0),
    };
  }, [cart, cashTenderedInput, flatDiscountInput, paymentMode]);

  useEffect(() => {
    const query = searchQuery.trim();
    let cancelled = false;
    if (!query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      setSelectedResultIndex(0);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      void searchMedicines(query, 15)
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results);
            setSelectedResultIndex(0);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSearchResults([]);
            setSearchError(getErrorMessage(error));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchLoading(false);
          }
        });
    }, 110);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const refreshRecentSales = useCallback(async () => {
    setRecentSalesLoading(true);
    setRecentSalesError(null);
    try {
      setRecentSales(await getRecentSales(8));
    } catch (error) {
      setRecentSalesError(getErrorMessage(error));
    } finally {
      setRecentSalesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRecentSales();
  }, [refreshRecentSales]);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (initialSearchQuery?.trim()) {
      onInitialSearchConsumed?.();
    }
  }, [initialSearchQuery, onInitialSearchConsumed]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const maxDiscount = totals.maxFlatDiscount;
    const currentDiscount = Number(flatDiscountInput) || 0;
    if (currentDiscount > maxDiscount) {
      setFlatDiscountInput(maxDiscount.toFixed(2));
    }
  }, [flatDiscountInput, totals.maxFlatDiscount]);

  const addMedicine = useCallback(
    (result: MedicineSearchResult, exactBatchId?: number) => {
      const task = addQueueRef.current.then(async () => {
        try {
          const batches = await getSellableBatches(result.medicine.id);
          const currentCart = cartRef.current;
          const batch = exactBatchId
            ? batches.find((candidate) => candidate.id === exactBatchId)
            : batches.find((candidate) => {
                const existing = currentCart.find(
                  (item) => item.batch_id === candidate.id,
                );
                return (existing?.quantity ?? 0) < candidate.current_stock;
              });

          if (!batch) {
            throw new Error(
              exactBatchId
                ? "That scanned batch is expired or out of stock."
                : batches.length === 0
                  ? "No unexpired stock is available for this medicine."
                  : "The available batch quantity is already in the cart.",
            );
          }

          const existing = currentCart.find((item) => item.batch_id === batch.id);
          if (existing && existing.quantity >= batch.current_stock) {
            throw new Error(`Only ${batch.current_stock} unit(s) remain in batch ${batch.batch_no}.`);
          }

          const next = existing
            ? currentCart.map((item) =>
                item.batch_id === batch.id
                  ? {
                      ...item,
                      quantity: item.quantity + 1,
                      available_in_batch: batch.current_stock,
                      line_total: lineTotal(item, item.quantity + 1),
                    }
                  : item,
              )
            : [
                ...currentCart,
                {
                  medicine_id: result.medicine.id,
                  batch_id: batch.id,
                  medicine_name: result.medicine.name,
                  generic_name: result.medicine.generic_name,
                  batch_no: batch.batch_no,
                  expiry_date: batch.expiry_date,
                  quantity: 1,
                  unit_price: batch.sale_rate,
                  item_discount: 0,
                  available_in_batch: batch.current_stock,
                  line_total: batch.sale_rate,
                },
              ];
          replaceCart(() => next);
          setSearchQuery("");
          setSearchResults([]);
          setNotice({
            kind: "success",
            message: `${result.medicine.name} added to the bill.`,
          });
          searchInputRef.current?.focus();
        } catch (error) {
          setNotice({ kind: "error", message: getErrorMessage(error) });
        }
      });
      addQueueRef.current = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
    [replaceCart],
  );

  const addScannedBarcode = useCallback(
    async (barcode: string) => {
      const code = barcode.trim();
      if (!code) {
        return;
      }
      try {
        const matches = await searchMedicines(code, 15);
        const exact = matches.find(
          (result) => result.fefo_batch?.barcode === code,
        );
        if (!exact?.fefo_batch) {
          throw new Error(`No available medicine batch matches barcode ${code}.`);
        }
        await addMedicine(exact, exact.fefo_batch.id);
      } catch (error) {
        setNotice({ kind: "error", message: getErrorMessage(error) });
        setSearchQuery("");
      }
    },
    [addMedicine],
  );

  useEffect(() => {
    let buffer = "";
    let firstKeyAt = 0;
    let lastKeyAt = 0;
    const maxKeyGapMs = 65;

    const captureScannerInput = (event: KeyboardEvent) => {
      if (
        checkoutOpen ||
        receiptSale ||
        document.activeElement !== searchInputRef.current ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey
      ) {
        buffer = "";
        return;
      }

      const now = performance.now();
      if (event.key === "Enter") {
        const duration = now - firstKeyAt;
        if (buffer.length >= 4 && duration <= 1300 && now - lastKeyAt <= 100) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          const scanned = buffer;
          buffer = "";
          void addScannedBarcode(scanned);
        } else {
          buffer = "";
        }
        return;
      }

      if (event.key.length === 1) {
        if (!buffer || now - lastKeyAt > maxKeyGapMs) {
          buffer = event.key;
          firstKeyAt = now;
        } else {
          buffer += event.key;
        }
        lastKeyAt = now;
      } else if (event.key === "Backspace") {
        buffer = buffer.slice(0, -1);
        lastKeyAt = now;
      } else if (event.key !== "Shift") {
        buffer = "";
      }
    };

    document.addEventListener("keydown", captureScannerInput, true);
    return () => document.removeEventListener("keydown", captureScannerInput, true);
  }, [addScannedBarcode, checkoutOpen, receiptSale]);

  const openCheckout = useCallback(() => {
    if (cartRef.current.length === 0) {
      setNotice({ kind: "info", message: "Add a medicine before opening checkout." });
      searchInputRef.current?.focus();
      return;
    }
    if (paymentMode === "CASH") {
      const currentTendered = Number(cashTenderedInput) || 0;
      if (currentTendered < totals.grandTotal) {
        setCashTenderedInput(totals.grandTotal.toFixed(2));
      }
    } else {
      setCashTenderedInput("0");
    }
    setCheckoutOpen(true);
  }, [cashTenderedInput, paymentMode, totals.grandTotal]);

  useEffect(() => {
    const handleShortcuts = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        if (!checkoutOpen && !receiptSale) {
          searchInputRef.current?.focus();
        }
      } else if (event.key === "F9") {
        event.preventDefault();
        if (!checkoutOpen && !receiptSale) {
          openCheckout();
        }
      } else if (event.key === "Escape") {
        if (receiptSale) {
          event.preventDefault();
          setReceiptSale(null);
          setPrintReceiptOnOpen(false);
        } else if (checkoutOpen) {
          event.preventDefault();
          setCheckoutOpen(false);
        } else if (searchQuery) {
          event.preventDefault();
          setSearchQuery("");
          setSearchResults([]);
          setSearchError(null);
          searchInputRef.current?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleShortcuts);
    return () => document.removeEventListener("keydown", handleShortcuts);
  }, [checkoutOpen, openCheckout, receiptSale, searchQuery]);

  function handleSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && searchResults.length > 0) {
      event.preventDefault();
      setSelectedResultIndex((current) => (current + 1) % searchResults.length);
    } else if (event.key === "ArrowUp" && searchResults.length > 0) {
      event.preventDefault();
      setSelectedResultIndex(
        (current) => (current - 1 + searchResults.length) % searchResults.length,
      );
    } else if (event.key === "Enter" && searchResults[selectedResultIndex]) {
      event.preventDefault();
      void addMedicine(searchResults[selectedResultIndex]);
    }
  }

  function changeQuantity(batchId: number, quantity: number) {
    const item = cartRef.current.find((entry) => entry.batch_id === batchId);
    if (!item || !Number.isSafeInteger(quantity) || quantity < 1) {
      return;
    }
    if (quantity > item.available_in_batch) {
      setNotice({
        kind: "error",
        message: `Only ${item.available_in_batch} unit(s) are available in batch ${item.batch_no}.`,
      });
      return;
    }
    replaceCart((current) =>
      current.map((entry) => {
        if (entry.batch_id !== batchId) {
          return entry;
        }
        const maxDiscount = fromCents(toCents(entry.unit_price) * quantity);
        const discount = Math.min(entry.item_discount, maxDiscount);
        return {
          ...entry,
          quantity,
          item_discount: discount,
          line_total: lineTotal(entry, quantity, discount),
        };
      }),
    );
  }

  function changeItemDiscount(batchId: number, discount: number) {
    const item = cartRef.current.find((entry) => entry.batch_id === batchId);
    if (!item) {
      return;
    }
    if (!Number.isFinite(discount) || discount < 0) {
      setNotice({ kind: "error", message: "Item discount must be zero or more." });
      return;
    }
    const roundedDiscount = fromCents(toCents(discount));
    const gross = fromCents(toCents(item.unit_price) * item.quantity);
    if (roundedDiscount > gross) {
      setNotice({ kind: "error", message: "Item discount cannot exceed its line total." });
      return;
    }
    replaceCart((current) =>
      current.map((entry) =>
        entry.batch_id === batchId
          ? {
              ...entry,
              item_discount: roundedDiscount,
              line_total: lineTotal(entry, entry.quantity, roundedDiscount),
            }
          : entry,
      ),
    );
  }

  function removeFromCart(batchId: number) {
    const item = cartRef.current.find((entry) => entry.batch_id === batchId);
    replaceCart((current) => current.filter((entry) => entry.batch_id !== batchId));
    if (item) {
      setNotice({ kind: "info", message: `${item.medicine_name} removed from the bill.` });
    }
  }

  async function completeCheckout() {
    if (isSavingRef.current) {
      return;
    }
    isSavingRef.current = true;
    setIsSaving(true);
    setNotice(null);
    try {
      const completed = await checkoutSale({
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        payment_mode: paymentMode,
        flat_discount: totals.flatDiscount,
        cash_tendered:
          paymentMode === "CASH" ? Number(cashTenderedInput) || 0 : 0,
        items: cart.map((item) => ({
          medicine_id: item.medicine_id,
          batch_id: item.batch_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          item_discount: item.item_discount,
        })),
      });
      setReceiptSale(completed);
      setPrintReceiptOnOpen(true);
      replaceCart(() => []);
      setFlatDiscountInput("0");
      setCashTenderedInput("0");
      setCustomerName("");
      setCustomerPhone("");
      setPaymentMode("CASH");
      setCheckoutOpen(false);
      setNotice({
        kind: "success",
        message: `${completed.sale.invoice_no} saved successfully.`,
      });
      await refreshRecentSales();
    } catch (error) {
      if (error instanceof SaleDetailsUnavailableError) {
        replaceCart(() => []);
        setFlatDiscountInput("0");
        setCashTenderedInput("0");
        setCustomerName("");
        setCustomerPhone("");
        setPaymentMode("CASH");
        setCheckoutOpen(false);
        setNotice({ kind: "error", message: error.message });
        await refreshRecentSales();
      } else {
        setNotice({ kind: "error", message: getErrorMessage(error) });
      }
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }

  async function viewInvoice(invoiceNo: string) {
    setOpeningInvoice(invoiceNo);
    try {
      const details = await getSaleDetails(invoiceNo);
      if (!details) {
        throw new Error(`Invoice ${invoiceNo} could not be found.`);
      }
      setPrintReceiptOnOpen(false);
      setReceiptSale(details);
    } catch (error) {
      setNotice({ kind: "error", message: getErrorMessage(error) });
    } finally {
      setOpeningInvoice(null);
    }
  }

  return (
    <div className="pos-workspace">
      <header className="pos-page-header">
        <div>
          <div className="page-kicker">
            <span className="live-dot" />
            OFFLINE POINT OF SALE
          </div>
          <h1>POS Billing</h1>
          <p>Scan or search a medicine to start a new bill.</p>
        </div>
        <div className="keyboard-hint">
          <Keyboard size={17} />
          <span>Keyboard ready</span>
          <span className="keycap">F2</span>
          <span>Search</span>
        </div>
      </header>

      {notice && (
        <div
          className={`pos-notice pos-notice--${notice.kind}`}
          data-testid="status-pos-notice"
          role="status"
        >
          {notice.kind === "error" ? (
            <AlertCircle size={18} />
          ) : notice.kind === "success" ? (
            <CircleCheck size={18} />
          ) : (
            <Check size={18} />
          )}
          <span>{notice.message}</span>
          <button
            aria-label="Dismiss notification"
            className="notice-close"
            data-testid="button-dismiss-notice"
            onClick={() => setNotice(null)}
            type="button"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <section className="pos-main-grid">
        <div className="cart-column">
          <div className="search-card">
            <div className="search-card-label">
              <div className="search-label-icon"><Barcode size={18} /></div>
              <div>
                <strong>Find a medicine</strong>
                <span>Name, generic name, or barcode</span>
              </div>
            </div>
            <div className="medicine-search-wrap">
              <Search aria-hidden="true" className="medicine-search-icon" size={19} />
              <input
                aria-autocomplete="list"
                aria-controls="medicine-search-results"
                aria-expanded={Boolean(searchQuery.trim())}
                aria-label="Search medicines by name or barcode"
                autoComplete="off"
                data-testid="input-medicine-search"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Scan barcode or type a medicine name…"
                ref={searchInputRef}
                role="combobox"
                value={searchQuery}
              />
              <span className="search-keycap">F2</span>
              {searchQuery && (
                <button
                  aria-label="Clear medicine search"
                  className="search-clear"
                  data-testid="button-clear-search"
                  onClick={() => {
                    setSearchQuery("");
                    searchInputRef.current?.focus();
                  }}
                  type="button"
                >
                  <X size={16} />
                </button>
              )}
              {searchQuery.trim() && (
                <div
                  className="search-results"
                  id="medicine-search-results"
                  role="listbox"
                  data-testid="list-search-results"
                >
                  {searchLoading ? (
                    <div className="search-result-message">
                      <span className="small-spinner" /> Searching local inventory…
                    </div>
                  ) : searchError ? (
                    <div className="search-result-message search-result-message--error">
                      <AlertCircle size={17} /> {searchError}
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="search-result-message">
                      No matching medicines found in local inventory.
                    </div>
                  ) : (
                    searchResults.map((result, index) => {
                      const batch = result.fefo_batch;
                      const isSelected = selectedResultIndex === index;
                      return (
                        <button
                          aria-selected={isSelected}
                          className={`search-result ${isSelected ? "is-selected" : ""}`}
                          data-testid={`option-medicine-${result.medicine.id}`}
                          key={result.medicine.id}
                          onClick={() => void addMedicine(result)}
                          onMouseEnter={() => setSelectedResultIndex(index)}
                          role="option"
                          type="button"
                        >
                          <span className="result-mark"><PackageCheck size={17} /></span>
                          <span className="result-main">
                            <strong>{result.medicine.name}</strong>
                            <span>
                              {[result.medicine.generic_name, batch?.batch_no && `Batch ${batch.batch_no}`]
                                .filter(Boolean)
                                .join(" · ") || "No generic name"}
                            </span>
                          </span>
                          <span className="result-stock">
                            <strong>{result.available_stock}</strong>
                            <span>in stock</span>
                          </span>
                          <span className="result-price">
                            {batch ? formatMoney(batch.sale_rate) : "Unavailable"}
                          </span>
                        </button>
                      );
                    })
                  )}
                  {searchResults.length > 0 && (
                    <div className="search-results-footer">
                      <span><kbd>↑</kbd><kbd>↓</kbd> to select</span>
                      <span><kbd>Enter</kbd> to add</span>
                      <span><kbd>Esc</kbd> to clear</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="search-assurance">
              <span><CircleCheck size={14} /> Local database</span>
              <span><PackageCheck size={14} /> First-expiry-first-out</span>
              <span><Barcode size={14} /> Scanner compatible</span>
            </div>
          </div>

          <section className="cart-card">
            <header className="cart-card-header">
              <div className="cart-title-wrap">
                <div className="cart-title-icon"><ShoppingBasket size={18} /></div>
                <div>
                  <h2>Current bill</h2>
                  <span>
                    {cart.length === 0
                      ? "Ready for your first item"
                      : `${totals.itemCount} unit${totals.itemCount === 1 ? "" : "s"} · ${cart.length} line${cart.length === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>
              {cart.length > 0 && (
                <button
                  className="button button-quiet"
                  data-testid="button-clear-cart"
                  onClick={() => {
                    replaceCart(() => []);
                    setNotice({ kind: "info", message: "Bill cleared." });
                  }}
                  type="button"
                >
                  Clear bill
                </button>
              )}
            </header>

            {cart.length === 0 ? (
              <div className="empty-cart">
                <div className="empty-cart-art">
                  <ShoppingBasket size={30} strokeWidth={1.5} />
                  <span className="empty-cart-plus"><Plus size={13} /></span>
                </div>
                <strong>Your bill is empty</strong>
                <span>Search by medicine name or scan a barcode to add your first item.</span>
                <button
                  className="button button-secondary"
                  data-testid="button-start-search"
                  onClick={() => searchInputRef.current?.focus()}
                  type="button"
                >
                  <Search size={16} /> Find medicine <span className="keycap">F2</span>
                </button>
              </div>
            ) : (
              <div className="cart-table-scroll">
                <table className="cart-table">
                  <thead>
                    <tr>
                      <th scope="col">Medicine</th>
                      <th scope="col">Batch / expiry</th>
                      <th scope="col">Unit price</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Discount</th>
                      <th scope="col">Line total</th>
                      <th scope="col"><span className="sr-only">Remove item</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.map((item) => {
                      const expiry = expiryState(item.expiry_date);
                      return (
                        <tr key={item.batch_id} data-testid={`row-cart-item-${item.batch_id}`}>
                          <td>
                            <div className="cart-product">
                              <span className="cart-product-mark"><PackageCheck size={16} /></span>
                              <span>
                                <strong>{item.medicine_name}</strong>
                                {item.generic_name && <small>{item.generic_name}</small>}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="batch-cell">
                              <strong>{item.batch_no}</strong>
                              <span className={`expiry-badge expiry-badge--${expiry}`}>
                                <span className="expiry-dot" />
                                {expiry === "expired"
                                  ? "Expired"
                                  : expiry === "soon"
                                    ? `Exp ${formatDate(item.expiry_date)}`
                                    : `Exp ${formatDate(item.expiry_date)}`}
                              </span>
                            </div>
                          </td>
                          <td className="table-money">{formatMoney(item.unit_price)}</td>
                          <td>
                            <div className="quantity-control">
                              <button
                                aria-label={`Decrease ${item.medicine_name} quantity`}
                                className="quantity-step"
                                data-testid={`button-decrease-${item.batch_id}`}
                                disabled={item.quantity <= 1}
                                onClick={() => changeQuantity(item.batch_id, item.quantity - 1)}
                                type="button"
                              >
                                <Minus size={13} />
                              </button>
                              <input
                                aria-label={`${item.medicine_name} quantity`}
                                data-testid={`input-quantity-${item.batch_id}`}
                                inputMode="numeric"
                                max={item.available_in_batch}
                                min="1"
                                onChange={(event) =>
                                  changeQuantity(item.batch_id, Number(event.target.value))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.currentTarget.blur();
                                  }
                                }}
                                type="number"
                                value={item.quantity}
                              />
                              <button
                                aria-label={`Increase ${item.medicine_name} quantity`}
                                className="quantity-step"
                                data-testid={`button-increase-${item.batch_id}`}
                                disabled={item.quantity >= item.available_in_batch}
                                onClick={() => changeQuantity(item.batch_id, item.quantity + 1)}
                                type="button"
                              >
                                <Plus size={13} />
                              </button>
                            </div>
                          </td>
                          <td>
                            <label className="discount-input">
                              <span className="sr-only">{item.medicine_name} discount</span>
                              <span>₹</span>
                              <input
                                aria-label={`${item.medicine_name} item discount`}
                                data-testid={`input-item-discount-${item.batch_id}`}
                                inputMode="decimal"
                                min="0"
                                onChange={(event) =>
                                  changeItemDiscount(item.batch_id, Number(event.target.value) || 0)
                                }
                                step="0.01"
                                type="number"
                                value={item.item_discount}
                              />
                            </label>
                          </td>
                          <td className="table-money table-money--strong">
                            {formatMoney(item.line_total)}
                          </td>
                          <td>
                            <button
                              aria-label={`Remove ${item.medicine_name}`}
                              className="remove-line-button"
                              data-testid={`button-remove-${item.batch_id}`}
                              onClick={() => removeFromCart(item.batch_id)}
                              type="button"
                            >
                              <Trash2 size={15} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {cart.length > 0 && (
              <div className="cart-footer-note">
                <span><Clock3 size={14} /> Stock is checked again at checkout.</span>
                <span>{cart.length} active batch{cart.length === 1 ? "" : "es"}</span>
              </div>
            )}
          </section>
        </div>

        <aside className="billing-column">
          <section className="summary-card">
            <header className="summary-card-header">
              <div className="summary-icon"><ReceiptText size={18} /></div>
              <div>
                <h2>Bill summary</h2>
                <span>Amounts update as you edit the cart</span>
              </div>
            </header>

            <div className="summary-lines">
              <div className="summary-row">
                <span>Subtotal <small>({totals.itemCount} units)</small></span>
                <strong data-testid="text-subtotal">{formatMoney(totals.subtotal)}</strong>
              </div>
              <div className="summary-row">
                <span>Item discounts</span>
                <strong className="discount-value" data-testid="text-item-discounts">
                  −{formatMoney(totals.itemDiscount)}
                </strong>
              </div>
              <label className="summary-row flat-discount-row">
                <span>Flat discount</span>
                <span className="flat-discount-input">
                  <span>₹</span>
                  <input
                    aria-label="Flat bill discount"
                    data-testid="input-flat-discount"
                    inputMode="decimal"
                    min="0"
                    max={totals.maxFlatDiscount}
                    onChange={(event) => setFlatDiscountInput(event.target.value)}
                    step="0.01"
                    type="number"
                    value={flatDiscountInput}
                  />
                  <ChevronDown aria-hidden="true" size={14} />
                </span>
              </label>
            </div>

            <div className="payable-block">
              <span>Final payable</span>
              <strong data-testid="text-final-payable">{formatMoney(totals.grandTotal)}</strong>
              <small>Discounts included</small>
            </div>

            <div className="payment-summary">
              <div className="summary-row">
                <span><CreditCard size={15} /> Payment mode</span>
                <strong>{paymentMode}</strong>
              </div>
              <div className="summary-row">
                <span>Cash paid</span>
                <strong data-testid="text-cash-paid">
                  {formatMoney(totals.cashTendered)}
                </strong>
              </div>
              <div className="summary-row summary-row--change">
                <span>Change due</span>
                <strong data-testid="text-change-due">
                  {formatMoney(totals.changeDue)}
                </strong>
              </div>
            </div>

            <button
              className="button button-checkout"
              data-testid="button-open-checkout"
              disabled={cart.length === 0 || isSaving}
              onClick={openCheckout}
              type="button"
            >
              <span>Proceed to checkout</span>
              <span className="checkout-button-trail"><span className="keycap">F9</span></span>
            </button>
            <div className="secure-note">
              <CircleCheck size={14} /> Sale and stock update together
            </div>
          </section>

          <section className="shortcut-card">
            <div className="shortcut-card-title">
              <Keyboard size={16} />
              <strong>Quick keys</strong>
            </div>
            <div className="shortcut-row"><span>Focus medicine search</span><kbd>F2</kbd></div>
            <div className="shortcut-row"><span>Navigate search results</span><kbd>↑</kbd><kbd>↓</kbd></div>
            <div className="shortcut-row"><span>Add selected medicine</span><kbd>Enter</kbd></div>
            <div className="shortcut-row"><span>Open checkout</span><kbd>F9</kbd></div>
            <div className="shortcut-row"><span>Close / clear search</span><kbd>Esc</kbd></div>
          </section>
        </aside>
      </section>

      <section className="recent-sales-card">
        <header className="recent-sales-header">
          <div className="recent-sales-title">
            <div className="recent-sales-icon"><FileText size={17} /></div>
            <div>
              <h2>Recent invoices</h2>
              <span>Open a completed invoice to review or reprint it.</span>
            </div>
          </div>
          <button
            className="button button-quiet"
            data-testid="button-refresh-recent-sales"
            disabled={recentSalesLoading}
            onClick={() => void refreshRecentSales()}
            type="button"
          >
            {recentSalesLoading ? <span className="small-spinner" /> : <Clock3 size={15} />}
            Refresh
          </button>
        </header>

        {recentSalesLoading ? (
          <div className="recent-empty">
            <span className="small-spinner" /> Loading local invoices…
          </div>
        ) : recentSalesError ? (
          <div className="recent-empty recent-empty--error" data-testid="status-recent-sales-error">
            <AlertCircle size={17} /> {recentSalesError}
          </div>
        ) : recentSales.length === 0 ? (
          <div className="recent-empty">
            <ReceiptText size={19} />
            No completed invoices yet. Your latest sales will appear here.
          </div>
        ) : (
          <div className="recent-sales-table-scroll">
            <table className="recent-sales-table">
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Date & time</th>
                  <th scope="col">Items</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Total</th>
                  <th scope="col"><span className="sr-only">Open invoice</span></th>
                </tr>
              </thead>
              <tbody>
                {recentSales.map(({ sale, item_count }) => (
                  <tr key={sale.id} data-testid={`row-invoice-${sale.id}`}>
                    <td><strong className="invoice-code">{sale.invoice_no}</strong></td>
                    <td>{sale.customer_name || "Walk-in"}</td>
                    <td>{formatDateTime(sale.created_at)}</td>
                    <td>{item_count}</td>
                    <td><span className="payment-pill">{sale.payment_mode}</span></td>
                    <td className="table-money table-money--strong">{formatMoney(sale.grand_total)}</td>
                    <td>
                      <button
                        aria-label={`View invoice ${sale.invoice_no}`}
                        className="open-invoice-button"
                        data-testid={`button-open-invoice-${sale.id}`}
                        disabled={openingInvoice === sale.invoice_no}
                        onClick={() => void viewInvoice(sale.invoice_no)}
                        type="button"
                      >
                        {openingInvoice === sale.invoice_no ? (
                          <span className="small-spinner" />
                        ) : (
                          <ReceiptText size={16} />
                        )}
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="pos-bottom-note">
        <span><PackageCheck size={14} /> Expired batches are excluded at search and checkout.</span>
        <span>All sales are stored on this device.</span>
      </footer>

      {checkoutOpen && (
        <CheckoutDialog
          cashTendered={cashTenderedInput}
          customerName={customerName}
          customerPhone={customerPhone}
          grandTotal={totals.grandTotal}
          isSaving={isSaving}
          onCashTenderedChange={setCashTenderedInput}
          onClose={() => setCheckoutOpen(false)}
          onConfirm={() => void completeCheckout()}
          onCustomerNameChange={setCustomerName}
          onCustomerPhoneChange={setCustomerPhone}
          onPaymentModeChange={(mode) => {
            setPaymentMode(mode);
            if (mode !== "CASH") {
              setCashTenderedInput("0");
            } else {
              setCashTenderedInput(totals.grandTotal.toFixed(2));
            }
          }}
          paymentMode={paymentMode}
        />
      )}

      {receiptSale && (
        <ReceiptPrint
          autoPrint={printReceiptOnOpen}
          onClose={() => {
            setReceiptSale(null);
            setPrintReceiptOnOpen(false);
          }}
          sale={receiptSale}
        />
      )}
    </div>
  );
}