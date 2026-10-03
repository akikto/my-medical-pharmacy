import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import type { MedicineInventoryRow } from "../../types";

interface BulkReorderThresholdDialogProps {
  medicines: MedicineInventoryRow[];
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (minStockAlert: number) => void;
}

export function BulkReorderThresholdDialog({
  medicines,
  error,
  isSaving,
  onClose,
  onSave,
}: BulkReorderThresholdDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  const [minStockAlert, setMinStockAlert] = useState("");
  const [showConfirmation, setShowConfirmation] = useState(false);
  const parsedValue = Number(minStockAlert);
  const isValid =
    minStockAlert.trim() !== "" &&
    Number.isSafeInteger(parsedValue) &&
    parsedValue >= 0 &&
    parsedValue <= 1_000_000_000;

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="bulk-reorder-threshold-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--narrow"
        data-testid="dialog-bulk-reorder-threshold"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">BULK INVENTORY CONTROL</span>
            <h2 id="bulk-reorder-threshold-title">Set reorder level</h2>
            <p>Change only the low-stock alert threshold for the selected medicines.</p>
          </div>
          <button
            aria-label="Close reorder-level update"
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
              <label className="field-label">
                New alert level for all selected medicines
                <input
                  autoFocus
                  className="workspace-input"
                  data-testid="input-bulk-reorder-level"
                  inputMode="numeric"
                  max={1_000_000_000}
                  min={0}
                  onChange={(event) => setMinStockAlert(event.target.value)}
                  required
                  step={1}
                  type="number"
                  value={minStockAlert}
                />
              </label>
              <div className="bulk-reorder-preview">
                {medicines.slice(0, 8).map((medicine) => (
                  <span key={medicine.id}>
                    {medicine.name}: {medicine.min_stock_alert} → {isValid ? parsedValue : "—"}
                  </span>
                ))}
                {medicines.length > 8 && <small>and {medicines.length - 8} more</small>}
              </div>
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
                  disabled={isSaving || !isValid}
                  type="submit"
                >
                  Review {medicines.length} changes
                </button>
              </footer>
            </>
          ) : (
            <>
              <div className="bulk-operation-confirmation" data-testid="confirmation-bulk-reorder-level">
                <strong>Update {medicines.length} medicines?</strong>
                <span>
                  Their reorder alert level will be set to {parsedValue}. This will not
                  change on-hand stock, batches, prices, or transaction history.
                </span>
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
                  data-testid="button-confirm-bulk-reorder-level"
                  disabled={isSaving}
                  onClick={() => onSave(parsedValue)}
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