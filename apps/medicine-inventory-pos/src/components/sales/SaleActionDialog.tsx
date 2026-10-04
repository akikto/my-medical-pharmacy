import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import type {
  Customer,
  CustomerCollectionMode,
  SaleCorrectionInput,
  SaleDetails,
  SaleReturnInput,
  SaleVoidInput,
} from "../../types";
import { formatMoney } from "../../utils/money";

export type SaleActionKind = "return" | "correct" | "cancel";

interface SaleActionDialogProps {
  kind: SaleActionKind;
  sale: SaleDetails;
  customers: Customer[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onReturn: (input: SaleReturnInput) => void;
  onCorrect: (input: SaleCorrectionInput) => void;
  onCancelSale: (input: SaleVoidInput) => void;
}

type EditableLine = {
  sale_item_id: number;
  quantity: number;
  unit_price: number;
};

const RETURN_MODES: CustomerCollectionMode[] = ["CASH", "UPI", "BANK", "OTHER"];
const SETTLEMENT_MODES: Array<CustomerCollectionMode | "ACCOUNT"> = [
  "ACCOUNT",
  "CASH",
  "CARD",
  "UPI",
  "BANK",
  "OTHER",
];

export function SaleActionDialog({
  kind,
  sale,
  customers,
  error,
  isSaving,
  onClose,
  onReturn,
  onCorrect,
  onCancelSale,
}: SaleActionDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, string>>({});
  const [refundMode, setRefundMode] = useState<CustomerCollectionMode>("CASH");
  const [refundReference, setRefundReference] = useState("");
  const [refundUpiId, setRefundUpiId] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [cancelMode, setCancelMode] = useState<SaleVoidInput["refund_mode"]>(
    sale.sale.payment_mode === "CREDIT"
      ? "ACCOUNT"
      : (sale.sale.payment_mode as SaleVoidInput["refund_mode"]),
  );
  const [cancelReference, setCancelReference] = useState("");
  const [cancelUpiId, setCancelUpiId] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [lineEdits, setLineEdits] = useState<EditableLine[]>(() =>
    sale.items.map((item) => ({
      sale_item_id: item.id,
      quantity: item.quantity,
      unit_price: item.unit_price,
    })),
  );
  const [customerId, setCustomerId] = useState(
    sale.sale.customer_id === null ? "" : String(sale.sale.customer_id),
  );
  const [customerName, setCustomerName] = useState(sale.sale.customer_name ?? "");
  const [customerPhone, setCustomerPhone] = useState(sale.sale.customer_phone ?? "");
  const [paymentMode, setPaymentMode] = useState(sale.sale.payment_mode);
  const [cashTendered, setCashTendered] = useState(String(sale.sale.cash_tendered));
  const [paymentReference, setPaymentReference] = useState(
    sale.sale.payment_reference ?? "",
  );
  const [upiTransactionId, setUpiTransactionId] = useState(
    sale.sale.upi_transaction_id ?? "",
  );
  const [adjustmentMode, setAdjustmentMode] = useState<
    SaleCorrectionInput["adjustment_mode"]
  >("");
  const [adjustmentReference, setAdjustmentReference] = useState("");
  const [adjustmentUpiId, setAdjustmentUpiId] = useState("");
  const [invoiceNotes, setInvoiceNotes] = useState(sale.sale.notes ?? "");
  const [reason, setReason] = useState("");

  useDialogFocusTrap(dialogRef);

  const title =
    kind === "return"
      ? "Record a sales return"
      : kind === "correct"
        ? "Correct invoice"
        : "Cancel invoice";
  const returnSelection = useMemo(
    () =>
      sale.items
        .map((item) => ({
          sale_item_id: item.id,
          quantity: Number(returnQuantities[item.id] ?? 0),
        }))
        .filter((item) => item.quantity > 0),
    [returnQuantities, sale.items],
  );
  const returnQuantityValid = sale.items.every((item) => {
    const value = returnQuantities[item.id];
    if (!value) return true;
    const quantity = Number(value);
    return (
      Number.isSafeInteger(quantity) &&
      quantity >= 0 &&
      quantity <= item.quantity - item.returned_quantity
    );
  });
  const note =
    kind === "return" ? returnNote : kind === "cancel" ? cancelNote : reason;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind === "return") {
      onReturn({
        invoice_no: sale.sale.invoice_no,
        items: returnSelection,
        refund_mode: refundMode,
        payment_reference: refundReference,
        upi_transaction_id: refundUpiId,
        note: returnNote,
      });
      return;
    }
    if (kind === "cancel") {
      onCancelSale({
        invoice_no: sale.sale.invoice_no,
        refund_mode: cancelMode,
        payment_reference: cancelReference,
        upi_transaction_id: cancelUpiId,
        note: cancelNote,
      });
      return;
    }
    onCorrect({
      invoice_no: sale.sale.invoice_no,
      customer_id: customerId ? Number(customerId) : null,
      customer_name: customerName,
      customer_phone: customerPhone,
      payment_mode: paymentMode as SaleCorrectionInput["payment_mode"],
      cash_tendered: Number(cashTendered),
      payment_reference: paymentReference,
      upi_transaction_id: paymentMode === "UPI" ? upiTransactionId : "",
      adjustment_mode: adjustmentMode,
      adjustment_reference: adjustmentReference,
      adjustment_upi_transaction_id: adjustmentMode === "UPI" ? adjustmentUpiId : "",
      notes: invoiceNotes,
      reason,
      items: lineEdits,
    });
  }

  function selectCustomer(value: string) {
    setCustomerId(value);
    if (!value) return;
    const customer = customers.find((item) => item.id === Number(value));
    if (customer) {
      setCustomerName(customer.name);
      setCustomerPhone(customer.phone ?? "");
    }
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        ref={dialogRef}
        aria-labelledby="sale-action-title"
        aria-modal="true"
        className="workspace-dialog sale-action-dialog"
        data-testid={`dialog-sale-${kind}`}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">{sale.sale.invoice_no}</span>
            <h2 id="sale-action-title">{title}</h2>
            <p>{formatMoney(sale.sale.grand_total)} · {sale.sale.customer_name || "Walk-in"}</p>
          </div>
          <button
            aria-label={`Close ${title.toLowerCase()}`}
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form className="workspace-form sale-action-form" onSubmit={handleSubmit}>
          {kind === "return" && (
            <>
              <p className="field-hint">
                Choose quantities from this invoice. The refund is calculated from the saved
                invoice prices, discounts, and GST; earlier returns reduce the remaining quantity.
              </p>
              <div className="sale-action-lines">
                {sale.items.map((item) => {
                  const remaining = item.quantity - item.returned_quantity;
                  return (
                    <label className="sale-action-line" key={item.id}>
                      <span>
                        <strong>{item.medicine_name}</strong>
                        <small>
                          Batch {item.batch_no} · sold {item.quantity} · returned{" "}
                          {item.returned_quantity} · left {remaining}
                        </small>
                      </span>
                      <input
                        aria-label={`Return quantity for ${item.medicine_name}, batch ${item.batch_no}`}
                        className="workspace-input"
                        data-testid={`input-return-quantity-${item.id}`}
                        disabled={remaining <= 0}
                        inputMode="numeric"
                        max={remaining}
                        min="0"
                        onChange={(event) =>
                          setReturnQuantities((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        type="number"
                        value={returnQuantities[item.id] ?? ""}
                      />
                    </label>
                  );
                })}
              </div>
              {!returnQuantityValid && (
                <p className="workspace-error" role="alert">
                  A return quantity cannot exceed the unreturned quantity.
                </p>
              )}
              {sale.sale.customer_id !== null && (
                <p className="field-hint">
                  The return will reduce this customer’s outstanding balance; only any amount beyond
                  their due can be refunded.
                </p>
              )}
              <SelectField
                label="Refund method"
                value={refundMode}
                onChange={(value) => setRefundMode(value as CustomerCollectionMode)}
                options={RETURN_MODES.map((value) => [value, value === "OTHER" ? "Other" : value])}
              />
              <TextField
                label="Payment reference"
                value={refundReference}
                onChange={setRefundReference}
                testId="input-return-payment-reference"
              />
              {refundMode === "UPI" && (
                <>
                  <TextField
                    label="UPI transaction ID"
                    value={refundUpiId}
                    onChange={setRefundUpiId}
                    testId="input-return-upi-id"
                  />
                  <p className="customer-upi-warning" role="note">
                    This app does not verify UPI payments. Confirm the refund in your UPI app.
                  </p>
                </>
              )}
              <TextField
                label="Return note"
                value={returnNote}
                onChange={setReturnNote}
                testId="input-return-note"
              />
            </>
          )}

          {kind === "cancel" && (
            <>
              <p className="sale-action-warning" role="note">
                This restores the invoice quantities to their original batches and records a refund
                or customer-account credit. It does not delete the invoice.
              </p>
              <SelectField
                label="Refund method"
                value={cancelMode}
                onChange={(value) =>
                  setCancelMode(value as SaleVoidInput["refund_mode"])
                }
                options={SETTLEMENT_MODES.map((value) => [
                  value,
                  value === "ACCOUNT" ? "Customer account" : value === "OTHER" ? "Other" : value,
                ])}
              />
              {cancelMode !== "ACCOUNT" && (
                <TextField
                  label="Payment reference"
                  value={cancelReference}
                  onChange={setCancelReference}
                  testId="input-cancel-payment-reference"
                />
              )}
              {cancelMode === "UPI" && (
                <>
                  <TextField
                    label="UPI transaction ID"
                    value={cancelUpiId}
                    onChange={setCancelUpiId}
                    testId="input-cancel-upi-id"
                  />
                  <p className="customer-upi-warning" role="note">
                    This app does not verify UPI payments. Confirm the refund in your UPI app.
                  </p>
                </>
              )}
              <TextField
                label="Cancellation reason"
                value={cancelNote}
                onChange={setCancelNote}
                required
                testId="input-cancel-reason"
              />
            </>
          )}

          {kind === "correct" && (
            <>
              <p className="sale-action-warning" role="note">
                Corrections are restricted to the original batch lines. The app keeps the original
                invoice snapshot and saves an audit record. Invoices with returns cannot be edited.
              </p>
              <label className="field-label">
                Saved customer
                <select
                  className="workspace-input"
                  data-testid="select-correction-customer"
                  onChange={(event) => selectCustomer(event.target.value)}
                  value={customerId}
                >
                  <option value="">Walk-in customer</option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}{customer.active ? "" : " (archived)"}
                    </option>
                  ))}
                </select>
              </label>
              {customerId === "" && (
                <div className="sale-action-fields">
                  <TextField label="Customer name" value={customerName} onChange={setCustomerName} />
                  <TextField label="Customer phone" value={customerPhone} onChange={setCustomerPhone} />
                </div>
              )}
              <div className="sale-action-lines">
                {sale.items.map((item, index) => (
                  <div className="sale-action-line sale-action-line--edit" key={item.id}>
                    <span>
                      <strong>{item.medicine_name}</strong>
                      <small>Batch {item.batch_no} · original quantity {item.quantity}</small>
                    </span>
                    <label>
                      Quantity
                      <input
                        aria-label={`Correct quantity for ${item.medicine_name}`}
                        className="workspace-input"
                        data-testid={`input-correction-quantity-${item.id}`}
                        min="1"
                        onChange={(event) =>
                          setLineEdits((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? { ...line, quantity: Number(event.target.value) }
                                : line,
                            ),
                          )
                        }
                        type="number"
                        value={lineEdits[index]?.quantity ?? item.quantity}
                      />
                    </label>
                    <label>
                      Unit price
                      <input
                        aria-label={`Correct unit price for ${item.medicine_name}`}
                        className="workspace-input"
                        data-testid={`input-correction-price-${item.id}`}
                        min="0"
                        onChange={(event) =>
                          setLineEdits((current) =>
                            current.map((line, lineIndex) =>
                              lineIndex === index
                                ? { ...line, unit_price: Number(event.target.value) }
                                : line,
                            ),
                          )
                        }
                        step="0.01"
                        type="number"
                        value={lineEdits[index]?.unit_price ?? item.unit_price}
                      />
                    </label>
                  </div>
                ))}
              </div>
              <SelectField
                label="Payment method"
                value={paymentMode}
                onChange={(value) =>
                  setPaymentMode(value as SaleCorrectionInput["payment_mode"])
                }
                options={["CASH", "CARD", "UPI", "CREDIT", "OTHER"].map((value) => [value, value])}
              />
              {paymentMode === "CASH" && (
                <TextField label="Cash tendered" value={cashTendered} onChange={setCashTendered} type="number" />
              )}
              {(paymentMode === "UPI" || paymentMode === "CARD") && (
                <TextField label="Payment reference" value={paymentReference} onChange={setPaymentReference} />
              )}
              {paymentMode === "UPI" && (
                <TextField label="UPI transaction ID" value={upiTransactionId} onChange={setUpiTransactionId} />
              )}
              <SelectField
                label="Settle any correction difference"
                value={adjustmentMode}
                onChange={(value) =>
                  setAdjustmentMode(value as SaleCorrectionInput["adjustment_mode"])
                }
                options={[
                  ["", "Choose if a balance changes"],
                  ...SETTLEMENT_MODES.map((value) => [
                    value,
                    value === "ACCOUNT" ? "Customer account" : value === "OTHER" ? "Other" : value,
                  ] as [string, string]),
                ]}
              />
              {adjustmentMode && adjustmentMode !== "ACCOUNT" && (
                <>
                  <TextField
                    label="Settlement reference"
                    value={adjustmentReference}
                    onChange={setAdjustmentReference}
                  />
                  {adjustmentMode === "UPI" && (
                    <TextField
                      label="Settlement UPI transaction ID"
                      value={adjustmentUpiId}
                      onChange={setAdjustmentUpiId}
                    />
                  )}
                </>
              )}
              <TextField label="Invoice notes" value={invoiceNotes} onChange={setInvoiceNotes} />
              <TextField
                label="Correction reason"
                value={reason}
                onChange={setReason}
                required
                testId="input-correction-reason"
              />
            </>
          )}

          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="button button-primary"
              data-testid={`button-submit-sale-${kind}`}
              disabled={
                isSaving ||
                (kind === "return" && (!returnSelection.length || !returnQuantityValid)) ||
                (kind === "cancel" && !cancelNote.trim()) ||
                (kind === "correct" && !reason.trim())
              }
              type="submit"
            >
              {isSaving ? "Saving…" : kind === "return" ? "Record return" : kind === "correct" ? "Save correction" : "Cancel invoice"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  testId?: string;
}) {
  return (
    <label className="field-label">
      {label}{required ? "" : <span className="field-optional">Optional</span>}
      <input
        className="workspace-input"
        data-testid={testId}
        maxLength={type === "number" ? undefined : 500}
        min={type === "number" ? "0" : undefined}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        step={type === "number" ? "0.01" : undefined}
        type={type}
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="field-label">
      {label}
      <select
        className="workspace-input"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}