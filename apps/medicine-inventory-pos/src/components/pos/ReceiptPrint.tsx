import { Printer, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SaleDetails } from "../../types";
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
  const didAutoPrint = useRef(false);
  const { sale: invoice, items } = sale;
  const itemDiscountTotal = items.reduce(
    (total, item) => total + item.item_discount,
    0,
  );

  useEffect(() => {
    if (!autoPrint || didAutoPrint.current) {
      return;
    }
    didAutoPrint.current = true;
    const timer = window.setTimeout(() => window.print(), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint, invoice.invoice_no]);

  return (
    <div className="receipt-overlay" data-testid="dialog-receipt">
      <style>{`@page { size: ${width}mm auto; margin: 0; }`}</style>
      <div className="receipt-actions">
        <div>
          <span className="eyebrow">{autoPrint ? "SALE COMPLETE" : "INVOICE DETAILS"}</span>
          <h2>{autoPrint ? "Receipt ready" : "Invoice"}</h2>
          <p>{invoice.invoice_no}</p>
        </div>
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
          <span className="receipt-brand-mark">P</span>
          <h1>PHARMACY</h1>
          <p>MEDICINE & WELLNESS</p>
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
        </div>

        <div className="receipt-divider" />
        <footer className="receipt-thanks">
          <strong>Thank you for choosing us.</strong>
          <span>Please retain this receipt for your records.</span>
        </footer>
      </article>
    </div>
  );
}