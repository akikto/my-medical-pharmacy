import {
  AlertCircle,
  CalendarDays,
  FilePlus2,
  PackagePlus,
  Plus,
  ReceiptText,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getInventoryMedicines } from "../../services/inventoryService";
import { createPurchase, getRecentPurchases } from "../../services/purchaseService";
import { getSuppliers, saveSupplier } from "../../services/supplierService";
import type {
  MedicineInventoryRow,
  PurchaseLineInput,
  RecentPurchase,
  Supplier,
  SupplierFormValues,
  StoreSettings,
} from "../../types";
import { formatDate, formatMoney, toCents } from "../../utils/money";
import { calculateGstInvoiceTotals } from "../../utils/gst";
import { getStoreSettings } from "../../services/settingsService";
import { SupplierFormDialog } from "./SupplierFormDialog";
import { PurchaseHistoryWorkspace } from "./PurchaseHistoryWorkspace";
import "./purchases.css";

interface PurchaseDraftLine extends PurchaseLineInput {
  rowId: number;
}

function localToday(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function blankLine(rowId: number): PurchaseDraftLine {
  return {
    rowId,
    medicine_id: 0,
    batch_no: "",
    expiry_date: "",
    purchase_rate: 0,
    mrp: 0,
    sale_rate: 0,
    quantity: 1,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The purchase could not be saved.";
}

export function PurchasesPage() {
  const rowIdRef = useRef(2);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [medicines, setMedicines] = useState<MedicineInventoryRow[]>([]);
  const [recentPurchases, setRecentPurchases] = useState<RecentPurchase[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(localToday);
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstPricingMode, setGstPricingMode] = useState<"INCLUSIVE" | "EXCLUSIVE">("EXCLUSIVE");
  const [placeOfSupply, setPlaceOfSupply] = useState("");
  const [items, setItems] = useState<PurchaseDraftLine[]>([blankLine(1)]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [supplierDialogError, setSupplierDialogError] = useState<string | null>(null);
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [supplierRefreshKey, setSupplierRefreshKey] = useState(0);
  const [purchaseRefreshKey, setPurchaseRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    void Promise.all([
      getSuppliers(),
      getInventoryMedicines(),
      getRecentPurchases(8),
      getStoreSettings(),
    ])
      .then(([supplierRows, medicineRows, purchaseRows, settings]) => {
        if (cancelled) return;
        setSuppliers(supplierRows);
        setMedicines(medicineRows);
        setRecentPurchases(purchaseRows);
        setStoreSettings(settings);
        setGstEnabled(settings.gst_enabled);
        setGstPricingMode(settings.gst_pricing_mode);
        setPlaceOfSupply(settings.gst_pharmacy_state_code);
        if (supplierRows.length === 1) setSelectedSupplierId(String(supplierRows[0].id));
        if (medicineRows.length > 0) {
          setItems((current) =>
            current.length === 1 && current[0].medicine_id === 0
              ? [{ ...current[0], medicine_id: medicineRows[0].id }]
              : current,
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [purchaseRefreshKey, supplierRefreshKey]);

  const purchaseTotal = useMemo(
    () => calculateGstInvoiceTotals(
      items.map((item) => ({
        quantity: Number.isSafeInteger(item.quantity) ? item.quantity : 0,
        unit_price_cents: toCents(item.purchase_rate),
        item_discount_cents: 0,
        gst_rate_basis_points: medicines.find((medicine) => medicine.id === item.medicine_id)?.gst_rate_basis_points ?? null,
        gst_rate_override_basis_points: item.gst_rate_override_basis_points ?? null,
      })),
      0,
      gstEnabled,
      storeSettings?.gst_default_rate_basis_points ?? null,
      gstPricingMode,
      storeSettings?.gst_pharmacy_state_code ?? "",
      placeOfSupply || null,
    ).grand_total_cents / 100,
    [items, medicines, gstEnabled, gstPricingMode, storeSettings, placeOfSupply],
  );
  const gstSummary = useMemo(() => calculateGstInvoiceTotals(
    items.map((item) => ({
      quantity: Number.isSafeInteger(item.quantity) ? item.quantity : 0,
      unit_price_cents: toCents(item.purchase_rate),
      item_discount_cents: 0,
      gst_rate_basis_points: medicines.find((medicine) => medicine.id === item.medicine_id)?.gst_rate_basis_points ?? null,
      gst_rate_override_basis_points: item.gst_rate_override_basis_points ?? null,
    })),
    0,
    gstEnabled,
    storeSettings?.gst_default_rate_basis_points ?? null,
    gstPricingMode,
    storeSettings?.gst_pharmacy_state_code ?? "",
    placeOfSupply || null,
  ), [items, medicines, gstEnabled, gstPricingMode, storeSettings, placeOfSupply]);

  function updateLine(rowId: number, values: Partial<PurchaseLineInput>) {
    setItems((current) =>
      current.map((item) => item.rowId === rowId ? { ...item, ...values } : item),
    );
  }

  function addLine() {
    const rowId = rowIdRef.current++;
    setItems((current) => [
      ...current,
      blankLine(rowId),
    ]);
  }

  function removeLine(rowId: number) {
    setItems((current) =>
      current.length <= 1 ? current : current.filter((item) => item.rowId !== rowId),
    );
  }

  async function handleSupplierSave(values: SupplierFormValues) {
    setIsSavingSupplier(true);
    setSupplierDialogError(null);
    try {
      const id = await saveSupplier(values);
      setSelectedSupplierId(String(id));
      setSupplierDialog(false);
      setSupplierRefreshKey((current) => current + 1);
      setNotice(`${values.name.trim()} was added and selected for this purchase.`);
    } catch (error) {
      setSupplierDialogError(getErrorMessage(error));
    } finally {
      setIsSavingSupplier(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      const completed = await createPurchase({
        supplier_id: Number(selectedSupplierId),
        invoice_no: invoiceNo,
        purchase_date: purchaseDate,
        gst_pricing_mode: gstPricingMode,
        place_of_supply_state_code: placeOfSupply || null,
        items: items.map(({ rowId: _rowId, ...item }) => item),
      });
      setNotice(
        `Purchase saved. ${formatMoney(completed.totalCents / 100)} recorded and stock updated in one transaction.`,
      );
      setInvoiceNo("");
      setPurchaseDate(localToday());
      setGstEnabled(storeSettings?.gst_enabled ?? false);
      setGstPricingMode(storeSettings?.gst_pricing_mode ?? "EXCLUSIVE");
      setPlaceOfSupply(storeSettings?.gst_pharmacy_state_code ?? "");
      setItems([blankLine(rowIdRef.current++)]);
      setPurchaseRefreshKey((current) => current + 1);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="workspace-page purchases-page" data-testid="page-purchases">
      <header className="workspace-page-header">
        <div>
          <div className="page-kicker"><span className="live-dot" /> STOCK IN</div>
          <h1>Purchases</h1>
          <p>Record supplier invoices and receive stock into medicine batches.</p>
        </div>
        <div className="purchase-page-badge"><Truck size={17} /> Offline purchase entry</div>
      </header>

      {notice && (
        <div className="workspace-notice workspace-notice--success" role="status">
          <PackagePlus size={16} />
          <span>{notice}</span>
          <button aria-label="Dismiss notice" className="notice-close" onClick={() => setNotice(null)} type="button">
            <X size={15} />
          </button>
        </div>
      )}

      {loadError && (
        <div className="workspace-error workspace-error--banner" role="alert">
          <AlertCircle size={16} /> {loadError}
          <button className="button button-secondary" onClick={() => { setSupplierRefreshKey((current) => current + 1); setPurchaseRefreshKey((current) => current + 1); }} type="button">Retry</button>
        </div>
      )}

      <section className="workspace-card purchase-entry-card">
        <div className="purchase-section-heading">
          <div className="purchase-section-icon"><FilePlus2 size={18} /></div>
          <div>
            <h2>New purchase invoice</h2>
            <p>Stock and purchase records are saved together or rolled back together.</p>
          </div>
        </div>

        {suppliers.length === 0 && !isLoading && (
          <div className="purchase-inline-warning">
            <Truck size={16} />
            <span>Add a supplier before entering a purchase invoice.</span>
            <button
              className="button button-secondary"
              onClick={() => {
                setSupplierDialogError(null);
                setSupplierDialog(true);
              }}
              type="button"
            >
              <Plus size={14} /> Add supplier
            </button>
          </div>
        )}
        {medicines.length === 0 && !isLoading && (
          <div className="purchase-inline-warning">
            <AlertCircle size={16} />
            <span>Add a medicine in Inventory before adding a purchase line.</span>
          </div>
        )}

        <form className="purchase-form" onSubmit={(event) => void handleSubmit(event)}>
          <div className="purchase-header-fields">
            <label className="field-label">
              Supplier
              <span className="purchase-select-line">
                <select
                  className="workspace-input"
                  data-testid="select-purchase-supplier"
                  onChange={(event) => {
                    setSelectedSupplierId(event.target.value);
                    const supplier = suppliers.find((row) => String(row.id) === event.target.value);
                    if (supplier?.state_code) setPlaceOfSupply(supplier.state_code);
                    else if (storeSettings?.gst_pharmacy_state_code) {
                      setPlaceOfSupply(storeSettings.gst_pharmacy_state_code);
                    }
                  }}
                  required
                  value={selectedSupplierId}
                >
                  <option value="">Select a supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
                <button
                  aria-label="Add a supplier"
                  className="icon-button"
                  onClick={() => {
                    setSupplierDialogError(null);
                    setSupplierDialog(true);
                  }}
                  type="button"
                >
                  <Plus size={16} />
                </button>
              </span>
            </label>
            <label className="field-label">
              Supplier invoice number
              <input
                className="workspace-input"
                data-testid="input-purchase-invoice"
                maxLength={100}
                onChange={(event) => setInvoiceNo(event.target.value)}
                required
                value={invoiceNo}
              />
            </label>
            <label className="field-label">
              Purchase date
              <span className="purchase-date-field">
                <CalendarDays size={15} />
                <input
                  className="workspace-input"
                  data-testid="input-purchase-date"
                  onChange={(event) => setPurchaseDate(event.target.value)}
                  required
                  type="date"
                  value={purchaseDate}
                />
              </span>
            </label>
          </div>

          <div className="purchase-gst-controls">
            <label className="purchase-gst-toggle">
              <input
                checked={gstEnabled}
                disabled
                onChange={(event) => setGstEnabled(event.target.checked)}
                type="checkbox"
              />
              <span className="purchase-gst-check" aria-hidden="true" />
              <span><strong>GST {gstEnabled ? "enabled" : "disabled"} for this store</strong><small>Controlled by pharmacy GST settings.</small></span>
            </label>
            {gstEnabled && (
              <div className="purchase-gst-fields">
                <label className="field-label">
                  Pricing
                  <select className="workspace-input" onChange={(event) => setGstPricingMode(event.target.value as "INCLUSIVE" | "EXCLUSIVE")} value={gstPricingMode}>
                    <option value="EXCLUSIVE">GST added to rate</option>
                    <option value="INCLUSIVE">Rate includes GST</option>
                  </select>
                </label>
                <label className="field-label">
                  Place of supply
                  <input className="workspace-input" inputMode="numeric" maxLength={2} onChange={(event) => setPlaceOfSupply(event.target.value.replace(/\D/g, ""))} placeholder="State code" value={placeOfSupply} />
                </label>
                <div className="purchase-gst-note">
                  <span>{gstSummary.tax_type === "IGST" ? "Inter-state · IGST" : "Intra-state · CGST + SGST"}</span>
                  <strong>{gstSummary.missing_rate ? "Rate missing on one or more medicines" : `GST ${formatMoney(gstSummary.total_gst_cents / 100)}`}</strong>
                </div>
              </div>
            )}
            {!gstEnabled && <span className="purchase-gst-config-note">Enable GST in Settings to calculate tax on supplier invoices.</span>}
          </div>

          <div className="purchase-lines-header">
            <div>
              <h3>Invoice line items</h3>
              <span>{items.length} line{items.length === 1 ? "" : "s"}</span>
            </div>
            <button
              className="button button-secondary"
              data-testid="button-add-purchase-line"
              disabled={medicines.length === 0}
              onClick={addLine}
              type="button"
            >
              <Plus size={15} /> Add line
            </button>
          </div>

          <div className="workspace-table-scroll purchase-lines-scroll">
            <table className="workspace-table purchase-lines-table">
              <thead>
                <tr>
                  <th scope="col">Medicine</th>
                  <th scope="col">Batch number</th>
                  <th scope="col">Expiry date</th>
                  <th scope="col">Purchase rate</th>
                  <th scope="col">MRP</th>
                  <th scope="col">Sale rate</th>
                  <th scope="col">Qty</th>
                  <th scope="col">GST %</th>
                  <th scope="col">Line total</th>
                  <th scope="col"><span className="sr-only">Remove line</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.rowId} data-testid={`row-purchase-line-${index + 1}`}>
                    <td>
                      <select
                        aria-label={`Medicine on line ${index + 1}`}
                        className="purchase-line-input purchase-medicine-select"
                        data-testid={`select-purchase-medicine-${index + 1}`}
                        onChange={(event) => updateLine(item.rowId, { medicine_id: Number(event.target.value) })}
                        required
                        value={item.medicine_id || ""}
                      >
                        <option value="">Select medicine</option>
                        {medicines.map((medicine) => (
                          <option key={medicine.id} value={medicine.id}>{medicine.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`Batch number on line ${index + 1}`}
                        className="purchase-line-input"
                        data-testid={`input-purchase-batch-${index + 1}`}
                        maxLength={80}
                        onChange={(event) => updateLine(item.rowId, { batch_no: event.target.value })}
                        required
                        value={item.batch_no}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Expiry date on line ${index + 1}`}
                        className="purchase-line-input"
                        aria-describedby={`purchase-expiry-format-${index + 1}`}
                        data-testid={`input-purchase-expiry-${index + 1}`}
                        min={localToday()}
                        onChange={(event) => updateLine(item.rowId, { expiry_date: event.target.value })}
                        required
                        type="date"
                        value={item.expiry_date}
                      />
                      <small className="purchase-date-format" id={`purchase-expiry-format-${index + 1}`}>
                        dd-mm-yyyy
                      </small>
                    </td>
                    <td>
                      <input
                        aria-label={`Purchase rate on line ${index + 1}`}
                        className="purchase-line-input purchase-line-input--number"
                        data-testid={`input-purchase-rate-${index + 1}`}
                        min={0}
                        onChange={(event) => updateLine(item.rowId, { purchase_rate: Number(event.target.value) })}
                        required
                        step="0.01"
                        type="number"
                        value={item.purchase_rate}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`MRP on line ${index + 1}`}
                        className="purchase-line-input purchase-line-input--number"
                        data-testid={`input-purchase-mrp-${index + 1}`}
                        min={0}
                        onChange={(event) => updateLine(item.rowId, { mrp: Number(event.target.value) })}
                        required
                        step="0.01"
                        type="number"
                        value={item.mrp}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Sale rate on line ${index + 1}`}
                        className="purchase-line-input purchase-line-input--number"
                        data-testid={`input-purchase-sale-rate-${index + 1}`}
                        min={0}
                        onChange={(event) => updateLine(item.rowId, { sale_rate: Number(event.target.value) })}
                        required
                        step="0.01"
                        type="number"
                        value={item.sale_rate}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Quantity on line ${index + 1}`}
                        className="purchase-line-input purchase-line-input--number"
                        data-testid={`input-purchase-quantity-${index + 1}`}
                        min={1}
                        onChange={(event) => updateLine(item.rowId, { quantity: Number(event.target.value) })}
                        required
                        step={1}
                        type="number"
                        value={item.quantity}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`GST rate override on line ${index + 1}; leave blank for medicine rate`}
                        className="purchase-line-input purchase-line-input--number"
                        data-testid={`input-purchase-gst-override-${index + 1}`}
                        max={100}
                        min={0}
                        onChange={(event) => updateLine(item.rowId, {
                          gst_rate_override_basis_points: event.target.value === "" ? null : Math.round(Number(event.target.value) * 100),
                        })}
                        placeholder={String(((medicines.find((medicine) => medicine.id === item.medicine_id)?.gst_rate_basis_points ?? storeSettings?.gst_default_rate_basis_points ?? 0) / 100))}
                        step="0.01"
                        type="number"
                        value={item.gst_rate_override_basis_points == null ? "" : item.gst_rate_override_basis_points / 100}
                      />
                    </td>
                    <td className="purchase-line-total">
                      {formatMoney((toCents(item.purchase_rate) * item.quantity) / 100)}
                    </td>
                    <td>
                      <button
                        aria-label={`Remove purchase line ${index + 1}`}
                        className="icon-button icon-button--danger"
                        disabled={items.length <= 1}
                        onClick={() => removeLine(item.rowId)}
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {formError && <div className="workspace-error workspace-error--banner" role="alert"><AlertCircle size={16} /> {formError}</div>}
          <footer className="purchase-total-bar">
            <div>
              <span>Invoice total</span>
              <strong>{formatMoney(purchaseTotal)}</strong>
              {gstEnabled && <small className="purchase-total-tax-caption">Taxable {formatMoney(gstSummary.taxable_cents / 100)} · GST {formatMoney(gstSummary.total_gst_cents / 100)}</small>}
            </div>
            <button
              className="button button-primary purchase-save-button"
              data-testid="button-save-purchase"
              disabled={isSaving || isLoading || suppliers.length === 0 || medicines.length === 0}
              type="submit"
            >
              <ReceiptText size={16} /> {isSaving ? "Saving purchase…" : "Save purchase & stock-in"}
            </button>
          </footer>
        </form>
      </section>

      <section className="workspace-card recent-purchases-card">
        <div className="purchase-section-heading">
          <div className="purchase-section-icon"><ReceiptText size={18} /></div>
          <div>
            <h2>Recent purchase invoices</h2>
            <p>Latest stock-in records saved on this device.</p>
          </div>
        </div>
        {recentPurchases.length === 0 ? (
          <div className="workspace-empty purchase-empty">
            <ReceiptText size={24} />
            <strong>No purchase invoices recorded</strong>
            <span>Saved invoices will appear here with their received stock totals.</span>
          </div>
        ) : (
          <div className="workspace-table-scroll">
            <table className="workspace-table recent-purchases-table">
              <thead>
                <tr>
                  <th scope="col">Supplier invoice</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Purchase date</th>
                  <th scope="col">Lines</th>
                  <th scope="col">Units received</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {recentPurchases.map((purchase) => (
                  <tr key={purchase.id} data-testid={`row-purchase-${purchase.id}`}>
                    <td><strong>{purchase.invoice_no}</strong></td>
                    <td>{purchase.supplier_name || "Supplier not available"}</td>
                    <td>{formatDate(purchase.purchase_date)}</td>
                    <td>{purchase.item_count}</td>
                    <td>{purchase.total_units}</td>
                    <td><strong>{formatMoney(purchase.total_amount)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <PurchaseHistoryWorkspace
        suppliers={suppliers}
        refreshKey={purchaseRefreshKey}
        onMutation={() => setPurchaseRefreshKey((current) => current + 1)}
      />

      {supplierDialog && (
        <SupplierFormDialog
          error={supplierDialogError}
          isSaving={isSavingSupplier}
          onClose={() => {
            setSupplierDialog(false);
            setSupplierDialogError(null);
          }}
          onSave={(values: SupplierFormValues) => void handleSupplierSave(values)}
          supplier={null}
        />
      )}
    </section>
  );
}