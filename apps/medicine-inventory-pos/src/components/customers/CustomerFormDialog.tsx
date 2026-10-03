import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Customer, CustomerFormValues } from "../../types";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import { gstStates } from "../../utils/gstStates";

interface CustomerFormDialogProps {
  customer: Customer | null;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (values: CustomerFormValues) => void;
}

const emptyValues: CustomerFormValues = {
  name: "",
  phone: "",
  address: "",
  notes: "",
  state_code: "",
};

export function CustomerFormDialog({
  customer,
  error,
  isSaving,
  onClose,
  onSave,
}: CustomerFormDialogProps) {
  const [values, setValues] = useState<CustomerFormValues>(emptyValues);
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef);

  useEffect(() => {
    setValues(
      customer
        ? {
            name: customer.name,
            phone: customer.phone ?? "",
            address: customer.address ?? "",
            notes: customer.notes ?? "",
            state_code: customer.state_code ?? "",
          }
        : emptyValues,
    );
  }, [customer]);

  function setField<K extends keyof CustomerFormValues>(
    field: K,
    value: CustomerFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(values);
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="customer-dialog-title"
        aria-modal="true"
        className="workspace-dialog"
        data-testid="dialog-customer"
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">CUSTOMER MASTER</span>
            <h2 id="customer-dialog-title">
              {customer ? "Edit customer" : "Add customer"}
            </h2>
            <p>Customer details support invoice lookup and state-based GST.</p>
          </div>
          <button
            aria-label="Close customer form"
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
            Customer name
            <input
              autoFocus
              className="workspace-input"
              data-testid="input-customer-master-name"
              maxLength={120}
              onChange={(event) => setField("name", event.target.value)}
              required
              value={values.name}
            />
          </label>
          <div className="workspace-form-grid">
            <label className="field-label">
              Mobile number <span className="field-optional">Optional</span>
              <input
                autoComplete="tel"
                className="workspace-input"
                data-testid="input-customer-master-phone"
                inputMode="tel"
                maxLength={40}
                onChange={(event) => setField("phone", event.target.value)}
                value={values.phone}
              />
              <span className="field-hint">
                Saved phone numbers must be unique.
              </span>
            </label>
            <label className="field-label">
              GST state <span className="field-optional">Optional</span>
              <select
                className="workspace-input"
                data-testid="select-customer-state"
                onChange={(event) => setField("state_code", event.target.value)}
                value={values.state_code}
              >
                <option value="">Not specified</option>
                {gstStates.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.code} · {state.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Address <span className="field-optional">Optional</span>
              <textarea
                className="workspace-input workspace-textarea"
                data-testid="input-customer-address"
                maxLength={500}
                onChange={(event) => setField("address", event.target.value)}
                rows={3}
                value={values.address}
              />
            </label>
            <label className="field-label">
              Notes <span className="field-optional">Optional</span>
              <textarea
                className="workspace-input workspace-textarea"
                data-testid="input-customer-notes"
                maxLength={500}
                onChange={(event) => setField("notes", event.target.value)}
                rows={3}
                value={values.notes}
              />
            </label>
          </div>
          {error && (
            <p className="workspace-error" role="alert">
              {error}
            </p>
          )}
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
              data-testid="button-save-customer"
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? "Saving…" : customer ? "Save changes" : "Add customer"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}