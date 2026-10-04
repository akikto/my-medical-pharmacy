import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useDialogFocusTrap } from "../../hooks/useDialogFocusTrap";
import type { Medicine, MedicineBatch } from "../../types";
import { formatMoney } from "../../utils/money";

interface BatchPricingDialogProps {
  medicine: Medicine;
  batch: MedicineBatch;
  error: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: (mrp: number, saleRate: number, rackLocation: string) => void;
}

export function BatchPricingDialog({
  medicine,
  batch,
  error,
  isSaving,
  onClose,
  onSave,
}: BatchPricingDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useDialogFocusTrap(dialogRef, isSaving ? undefined : onClose);

  const [mrp, setMrp] = useState(String(batch.mrp));
  const [saleRate, setSaleRate] = useState(String(batch.sale_rate));
  const [rackLocation, setRackLocation] = useState(medicine.rack_location ?? "");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(Number(mrp), Number(saleRate), rackLocation);
  }

  return (
    <div className="dialog-backdrop inventory-dialog-backdrop inventory-dialog-backdrop--top">
      <section
        aria-labelledby="batch-pricing-title"
        aria-modal="true"
        className="workspace-dialog workspace-dialog--narrow"
        data-testid="dialog-batch-pricing"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="dialog-header">
          <div>
            <span className="eyebrow">BATCH DETAILS</span>
            <h2 id="batch-pricing-title">Edit batch pricing</h2>
            <p>{medicine.name} · Batch {batch.batch_no}</p>
          </div>
          <button aria-label="Close batch editor" className="icon-button" disabled={isSaving} onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>
        <form className="workspace-form" onSubmit={handleSubmit}>
          <div className="workspace-form-grid">
            <label className="field-label">
              Purchase rate
              <input className="workspace-input" disabled value={formatMoney(batch.purchase_rate)} />
            </label>
            <label className="field-label">
              MRP
              <input
                className="workspace-input"
                data-testid="input-batch-mrp"
                min={0}
                onChange={(event) => setMrp(event.target.value)}
                required
                step="0.01"
                type="number"
                value={mrp}
              />
            </label>
            <label className="field-label">
              Sale rate
              <input
                className="workspace-input"
                data-testid="input-batch-sale-rate"
                min={0}
                onChange={(event) => setSaleRate(event.target.value)}
                required
                step="0.01"
                type="number"
                value={saleRate}
              />
            </label>
            <label className="field-label">
              Rack location
              <input
                className="workspace-input"
                data-testid="input-batch-rack"
                maxLength={80}
                onChange={(event) => setRackLocation(event.target.value)}
                value={rackLocation}
              />
            </label>
          </div>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <footer className="dialog-actions">
            <button className="button button-secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button-primary" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : "Save batch"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}