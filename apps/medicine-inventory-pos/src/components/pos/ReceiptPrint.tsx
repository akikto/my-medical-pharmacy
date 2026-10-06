import { Printer, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getStoreSettings } from "../../services/settingsService";
import type { SaleDetails, StoreSettings } from "../../types";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { formatDateTime, formatMoney } from "../../utils/money";
import { getReceiptPageRule, type ReceiptWidth } from "./receiptPrintModel";

interface ReceiptPrintProps {
  sale: SaleDetails;
  autoPrint?: boolean;
  inPrintWindow?: boolean;
  initialWidth?: ReceiptWidth;
  onClose: () => void;
}

export function ReceiptPrint({
  sale,
  autoPrint = false,
  inPrintWindow = false,
  initialWidth = "80",
  onClose,
}: ReceiptPrintProps) {
  const [width, setWidth] = useState<ReceiptWidth>(initialWidth);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);
  const didAutoPrint = useRef(false);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  const receiptPaperRef = useRef<HTMLElement>(null);
  const { sale: invoice, items } = sale;
  const itemDiscountTotal = items.reduce(
    (total, item) => total + item.item_discount,
    0,
  );

  useDialogFocusTrap(dialogRef);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!inPrintWindow) return;

    const pageStyle = document.createElement("style");
    pageStyle.dataset.receiptPageSettings = "true";
    pageStyle.textContent = getReceiptPageRule(width);
    document.head.appendChild(pageStyle);
    return () => pageStyle.remove();
  }, [inPrintWindow, width]);

  const printReceipt = useCallback(async () => {
    setPrintError(null);
    if (!inPrintWindow) {
      try {
        await invoke("open_receipt_print_window", {
          invoiceNo: encodeURIComponent(invoice.invoice_no),
          paperWidth: width,
        });
        return true;
      } catch (error) {
        setPrintError(
          error instanceof Error
            ? `Could not open print preview: ${error.message}`
            : "Could not open print preview.",
        );
        return false;
      }
    }

    try {
      const paper = receiptPaperRef.current;
      if (!paper?.isConnected) {
        throw new Error("The invoice is not ready for printing.");
      }
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => resolve());
        });
      });
      if (!paper.isConnected) {
        throw new Error("The invoice closed before it could be printed.");
      }
      const bounds = paper.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) {
        throw new Error("The invoice has not finished rendering for print preview.");
      }
      await invoke("set_receipt_print_active", { active: true });
      window.print();
      return true;
    } catch (error) {
      void invoke("set_receipt_print_active", { active: false }).catch(
        (resetError: unknown) => {
          setPrintError(
            resetError instanceof Error
              ? `Print protection could not be reset: ${resetError.message}`
              : "Print protection could not be reset.",
          );
        },
      );
      setPrintError(
        error instanceof Error
          ? `Could not open print preview: ${error.message}`
          : "Could not open print preview.",
      );
      return false;
    }
  }, [inPrintWindow, invoice.invoice_no, width]);

  useEffect(() => {
    const handleAfterPrint = () => {
      void invoke("set_receipt_print_active", { active: false }).catch(
        (error: unknown) => {
          setPrintError(
            error instanceof Error
              ? `Could not reset print protection: ${error.message}`
              : "Could not reset print protection.",
          );
        },
      );
    };
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, []);

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
    if (!autoPrint) {
      didAutoPrint.current = false;
      return;
    }
    if (!settingsLoaded || didAutoPrint.current) {
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      if (disposed || didAutoPrint.current) return;
      didAutoPrint.current = true;
      void printReceipt().then((opened) => {
        if (opened && autoPrint && !inPrintWindow && !disposed) {
          onCloseRef.current();
        }
      });
    }, 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [autoPrint, inPrintWindow, invoice.invoice_no, printReceipt, settingsLoaded]);

  const pharmacyName = storeSettings?.pharmacy_name.trim() || "PHARMACY";
  const pharmacyMark = pharmacyName.charAt(0).toUpperCase() || "P";
  const footerNote = storeSettings?.receipt_footer_note.trim() ?? "";
  const isStandardPaper = width === "A4" || width === "A5";

  const receiptDocument = (
    <div
      aria-labelledby="receipt-dialog-title"
      aria-modal="true"
      className="receipt-overlay"
      data-testid="dialog-receipt"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="receipt-actions">
        <div>
          <span className="eyebrow">{autoPrint ? "SALE COMPLETE" : "INVOICE DETAILS"}</span>
          <h2 id="receipt-dialog-title">{autoPrint ? "Receipt ready" : "Invoice"}</h2>
          <p>{invoice.invoice_no}</p>
        </div>
        {settingsLoadError && (
          <p className="receipt-settings-warning" role="alert">
            Store receipt details could not be loaded: {settingsLoadError}
          </p>
        )}
        {printError && (
          <p className="receipt-settings-warning" role="alert">
            {printError}
          </p>
        )}
        <div className="receipt-action-controls">
          <label className="receipt-width-select">
            Paper size
            <select
              aria-label="Receipt paper size"
              data-testid="select-receipt-width"
              onChange={(event) => setWidth(event.target.value as ReceiptWidth)}
              value={width}
            >
              <option value="58">58 mm roll</option>
              <option value="80">80 mm roll</option>
              <option value="A4">A4</option>
              <option value="A5">A5</option>
            </select>
            {!isStandardPaper && (
              <small className="receipt-roll-hint">Match this width in printer settings.</small>
            )}
          </label>
          <button
            className="button button-secondary"
            data-testid="button-print-receipt"
            onClick={() => void printReceipt()}
            type="button"
          >
            <Printer size={16} /> Print again
          </button>
          <button
            autoFocus
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
        className={`receipt-paper receipt-paper--${width.toLowerCase()}`}
        data-testid="receipt-paper"
        ref={receiptPaperRef}
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
          {invoice.payment_reference && (
            <div>
              <span>Payment reference</span>
              <span>{invoice.payment_reference}</span>
            </div>
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
      {!autoPrint && (sale.returns.length > 0 || sale.corrections.length > 0 || sale.void) && (
        <section className="sale-receipt-activity" aria-labelledby="sale-receipt-activity-title">
          <h3 id="sale-receipt-activity-title">Invoice activity</h3>
          {sale.void && (
            <article className="sale-receipt-activity-item" data-testid="receipt-invoice-void">
              <strong>Cancelled · {formatMoney(sale.void.refund)}</strong>
              <span>{sale.void.refund_mode} · {formatDateTime(sale.void.created_at)}</span>
              {sale.void.payment_reference && <span>Reference: {sale.void.payment_reference}</span>}
              {sale.void.upi_transaction_id && <span>UPI ID: {sale.void.upi_transaction_id}</span>}
              {sale.void.note && <span>{sale.void.note}</span>}
            </article>
          )}
          {sale.returns.map((record) => (
            <article className="sale-receipt-activity-item" key={record.id} data-testid={`receipt-return-${record.id}`}>
              <strong>{record.return_no} · {formatMoney(record.total)}</strong>
              <span>{record.refund_mode} · {formatDateTime(record.created_at)}</span>
              {record.payment_reference && <span>Reference: {record.payment_reference}</span>}
              {record.upi_transaction_id && <span>UPI ID: {record.upi_transaction_id}</span>}
              {record.note && <span>{record.note}</span>}
              <ul>
                {record.items.map((item) => (
                  <li key={item.sale_item_id}>
                    {item.medicine_name} · batch {item.batch_no} · {item.quantity} returned · {formatMoney(item.refund)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {sale.corrections.map((record) => (
            <article className="sale-receipt-activity-item" key={record.id} data-testid={`receipt-correction-${record.id}`}>
              <strong>Invoice correction · {formatDateTime(record.created_at)}</strong>
              {(record.adjustment_debit > 0 || record.adjustment_credit > 0) && (
                <span>
                  Account adjustment: {record.adjustment_debit > 0
                    ? `+${formatMoney(record.adjustment_debit)}`
                    : `−${formatMoney(record.adjustment_credit)}`}
                </span>
              )}
              {record.adjustment_mode && <span>Settlement: {record.adjustment_mode}</span>}
              {record.adjustment_reference && <span>Reference: {record.adjustment_reference}</span>}
              {record.note && <span>{record.note}</span>}
              <span>Original and corrected invoice snapshots are retained in the audit trail.</span>
            </article>
          ))}
        </section>
      )}
    </div>
  );
  return inPrintWindow ? receiptDocument : createPortal(receiptDocument, document.body);
}