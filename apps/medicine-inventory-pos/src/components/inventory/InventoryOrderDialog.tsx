import { AlertTriangle, ClipboardList, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { getMedicineOrderUsage } from "../../services/inventoryService";
import {
  getOrderList,
  saveOrderListItem,
} from "../../services/orderListService";
import { calculateOrderSuggestion } from "../../services/orderSuggestion";
import { getSuppliers } from "../../services/supplierService";
import type {
  MedicineInventoryRow,
  MedicineOrderUsage,
  OrderListItem,
  Supplier,
} from "../../types";

interface InventoryOrderDialogProps {
  medicine: MedicineInventoryRow;
  onClose: () => void;
  onSaved: () => void;
}

function todayLocalIso(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function InventoryOrderDialog({
  medicine,
  onClose,
  onSaved,
}: InventoryOrderDialogProps) {
  const [orderDate] = useState(todayLocalIso);
  const [usage, setUsage] = useState<MedicineOrderUsage | null>(null);
  const [orderItems, setOrderItems] = useState<OrderListItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [orderListError, setOrderListError] = useState<string | null>(null);
  const [supplierError, setSupplierError] = useState<string | null>(null);
  const [isUsageLoading, setIsUsageLoading] = useState(true);
  const [isOrderListLoading, setIsOrderListLoading] = useState(true);
  const [isSuppliersLoading, setIsSuppliersLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [quantityText, setQuantityText] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [quantityInitialized, setQuantityInitialized] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  useEffect(() => {
    let cancelled = false;
    setIsUsageLoading(true);
    setUsageError(null);
    void getMedicineOrderUsage(medicine.id)
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setUsage(null);
          setUsageError(errorMessage(error, "Recent medicine sales could not be read."));
        }
      })
      .finally(() => {
        if (!cancelled) setIsUsageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [medicine.id, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setIsOrderListLoading(true);
    setOrderListError(null);
    void getOrderList(orderDate)
      .then((rows) => {
        if (!cancelled) setOrderItems(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOrderItems([]);
          setOrderListError(errorMessage(error, "The existing order list could not be read."));
        }
      })
      .finally(() => {
        if (!cancelled) setIsOrderListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderDate, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    setIsSuppliersLoading(true);
    setSupplierError(null);
    void getSuppliers()
      .then((rows) => {
        if (!cancelled) setSuppliers(rows);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSuppliers([]);
          setSupplierError(errorMessage(error, "Supplier records could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) setIsSuppliersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const pendingItems = useMemo(
    () =>
      orderItems.filter(
        (item) => item.medicine_id === medicine.id && !item.ordered,
      ),
    [medicine.id, orderItems],
  );
  const pendingQuantity = pendingItems.reduce((sum, item) => sum + item.quantity, 0);
  const existingPendingItem = pendingItems[0] ?? null;
  const suggestion = usage && !isUsageLoading && !isOrderListLoading && !orderListError
    ? calculateOrderSuggestion({
        sellableStock: medicine.available_stock,
        reorderLevel: medicine.min_stock_alert,
        soldUnits30Days: usage.sold_units_30_days,
        salesDays30Days: usage.sales_days_30_days,
        pendingOrderQuantity: pendingQuantity,
      })
    : null;

  useEffect(() => {
    if (
      quantityInitialized ||
      isUsageLoading ||
      isOrderListLoading
    ) {
      return;
    }
    if (orderListError) return;
    const suggestedTotal =
      (existingPendingItem?.quantity ?? 0) +
      (suggestion?.suggestedAdditionalQuantity ?? 0);
    setQuantityText(
      suggestedTotal > 0 ? String(suggestedTotal) : "",
    );
    setSupplierId(
      existingPendingItem?.supplier_id ? String(existingPendingItem.supplier_id) : "",
    );
    setNote(existingPendingItem?.note ?? "");
    setQuantityInitialized(true);
  }, [
    existingPendingItem,
    isOrderListLoading,
    isUsageLoading,
    orderListError,
    quantityInitialized,
    suggestion,
  ]);

  async function saveToOrderList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const quantity = Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000_000) {
      setSaveError("Enter a whole-number quantity between 1 and 1,000,000,000.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveOrderListItem({
        ...(existingPendingItem ? { id: existingPendingItem.id } : {}),
        medicine_id: medicine.id,
        supplier_id: supplierId ? Number(supplierId) : null,
        quantity,
        note: note.trim(),
        order_date: orderDate,
      });
      onSaved();
    } catch (error) {
      setSaveError(errorMessage(error, "The medicine could not be added to the order list."));
    } finally {
      setIsSaving(false);
    }
  }

  const isLoading = isUsageLoading || isOrderListLoading;

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="inventory-order-title"
        aria-modal="true"
        className="workspace-dialog inventory-order-dialog"
        data-testid="dialog-inventory-order"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">ADD TO EXISTING ORDER LIST</span>
            <h2 id="inventory-order-title">Order {medicine.name}</h2>
            <p>
              {medicine.strength ? `${medicine.strength} · ` : ""}
              Order date {orderDate}
            </p>
          </div>
          <button
            aria-label="Close order dialog"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="inventory-order-body" onSubmit={(event) => void saveToOrderList(event)}>
          <div className="order-suggestion-summary" data-testid="order-suggestion-summary">
            <div className="order-suggestion-summary-icon"><ClipboardList size={17} /></div>
            <div>
              <strong>Suggested additional quantity</strong>
              <span data-testid="value-suggested-additional-quantity">
                {isUsageLoading || isOrderListLoading
                  ? "Calculating…"
                  : suggestion?.suggestedAdditionalQuantity.toLocaleString("en-IN") ?? "Unavailable"}
              </span>
            </div>
            {suggestion?.limitedSalesHistory && (
              <span className="order-suggestion-limited" data-testid="status-limited-sales-history">
                <AlertTriangle size={13} /> Limited history
              </span>
            )}
          </div>

          <p className="order-suggestion-formula">
            Target stock = higher of 2× the reorder level or units sold in the last 30 days.
            Suggested additional quantity = max(0, target − sellable stock − pending quantity).
            This is a deterministic restock rule, not a sales forecast.
          </p>

          <dl className="order-suggestion-facts">
            <div><dt>Sellable stock</dt><dd>{medicine.available_stock.toLocaleString("en-IN")}<small>Expired stock excluded</small></dd></div>
            <div><dt>Reorder level</dt><dd>{medicine.min_stock_alert.toLocaleString("en-IN")}</dd></div>
            <div><dt>Sold in last 30 days</dt><dd>{usage?.sold_units_30_days.toLocaleString("en-IN") ?? "Unavailable"}<small>{usage ? `${usage.sales_days_30_days} selling days` : "No usage data"}</small></dd></div>
            <div><dt>Pending on today’s list</dt><dd>{isOrderListLoading ? "Loading…" : orderListError ? "Unavailable" : pendingQuantity.toLocaleString("en-IN")}</dd></div>
            <div><dt>Target stock</dt><dd>{suggestion?.targetStock.toLocaleString("en-IN") ?? "Unavailable"}</dd></div>
          </dl>

          {suggestion?.limitedSalesHistory && (
            <p className="workspace-error inventory-order-caution" role="status">
              There are fewer than 7 distinct selling days in the last 30 days. Treat the suggestion
              as limited data and adjust the quantity if needed.
            </p>
          )}
          {suggestion?.suggestionCapped && (
            <p className="workspace-error inventory-order-caution" role="status">
              The suggested quantity exceeds the order-list limit and has been capped at
              1,000,000,000 units.
            </p>
          )}
          {usageError && (
            <p className="workspace-error" role="alert">
              {usageError} You can still enter a quantity manually.
              <button className="order-link-button" onClick={() => setReloadKey((key) => key + 1)} type="button">
                Retry
              </button>
            </p>
          )}
          {orderListError && (
            <p className="workspace-error" role="alert">
              {orderListError} Retry before saving so an existing order line is not duplicated.
              <button className="order-link-button" onClick={() => setReloadKey((key) => key + 1)} type="button">
                Retry
              </button>
            </p>
          )}
          {supplierError && (
            <p className="workspace-error" role="status">
              {supplierError} You can still add this item without selecting a supplier.
            </p>
          )}
          {existingPendingItem && (
            <p className="inventory-order-existing-note" role="status">
              An unmarked order line already exists. Saving updates that line; any other lines for
              this medicine remain unchanged.
            </p>
          )}
          {saveError && <p className="workspace-error" role="alert">{saveError}</p>}

          <div className="inventory-order-fields">
            <label>
              <span>Supplier</span>
              <select
                data-testid="select-inventory-order-supplier"
                disabled={isSuppliersLoading}
                onChange={(event) => setSupplierId(event.target.value)}
                value={supplierId}
              >
                <option value="">No supplier selected</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Requested total quantity on list</span>
              <input
                autoFocus
                data-testid="input-inventory-order-quantity"
                max={1_000_000_000}
                min={1}
                onChange={(event) => setQuantityText(event.target.value)}
                required
                step={1}
                type="number"
                value={quantityText}
              />
              <small>
                {existingPendingItem
                  ? `Starts with ${existingPendingItem.quantity} on the selected pending line plus the suggested additional amount.`
                  : "The suggested amount is prefilled when available. You can enter any whole number."}
              </small>
            </label>
            <label className="inventory-order-note-field">
              <span>Note for the wholesaler</span>
              <textarea
                data-testid="input-inventory-order-note"
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
                value={note}
              />
            </label>
          </div>

          <p className="inventory-order-no-invoice">
            Saving adds or updates an item on today’s local order list only. It does not create a
            purchase invoice or place an order with a supplier.
          </p>

          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="button button-primary"
              data-testid="button-save-inventory-order"
              disabled={isSaving || isOrderListLoading || Boolean(orderListError)}
              type="submit"
            >
              <ClipboardList size={15} />
              {isSaving ? "Saving…" : existingPendingItem ? "Update order list item" : "Add to order list"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}