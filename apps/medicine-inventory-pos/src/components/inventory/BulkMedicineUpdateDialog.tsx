import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import type { BulkMedicineFieldUpdate, MedicineInventoryRow } from "../../types";

type MedicineSummary = Pick<MedicineInventoryRow, "id" | "name" | "min_stock_alert">;
type TextFieldKey = "company" | "product_type" | "strength" | "rack_location";
type TextFieldState = Record<TextFieldKey, { enabled: boolean; value: string }>;

const textFieldLabels: Record<TextFieldKey, string> = {
  company: "Company",
  product_type: "Product type",
  strength: "Strength",
  rack_location: "Rack location",
};

const textFieldLimits: Record<TextFieldKey, number> = {
  company: 120,
  product_type: 80,
  strength: 80,
  rack_location: 80,
};

function describeUpdate(update: BulkMedicineFieldUpdate): string {
  switch (update.field) {
    case "company":
    case "product_type":
    case "strength":
    case "rack_location":
      return `${textFieldLabels[update.field]}: ${update.value ?? "clear value"}`;
    case "min_stock_alert":
      return `Reorder alert: ${update.value}`;
    case "gst_rate_basis_points":
      return `GST rate: ${update.value === null ? "clear override" : `${(update.value / 100).toFixed(2)}%`}`;
  }
}

interface BulkMedicineUpdateDialogProps {
  medicines: MedicineSummary[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (updates: BulkMedicineFieldUpdate[]) => void;
}

export function BulkMedicineUpdateDialog({
  medicines,
  error,
  isSaving,
  onClose,
  onSave,
}: BulkMedicineUpdateDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [textFields, setTextFields] = useState<TextFieldState>({
    company: { enabled: false, value: "" },
    product_type: { enabled: false, value: "" },
    strength: { enabled: false, value: "" },
    rack_location: { enabled: false, value: "" },
  });
  const [reorderEnabled, setReorderEnabled] = useState(false);
  const [reorderLevel, setReorderLevel] = useState("");
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstRate, setGstRate] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  const updates: BulkMedicineFieldUpdate[] = [];
  if (textFields.company.enabled) {
    updates.push({ field: "company", value: textFields.company.value.trim() || null });
  }
  if (textFields.product_type.enabled) {
    updates.push({ field: "product_type", value: textFields.product_type.value.trim() || null });
  }
  if (textFields.strength.enabled) {
    updates.push({ field: "strength", value: textFields.strength.value.trim() || null });
  }
  if (textFields.rack_location.enabled) {
    updates.push({ field: "rack_location", value: textFields.rack_location.value.trim() || null });
  }
  const parsedReorderLevel = Number(reorderLevel);
  if (reorderEnabled) {
    updates.push({ field: "min_stock_alert", value: parsedReorderLevel });
  }
  const parsedGstRate = gstRate.trim() === "" ? null : Number(gstRate);
  const gstBasisPoints = parsedGstRate === null ? null : Math.round(parsedGstRate * 100);
  if (gstEnabled) {
    updates.push({ field: "gst_rate_basis_points", value: gstBasisPoints });
  }

  const isReorderValid =
    !reorderEnabled ||
    (reorderLevel.trim() !== "" &&
      Number.isSafeInteger(parsedReorderLevel) &&
      parsedReorderLevel >= 0 &&
      parsedReorderLevel <= 1_000_000_000);
  const isGstValid =
    !gstEnabled ||
    parsedGstRate === null ||
    (Number.isFinite(parsedGstRate) && parsedGstRate >= 0 && parsedGstRate <= 100);
  const isValid = updates.length > 0 && isReorderValid && isGstValid;

