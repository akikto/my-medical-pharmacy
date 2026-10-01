import { ArrowRight, CreditCard, Phone, UserRound, X } from "lucide-react";
import type { PaymentMode } from "../../types";
import { formatMoney } from "../../utils/money";

interface CheckoutDialogProps {
  customerName: string;
  customerPhone: string;
  paymentMode: PaymentMode;
  cashTendered: string;
  grandTotal: number;
  isSaving: boolean;
  onCustomerNameChange: (value: string) => void;
  onCustomerPhoneChange: (value: string) => void;
  onPaymentModeChange: (value: PaymentMode) => void;
  onCashTenderedChange: (value: string) => void;
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
  customerName,
  customerPhone,
  paymentMode,
  cashTendered,
  grandTotal,
  isSaving,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onPaymentModeChange,
  onCashTenderedChange,
  onClose,
  onConfirm,
}: CheckoutDialogProps) {
  const tendered = Number(cashTendered) || 0;
  const changeDue = paymentMode === "CASH" ? Math.max(tendered - grandTotal, 0) : 0;
  const remaining = paymentMode === "CASH" ? Math.max(grandTotal - tendered, 0) : 0;

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
            <label className="field-label">
              <span>Customer name <span className="field-optional">Optional</span></span>
              <span className="input-with-icon">
                <UserRound aria-hidden="true" size={17} />
                <input
                  autoFocus
                  data-testid="input-customer-name"
                  maxLength={120}
                  onChange={(event) => onCustomerNameChange(event.target.value)}
                  placeholder="Walk-in customer"
                  value={customerName}
                />
              </span>
            </label>
            <label className="field-label">
              <span>Mobile number <span className="field-optional">Optional</span></span>
              <span className="input-with-icon">
                <Phone aria-hidden="true" size={17} />
                <input
                  autoComplete="tel"
                  data-testid="input-customer-phone"
                  inputMode="tel"
                  maxLength={30}
                  onChange={(event) => onCustomerPhoneChange(event.target.value)}
                  placeholder="Customer phone"
                  value={customerPhone}
                />
              </span>
            </label>
          </div>

          <fieldset className="payment-fieldset">
            <legend>Payment method</legend>
            <div className="payment-mode-options">
              {paymentModes.map((mode) => (
                <button
                  aria-pressed={paymentMode === mode.value}
                  className={`payment-mode-option ${paymentMode === mode.value ? "is-selected" : ""}`}
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
          ) : (
            <div className="noncash-note">
              <CreditCard aria-hidden="true" size={18} />
              <span>
                Record <strong>{formatMoney(grandTotal)}</strong> as paid by {paymentModes.find((mode) => mode.value === paymentMode)?.label}.
              </span>
            </div>
          )}

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
              disabled={isSaving || (paymentMode === "CASH" && tendered < grandTotal)}
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