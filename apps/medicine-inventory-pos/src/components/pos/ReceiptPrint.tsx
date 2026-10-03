import { Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getStoreSettings } from "../../services/settingsService";
import type { SaleDetails, StoreSettings } from "../../types";
import { formatDateTime, formatMoney } from "../../utils/money";

interface ReceiptPrintProps {
  sale: SaleDetails;
  autoPrint?: boolean;
  onClose: () => void;
}

type ReceiptWidth = "58" | "80";

export function ReceiptPrint({
  sale,
  autoPrint = false,
  onClose,
}: ReceiptPrintProps) {
  const [width, setWidth] = useState<ReceiptWidth>("80");
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const didAutoPrint = useRef(false);
  const { sale: invoice, items } = sale;
  const itemDiscountTotal = items.reduce(
    (total, item) => total + item.item_discount,
    0,
  );

  useEffect(() => {
    let cancelled = false;
    setSettingsLoaded(false);
    setSettingsLoadError(null);
    getStoreSettings()
      .then((settings) => {
        if (!cancelled) setStoreSettings(settings);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSettingsLoadError(
            error instanceof Error ? error.message : "Store receipt settings could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSettingsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.id]);

  useEffect(() => {
    if (!autoPrint || !settingsLoaded || didAutoPrint.current) {
      return;
    }
    didAutoPrint.current = true;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint, invoice.invoice_no, settingsLoaded]);

  const pharmacyName = storeSettings?.pharmacy_name.trim() || "PHARMACY";
  const pharmacyMark = pharmacyName.charAt(0).toUpperCase() || "P";
  const footerNote = storeSettings?.receipt_footer_note.trim() ?? "";

  return (
    <div className="receipt-overlay" data-testid="dialog-receipt">
      <style>{`@page { size: ${width}mm auto; margin: 0; }`}</style>
      <div className="receipt-actions">
        <div>
          <span className="eyebrow">{autoPrint ? "SALE COMPLETE" : "INVOICE DETAILS"}</span>
          <h2>{autoPrint ? "Receipt ready" : "Invoice"}</h2>
          <p>{invoice.invoice_no}</p>
        </div>
        {settingsLoadError && (
          <p className="receipt-settings-warning" role="alert">
            Store receipt details could not be loaded: {settingsLoadError}
          </p>
        )}
        <div className="receipt-action-controls">
          <label className="receipt-width-select">
            Paper width
            <select
              aria-label="Receipt paper width"
              data-testid="select-receipt-width"
              onChange={(event) => setWidth(event.target.value as ReceiptWidth)}
              value={width}
            >
              <option value="58">58 mm</option>
              <option value="80">80 mm</option>
            </select>
          </label>
          <button
            className="button button-secondary"
            data-testid="button-print-receipt"
            onClick={() => window.print()}
            type="button"
          >
            <Printer size={16} /> Print again
          </button>
          <button
            aria-label="Close receipt"
            className="icon-button"
            data-testid="button-close-receipt"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <article
        className={`receipt-paper receipt-paper--${width}`}
        data-testid="receipt-paper"
      >
        <header className="receipt-brand">
          <span className="receipt-brand-mark">{pharmacyMark}</span>
          <h1>{pharmacyName}</h1>
          {storeSettings?.address && (
            <p className="receipt-store-line">{storeSettings.address}</p>
          )}
          {storeSettings?.contact_number && (
            <p className="receipt-store-line">Contact: {storeSettings.contact_number}</p>
          )}
          {storeSettings?.drug_license_number && (
            <p className="receipt-store-line">
              D.L. No.: {storeSettings.drug_license_number}
            </p>
          )}
        </header>

        <div className="receipt-divider" />
        <div className="receipt-meta">
          <div>
            <span>Invoice</span>
            <strong>{invoice.invoice_no}</strong>
          </div>
          <div>
            <span>Date</span>
            <strong>{formatDateTime(invoice.created_at)}</strong>
          </div>
          {(invoice.customer_name || invoice.customer_phone) && (
            <div>
              <span>Customer</span>
              <strong>{invoice.customer_name || invoice.customer_phone}</strong>
            </div>
          )}
          {invoice.customer_state_code && (
            <div>
              <span>Customer state</span>
              <strong>{invoice.customer_state_code}</strong>
            </div>
          )}
          {invoice.customer_name && invoice.customer_phone && (
            <div>
              <span>Mobile</span>
              <strong>{invoice.customer_phone}</strong>
            </div>
          )}
        </div>

        <div className="receipt-divider" />
        <div className="receipt-items-heading">
          <span>ITEM / BATCH</span>
          <span>AMOUNT</span>
        </div>
        <div className="receipt-items">
          {items.map((item) => (
            <div className="receipt-item" key={item.id} data-testid={`receipt-item-${item.id}`}>
              <strong>{item.medicine_name}</strong>
              <div className="receipt-item-subline">
                <span>
                  {item.quantity} × {formatMoney(item.unit_price)}
                  {item.item_discount > 0 && ` · Discount ${formatMoney(item.item_discount)}`}
                </span>
                <strong>{formatMoney(item.total_price)}</strong>
              </div>
              <div className="receipt-item-batch">
                Batch {item.batch_no} · Exp {item.expiry_date}
              </div>
              {invoice.gst_enabled && item.gst_rate_basis_points !== undefined && (
                <div className="receipt-item-tax">
                  GST {(item.gst_rate_basis_points / 100).toFixed(2)}% · Taxable{" "}
                  {formatMoney(item.taxable_amount ?? 0)} · Tax{" "}
                  {formatMoney(item.total_gst ?? 0)}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="receipt-divider" />
        <div className="receipt-totals">
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(invoice.subtotal)}</span>
          </div>
          {itemDiscountTotal > 0 && (
            <div>
              <span>Item discounts</span>
              <span>−{formatMoney(itemDiscountTotal)}</span>
            </div>
          )}
          {invoice.flat_discount > 0 && (
            <div>
              <span>Bill discount</span>
              <span>−{formatMoney(invoice.flat_discount)}</span>
            </div>
          )}
          {invoice.gst_enabled && (
            <>
              <div>
                <span>GST pricing</span>
                <span>{invoice.gst_pricing_mode === "INCLUSIVE" ? "Inclusive" : "Exclusive"}</span>
              </div>
              {invoice.place_of_supply_state_code && (
                <div>
                  <span>Place of supply</span>
                  <span>{invoice.place_of_supply_state_code}</span>
                </div>
              )}
              <div>
                <span>Taxable amount</span>
                <span>{formatMoney(invoice.taxable_amount ?? 0)}</span>
              </div>
              {invoice.tax_type === "IGST" ? (
                <div>
                  <span>IGST</span>
                  <span>{formatMoney(invoice.igst_amount ?? 0)}</span>
                </div>
              ) : (
                <>
                  <div>
                    <span>CGST</span>
                    <span>{formatMoney(invoice.cgst_amount ?? 0)}</span>
                  </div>
                  <div>
                    <span>SGST</span>
                    <span>{formatMoney(invoice.sgst_amount ?? 0)}</span>
                  </div>
                </>
              )}
              <div className="receipt-gst-total">
                <strong>Total GST</strong>
                <strong>{formatMoney(invoice.total_gst ?? 0)}</strong>
              </div>
            </>
          )}
          <div className="receipt-grand-total">
            <strong>Grand total</strong>
            <strong>{formatMoney(invoice.grand_total)}</strong>
          </div>
          <div>
            <span>Payment</span>
            <span>{invoice.payment_mode}</span>
          </div>
          {invoice.payment_mode === "CASH" && (
            <>
              <div>
                <span>Cash received</span>
                <span>{formatMoney(invoice.cash_tendered)}</span>
              </div>
              <div>
                <span>Change</span>
                <span>{formatMoney(invoice.change_due)}</span>
              </div>
            </>
          )}
          {invoice.payment_mode === "UPI" && (
            <>
              <div>
                <span>UPI transaction ID</span>
                <span>{invoice.upi_transaction_id || "Not provided"}</span>
              </div>
              <div className="receipt-upi-warning">
                <strong>UPI payment unverified</strong>
                <span>This app does not confirm payment status.</span>
              </div>
            </>
          )}
          {invoice.payment_mode === "CREDIT" && (
            <div>
              <span>Credit balance due</span>
              <strong>{formatMoney(invoice.grand_total)}</strong>
            </div>
          )}
        </div>

        <div className="receipt-divider" />
        {footerNote && (
          <footer className="receipt-thanks">
            <span>{footerNote}</span>
          </footer>
        )}
      </article>
    </div>
  );
}