  function updateTextField(field: TextFieldKey, update: Partial<TextFieldState[TextFieldKey]>) {
    setTextFields((current) => ({
      ...current,
      [field]: { ...current[field], ...update },
    }));
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="bulk-medicine-update-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--narrow"
        data-testid="dialog-bulk-medicine-update"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">BULK MEDICINE CONTROL</span>
            <h2 id="bulk-medicine-update-title">Update selected medicines</h2>
            <p>Choose only the shared fields to change for these {medicines.length} medicines.</p>
          </div>
          <button
            aria-label="Close bulk medicine update"
            className="icon-button"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <form
          className="workspace-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (isValid) setShowConfirmation(true);
          }}
        >
          {!showConfirmation ? (
            <>
              <div className="bulk-medicine-field-list" aria-label="Fields to update">
                {(Object.keys(textFieldLabels) as TextFieldKey[]).map((field) => (
                  <div className="bulk-medicine-field-row" key={field}>
                    <label className="bulk-medicine-field-toggle">
                      <input
                        checked={textFields[field].enabled}
                        data-testid={`checkbox-bulk-field-${field}`}
                        onChange={(event) => updateTextField(field, { enabled: event.target.checked })}
                        type="checkbox"
                      />
                      {textFieldLabels[field]}
                    </label>
                    {textFields[field].enabled && (
                      <input
                        aria-label={`New ${textFieldLabels[field].toLocaleLowerCase()} for all selected medicines`}
                        className="workspace-input"
                        data-testid={`input-bulk-field-${field}`}
                        maxLength={textFieldLimits[field]}
                        onChange={(event) => updateTextField(field, { value: event.target.value })}
                        placeholder="Leave blank to clear this field"
                        value={textFields[field].value}
                      />
                    )}
                  </div>
                ))}

                <div className="bulk-medicine-field-row">
                  <label className="bulk-medicine-field-toggle">
                    <input
                      checked={reorderEnabled}
                      data-testid="checkbox-bulk-field-min-stock-alert"
                      onChange={(event) => setReorderEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    Reorder alert level
                  </label>
                  {reorderEnabled && (
                    <input
                      aria-label="New reorder alert level for all selected medicines"
                      className="workspace-input"
                      data-testid="input-bulk-field-min-stock-alert"
                      inputMode="numeric"
                      max={1_000_000_000}
                      min={0}
                      onChange={(event) => setReorderLevel(event.target.value)}
                      placeholder="Whole units"
                      step={1}
                      type="number"
                      value={reorderLevel}
                    />
                  )}
                </div>

                <div className="bulk-medicine-field-row">
                  <label className="bulk-medicine-field-toggle">
                    <input
                      checked={gstEnabled}
                      data-testid="checkbox-bulk-field-gst-rate-basis-points"
                      onChange={(event) => setGstEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    GST rate
                  </label>
                  {gstEnabled && (
                    <input
                      aria-label="New GST rate for all selected medicines"
                      className="workspace-input"
                      data-testid="input-bulk-field-gst-rate"
                      max={100}
                      min={0}
                      onChange={(event) => setGstRate(event.target.value)}
                      placeholder="Leave blank to clear the medicine override"
                      step="0.01"
                      type="number"
                      value={gstRate}
                    />
                  )}
                </div>
              </div>

              <div className="bulk-reorder-preview" data-testid="bulk-medicine-update-preview">
                <strong>Changes for all {medicines.length} selected medicines</strong>
                {updates.map((update) => <span key={update.field}>{describeUpdate(update)}</span>)}
                {updates.length === 0 && <small>Select at least one field to update.</small>}
              </div>
              {error && <p className="workspace-error" role="alert">{error}</p>}
              <footer className="dialog-actions">
                <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
                  Cancel
                </button>
                <button className="button button-primary" disabled={isSaving || !isValid} type="submit">
                  Review {medicines.length} changes
                </button>
              </footer>
            </>
          ) : (
            <>
              <div className="bulk-operation-confirmation" data-testid="confirmation-bulk-medicine-update">
                <strong>Update {medicines.length} medicines?</strong>
                <span>
                  Only the listed fields will change. On-hand stock, batches, prices, and transaction history will remain unchanged.
                </span>
                <div className="bulk-operation-confirmation-list">
                  {updates.map((update) => <span key={update.field}>{describeUpdate(update)}</span>)}
                </div>
              </div>
              {error && <p className="workspace-error" role="alert">{error}</p>}
              <footer className="dialog-actions">
                <button
                  className="button button-secondary"
                  disabled={isSaving}
                  onClick={() => setShowConfirmation(false)}
                  type="button"
                >
                  Back to review
                </button>
                <button
                  className="button button-primary"
                  data-testid="button-confirm-bulk-medicine-update"
                  disabled={isSaving}
                  onClick={() => onSave(updates)}
                  type="button"
                >
                  {isSaving ? "Saving…" : `Confirm update for ${medicines.length}`}
                </button>
              </footer>
            </>
          )}
        </form>
      </section>
    </div>
  );
}
