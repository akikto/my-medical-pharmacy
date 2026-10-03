import { ArrowUpRight, CreditCard, X } from "lucide-react";
import { useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Customer, CustomerPaymentInput } from "../../types";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { createUpiPaymentLink } from "../../utils/upi";
import { formatMoney } from "../../utils/money";

interface CustomerPaymentDialogProps {
  customer: Customer;
  error: string | null;
  isSaving: boolean;
  upiId: string;
  upiDisplayName: string;
  onClose: () => void;
  onSave: (input: Omit<CustomerPaymentInput, "customer_id">) => void;
}

export function CustomerPaymentDialog({
  customer,
  error,
  isSaving,
  upiId,
  upiDisplayName,
  onClose,
  onSave,
}: CustomerPaymentDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [amount, setAmount] = useState(customer.balance_due.toFixed(2));
  const [paymentMode, setPaymentMode] =
    useState<CustomerPaymentInput["payment_mode"]>("CASH");
  const [upiTransactionId, setUpiTransactionId] = useState("");
  const [note, setNote] = useState("");
  const [upiOpenError, setUpiOpenError] = useState<string | null>(null);
  const amountNumber = Number(amount);
  const isValidAmount =
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    amountNumber <= customer.balance_due;
  const amountError =
    !amount.trim()
      ? "Enter a collection amount."
      : !Number.isFinite(amountNumber)
        ? "Enter a valid collection amount."
        : amountNumber <= 0
          ? "Collection amount must be greater than ₹0."
          : amountNumber > customer.balance_due
            ? `Collection cannot exceed the outstanding balance of ${formatMoney(customer.balance_due)}.`
            : null;
  const upiLink =
    paymentMode === "UPI"
      ? createUpiPaymentLink(
          upiId,
          upiDisplayName,
          isValidAmount ? amountNumber : 0,
          `Customer collection ${customer.name}`,
        )
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

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({
      amount: amountNumber,
      payment_mode: paymentMode,
      upi_transaction_id: upiTransactionId,
      note,
    });
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="customer-payment-title"
        aria-modal="true"
        className="workspace-dialog"
        data-testid="dialog-customer-payment"
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">CUSTOMER LEDGER</span>
            <h2 id="customer-payment-title">Record a collection</h2>
            <p>{customer.name} · outstanding {formatMoney(customer.balance_due)}</p>
          </div>
          <button
            aria-label="Close collection form"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>
        <form className="workspace-form" onSubmit={handleSubmit}>
          <label className="field-label">
            Collection amount
            <span className="money-input">
              <span>₹</span>
              <input
                autoFocus
                className="workspace-input"
                data-testid="input-customer-payment-amount"
                inputMode="decimal"
                max={customer.balance_due}
                min="0.01"
                onChange={(event) => setAmount(event.target.value)}
                step="0.01"
                type="number"
                value={amount}
              />
            </span>
          </label>
          {amountError && (
            <p
              className="workspace-error"
              data-testid="status-collection-amount-error"
              role="alert"
            >
              {amountError}
            </p>
          )}
          <fieldset className="payment-fieldset">
            <legend>Payment method</legend>
            <div className="payment-mode-options">
              {(["CASH", "UPI", "CARD", "OTHER"] as const).map((mode) => (
                <button
                  aria-pressed={paymentMode === mode}
                  className={`payment-mode-option ${paymentMode === mode ? "is-selected" : ""}`}
                  key={mode}
                  onClick={() => setPaymentMode(mode)}
                  type="button"
                >
                  {mode === "CASH" ? <span className="cash-symbol">₹</span> : <CreditCard size={16} />}
                  {mode === "OTHER" ? "Other" : mode}
                </button>
              ))}
            </div>
          </fieldset>
          {paymentMode === "UPI" && (
            <div className="customer-upi-fields">
              {upiLink ? (
                <button
                  className="button button-secondary"
                  data-testid="button-open-collection-upi"
                  onClick={() => void openUpiPayment()}
                  type="button"
                >
                  Open UPI app <ArrowUpRight size={15} />
                </button>
              ) : (
                <p className="field-hint">
                  Add the pharmacy UPI ID in Settings to create a payment link.
                </p>
              )}
              {upiOpenError && <p className="customer-lookup-error" role="alert">{upiOpenError}</p>}
              <label className="field-label">
                UPI transaction ID <span className="field-optional">Optional</span>
                <input
                  className="workspace-input"
                  data-testid="input-collection-upi-reference"
                  maxLength={120}
                  onChange={(event) => setUpiTransactionId(event.target.value)}
                  value={upiTransactionId}
                />
              </label>
              <p className="customer-upi-warning" role="note">
                This app does not verify UPI payments. Confirm payment in your UPI app before recording this collection.
              </p>
            </div>
          )}
          <label className="field-label">
            Note <span className="field-optional">Optional</span>
            <input
              className="workspace-input"
              data-testid="input-collection-note"
              maxLength={250}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
          </label>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button
              className="button button-secondary"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              data-testid="button-save-collection"
              disabled={isSaving || !isValidAmount}
              type="submit"
            >
              {isSaving
                ? "Saving…"
                : isValidAmount
                  ? `Record ${formatMoney(amountNumber)}`
                  : "Fix amount"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}