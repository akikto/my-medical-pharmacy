import { ArrowRight, CreditCard, Phone, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCustomers } from "../../services/customerService";
import type { Customer, PaymentMode } from "../../types";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { gstStateName } from "../../utils/gstStates";
import { formatMoney } from "../../utils/money";
import { createUpiPaymentLink } from "../../utils/upi";

interface CheckoutDialogProps {
  customerId: number | null;
  customerBalanceDue: number | null;
  customerStateCode: string | null;
  customerName: string;
  customerPhone: string;
  paymentMode: PaymentMode;
  cashTendered: string;
  grandTotal: number;
  gstEnabled: boolean;
  gstPricingMode: "INCLUSIVE" | "EXCLUSIVE";
  taxType: "NONE" | "CGST_SGST" | "IGST";
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalGst: number;
  upiId: string;
  upiDisplayName: string;
  upiTransactionId: string;
  isSaving: boolean;
  canConfirm: boolean;
  onCustomerNameChange: (value: string) => void;
  onCustomerPhoneChange: (value: string) => void;
  onCustomerSelect: (customer: Customer | null) => void;
  onPaymentModeChange: (value: PaymentMode) => void;
  onCashTenderedChange: (value: string) => void;
  onUpiTransactionIdChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}

const paymentModes: Array<{ value: PaymentMode; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "CREDIT", label: "Credit" },
  { value: "OTHER", label: "Other" },
];

export function CheckoutDialog({
  customerId,
  customerBalanceDue,
  customerStateCode,
  customerName,
  customerPhone,
  paymentMode,
  cashTendered,
  grandTotal,
  gstEnabled,
  gstPricingMode,
  taxType,
  taxableAmount,
  cgstAmount,
  sgstAmount,
  igstAmount,
  totalGst,
  upiId,
  upiDisplayName,
  upiTransactionId,
  isSaving,
  canConfirm,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onCustomerSelect,
  onPaymentModeChange,
  onCashTenderedChange,
  onUpiTransactionIdChange,
  onClose,
  onConfirm,
}: CheckoutDialogProps) {
  const tendered = Number(cashTendered) || 0;
  const changeDue = paymentMode === "CASH" ? Math.max(tendered - grandTotal, 0) : 0;
  const remaining = paymentMode === "CASH" ? Math.max(grandTotal - tendered, 0) : 0;
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([]);
  const [customerLookupError, setCustomerLookupError] = useState<string | null>(null);
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const [upiOpenError, setUpiOpenError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const upiLink =
    paymentMode === "UPI"
      ? createUpiPaymentLink(upiId, upiDisplayName, grandTotal, "MY MEDICAL sale")
      : null;

  useDialogFocusTrap(dialogRef);

  async function openUpiPayment() {
    if (!upiLink) return;
    try {
      await openUrl(upiLink);
      setUpiOpenError(null);
    } catch (error) {
      setUpiOpenError(
        error instanceof Error
          ? `Could not open a UPI app: ${error.message}`
          : "Could not open a UPI app on this device.",
      );
    }
  }

  useEffect(() => {
    const query = customerName.trim();
    if (customerId !== null || query.length < 2) {
      setCustomerOptions([]);
      setCustomerLookupError(null);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      getCustomers(query, false)
        .then((customers) => {
          if (!cancelled) {
            setCustomerOptions(customers);
            setCustomerLookupError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCustomerOptions([]);
            setCustomerLookupError("Saved customer search is unavailable. You can continue as a walk-in.");
          }
        });
    }, 160);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [customerId, customerName]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm();
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="checkout-title"
        aria-modal="true"
        className="checkout-dialog"
        role="dialog"
        data-testid="dialog-checkout"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">FINAL STEP</span>
            <h2 id="checkout-title">Complete checkout</h2>
            <p>Confirm payment details before saving this invoice.</p>
          </div>
          <button
            aria-label="Close checkout"
            className="icon-button"
            data-testid="button-close-checkout"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="checkout-fields">
            <div className="customer-autocomplete">
              <label className="field-label">
              <span>Customer name <span className="field-optional">Optional</span></span>
              <span className="input-with-icon">
                <UserRound aria-hidden="true" size={17} />
                <input
                  autoFocus
                  data-testid="input-customer-name"
                  maxLength={120}
                  onChange={(event) => {
                    onCustomerSelect(null);
                    onCustomerNameChange(event.target.value);
                    setShowCustomerOptions(true);
                  }}
                  placeholder="Walk-in customer"
                  value={customerName}
                />
              </span>
              </label>
              {showCustomerOptions && customerId === null && customerOptions.length > 0 && (
                <div className="customer-autocomplete-options" role="listbox" aria-label="Saved customers">
                  {customerOptions.slice(0, 6).map((customer) => (
                    <button
                      aria-selected="false"
                      className="customer-autocomplete-option"
                      data-testid={`button-select-customer-${customer.id}`}
                      key={customer.id}
                      onClick={() => {
                        onCustomerSelect(customer);
                        setShowCustomerOptions(false);
                        setCustomerOptions([]);
                      }}
                      role="option"
                      type="button"
                    >
                      <span><strong>{customer.name}</strong><small>{customer.phone || "No phone"}</small></span>
                      <span>{formatMoney(customer.balance_due)} due</span>
                    </button>
                  ))}
                </div>
              )}
              {customerLookupError && <small className="customer-lookup-error">{customerLookupError}</small>}
              {customerId !== null && (
                <small className="saved-customer-state">
                  Saved customer · GST state: {gstStateName(customerStateCode)}
                </small>
              )}
            </div>
            <label className="field-label">
              <span>Mobile number <span className="field-optional">Optional</span></span>
              <span className="input-with-icon">
                <Phone aria-hidden="true" size={17} />
                <input
                  autoComplete="tel"
                  data-testid="input-customer-phone"
                  inputMode="tel"
                  maxLength={30}
                  onChange={(event) => {
                    onCustomerSelect(null);
                    onCustomerPhoneChange(event.target.value);
                  }}
                  placeholder="Customer phone"
                  value={customerPhone}
                />
              </span>
            </label>
          </div>

          {customerId !== null && (
            <div
              className="customer-balance-summary"
              data-testid="text-existing-customer-balance"
            >
              <span>Existing balance due</span>
              <strong>{formatMoney(customerBalanceDue ?? 0)}</strong>
            </div>
          )}

          <fieldset className="payment-fieldset">
            <legend>Payment method</legend>
            <div className="payment-mode-options">
              {paymentModes.map((mode) => (
                <button
                  aria-pressed={paymentMode === mode.value}
                  className={`payment-mode-option payment-mode-option--${mode.value.toLowerCase()} ${paymentMode === mode.value ? "is-selected" : ""}`}
                  data-testid={`button-payment-${mode.value.toLowerCase()}`}
                  key={mode.value}
                  onClick={() => onPaymentModeChange(mode.value)}
                  type="button"
                >
                  {mode.value === "CASH" ? <span className="cash-symbol">₹</span> : <CreditCard size={16} />}
                  {mode.label}
                </button>
              ))}
            </div>
          </fieldset>

          {paymentMode === "UPI" ? (
            <div className="checkout-upi-fields">
              <div className="checkout-upi-identity" data-testid="text-configured-upi-id">
                <span>Pay to</span>
                <strong>{upiDisplayName || "Pharmacy UPI"}</strong>
                <code>{upiId || "No UPI ID configured"}</code>
              </div>
              {upiLink ? (
                <button
                  className="button button-secondary"
                  data-testid="button-open-upi"
                  onClick={() => void openUpiPayment()}
                  type="button"
                >
                  Open UPI app
                </button>
              ) : (
                <p className="field-hint">
                  Add a UPI ID in Settings to create a payment link.
                </p>
              )}
              {upiOpenError && <p className="customer-lookup-error" role="alert">{upiOpenError}</p>}
              <label className="field-label">
                UPI transaction ID <span className="field-optional">Optional</span>
                <input
                  className="workspace-input"
                  data-testid="input-upi-transaction-id"
                  maxLength={120}
                  onChange={(event) => onUpiTransactionIdChange(event.target.value)}
                  value={upiTransactionId}
                />
              </label>
              <p className="checkout-upi-warning" role="note">
                The app does not verify UPI payments. Confirm payment in your UPI app; this invoice will be marked unverified.
              </p>
            </div>
          ) : paymentMode === "CREDIT" ? (
            <div className="noncash-note">
              <CreditCard aria-hidden="true" size={18} />
              <span>
                {customerId === null
                  ? "Select a saved customer to record this invoice as credit."
                  : `This will add ${formatMoney(grandTotal)} to ${customerName.trim() || "the customer"}’s balance.`}
              </span>
            </div>
          ) : null}

          {gstEnabled && (
            <div className="checkout-tax-summary" data-testid="checkout-tax-summary">
              <div><span>Pricing mode</span><strong>{gstPricingMode === "INCLUSIVE" ? "Tax included" : "Tax added"}</strong></div>
              <div><span>Taxable amount</span><strong>{formatMoney(taxableAmount)}</strong></div>
              <div><span>{taxType === "IGST" ? "IGST" : "CGST + SGST"}</span><strong>{formatMoney(totalGst)}</strong></div>
              {taxType === "IGST" ? (
                <div><span>IGST</span><strong>{formatMoney(igstAmount)}</strong></div>
              ) : (
                <>
                  <div><span>CGST</span><strong>{formatMoney(cgstAmount)}</strong></div>
                  <div><span>SGST</span><strong>{formatMoney(sgstAmount)}</strong></div>
                </>
              )}
            </div>
          )}

          {paymentMode === "CASH" ? (
            <div className="cash-entry-grid">
              <label className="field-label">
                <span>Cash tendered</span>
                <span className="money-input">
                  <span>₹</span>
                  <input
                    data-testid="input-cash-tendered"
                    inputMode="decimal"
                    min="0"
                    onChange={(event) => onCashTenderedChange(event.target.value)}
                    step="0.01"
                    type="number"
                    value={cashTendered}
                  />
                </span>
              </label>
              <div className={`change-preview ${remaining > 0 ? "is-short" : ""}`}>
                <span>{remaining > 0 ? "Still due" : "Change to return"}</span>
                <strong data-testid="text-checkout-change">
                  {formatMoney(remaining > 0 ? remaining : changeDue)}
                </strong>
              </div>
            </div>
          ) : paymentMode === "UPI" ? (
            <div className="noncash-note">
              <CreditCard aria-hidden="true" size={18} />
              <span>Record {formatMoney(grandTotal)} as a UPI sale. Payment remains unverified by this app.</span>
            </div>
          ) : paymentMode !== "CREDIT" ? (
            <div className="noncash-note">
              <CreditCard aria-hidden="true" size={18} />
              <span>
                Record <strong>{formatMoney(grandTotal)}</strong> as paid by {paymentModes.find((mode) => mode.value === paymentMode)?.label}.
              </span>
            </div>
          ) : null}

          <div className="checkout-total">
            <span>Final payable</span>
            <strong data-testid="text-checkout-grand-total">{formatMoney(grandTotal)}</strong>
          </div>

          <footer className="dialog-actions">
            <button
              className="button button-secondary"
              data-testid="button-cancel-checkout"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Back to cart <span className="keycap">Esc</span>
            </button>
            <button
              className="button button-primary"
              data-testid="button-confirm-checkout"
              disabled={
                isSaving ||
                !canConfirm ||
                (paymentMode === "CASH" && tendered < grandTotal) ||
                (paymentMode === "CREDIT" && customerId === null)
              }
              type="submit"
            >
              {isSaving ? "Saving invoice…" : "Confirm & print"}
              {!isSaving && <ArrowRight aria-hidden="true" size={17} />}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}